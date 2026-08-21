// ============================================================
// pipeline-defs.ts — 流水线定义：树形原语类型 + CRUD + 校验
//
// 设计对齐 Mastra SerializedStepFlowEntry（见 output/pipeline-design.md 附录A），
// 本土化改造：agentId+skills 绑定 / 声明式谓词 / verdict 双通道 / artifacts。
//
// 原语集合冻结为 7 种：agent / parallel / conditional / loop / foreach / sleep / (闸门=agent属性)
// 存储：~/.myagent/pipelines/<id>.json
// ============================================================

import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { PATHS } from "../paths.js";
import type { PipelineDag } from "./dag-model.js";
import { validateDag } from "./dag-model.js";
import { compileDag, treeToDagNodes } from "./dag-to-tree.js";

// ── 树形原语类型 ──

/** 声明式谓词（不用函数字符串：不可序列化且有注入面） */
export interface Predicate {
  kind: "verdict-eq";            // v1 只需要这一种：某 step 的 verdict == value
  stepId: string;
  value: string;
}

/** 裁决：command 确定性通道优先，llm 兜底 */
export interface VerdictSpec {
  type: "pass-fail" | "route";
  routes?: string[];             // type=route 的合法值
  /** 确定性通道：引擎执行命令，exit code 映射裁决 */
  command?: {
    cmd: string;                 // 如 "pnpm test"
    passWhen: string;            // exit 0 时的裁决值
    failWhen?: string;           // 非0/超时时的裁决值（默认 "fail"）
    timeoutMs?: number;          // 默认 300s
  };
  /** llm 通道：解析输出末尾结构化 JSON */
  promptHint?: string;
}

/** 执行单元：Agent(谁) × Skill(方法) × 输入(什么) × 裁决(做得如何) */
export interface AgentStep {
  type: "agent";
  id: string;                    // 树内唯一
  name: string;
  agentId?: string;              // AgentConfig.id；缺省用默认 Agent
  skills?: string[];             // skill 白名单（空 = 该 Agent 默认 skills）
  role: string;                  // 注入 prompt 的角色名
  instructions?: string;         // 专属指令
  inputsFrom: "all" | string[];  // 上游 step id；loop body 内引用 = 最近一轮输出
  verdict?: VerdictSpec;
  retry?: { maxRetries: number };   // 默认 0
  artifacts?: string[];          // 产物 glob（相对 cwd）
  needsUserInput?: boolean;      // 人机闸门
}

export interface ParallelStep {
  type: "parallel";
  id: string;
  steps: StepNode[];
}

export interface ConditionalStep {
  type: "conditional";
  id: string;
  branches: { predicate: Predicate; steps: StepNode[] }[];
  default?: StepNode[];          // 无匹配时兜底（可空=直接跳过）
}

export interface LoopStep {
  type: "loop";
  id: string;
  loopType: "dowhile" | "dountil";
  /** dowhile: 满足 exitWhen → 继续（不满足则停）
   *  dountil: 满足 exitWhen → 停止 */
  exitWhen: Predicate;
  maxIterations: number;         // ≤5（校验强制）
  steps: StepNode[];
}

export interface ForeachStep {
  type: "foreach";
  id: string;
  fromStepId: string;            // 从哪个 step 取数组
  source: "artifact" | "output";
  path?: string;                 // artifact 文件路径
  itemKey?: string;              // 元素里作为分片标题的键
  concurrency?: number;          // 默认继承全局 maxParallel
  steps: StepNode[];             // body 模板
}

export interface SleepStep {
  type: "sleep";
  id: string;
  durationMs: number;
}

export type StepNode = AgentStep | ParallelStep | ConditionalStep | LoopStep | ForeachStep | SleepStep;

export interface PipelineDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  steps: StepNode[];             // 顶层序列（由 dag 编译产出；旧数据直接存树）
  /** 路线A：DAG 编辑层（workflowbuilder 产出的节点+边）。有 dag 时以 dag 为准 */
  dag?: PipelineDag;
  maxParallel: number;           // 默认 3
  budget?: { maxLLMCalls: number };   // 默认 40
  timeoutMs?: number;                 // 默认 2h
  createdAt: number;
  updatedAt: number;
}

// ── 校验器 ──

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

