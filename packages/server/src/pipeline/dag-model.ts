// ============================================================
// dag-model.ts — 流水线 DAG 数据模型（路线A：自由 DAG 替代嵌套树）
//
// 编辑层：PipelineDag（节点+边，workflowbuilder 编辑器直接产出）
// 执行层：仍用现有 PipelineDef.steps 树（dag-to-tree 编译）
//
// 节点类型（5 种，对齐引擎原语）：
//   trigger      — 起点（单出边）
//   agent        — 执行单元（role/instructions/verdict/retry/artifacts/闸门）
//   decision     — 条件分支（出边带 verdict 谓词 label，default 出边）
//   loop         — 循环域（body 节点标记 loopOf=loop节点id，出口节点 exitOf）
//   delay        — sleep
//
// 边语义：sequence（普通流）/ branch（decision 出边，label=谓词值）
// loop 用「域标记」而非回边表达：body 节点带 loopOf，尾部 exitWhen 节点带 exitOf
// ============================================================

import type { Predicate, VerdictSpec } from "./pipeline-defs.js";

// ── DAG 节点 ──

export interface DagNodeBase {
  id: string;                      // ReactFlow 节点 id（uuid）
  type: "trigger" | "agent" | "decision" | "loop" | "delay";
  label: string;                   // 显示名（stepId 角色）
  /** loop 域标记：属于哪个 loop 节点的 body */
  loopOf?: string;
  /** loop 出口标记：本节点是 loop 的 exitWhen 判定节点（须声明 verdict） */
  exitOf?: string;
}

export interface TriggerNode extends DagNodeBase { type: "trigger" }

export interface AgentDagNode extends DagNodeBase {
  type: "agent";
  agentId?: string;
  skills?: string[];
  role: string;
  instructions?: string;
  inputsFrom: "all" | string[];    // 上游节点 id 列表
  verdict?: VerdictSpec;
  retry?: { maxRetries: number };
  artifacts?: string[];
  needsUserInput?: boolean;
}

export interface DecisionDagNode extends DagNodeBase {
  type: "decision";
  /** 谓词数据源：引用某个 agent 节点的 verdict */
  sourceNodeId: string;
}

export interface LoopDagNode extends DagNodeBase {
  type: "loop";
  loopType: "dowhile" | "dountil";
  maxIterations: number;
}

export interface DelayDagNode extends DagNodeBase {
  type: "delay";
  durationMs: number;
}

export type PipelineDagNode = TriggerNode | AgentDagNode | DecisionDagNode | LoopDagNode | DelayDagNode;

// ── DAG 边 ──

export interface DagFlowEdge {
  id: string;
  source: string;
  target: string;
  /** decision 出边：谓词匹配值（verdict === label 时走这条边） */
  branchValue?: string;
  /** decision 的 default 出边 */
  isDefault?: boolean;
}

// ── DAG 文档（存盘格式） ──

export interface PipelineDag {
  /** 画布节点位置（编辑器持久化用） */
  positions: Record<string, { x: number; y: number }>;
  nodes: PipelineDagNode[];
  edges: DagFlowEdge[];
}

// ── 校验 ──

export interface DagValidationIssue {
  code: string;
  message: string;
}

