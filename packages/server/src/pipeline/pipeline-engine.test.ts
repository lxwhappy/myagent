// ============================================================
// pipeline-engine.test.ts — 引擎单测（node:test，零新依赖）
//
// 全部 mock spawnJob/runCommand，不依赖真实 LLM。
// 覆盖：串行时序 / parallel 重叠 / conditional 分派 / loop 轮次 /
//       foreach 展开 / command 裁决 / 预算熔断 / 失败处理
// 运行：npx tsx --test src/pipeline/pipeline-engine.test.ts
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PipelineDef, StepNode } from "./pipeline-defs.js";
import type { SpawnJobFn, SpawnJobParams, SpawnJobResult } from "./spawn-for-pipeline.js";
import { startPipelineRun } from "./pipeline-engine.js";

// ── 测试基建 ──

interface CallRecord { stepId: string; startedAt: number; endedAt: number; }

function makeSpawn(records: CallRecord[], outputs: (p: SpawnJobParams) => string = () => "ok", delayMs = 50): SpawnJobFn {
  return async (params) => {
    const startedAt = Date.now();
    await new Promise((r) => setTimeout(r, delayMs));
    records.push({ stepId: params.stepId, startedAt, endedAt: Date.now() });
    const result: SpawnJobResult = { output: outputs(params), durationMs: delayMs };
    return result;
  };
}

function def(steps: StepNode[], extra: Partial<PipelineDef> = {}): PipelineDef {
  return {
    id: "test-pipeline", name: "测试", description: "", icon: "🧪",
    steps, maxParallel: 3, budget: { maxLLMCalls: 40 }, timeoutMs: 3_600_000,
    createdAt: 0, updatedAt: 0, ...extra,
  };
}

const noCmd = async () => ({ exitCode: 0, stderr: "" });

async function run(defn: PipelineDef, spawn: SpawnJobFn, input = "测试需求") {
  // 用临时目录（runStore 写 ~/.myagent/pipeline-runs，测试环境可接受）
  const handle = await startPipelineRun(defn, input, { type: "manual" }, {
    spawnJob: spawn, runCommand: noCmd, cwd: "/tmp",
  });
  const status = await handle.promise;
  return status;
}

// ── AC-2.1 串行：时间戳严格递增 ──
test("串行执行：step 时间戳严格递增", async () => {
  const records: CallRecord[] = [];
  const status = await run(def([
    { type: "agent", id: "s1", name: "1", role: "r", inputsFrom: "all" },
    { type: "agent", id: "s2", name: "2", role: "r", inputsFrom: "all" },
    { type: "agent", id: "s3", name: "3", role: "r", inputsFrom: "all" },
  ]), makeSpawn(records));
  assert.equal(status, "success");
  assert.equal(records.length, 3);
  assert.ok(records[0].endedAt <= records[1].startedAt, "s1 结束应早于 s2 开始");
  assert.ok(records[1].endedAt <= records[2].startedAt, "s2 结束应早于 s3 开始");
});

// ── AC-2.2 并行：时间区间重叠 ──
test("parallel 执行：两个 job 时间区间重叠", async () => {
  const records: CallRecord[] = [];
  const status = await run(def([
    { type: "parallel", id: "par", steps: [
      { type: "agent", id: "p1", name: "1", role: "r", inputsFrom: "all" },
      { type: "agent", id: "p2", name: "2", role: "r", inputsFrom: "all" },
    ] },
  ]), makeSpawn(records, () => "ok", 100));
  assert.equal(status, "success");
  assert.equal(records.length, 2);
  const overlap = records[0].startedAt < records[1].endedAt && records[1].startedAt < records[0].endedAt;
  assert.ok(overlap, "p1/p2 执行区间应重叠");
});

