// ============================================================
// pipeline-engine.ts — 流水线执行引擎（树递归解释器）
//
// 设计要点（见 output/pipeline-design.md §3）：
//   - 树形原语递归解释：序列串行 / parallel 并行 / conditional 分派 /
//     loop 循环 / foreach 动态展开 / sleep 等待
//   - 三重闸：maxParallel（run 内并发）/ budget.maxLLMCalls（熔断）/ timeoutMs（超时）
//   - verdict：command 通道优先（确定性），llm 兜底
//   - 每个 step 状态变更即落盘 + SSE 事件
//   - 依赖注入（spawnJob / runCommand），引擎可脱离 Fastify/LLM 单测
// ============================================================

import { emit } from "../event-bus.js";
import type {
  PipelineDef, StepNode, AgentStep, Predicate,
} from "./pipeline-defs.js";
import type { PipelineRun, RunStep } from "./run-store.js";
import { runStore } from "./run-store.js";
import { createVerdictExecutor, type CommandRunner } from "./verdict-executor.js";
import type { SpawnJobFn, SpawnJobParams } from "./spawn-for-pipeline.js";
import { readArtifactContent } from "./spawn-for-pipeline.js";

// ── 引擎异常类型 ──
export class BudgetExceededError extends Error {
  constructor() { super("预算已耗尽（maxLLMCalls）"); this.name = "BudgetExceededError"; }
}
export class RunTimeoutError extends Error {
  constructor() { super("run 执行超时"); this.name = "RunTimeoutError"; }
}
export class RunAbortedError extends Error {
  constructor() { super("run 被用户中止"); this.name = "RunAbortedError"; }
}
export class StepFailedError extends Error {
  constructor(public stepId: string, msg: string) { super(msg); this.name = "StepFailedError"; }
}

export interface EngineDeps {
  spawnJob: SpawnJobFn;             // 注入：真实实现 or mock
  runCommand: CommandRunner;        // 注入：命令执行（verdict command 通道）
  cwd: string;                      // 工作目录
}

// ── 并发限流器（p-limit 极简版，零依赖） ──
export function createLimiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    queue.shift()!();
  };
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    const start = new Promise<void>((r) => queue.push(r));
    const run = start.then(() => fn());
    run.finally(() => { active--; next(); }).catch(() => {});
    Promise.resolve().then(next);
    return run;
  };
}

// ── 执行上下文 ──
interface RunContext {
  def: PipelineDef;
  run: PipelineRun;
  cwd: string;
  spawnJob: SpawnJobFn;
  verdictExecutor: ReturnType<typeof createVerdictExecutor>;
  limiter: ReturnType<typeof createLimiter>;
  abortSignal: AbortSignal;
  outputs: Map<string, string>;       // stepId（或 stepId::instanceKey）→ 最近输出
  verdicts: Map<string, string>;
  artifactsOf: Map<string, string[]>;
  llmCalls: number;
  maxLLMCalls: number;
  deadline: number;
}

function newRunStep(ctx: RunContext, stepId: string, instanceKey?: string, iteration = 1): RunStep {
  const step: RunStep = {
    stepId, instanceKey, attempt: 1, iteration,
    status: "running", startedAt: Date.now(),
  };
  ctx.run.steps.push(step);
  return step;
}

async function persistStep(ctx: RunContext, step: RunStep) {
  await runStore.save(ctx.run);
  emit({
    type: "pipeline_flow_update",
    chatSessionId: `pipeline:${ctx.run.pipelineId}`,
    payload: { runId: ctx.run.runId, step: { ...step } },
    ts: Date.now(),
  });
}

/** 检查三重闸 */
function checkGates(ctx: RunContext) {
  if (ctx.abortSignal.aborted) throw new RunAbortedError();
  if (ctx.llmCalls >= ctx.maxLLMCalls) throw new BudgetExceededError();
  if (Date.now() > ctx.deadline) throw new RunTimeoutError();
}