export function validateDag(dag: PipelineDag): DagValidationIssue[] {
  const issues: DagValidationIssue[] = [];
  const push = (code: string, message: string) => issues.push({ code, message });

  if (!Array.isArray(dag.nodes) || dag.nodes.length === 0) {
    push("empty", "流水线至少需要一个节点");
    return issues;
  }

  const nodeById = new Map(dag.nodes.map((n) => [n.id, n]));
  const ids = new Set<string>();
  for (const n of dag.nodes) {
    if (!n.id) push("missing-id", "节点缺少 id");
    if (ids.has(n.id)) push("duplicate-id", `节点 id 重复: ${n.id}`);
    ids.add(n.id);
  }

  // trigger 唯一且必须是起点
  const triggers = dag.nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) push("no-trigger", "必须有一个 trigger 起点节点");
  if (triggers.length > 1) push("multi-trigger", "trigger 起点节点只能有一个");

  // 边引用 + 环检测（允许 loop 域内回边？不：loop 用域标记，DAG 本身必须无环）
  const inDeg = new Map<string, number>();
  for (const n of dag.nodes) inDeg.set(n.id, 0);
  for (const e of dag.edges) {
    if (!nodeById.has(e.source)) push("bad-edge", `边引用不存在的节点: ${e.source}`);
    else if (!nodeById.has(e.target)) push("bad-edge", `边引用不存在的节点: ${e.target}`);
    else inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  // Kahn 拓扑排序验环
  const queue = dag.nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const adj = new Map<string, string[]>();
  for (const e of dag.edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  }
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const t of adj.get(id) ?? []) {
      const d = (inDeg.get(t) ?? 0) - 1;
      inDeg.set(t, d);
      if (d === 0) queue.push(t);
    }
  }
  if (visited !== dag.nodes.length) push("cycle", "画布存在环（loop 请用 loop 节点+域标记，不要画回边）");

  // agent 节点细化校验
  for (const n of dag.nodes) {
    if (n.type !== "agent") continue;
    if (!n.role?.trim()) push("missing-role", `agent 节点「${n.label}」缺少角色名`);
    if (Array.isArray(n.inputsFrom)) {
      for (const ref of n.inputsFrom) {
        if (!nodeById.has(ref)) push("bad-inputs-from", `节点「${n.label}」inputsFrom 引用不存在: ${ref}`);
      }
    }
    if (n.retry && (!Number.isInteger(n.retry.maxRetries) || n.retry.maxRetries < 0 || n.retry.maxRetries > 3)) {
      push("bad-retry", `节点「${n.label}」maxRetries 必须是 0-3`);
    }
    // 闸门不能在 loop 域内
    if (n.needsUserInput && n.loopOf) {
      push("gate-in-loop", `人工闸门「${n.label}」不能放在循环域内（防止无限等待）`);
    }
  }

  // decision 校验
  for (const n of dag.nodes) {
    if (n.type !== "decision") continue;
    if (!nodeById.has(n.sourceNodeId)) {
      push("bad-decision-source", `decision「${n.label}」的数据源节点不存在: ${n.sourceNodeId}`);
    } else {
      const src = nodeById.get(n.sourceNodeId)!;
      if (src.type !== "agent" || !src.verdict) {
        push("decision-no-verdict", `decision「${n.label}」的数据源「${src.label}」未声明 verdict`);
      }
    }
    const outs = dag.edges.filter((e) => e.source === n.id);
    if (outs.length < 2) push("decision-branches", `decision「${n.label}」至少需要 2 条出边`);
    if (!outs.some((e) => e.isDefault)) push("decision-default", `decision「${n.label}」需要一条 default 出边（无匹配时兜底）`);
    for (const e of outs) {
      if (!e.isDefault && !e.branchValue) {
        push("decision-branch-value", `decision「${n.label}」的分支边缺少匹配值`);
      }
    }
  }

  // loop 校验
  for (const n of dag.nodes) {
    if (n.type !== "loop") continue;
    const body = dag.nodes.filter((m) => m.loopOf === n.id);
    if (body.length === 0) push("loop-empty", `loop「${n.label}」的循环域内没有任何节点`);
    if (!Number.isInteger(n.maxIterations) || n.maxIterations < 1 || n.maxIterations > 5) {
      push("loop-iterations", `loop「${n.label}」maxIterations 必须是 1-5`);
    }
    const exits = dag.nodes.filter((m) => m.exitOf === n.id);
    if (exits.length !== 1) {
      push("loop-exit", `loop「${n.label}」必须恰好有一个出口判定节点（exitOf 标记）`);
    } else {
      const ex = exits[0];
      if (ex.type !== "agent" || !(ex as AgentDagNode).verdict) {
        push("loop-exit-verdict", `loop「${n.label}」的出口节点「${ex.label}」必须是声明了 verdict 的 agent 节点`);
      }
    }
  }

  // delay 校验
  for (const n of dag.nodes) {
    if (n.type === "delay" && (!Number.isFinite(n.durationMs) || n.durationMs < 0 || n.durationMs > 3_600_000)) {
      push("bad-delay", `delay「${n.label}」durationMs 必须在 0-3600000`);
    }
  }

  return issues;
}
