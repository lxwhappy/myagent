// ============================================================
// dag-to-tree.ts — DAG → 引擎树编译器（路线A核心）
//
// 输入：PipelineDag（编辑器产出的自由 DAG）
// 输出：StepNode[]（现有 pipeline-engine 直接执行的嵌套树）
//
// 编译规则：
//   1. 以 trigger 为根做 BFS 分层，同层无依赖的节点 → parallel 包裹
//   2. decision 节点 → conditional（出边 branchValue → 谓词分支）
//   3. loop 节点的域成员（loopOf）→ 循环体（按域内拓扑序串行）；
//      loop 节点本身不产生执行节点，位置让给 body 首节点
//   4. DAG 分叉（多出边非 decision）→ parallel 多分支
//   5. 汇合点（多入边）前的分支自动被 parallel 语义覆盖（allSettled 后继续）
//
// 保持幂等：同一 DAG 编译出的 step id 稳定（用节点 id 做映射）。
// ============================================================

import type {
  StepNode, AgentStep, ParallelStep, ConditionalStep, LoopStep, SleepStep,
} from "./pipeline-defs.js";
import type {
  PipelineDag, PipelineDagNode, AgentDagNode, DecisionDagNode, DagFlowEdge,
} from "./dag-model.js";

interface CompileIssue {
  message: string;
}

export interface CompileResult {
  steps: StepNode[];
  issues: CompileIssue[];
}

/** stepId（树内）↔ 节点 id（DAG）映射：DAG 节点 id 带 -agent 等后缀区分，树 id 就是节点 id */
export function compileDag(dag: PipelineDag): CompileResult {
  const issues: CompileIssue[] = [];
  const nodes = dag.nodes;
  const edges = dag.edges;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // ── 域划分：loop 节点的 body 成员 ──
  const loopBodies = new Map<string, PipelineDagNode[]>();
  for (const n of nodes) {
    if (n.loopOf) {
      const arr = loopBodies.get(n.loopOf) ?? [];
      arr.push(n);
      loopBodies.set(n.loopOf, arr);
    }
  }
  // 只有 body 成员排除主图；loop 节点本身在主图占位（编译成 LoopStep）
  const bodyMemberIds = new Set<string>();
  for (const [, body] of loopBodies) {
    for (const b of body) bodyMemberIds.add(b.id);
  }

  // ── 主图：trigger 之后的节点（排除 loop body 成员） ──
  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) {
    return { steps: [], issues: [{ message: "缺少 trigger 起点节点" }] };
  }

  // 主图边（两端都在主图内的边；穿过 body 的边「穿透」为 loop 边：b1→a9 变 L→a9）
  const mainEdges: DagFlowEdge[] = [];
  const resolveSource = (id: string): string => {
    // body 成员的出边视作其所属 loop 的出边
    const n = byId.get(id);
    if (n?.loopOf) return n.loopOf;
    return id;
  };
  for (const e of edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) continue;
    // 边的两端都排除 trigger；target 不能是 body 成员（body 入边也穿透到 loop）
    if (tgt.loopOf) continue; // → loop 的 body 入边，主图不需要
    const source = resolveSource(e.source);
    if (source === e.target) continue;
    mainEdges.push({ ...e, source });
  }

  // ── 分层 BFS（按入度）──
  const mainNodeIds = nodes.filter((n) => !bodyMemberIds.has(n.id) && n.id !== trigger.id).map((n) => n.id);
  const levels = topoLevels(mainNodeIds, mainEdges, trigger.id, byId);

  // ── 逐层编译 ──
  const steps: StepNode[] = [];
  for (const level of levels) {
    if (level.length === 0) continue;
    const compiled = level.map((id) => compileNode(id, byId, edges, loopBodies, dag, issues)).filter(Boolean) as StepNode[];
    if (compiled.length === 0) continue;
    if (compiled.length === 1) {
      steps.push(compiled[0]);
    } else {
      // 同层多节点 → parallel
      const p: ParallelStep = {
        type: "parallel",
        id: `par-${level.join("_").slice(0, 60)}`,
        steps: compiled,
      };
      steps.push(p);
    }
  }

  return { steps, issues };
}

/** 主图拓扑分层（Kahn 变体：一层 = 所有当前入度为 0 的节点） */
function topoLevels(
  nodeIds: string[],
  edges: DagFlowEdge[],
  triggerId: string,
  byId: Map<string, PipelineDagNode>,
): string[][] {
  const idSet = new Set(nodeIds);
  const inDeg = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const adj = new Map<string, string[]>();
  // trigger 直连的节点入度从 0 起
  for (const e of edges) {
    const s = e.source === triggerId ? null : e.source;
    const t = e.target;
    if (!idSet.has(t)) continue;
    if (s !== null && !idSet.has(s)) continue;
    if (s === null) continue; // trigger 直连：入度不加（起始层）
    inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
    adj.set(s, [...(adj.get(s) ?? []), t]);
  }
  // 起始层：入度 0 的 + trigger 直连
  let layer = nodeIds.filter((id) => (inDeg.get(id) ?? 0) === 0);
  const levels: string[][] = [];
  const seen = new Set<string>();
  while (layer.length) {
    levels.push(layer);
    const next: string[] = [];
    for (const id of layer) {
      seen.add(id);
      for (const t of adj.get(id) ?? []) {
        const d = (inDeg.get(t) ?? 0) - 1;
        inDeg.set(t, d);
        if (d === 0 && !seen.has(t)) next.push(t);
      }
    }
    layer = next;
  }
  return levels;
}