// ── AC-2.3 上下文传递 ──
test("上下文传递：下游收到上游输出", async () => {
  const seen: string[] = [];
  const spawn: SpawnJobFn = async (p) => {
    seen.push(p.jobInput);
    if (p.stepId === "s1") return { output: "TOKEN_XYZ_123", durationMs: 1 };
    return { output: "ok", durationMs: 1 };
  };
  const status = await run(def([
    { type: "agent", id: "s1", name: "1", role: "r", inputsFrom: "all" },
    { type: "agent", id: "s2", name: "2", role: "r", inputsFrom: ["s1"] },
  ]), spawn);
  assert.equal(status, "success");
  assert.ok(seen[1].includes("TOKEN_XYZ_123"), "s2 的输入应包含 s1 的输出标记");
});

// ── AC-2.4 command 裁决 ──
test("command 裁决：exit code 映射 verdict（不调 LLM 通道）", async () => {
  const verdicts: string[] = [];
  const spawn: SpawnJobFn = async (p) => {
    if (p.stepId === "check") {
      // 输出里故意没有合法 JSON（如果走了 llm 通道会解析失败）
      return { output: "检查完成，无结构化输出", durationMs: 1 };
    }
    return { output: "done", durationMs: 1 };
  };
  // command 模拟：exit 1 → fail
  const cmdFail = async () => ({ exitCode: 1, stderr: "test failed" });
  const handle = await startPipelineRun(def([
    { type: "agent", id: "check", name: "检查", role: "r", inputsFrom: "all",
      verdict: { type: "pass-fail", command: { cmd: "pnpm test", passWhen: "pass" } } },
  ]), "需求", { type: "manual" }, { spawnJob: spawn, runCommand: cmdFail, cwd: "/tmp" });
  const status = await handle.promise;
  assert.equal(status, "success"); // fail verdict 不等于 run 失败
  // 校验 verdict 写入（通过 runStore 读）
  const { runStore } = await import("./run-store.js");
  const runData = await runStore.get(handle.runId);
  const checkStep = runData?.steps.find((s) => s.stepId === "check");
  assert.equal(checkStep?.verdict, "fail");
  assert.equal(checkStep?.verdictSource, "command");
});

// ── AC-2.8 conditional 分支 ──
test("conditional：fail 裁决只走 fail 分支", async () => {
  const called: string[] = [];
  const spawn: SpawnJobFn = async (p) => {
    called.push(p.stepId);
    if (p.stepId === "gate") return { output: '```json\n{"verdict":"fail"}\n```', durationMs: 1 };
    return { output: "ok", durationMs: 1 };
  };
  const status = await run(def([
    { type: "agent", id: "gate", name: "门", role: "r", inputsFrom: "all",
      verdict: { type: "pass-fail", promptHint: "输出 verdict" } },
    { type: "conditional", id: "cond", branches: [
      { predicate: { kind: "verdict-eq", stepId: "gate", value: "pass" },
        steps: [{ type: "agent", id: "ok-path", name: "通过分支", role: "r", inputsFrom: "all" }] },
      { predicate: { kind: "verdict-eq", stepId: "gate", value: "fail" },
        steps: [{ type: "agent", id: "fail-path", name: "失败分支", role: "r", inputsFrom: "all" }] },
    ] },
  ]), spawn);
  assert.equal(status, "success");
  assert.ok(called.includes("fail-path"), "应走 fail 分支");
  assert.ok(!called.includes("ok-path"), "不应走 pass 分支");
});