/** 收集树内全部 step id（含嵌套） */
function collectIds(steps: StepNode[] | undefined, acc: Set<string> = new Set()): Set<string> {
  if (!steps) return acc;
  for (const s of steps) {
    acc.add(s.id);
    if (s.type === "parallel") collectIds(s.steps, acc);
    else if (s.type === "conditional") {
      for (const b of s.branches) collectIds(b.steps, acc);
      collectIds(s.default, acc);
    } else if (s.type === "loop" || s.type === "foreach") collectIds(s.steps, acc);
  }
  return acc;
}

/** 收集 loop/foreach body 内的 agent step id（校验 gate-in-loop 用） */
function collectIdsInLoopable(steps: StepNode[] | undefined, acc: Set<string> = new Set()): Set<string> {
  if (!steps) return acc;
  for (const s of steps) {
    if (s.type === "loop" || s.type === "foreach") {
      collectIds(s.steps, acc); // 整个 body 都算循环域
    } else if (s.type === "parallel") collectIdsInLoopable(s.steps, acc);
    else if (s.type === "conditional") {
      for (const b of s.branches) collectIdsInLoopable(b.steps, acc);
      collectIdsInLoopable(s.default, acc);
    }
  }
  return acc;
}

export function validatePipeline(def: PipelineDef): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, path: string, message: string) => issues.push({ code, path, message });

  if (!def.name?.trim()) push("missing-name", "$.name", "流水线名称不能为空");
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    push("empty-graph", "$.steps", "流水线至少需要一个步骤");
    return issues;
  }

  const maxParallel = def.maxParallel ?? 3;
  if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 10) {
    push("invalid-max-parallel", "$.maxParallel", "maxParallel 必须是 1-10 的整数");
  }
  const budget = def.budget?.maxLLMCalls ?? 40;
  if (!Number.isInteger(budget) || budget < 1) {
    push("invalid-budget", "$.budget.maxLLMCalls", "预算必须是正整数");
  }
  if (def.timeoutMs != null && def.timeoutMs < 60_000) {
    push("invalid-timeout", "$.timeoutMs", "run 超时不能小于 60s");
  }

  // 遍历树做结构校验
  const allIds = collectIds(def.steps);
  const seen = new Set<string>();
  const loopDomain = collectIdsInLoopable(def.steps);

  const walk = (steps: StepNode[], path: string) => {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const p = `${path}[${i}]`;
      // id 校验
      if (!s?.id) { push("missing-step-id", p, `步骤缺少 id`); continue; }
      if (seen.has(s.id)) push("duplicate-step-id", `${p}.id`, `步骤 id 重复: ${s.id}`);
      seen.add(s.id);

      switch (s.type) {
        case "agent": {
          if (!s.role?.trim()) push("missing-role", `${p}(${s.id})`, "agent 步骤必须有角色名");
          // inputsFrom 引用
          if (Array.isArray(s.inputsFrom)) {
            for (const ref of s.inputsFrom) {
              if (!allIds.has(ref)) push("missing-reference", `${p}(${s.id}).inputsFrom`, `引用的 step 不存在: ${ref}`);
            }
          } else if (s.inputsFrom !== "all" && s.inputsFrom !== undefined) {
            push("invalid-inputs-from", `${p}(${s.id}).inputsFrom`, `inputsFrom 必须是 "all" 或 id 数组`);
          }
          // 闸门不得在循环域内
          if (s.needsUserInput && loopDomain.has(s.id)) {
            push("gate-in-loop", `${p}(${s.id})`, "人工闸门不能放在 loop/foreach body 内（防止无限等待）");
          }
          // retry
          if (s.retry && (!Number.isInteger(s.retry.maxRetries) || s.retry.maxRetries < 0 || s.retry.maxRetries > 3)) {
            push("invalid-retry", `${p}(${s.id}).retry`, "maxRetries 必须是 0-3");
          }
          break;
        }
        case "parallel": {
          if (!s.steps?.length) push("invalid-parallel", `${p}(${s.id})`, "parallel 至少包含一个子步骤");
          walk(s.steps, `${p}.steps`);
          break;
        }
        case "conditional": {
          if (!s.branches?.length) push("invalid-conditional", `${p}(${s.id})`, "conditional 至少包含一个分支");
          s.branches?.forEach((b, bi) => {
            if (!b.predicate || b.predicate.kind !== "verdict-eq") {
              push("invalid-predicate", `${p}(${s.id}).branches[${bi}]`, "谓词只支持 verdict-eq");
            } else if (!allIds.has(b.predicate.stepId)) {
              push("missing-reference", `${p}(${s.id}).branches[${bi}].predicate`, `谓词引用的 step 不存在: ${b.predicate.stepId}`);
            } else {
              // 谓词引用的 step 必须声明 verdict
              const ref = findById(def.steps, b.predicate.stepId);
              if (ref?.type === "agent" && !ref.verdict) {
                push("verdict-missing", `${p}(${s.id}).branches[${bi}]`, `谓词引用的 step ${b.predicate.stepId} 未声明 verdict`);
              }
            }
            walk(b.steps, `${p}.branches[${bi}].steps`);
          });
          if (s.default) walk(s.default, `${p}.default`);
          break;
        }
        case "loop": {
          if (!s.steps?.length) push("invalid-loop", `${p}(${s.id})`, "loop body 不能为空");
          if (!s.exitWhen || !allIds.has(s.exitWhen?.stepId ?? "")) {
            push("missing-reference", `${p}(${s.id}).exitWhen`, `出口谓词引用的 step 不存在: ${s.exitWhen?.stepId}`);
          } else {
            // exitWhen 必须指向本 body 内的 step
            const bodyIds = collectIds(s.steps);
            if (!bodyIds.has(s.exitWhen.stepId)) {
              push("invalid-loop", `${p}(${s.id}).exitWhen`, "出口谓词必须指向 loop body 内的 step");
            }
            const ref = findById(s.steps, s.exitWhen.stepId);
            if (ref?.type === "agent" && !ref.verdict) {
              push("verdict-missing", `${p}(${s.id}).exitWhen`, `出口 step ${s.exitWhen.stepId} 未声明 verdict`);
            }
          }
          if (!Number.isInteger(s.maxIterations) || s.maxIterations < 1 || s.maxIterations > 5) {
            push("invalid-loop", `${p}(${s.id}).maxIterations`, "maxIterations 必须是 1-5");
          }
          walk(s.steps, `${p}.steps`);
          break;
        }
        case "foreach": {
          if (!s.steps?.length) push("invalid-foreach", `${p}(${s.id})`, "foreach body 不能为空");
          if (!allIds.has(s.fromStepId ?? "")) {
            push("missing-reference", `${p}(${s.id}).fromStepId`, `fromStepId 引用的 step 不存在: ${s.fromStepId}`);
          } else {
            if (s.source === "artifact" && !s.path) {
              push("invalid-foreach", `${p}(${s.id})`, "source=artifact 时必须提供 path");
            }
          }
          if (s.concurrency != null && (!Number.isInteger(s.concurrency) || s.concurrency < 1 || s.concurrency > 10)) {
            push("invalid-foreach", `${p}(${s.id}).concurrency`, "concurrency 必须是 1-10");
          }
          walk(s.steps, `${p}.steps`);
          break;
        }
        case "sleep": {
          if (!Number.isFinite(s.durationMs) || s.durationMs < 0 || s.durationMs > 3_600_000) {
            push("invalid-sleep", `${p}(${s.id})`, "durationMs 必须在 0-3600000");
          }
          break;
        }
        default:
          push("unknown-step-type", p, `未知步骤类型: ${(s as any).type}`);
      }
    }
  };

  walk(def.steps, "$.steps");
  return issues;
}