// ── 输入组装 ──
async function buildJobInput(
  ctx: RunContext, step: AgentStep,
  opts: { instanceKey?: string; iteration?: number; foreachItem?: unknown },
): Promise<string> {
  const parts: string[] = [];
  parts.push(`## 流水线任务\n你在流水线「${ctx.def.name}」的步骤「${step.role}」中执行。`);
  if ((opts.iteration ?? 1) > 1) parts.push(`（第 ${opts.iteration} 轮迭代，请结合此前轮次的反馈改进）`);
  if (opts.instanceKey) parts.push(`（分片任务：${opts.instanceKey}）`);
  parts.push(`## 用户需求\n${ctx.run.input}`);

  // 上游输出
  const refs = step.inputsFrom === "all"
    ? [...ctx.outputs.keys()].filter((k) => !k.includes("::") || k.startsWith(step.id + "::"))
    : Array.isArray(step.inputsFrom) ? (step.inputsFrom as string[]) : [];

  if (refs.length > 0) {
    const chunks: string[] = [];
    for (const ref of refs) {
      if (ref === step.id) continue;
      const out = ctx.outputs.get(ref);
      if (out !== undefined) chunks.push(`### 上游步骤 ${ref}\n${out.slice(0, 4000)}`);
    }
    if (chunks.length > 0) parts.push(`## 上游产出\n${chunks.join("\n\n")}`);
  }

  // 上游产物文件内容（强制注入）
  if (Array.isArray(step.inputsFrom)) {
    const artChunks: string[] = [];
    for (const ref of step.inputsFrom) {
      const arts = ctx.artifactsOf.get(ref);
      if (!arts) continue;
      for (const p of arts) {
        const content = await readArtifactContent(ctx.cwd, p);
        if (content) artChunks.push(`### 文件 ${p}\n\`\`\`\n${content}\n\`\`\``);
      }
    }
    if (artChunks.length > 0) parts.push(`## 上游产物文件\n${artChunks.join("\n\n")}`);
  }

  if (opts.foreachItem !== undefined) {
    parts.push(`## 你的分片\n\`\`\`json\n${JSON.stringify(opts.foreachItem, null, 2)}\n\`\`\``);
  }

  if (step.instructions?.trim()) parts.push(`## 本步骤专属指令\n${step.instructions.trim()}`);
  if (step.verdict?.promptHint) parts.push(`## 输出要求\n${step.verdict.promptHint}`);
  return parts.join("\n\n");
}

// ── agent step 执行（含 retry / verdict） ──
async function runAgentStep(
  ctx: RunContext,
  step: AgentStep,
  opts: { instanceKey?: string; iteration?: number; foreachItem?: unknown },
): Promise<void> {
  checkGates(ctx);

  const maxRetries = step.retry?.maxRetries ?? 0;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const rs = newRunStep(ctx, step.id, opts.instanceKey, opts.iteration ?? 1);
    rs.attempt = attempt;

    const jobInput = await buildJobInput(ctx, step, opts);
    rs.inputDigest = jobInput.slice(0, 4000);
    await persistStep(ctx, rs);

    ctx.llmCalls++;
    ctx.run.usage.llmCalls = ctx.llmCalls;
    if (ctx.llmCalls > ctx.maxLLMCalls) {
      rs.status = "skipped";
      rs.endedAt = Date.now();
      rs.warnings = [...(rs.warnings ?? []), "预算耗尽，本步骤未执行"];
      await persistStep(ctx, rs);
      throw new BudgetExceededError();
    }

    const params: SpawnJobParams = {
      stepId: step.id,
      name: step.name,
      role: step.role,
      instructions: step.instructions,
      agentId: step.agentId,
      skills: step.skills,
      jobInput,
      cwd: ctx.cwd,
      runId: ctx.run.runId,
    };
    const result = await ctx.spawnJob(params);
    if (result.subId) rs.subId = result.subId;
    rs.durationMs = Date.now() - (rs.startedAt ?? Date.now());
    rs.endedAt = Date.now();

    if (result.error && !result.output) {
      lastError = result.error;
      rs.status = "error";
      rs.error = result.error;
      await persistStep(ctx, rs);
      if (attempt <= maxRetries) continue;
      throw new StepFailedError(step.id, `步骤 ${step.id} 失败: ${lastError}`);
    }

    rs.output = result.output;
    rs.status = "success";
    if (result.error) rs.warnings = [...(rs.warnings ?? []), `带错误完成: ${result.error}`];

    // verdict 裁决
    if (step.verdict) {
      const v = await ctx.verdictExecutor.decide(step.verdict, result.output, ctx.cwd);
      if (v) {
        rs.verdict = v.verdict;
        rs.verdictSource = v.source;
        if (v.warnings?.length) rs.warnings = [...(rs.warnings ?? []), ...v.warnings];
      }
    }
    await persistStep(ctx, rs);

    // 登记输出/裁决/产物（foreach 分片 → 复合键 + 原键都写）
    const key = opts.instanceKey ? `${step.id}::${opts.instanceKey}` : step.id;
    ctx.outputs.set(key, result.output);
    if (opts.instanceKey) ctx.outputs.set(step.id, result.output);
    if (rs.verdict) {
      ctx.verdicts.set(key, rs.verdict);
      ctx.verdicts.set(step.id, rs.verdict);
    }
    if (step.artifacts?.length) ctx.artifactsOf.set(key, step.artifacts);
    return;
  }
  throw new StepFailedError(step.id, `步骤 ${step.id} 失败: ${lastError}`);
}