// ── AC-2.9 loop 循环 ──
test("loop：verdict fail 持续时按 maxIterations 重跑并记 warning", async () => {
  let checkCount = 0;
  const spawn: SpawnJobFn = async (p) => {
    if (p.stepId === "impl") return { output: `impl 第${checkCount + 1}次`, durationMs: 1 };
    checkCount++;
    return { output: '```json\n{"verdict":"fail"}\n```', durationMs: 1 };
  };
  const status = await run(def([
    { type: "loop", id: "lp", loopType: "dowhile", maxIterations: 3,
      exitWhen: { kind: "verdict-eq", stepId: "check", value: "fail" },
      steps: [
        { type: "agent", id: "impl", name: "实现", role: "r", inputsFrom: "all" },
        { type: "agent", id: "check", name: "检查", role: "r", inputsFrom: ["impl"],
          verdict: { type: "pass-fail", promptHint: "输出 verdict" } },
      ] },
  ]), spawn);
  assert.equal(status, "success");
  assert.equal(checkCount, 3, "检查应执行 3 轮");
  const { runStore } = await import("./run-store.js");
  // 校验 iteration 递增 + maxIterations warning
  const handle2 = null; // runId 无法直接拿——通过 listIndex 最新一条验证
  const idx = await runStore.listIndex();
  const last = idx[0];
  const runData = await runStore.get(last.runId);
  const implSteps = runData?.steps.filter((s) => s.stepId === "impl");
  assert.equal(implSteps?.length, 3);
  assert.deepEqual(implSteps?.map((s) => s.iteration), [1, 2, 3]);
  const warnStep = runData?.steps.find((s) => s.warnings?.some((w) => w.includes("maxIterations")));
  assert.ok(warnStep, "应有 maxIterations 强制退出的 warning");
});

// ── AC-2.10 foreach 展开 ──
test("foreach：输出数组展开为并行分片", async () => {
  const items = [{ title: "任务A" }, { title: "任务B" }, { title: "任务C" }];
  const spawn: SpawnJobFn = async (p) => {
    if (p.stepId === "split") return { output: "```json\n" + JSON.stringify(items) + "\n```", durationMs: 1 };
    return { output: "did " + (p.jobInput.includes("任务A") ? "A" : p.jobInput.includes("任务B") ? "B" : "C"), durationMs: 1 };
  };
  const status = await run(def([
    { type: "agent", id: "split", name: "拆分", role: "r", inputsFrom: "all" },
    { type: "foreach", id: "fe", fromStepId: "split", source: "output", itemKey: "title",
      steps: [{ type: "agent", id: "work", name: "干活", role: "r", inputsFrom: "all" }] },
  ]), spawn);
  assert.equal(status, "success");
  const { runStore } = await import("./run-store.js");
  const idx = await runStore.listIndex();
  const runData = await runStore.get(idx[0].runId);
  const workSteps = runData?.steps.filter((s) => s.stepId === "work");
  assert.equal(workSteps?.length, 3, "应展开 3 个分片");
  const keys = workSteps?.map((s) => s.instanceKey).sort();
  assert.ok(keys?.every((k) => k?.startsWith("fe#")), "instanceKey 应带 foreach 前缀");
});

// ── AC-2.11 预算熔断 ──
test("预算熔断：超 maxLLMCalls 后停止调度", async () => {
  const called: string[] = [];
  const spawn: SpawnJobFn = async (p) => { called.push(p.stepId); return { output: "ok", durationMs: 1 }; };
  const status = await run(def([
    { type: "agent", id: "a1", name: "1", role: "r", inputsFrom: "all" },
    { type: "agent", id: "a2", name: "2", role: "r", inputsFrom: "all" },
    { type: "agent", id: "a3", name: "3", role: "r", inputsFrom: "all" },
  ], { budget: { maxLLMCalls: 2 } }), spawn);
  assert.equal(status, "aborted", "预算耗尽应 aborted");
  const { runStore } = await import("./run-store.js");
  const idx = await runStore.listIndex();
  const runData = await runStore.get(idx[0].runId);
  assert.equal(runData?.abortReason, "budget");
  assert.ok(called.length <= 2, `应最多执行 2 个 step，实际 ${called.length}`);
});

// ── AC-2.5 失败处理 ──
test("失败处理：job 报错 → run failed，后续不执行", async () => {
  const called: string[] = [];
  const spawn: SpawnJobFn = async (p) => {
    called.push(p.stepId);
    if (p.stepId === "bad") return { output: "", error: "模拟失败", durationMs: 1 };
    return { output: "ok", durationMs: 1 };
  };
  const status = await run(def([
    { type: "agent", id: "bad", name: "坏", role: "r", inputsFrom: "all" },
    { type: "agent", id: "after", name: "后", role: "r", inputsFrom: "all" },
  ]), spawn);
  assert.equal(status, "failed");
  assert.ok(!called.includes("after"), "失败后不应执行后续 step");
});

