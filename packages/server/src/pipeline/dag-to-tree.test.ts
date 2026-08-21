// dag-to-tree.test.ts — 编译器单元测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDag, type PipelineDag } from "./dag-model.js";
import { compileDag, treeToDagNodes } from "./dag-to-tree.js";
import type { PipelineDef } from "./pipeline-defs.js";

function mkDag(): PipelineDag {
  return {
    positions: {},
    nodes: [
      { id: "t1", type: "trigger", label: "开始" },
      { id: "a1", type: "agent", label: "分析", role: "分析师", inputsFrom: "all" },
      { id: "d1", type: "decision", label: "路由", sourceNodeId: "a1" },
      { id: "a2", type: "agent", label: "小路径", role: "执行", inputsFrom: ["a1"] },
      { id: "a3", type: "agent", label: "大路径", role: "执行", inputsFrom: ["a1"] },
      { id: "a4", type: "agent", label: "收尾", role: "报告", inputsFrom: "all" },
    ],
    edges: [
      { id: "e1", source: "t1", target: "a1" },
      { id: "e2", source: "a1", target: "d1" },
      { id: "e3", source: "d1", target: "a2", branchValue: "small" },
      { id: "e4", source: "d1", target: "a3", branchValue: "complex" },
      { id: "e5", source: "d1", target: "a4", isDefault: true },
      { id: "e6", source: "a2", target: "a4" },
      { id: "e7", source: "a3", target: "a4" },
    ],
  };
}

test("validateDag：合法 DAG 零 issue", () => {
  const dag = mkDag();
  // a1 需要 verdict 才能给 decision 用
  (dag.nodes[1] as any).verdict = { type: "route", routes: ["small", "complex"] };
  assert.deepEqual(validateDag(dag), []);
});

test("validateDag：环检测 + 缺 trigger + decision 缺 default", () => {
  const dag = mkDag();
  // 无 verdict 的 decision source
  const issues1 = validateDag(dag);
  assert.ok(issues1.some((i) => i.code === "decision-no-verdict"));

  // 环
  const dag2 = mkDag();
  (dag2.nodes[1] as any).verdict = { type: "route" };
  dag2.edges.push({ id: "ex", source: "a4", target: "a1" });
  const issues2 = validateDag(dag2);
  assert.ok(issues2.some((i) => i.code === "cycle"));

  // 缺 trigger
  const dag3 = mkDag();
  dag3.nodes = dag3.nodes.filter((n) => n.id !== "t1");
  const issues3 = validateDag(dag3);
  assert.ok(issues3.some((i) => i.code === "no-trigger"));

  // decision 无 default 边
  const dag4 = mkDag();
  (dag4.nodes[1] as any).verdict = { type: "route" };
  dag4.edges = dag4.edges.filter((e) => !e.isDefault);
  const issues4 = validateDag(dag4);
  assert.ok(issues4.some((i) => i.code === "decision-default"));
});

test("compileDag：decision → conditional 路由门 + 汇合", () => {
  const dag = mkDag();
  (dag.nodes[1] as any).verdict = { type: "route", routes: ["small", "complex"] };
  const { steps, issues } = compileDag(dag);
  assert.deepEqual(issues, []);
  // 期望序列：a1 → d1(conditional) → a2/a3(parallel) → a4
  assert.equal(steps.length, 4);
  assert.equal(steps[0].type, "agent");
  assert.equal(steps[1].type, "conditional");
  const c = steps[1] as any;
  assert.equal(c.branches.length, 2);
  assert.equal(c.branches[0].predicate.value, "small");
  assert.equal(c.branches[0].predicate.stepId, "a1");
  assert.equal(steps[2].type, "parallel");
  assert.equal((steps[2] as any).steps.length, 2);
  assert.equal(steps[3].type, "agent");
  assert.equal(steps[3].id, "a4");
});

test("compileDag：loop 域编译 + exitOf 出口", () => {
  const dag: PipelineDag = {
    positions: {},
    nodes: [
      { id: "t1", type: "trigger", label: "开始" },
      { id: "L", type: "loop", label: "打磨循环", loopType: "dountil", maxIterations: 3 },
      { id: "b1", type: "agent", label: "打磨", role: "审稿", inputsFrom: "all", loopOf: "L", verdict: { type: "pass-fail" }, exitOf: "L" },
      { id: "a9", type: "agent", label: "收尾", role: "报告", inputsFrom: "all" },
    ],
    edges: [
      { id: "e1", source: "t1", target: "L" },
      { id: "e2", source: "L", target: "b1" },
      { id: "e3", source: "b1", target: "a9" },
    ],
  };
  assert.deepEqual(validateDag(dag), []);
  const { steps, issues } = compileDag(dag);
  assert.deepEqual(issues, []);
  // L 是域节点不产生步骤；b1 在域内 → LoopStep；a9 在主图
  const loop = steps.find((s) => s.type === "loop") as any;
  assert.ok(loop, "应有 loop 步骤");
  assert.equal(loop.maxIterations, 3);
  assert.equal(loop.exitWhen.stepId, "b1");
  assert.equal(loop.steps.length, 1);
  assert.equal(loop.steps[0].id, "b1");
  const after = steps.find((s) => s.id === "a9");
  assert.ok(after, "域外节点应保留");
});

test("treeToDagNodes：旧树迁移往返（冒烟流水线核心子集）", () => {
  const def: PipelineDef = {
    id: "x", name: "旧", description: "", icon: "➡️",
    steps: [
      { type: "agent", id: "gather", name: "需求分析", role: "分析", inputsFrom: "all" },
      { type: "sleep", id: "breath", durationMs: 1000 },
      {
        type: "conditional", id: "route-split",
        branches: [
          { predicate: { kind: "verdict-eq", stepId: "gather", value: "small" }, steps: [{ type: "agent", id: "quick", name: "快速", role: "执行", inputsFrom: ["gather"] }] },
        ],
        default: [],
      },
    ],
    maxParallel: 3,
    createdAt: 0, updatedAt: 0,
  };
  const dag = treeToDagNodes(def);
  assert.ok(dag.nodes.some((n) => n.type === "trigger"));
  assert.ok(dag.nodes.some((n) => n.id === "gather" && n.type === "agent"));
  assert.ok(dag.nodes.some((n) => n.id === "breath" && n.type === "delay"));
  assert.ok(dag.nodes.some((n) => n.id === "route-split" && n.type === "decision"));
  const be = dag.edges.find((e) => e.branchValue === "small");
  assert.ok(be, "分支边应带 branchValue");
  // 编译回树：结构等价（conditional 存在，quick 在主图某层）
  const { steps } = compileDag(dag);
  assert.ok(steps.some((s) => s.type === "conditional"));
  assert.ok(steps.some((s) => s.id === "quick"));
});