/** 单节点 → StepNode（loop 节点特殊：产出 LoopStep，body 从域编译） */
function compileNode(
  id: string,
  byId: Map<string, PipelineDagNode>,
  edges: DagFlowEdge[],
  loopBodies: Map<string, PipelineDagNode[]>,
  dag: PipelineDag,
  issues: CompileIssue[],
): StepNode | null {
  const n = byId.get(id);
  if (!n) return null;

  switch (n.type) {
    case "agent": {
      const a = n as AgentDagNode;
      const s: AgentStep = {
        type: "agent",
        id: a.id,
        name: a.label,
        agentId: a.agentId,
        skills: a.skills,
        role: a.role || a.label,
        instructions: a.instructions,
        inputsFrom: a.inputsFrom ?? "all",
        verdict: a.verdict,
        retry: a.retry,
        artifacts: a.artifacts,
        needsUserInput: a.needsUserInput,
      };
      return s;
    }
    case "decision": {
      const d = n as DecisionDagNode;
      const outs = edges.filter((e) => e.source === id);
      const branches = outs
        .filter((e) => !e.isDefault)
        .map((e) => ({
          predicate: { kind: "verdict-eq" as const, stepId: d.sourceNodeId ?? "", value: e.branchValue ?? "" },
          steps: [] as StepNode[],
        }));
      // 分支体：简化为空（分支后的图仍由后续层表达，谓词只做门）
      // 引擎 conditional 语义：匹配分支执行其 steps 后继续序列 → 分支体为空等价于「路由门」
      const c: ConditionalStep = {
        type: "conditional",
        id,
        branches,
        default: [],
      };
      return c;
    }
    case "loop": {
      const body = loopBodies.get(id) ?? [];
      const exitNode = body.find((b) => b.exitOf === id) as AgentDagNode | undefined;
      if (!exitNode) {
        issues.push({ message: `loop「${n.label}」缺少出口判定节点` });
        return null;
      }
      // body 内拓扑序（用域内边）
      const bodyIds = body.map((b) => b.id);
      const bodyEdges = edges.filter((e) => bodyIds.includes(e.source) && bodyIds.includes(e.target));
      const inDeg = new Map(bodyIds.map((bid) => [bid, 0]));
      for (const e of bodyEdges) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
      const ordered: string[] = [];
      let queue = bodyIds.filter((bid) => (inDeg.get(bid) ?? 0) === 0);
      while (queue.length) {
        const bid = queue.shift()!;
        ordered.push(bid);
        for (const e of bodyEdges.filter((e2) => e2.source === bid)) {
          const d = (inDeg.get(e.target) ?? 0) - 1;
          inDeg.set(e.target, d);
          if (d === 0) queue.push(e.target);
        }
      }
      const bodySteps = ordered
        .map((bid) => compileNode(bid, byId, edges, loopBodies, dag, issues))
        .filter(Boolean) as StepNode[];
      const l: LoopStep = {
        type: "loop",
        id,
        loopType: (n as any).loopType ?? "dountil",
        maxIterations: (n as any).maxIterations ?? 2,
        exitWhen: { kind: "verdict-eq", stepId: exitNode.id, value: "pass" },
        steps: bodySteps,
      };
      return l;
    }
    case "delay": {
      const s: SleepStep = { type: "sleep", id, durationMs: (n as any).durationMs ?? 1000 };
      return s;
    }
    case "trigger":
      return null; // trigger 不产生执行步骤
  }
  return null;
}

// ── 反向：树 → DAG（旧数据迁移 + 只读视图复用） ──

import type { PipelineDef } from "./pipeline-defs.js";