// ── 树递归解释器 ──
async function runNode(ctx: RunContext, node: StepNode, scope: { foreachItem?: unknown; instanceKey?: string; iteration?: number }): Promise<void> {
  checkGates(ctx);
  switch (node.type) {
    case "agent":
      return runAgentStep(ctx, node, scope);

    case "sleep":
      await new Promise((r) => setTimeout(r, node.durationMs));
      return;

    case "parallel": {
      // 等全部完成再抛错（不中途杀：错误信息更全、已花 token 不浪费）
      const results = await Promise.allSettled(
        node.steps.map((s) => ctx.limiter(() => runNode(ctx, s, scope))),
      );
      const firstErr = results.find((r) => r.status === "rejected");
      if (firstErr) throw (firstErr as PromiseRejectedResult).reason;
      return;
    }

    case "conditional": {
      for (const branch of node.branches) {
        if (matchPredicate(ctx, branch.predicate)) {
          for (const s of branch.steps) await runNode(ctx, s, scope);
          return;
        }
      }
      if (node.default) {
        for (const s of node.default) await runNode(ctx, s, scope);
      }
      return;
    }

    case "loop": {
      for (let iteration = 1; iteration <= node.maxIterations; iteration++) {
        for (const s of node.steps) {
          await runNode(ctx, s, { foreachItem: scope.foreachItem, instanceKey: scope.instanceKey, iteration });
        }
        const v = ctx.verdicts.get(node.exitWhen.stepId);
        const matched = v === node.exitWhen.value;
        if (node.loopType === "dowhile") {
          if (!matched) return;   // 不满足继续条件 → 退出
        } else {
          if (matched) return;    // dountil：满足 → 停
        }
        if (iteration === node.maxIterations) {
          const lastStep = ctx.run.steps.filter((s) => s.stepId === node.exitWhen.stepId).pop();
          if (lastStep) {
            lastStep.warnings = [...(lastStep.warnings ?? []), `loop ${node.id} 达 maxIterations=${node.maxIterations} 强制退出`];
            await persistStep(ctx, lastStep);
          }
        }
      }
      return;
    }

    case "foreach": {
      const items = await resolveForeachItems(ctx, node);
      if (items.length === 0) {
        console.log(`[pipeline] foreach ${node.id}: 上游数组为空，跳过`);
        return;
      }
      if (items.length > 20) {
        throw new StepFailedError(node.id, `foreach 展开数 ${items.length} 超过上限 20`);
      }
      const conc = node.concurrency ?? ctx.def.maxParallel;
      const limit = createLimiter(conc);
      const results = await Promise.allSettled(
        items.map(async (item, i) => {
          const title = node.itemKey && item && typeof item === "object"
            ? String((item as any)[node.itemKey] ?? i) : String(i);
          const instanceKey = `${node.id}#${title}`;
          for (const s of node.steps) {
            await limit(() => runNode(ctx, s, { foreachItem: item, instanceKey }));
          }
        }),
      );
      const firstErr = results.find((r) => r.status === "rejected");
      if (firstErr) throw (firstErr as PromiseRejectedResult).reason;
      return;
    }
  }
}

function matchPredicate(ctx: RunContext, p: Predicate): boolean {
  if (p.kind !== "verdict-eq") return false;
  return ctx.verdicts.get(p.stepId) === p.value;
}

/** 解析 foreach 数组：artifact 文件 或 上游输出中的 JSON 数组 */
async function resolveForeachItems(ctx: RunContext, node: Extract<StepNode, { type: "foreach" }>): Promise<unknown[]> {
  try {
    let raw: string | null = null;
    if (node.source === "artifact" && node.path) {
      raw = await readArtifactContent(ctx.cwd, node.path);
      if (!raw) {
        console.warn(`[pipeline] foreach ${node.id}: 产物文件不存在 ${node.path}`);
        return [];
      }
    } else {
      raw = ctx.outputs.get(node.fromStepId) ?? null;
      if (!raw) return [];
    }
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) return [];
    const parsed = JSON.parse(arrMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e: any) {
    console.warn(`[pipeline] foreach ${node.id}: 解析数组失败 — ${e?.message}`);
    return [];
  }
}

