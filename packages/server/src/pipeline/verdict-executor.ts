// ============================================================
// verdict-executor.ts — 裁决双通道
//
// command 通道（第一公民）：引擎执行确定性命令，exit code 映射裁决。
//   测试通过与否不再是 LLM 的自我报告 —— pnpm test 说了算。
// llm 通道（兜底/语义）：三级宽松解析输出末尾的结构化 JSON。
//
// 可注入命令执行器（单测 mock 用）。
// ============================================================

import { spawn } from "child_process";
import type { VerdictSpec } from "./pipeline-defs.js";

export interface VerdictResult {
  verdict: string;
  source: "command" | "llm";
  warnings?: string[];
}

/** 可注入的命令执行器（默认真 spawn；单测传 mock） */
export type CommandRunner = (cmd: string, cwd: string, timeoutMs: number) => Promise<{ exitCode: number | null; stderr: string }>;

const defaultCommandRunner: CommandRunner = (cmd, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd, timeout: timeoutMs });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); if (stderr.length > 4000) stderr = stderr.slice(-4000); });
    child.on("error", (err) => resolve({ exitCode: null, stderr: String(err) }));
    child.on("close", (code) => resolve({ exitCode: code, stderr }));
  });

export function createVerdictExecutor(runCommand: CommandRunner = defaultCommandRunner) {
  return {
    /**
     * 裁决入口。
     * - spec.command 存在 → command 通道（命令通过后如还需语义判断，继续 llm 通道叠加）
     * - 否则 → llm 通道
     */
    async decide(spec: VerdictSpec, output: string, cwd: string): Promise<VerdictResult | null> {
      if (!spec.command && !spec.promptHint) return null; // 无裁决约定
      const warnings: string[] = [];

      if (spec.command) {
        const timeoutMs = spec.command.timeoutMs ?? 300_000;
        const { exitCode, stderr } = await runCommand(spec.command.cmd, cwd, timeoutMs);
        if (exitCode === 0) {
          // 命令通过；若有 promptHint 还需语义补充则继续 llm 通道（如整体验收）
          if (spec.promptHint) {
            const llm = parseLlmVerdict(spec, output);
            if (llm) return { verdict: llm.verdict, source: "llm", warnings: llm.warnings };
          }
          return { verdict: spec.command.passWhen, source: "command" };
        }
        // 命令失败/超时
        const failWhen = spec.command.failWhen ?? "fail";
        if (exitCode === null) warnings.push(`裁决命令超时或启动失败（>${timeoutMs}ms）: ${spec.command.cmd}`);
        else warnings.push(`裁决命令失败(exit=${exitCode}): ${spec.command.cmd}${stderr ? ` — ${stderr.slice(-300)}` : ""}`);
        return { verdict: failWhen, source: "command", warnings };
      }

      // 纯 llm 通道
      const llm = parseLlmVerdict(spec, output);
      if (!llm) return null;
      return { verdict: llm.verdict, source: "llm", warnings: llm.warnings };
    },
  };
}

/** llm 三级宽松解析：JSON 块 → 关键词 → unknown */
function parseLlmVerdict(spec: VerdictSpec, output: string): { verdict: string; warnings?: string[] } | null {
  const warnings: string[] = [];
  const legal = spec.type === "route" ? (spec.routes ?? []) : ["pass", "fail"];

  // ① 最后一个 ```json {...} ``` 代码块
  const jsonBlocks = [...output.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = jsonBlocks.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(jsonBlocks[i][1].trim());
      const v = obj?.verdict ?? obj?.route ?? obj?.result;
      if (typeof v === "string") {
        const lower = v.toLowerCase();
        if (legal.includes(lower) || legal.includes(v)) return { verdict: legal.includes(v) ? v : lower };
        warnings.push(`verdict 值 "${v}" 不在合法集 [${legal.join(",")}]，尝试关键词解析`);
        break;
      }
    } catch { /* 解析失败继续 */ }
  }

  // ② 末 200 字关键词匹配（按 legal 集合）
  const tail = output.slice(-200).toLowerCase();
  for (const kw of legal) {
    if (tail.includes(kw.toLowerCase())) return { verdict: kw };
  }

  // ③ unknown
  warnings.push("verdict 解析失败（无合法 JSON 块、无关键词），视为 unknown");
  return { verdict: "unknown", warnings };
}