// ── AC-2.6 重试 ──
test("重试：maxRetries=1 时失败一次成功一次", async () => {
  let attempt = 0;
  const spawn: SpawnJobFn = async (p) => {
    if (p.stepId === "flaky") {
      attempt++;
      if (attempt === 1) return { output: "", error: "第一次失败", durationMs: 1 };
      return { output: "第二次成功", durationMs: 1 };
    }
    return { output: "ok", durationMs: 1 };
  };
  const status = await run(def([
    { type: "agent", id: "flaky", name: "不稳定", role: "r", inputsFrom: "all", retry: { maxRetries: 1 } },
  ]), spawn);
  assert.equal(status, "success");
  assert.equal(attempt, 2);
  const { runStore } = await import("./run-store.js");
  const idx = await runStore.listIndex();
  const runData = await runStore.get(idx[0].runId);
  const steps = runData?.steps.filter((s) => s.stepId === "flaky");
  assert.equal(steps?.length, 2, "应有两条 attempt 记录");
});

// ── 校验器 ──
test("校验器：环/断引用/闸门在循环内等反例", async () => {
  const { validatePipeline } = await import("./pipeline-defs.js");
  // 断引用
  let issues = validatePipeline(def([{ type: "agent", id: "a", name: "x", role: "r", inputsFrom: ["ghost"] }]));
  assert.ok(issues.some((i) => i.code === "missing-reference"));
  // 闸门在 loop 内
  issues = validatePipeline(def([
    { type: "loop", id: "lp", loopType: "dowhile", maxIterations: 2,
      exitWhen: { kind: "verdict-eq", stepId: "inner", value: "fail" },
      steps: [{ type: "agent", id: "inner", name: "x", role: "r", inputsFrom: "all", needsUserInput: true,
        verdict: { type: "pass-fail", promptHint: "v" } }] },
  ]));
  assert.ok(issues.some((i) => i.code === "gate-in-loop"));
  // maxIterations 超限
  issues = validatePipeline(def([
    { type: "loop", id: "lp", loopType: "dowhile", maxIterations: 9,
      exitWhen: { kind: "verdict-eq", stepId: "i", value: "f" },
      steps: [{ type: "agent", id: "i", name: "x", role: "r", inputsFrom: "all",
        verdict: { type: "pass-fail", promptHint: "v" } }] },
  ]));
  assert.ok(issues.some((i) => i.code === "invalid-loop"));
  // 重复 id
  issues = validatePipeline(def([
    { type: "agent", id: "dup", name: "x", role: "r", inputsFrom: "all" },
    { type: "agent", id: "dup", name: "y", role: "r", inputsFrom: "all" },
  ]));
  assert.ok(issues.some((i) => i.code === "duplicate-step-id"));
});

// ── verdict-executor 单元 ──
test("verdict llm 三级解析", async () => {
  const { createVerdictExecutor } = await import("./verdict-executor.js");
  const ve = createVerdictExecutor(async () => ({ exitCode: 0, stderr: "" }));
  const spec = { type: "pass-fail" as const, promptHint: "输出 verdict" };
  // ① JSON 块
  let r = await ve.decide(spec, '完成\n```json\n{"verdict":"pass"}\n```', "/tmp");
  assert.equal(r?.verdict, "pass");
  // ② 关键词
  r = await ve.decide(spec, "全部测试通过，结果 pass", "/tmp");
  assert.equal(r?.verdict, "pass");
  // ③ unknown
  r = await ve.decide(spec, "啥都没有", "/tmp");
  assert.equal(r?.verdict, "unknown");
  assert.ok(r?.warnings?.length);
});