function findById(steps: StepNode[], id: string): StepNode | undefined {
  for (const s of steps) {
    if (s.id === id) return s;
    let found: StepNode | undefined;
    if (s.type === "parallel") found = findById(s.steps, id);
    else if (s.type === "conditional") {
      for (const b of s.branches) { found = findById(b.steps, id); if (found) break; }
      if (!found && s.default) found = findById(s.default, id);
    } else if (s.type === "loop" || s.type === "foreach") found = findById(s.steps, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * 统一校验入口（路线A）：
 * - 有 dag → validateDag + compileDag，编译产物写回 steps（DAG 为唯一真源）
 * - 无 dag → 旧树校验（validatePipeline）
 */
export function validatePipelineDef(def: PipelineDef): ValidationIssue[] {
  if (def.dag) {
    const dagIssues = validateDag(def.dag);
    if (dagIssues.length > 0) {
      return dagIssues.map((i) => ({ code: i.code, path: "$.dag", message: i.message }));
    }
    const { steps, issues } = compileDag(def.dag);
    if (issues.length > 0) {
      return issues.map((i) => ({ code: "compile", path: "$.dag", message: i.message }));
    }
    def.steps = steps; // 编译产物写回（同一对象原地更新）
    // 基础字段校验（名称/预算等）
    const base = validatePipeline(def).filter((i) => !i.code.startsWith("empty-graph"));
    return base;
  }
  return validatePipeline(def);
}

/** 读取时迁移：旧树数据自动生成 dag（一次性，生成后回写盘） */
async function migrateToDag(def: PipelineDef): Promise<boolean> {
  if (def.dag || !def.steps?.length) return false;
  try {
    def.dag = treeToDagNodes(def);
    await persistOne(def);
    return true;
  } catch {
    return false;
  }
}

// ── CRUD ──

let loaded = false;
let defs = new Map<string, PipelineDef>();

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  await mkdir(PATHS.pipelinesDir, { recursive: true });
  if (!existsSync(PATHS.pipelinesDir)) return;
  const files = await readdir(PATHS.pipelinesDir).catch(() => [] as string[]);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const def: PipelineDef = JSON.parse(await readFile(join(PATHS.pipelinesDir, f), "utf-8"));
      if (def?.id) {
        defs.set(def.id, def);
        // 路线A迁移：旧树自动生成 dag（异步不阻塞启动，失败不致命）
        migrateToDag(def).catch(() => {});
      }
    } catch { /* 跳过损坏文件 */ }
  }
}

