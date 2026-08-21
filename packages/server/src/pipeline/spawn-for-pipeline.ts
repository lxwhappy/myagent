// ============================================================
// spawn-for-pipeline.ts — 流水线 job 执行适配层
//
// 职责（引擎与 runSubagent 之间唯一的桥）：
//   1. 组装 job 输入（上游输出 + 产物文件内容强制注入 + 分片上下文）
//   2. 查 AgentConfig（agentId → systemPrompt/model/disabledTools/skills）
//   3. 调 runSubagent（concurrent: true 绕过会话串行锁）
//   4. 归一化结果（输出截断 / subId 登记 / usage 计数）
// ============================================================

import { readFile } from "fs/promises";
import { resolve as resolvePath } from "path";
import { agentConfigStore } from "../agent-configs.js";
import { config } from "../config.js";

export interface SpawnJobParams {
  stepId: string;
  name: string;
  role: string;
  instructions?: string;
  agentId?: string;
  skills?: string[];
  /** 完整拼装好的输入文本（由引擎准备） */
  jobInput: string;
  cwd?: string;
  maxTurns?: number;
}

export interface SpawnJobResult {
  output: string;
  error?: string;
  subId?: string;
  durationMs: number;
}

/** 可注入的 spawn 函数类型（单测 mock 用；真实实现调 runSubagent） */
export type SpawnJobFn = (params: SpawnJobParams) => Promise<SpawnJobResult>;

/**
 * 真实实现：通过 runSubagent 跑 job。
 * 注意 parentSessionId 用 pipeline 专属前缀，与聊天会话隔离；
 * concurrent: true 跳过串行锁（锁保留给 LLM 驱动的团队模式）。
 */
export function createRealSpawnJob(): SpawnJobFn {
  return async (params) => {
    const { runSubagent } = await import("../subagent-runner.js");
    const agent = params.agentId ? await agentConfigStore.get(params.agentId) : undefined;

    // Agent 预设的角色指令作为 goal 前缀（与 chat 场景同源）
    const sysPromptPrefix = agent?.systemPrompt?.trim() ? `${agent.systemPrompt.trim()}\n\n` : "";
    const goal = `${sysPromptPrefix}${params.jobInput}`;

    const result = await runSubagent(
      `pipeline-${params.stepId}`,           // parentSessionId（隔离命名空间）
      goal,
      undefined,                              // context（全部拼在 goal 里）
      {
        concurrent: true,                     // 绕过串行锁
        cwd: params.cwd ?? config.workDir,
        enabledSkills: params.skills?.length ? params.skills : agent?.enabledSkills,
        provider: undefined,
        model: agent?.model,
        maxTurns: params.maxTurns,
      },
      () => {},                               // onProgress（事件已由 runner emit，无需额外处理）
    );

    return {
      output: (result.summary ?? "").slice(0, 8000),
      error: result.error,
      durationMs: result.durationMs ?? 0,
    };
  };
}

/** 读产物文件内容（强制注入下游 prompt；失败不阻塞，记提示文本） */
export async function readArtifactContent(cwd: string, artifactPath: string): Promise<string | null> {
  try {
    const abs = resolvePath(cwd, artifactPath);
    const content = await readFile(abs, "utf-8");
    return content.length > 8000 ? content.slice(0, 8000) + "\n…(截断)" : content;
  } catch {
    return null;
  }
}