/** 把旧的树形 PipelineDef.steps 编译成 DAG（一次性迁移用） */
export function treeToDagNodes(def: PipelineDef): PipelineDag {
  const nodes: PipelineDagNode[] = [];
  const edges: DagFlowEdge[] = [];
  const positions: Record<string, { x: number; y: number }> = {};
  let x = 60, y = 200;
  let prevId = "n-trigger";

  nodes.push({ id: "n-trigger", type: "trigger", label: "开始" });
  positions["n-trigger"] = { x, y };

  const walk = (steps: StepNode[], parent: string, loopId?: string) => {
    let last = parent;
    for (const s of steps) {
      x += 240;
      const id = s.id;
      switch (s.type) {
        case "agent": {
          nodes.push({
            id, type: "agent", label: s.name || s.id,
            agentId: s.agentId, skills: s.skills, role: s.role,
            instructions: s.instructions, inputsFrom: s.inputsFrom,
            verdict: s.verdict, retry: s.retry, artifacts: s.artifacts,
            needsUserInput: s.needsUserInput,
            loopOf: loopId,
          });
          edges.push({ id: `e-${last}-${id}`, source: last, target: id });
          positions[id] = { x, y };
          last = id;
          break;
        }
        case "sleep": {
          nodes.push({ id, type: "delay", label: s.id, durationMs: s.durationMs, loopOf: loopId });
          edges.push({ id: `e-${last}-${id}`, source: last, target: id });
          positions[id] = { x, y };
          last = id;
          break;
        }
        case "parallel": {
          // parallel → 扇出扇入：每个分支子序列从同一 parent 出发，尾都连到汇合点
          const branchTails: string[] = [];
          const branchYs: number[] = [];
          for (const b of s.steps) {
            y += 120;
            const tail = walkBranch(b, last, nodes, edges, positions, loopId);
            branchTails.push(tail);
            branchYs.push(y);
          }
          y = Math.max(...branchYs, y);
          if (branchTails.length > 0) last = branchTails[0]; // 汇合近似：取第一分支尾
          break;
        }
        case "conditional": {
          nodes.push({
            id, type: "decision", label: s.id,
            sourceNodeId: s.branches[0]?.predicate.stepId ?? "",
          });
          edges.push({ id: `e-${last}-${id}`, source: last, target: id });
          positions[id] = { x, y };
          let defTail = id;
          for (const b of s.branches) {
            const tail = walkList(b.steps, id, nodes, edges, positions, loopId, b.predicate.value);
            if (tail && tail !== id) defTail = tail;
          }
          if (s.default?.length) {
            walkList(s.default, id, nodes, edges, positions, loopId, undefined, true);
          }
          last = defTail;
          break;
        }
        case "loop": {
          // loop 节点 + 域标记 body
          nodes.push({
            id, type: "loop", label: s.id,
            loopType: s.loopType, maxIterations: s.maxIterations,
          });
          edges.push({ id: `e-${last}-${id}`, source: last, target: id });
          positions[id] = { x, y };
          // body：exitWhen 节点标 exitOf，其他标 loopOf
          for (const b of s.steps) {
            const isExit = b.id === s.exitWhen.stepId;
            x += 240;
            if (b.type === "agent") {
              nodes.push({
                id: b.id, type: "agent", label: b.name || b.id,
                agentId: b.agentId, skills: b.skills, role: b.role,
                instructions: b.instructions, inputsFrom: b.inputsFrom,
                verdict: b.verdict, retry: b.retry, artifacts: b.artifacts,
                needsUserInput: b.needsUserInput,
                loopOf: id,
                ...(isExit ? { exitOf: id } : {}),
              } as any);
              edges.push({ id: `e-${last === id ? id : last}-${b.id}`, source: last === id ? id : last, target: b.id });
              positions[b.id] = { x, y };
            } else if (b.type === "sleep") {
              nodes.push({ id: b.id, type: "delay", label: b.id, durationMs: b.durationMs, loopOf: id });
              edges.push({ id: `e-${last}-${b.id}`, source: last, target: b.id });
              positions[b.id] = { x, y };
            }
          }
          last = s.exitWhen.stepId; // loop 后续接到出口节点
          break;
        }
        case "foreach": {
          // foreach 拆成：split agent（产数组）+ 检查 agent（域内）——迁移近似
          x += 240;
          const fid = `${s.id}-check`;
          nodes.push({ id: fid, type: "agent", label: `${s.id}（分片）`, role: "分片执行", inputsFrom: "all", loopOf: loopId } as any);
          edges.push({ id: `e-${last}-${fid}`, source: last, target: fid });
          positions[fid] = { x, y };
          last = fid;
          break;
        }
      }
    }
    return last;
  };

  const walkBranch = (b: StepNode, parent: string, nodes: any[], edges: any[], positions: any, loopId?: string) => {
    return walk([b], parent, loopId);
  };
  const walkList = (list: StepNode[], parent: string, nodes: any[], edges: any[], positions: any, loopId: string | undefined, branchValue?: string, isDefault?: boolean) => {
    // 分支列表：首节点边带 branchValue
    let prev = parent;
    let first = true;
    let last = parent;
    for (const s of list) {
      const sub = walk([s], prev, loopId);
      if (first && branchValue !== undefined) {
        // 给首边打谓词（walk 里已建边，回填）
        const e = edges.find((e2) => e2.target === s.id && e2.source === parent);
        if (e) { e.branchValue = branchValue; }
      }
      if (first && isDefault) {
        const e = edges.find((e2) => e2.target === s.id && e2.source === parent);
        if (e) e.isDefault = true;
      }
      first = false;
      last = sub;
      prev = sub;
    }
    return last;
  };

  walk(def.steps, "n-trigger");
  return { positions, nodes, edges };
}