async function persistOne(def: PipelineDef) {
  await mkdir(PATHS.pipelinesDir, { recursive: true });
  const file = join(PATHS.pipelinesDir, `${def.id}.json`);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(def, null, 2), "utf-8");
  await (await import("fs/promises")).rename(tmp, file);
}

export const pipelineStore = {
  async list(): Promise<PipelineDef[]> {
    await ensureLoaded();
    return [...defs.values()].map(d => ({ ...d }));
  },

  async get(id: string): Promise<PipelineDef | undefined> {
    await ensureLoaded();
    const d = defs.get(id);
    return d ? { ...d } : undefined;
  },

  async create(input: Partial<PipelineDef> & { name: string }): Promise<{ def?: PipelineDef; issues: ValidationIssue[] }> {
    await ensureLoaded();
    const now = Date.now();
    const base: PipelineDef = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? "",
      icon: input.icon ?? "➡️",
      steps: (input.steps as StepNode[]) ?? [],
      dag: input.dag,
      maxParallel: input.maxParallel ?? 3,
      budget: input.budget ?? { maxLLMCalls: 40 },
      timeoutMs: input.timeoutMs ?? 7_200_000,
      createdAt: now,
      updatedAt: now,
    };
    const issues = validatePipelineDef(base);
    if (issues.length > 0) return { issues };
    defs.set(base.id, base);
    await persistOne(base);
    return { def: { ...base }, issues: [] };
  },

  async update(id: string, patch: Partial<PipelineDef>): Promise<{ def?: PipelineDef; issues: ValidationIssue[] }> {
    await ensureLoaded();
    const cur = defs.get(id);
    if (!cur) return { issues: [{ code: "not-found", path: "$", message: "流水线不存在" }] };
    const next: PipelineDef = {
      ...cur,
      ...patch,
      id: cur.id,              // id 不可改
      createdAt: cur.createdAt,
      updatedAt: Date.now(),
    };
    const issues = validatePipelineDef(next);
    if (issues.length > 0) return { issues };
    defs.set(id, next);
    await persistOne(next);
    return { def: { ...next }, issues: [] };
  },

  async remove(id: string): Promise<boolean> {
    await ensureLoaded();
    if (!defs.has(id)) return false;
    defs.delete(id);
    await unlink(join(PATHS.pipelinesDir, `${id}.json`)).catch(() => {});
    return true;
  },
};