// ── 顶层 run 生命周期 ──

export interface RunHandle {
  runId: string;
  promise: Promise<"success" | "failed" | "aborted">;
  abort: () => void;
}

/** 进程级 run 并发闸 */
let activeRunCount = 0;
export const PIPELINE_CONCURRENCY = 2;
export function getActiveRunCount() { return activeRunCount; }

export async function startPipelineRun(
  def: PipelineDef,
  input: string,
  trigger: PipelineRun["trigger"],
  deps: EngineDeps,
): Promise<RunHandle> {
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const abortController = new AbortController();

  const run: PipelineRun = {
    runId,
    pipelineId: def.id,
    pipelineSnapshot: def,
    trigger,
    status: "running",
    input,
    steps: [],
    startedAt: Date.now(),
    usage: { llmCalls: 0 },
  };
  await runStore.create(run);

  emit({
    type: "pipeline_flow_start",
    chatSessionId: `pipeline:${def.id}`,
    payload: { runId, pipelineId: def.id, name: def.name, steps: def.steps.map(summarizeNode) },
    ts: Date.now(),
  });

  const ctx: RunContext = {
    def, run, cwd: deps.cwd,
    spawnJob: deps.spawnJob,
    verdictExecutor: createVerdictExecutor(deps.runCommand),
    limiter: createLimiter(def.maxParallel ?? 3),
    abortSignal: abortController.signal,
    outputs: new Map(),
    verdicts: new Map(),
    artifactsOf: new Map(),
    llmCalls: 0,
    maxLLMCalls: def.budget?.maxLLMCalls ?? 40,
    deadline: Date.now() + (def.timeoutMs ?? 7_200_000),
  };

  activeRunCount++;
  const promise = (async (): Promise<"success" | "failed" | "aborted"> => {
    try {
      for (const node of def.steps) {
        await runNode(ctx, node, {});
      }
      run.status = "success";
    } catch (e: any) {
      if (e instanceof BudgetExceededError) {
        run.status = "aborted"; run.abortReason = "budget";
      } else if (e instanceof RunTimeoutError) {
        run.status = "aborted"; run.abortReason = "timeout";
      } else if (e instanceof RunAbortedError || abortController.signal.aborted) {
        run.status = "aborted"; run.abortReason = "user";
      } else {
        run.status = "failed";
        console.error(`[pipeline] run ${runId} 失败:`, e?.message ?? e);
      }
    } finally {
      activeRunCount--;
      run.endedAt = Date.now();
      run.stats = {
        total: run.steps.length,
        success: run.steps.filter((s) => s.status === "success").length,
        failed: run.steps.filter((s) => s.status === "error").length,
        skipped: run.steps.filter((s) => s.status === "skipped").length,
      };
      await runStore.finish(run);
      emit({
        type: "pipeline_flow_end",
        chatSessionId: `pipeline:${def.id}`,
        payload: {
          runId, status: run.status, abortReason: run.abortReason,
          stats: run.stats, usage: run.usage,
          durationMs: run.endedAt - run.startedAt,
        },
        ts: Date.now(),
      });
    }
    return run.status;
  })();

  return { runId, promise, abort: () => abortController.abort() };
}

function summarizeNode(node: StepNode): { id: string; type: string; name?: string; children?: unknown[] } {
  const base = { id: node.id, type: node.type, name: (node as AgentStep).name };
  if (node.type === "parallel" || node.type === "loop" || node.type === "foreach") {
    return { ...base, children: node.steps.map(summarizeNode) };
  }
  if (node.type === "conditional") {
    return {
      ...base,
      children: [
        ...node.branches.map((b) => b.steps.map(summarizeNode)),
        ...(node.default ? [node.default.map(summarizeNode)] : []),
      ],
    };
  }
  return base;
}

// ── 活跃 run 注册表（abort 用） ──
const activeRuns = new Map<string, RunHandle>();

export function registerRun(handle: RunHandle) {
  activeRuns.set(handle.runId, handle);
  handle.promise.finally(() => activeRuns.delete(handle.runId)).catch(() => {});
}

export function abortRun(runId: string): boolean {
  const h = activeRuns.get(runId);
  if (!h) return false;
  h.abort();
  return true;
}
