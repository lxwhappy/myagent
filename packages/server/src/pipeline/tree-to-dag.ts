// ============================================================
// tree-to-dag.ts — 树形流水线定义 → React Flow DAG（只读画布视图用）
//
// 纯函数：parallel → 并行分支汇合；loop → 回边（虚线）；
//         foreach → 展开容器节点；conditional → 分支。
// 注意：任意 DAG 不能无损转回嵌套树，所以画布只读（编辑在表单/JSON）。
// ============================================================

import type { PipelineDef, StepNode } from "./pipeline-defs.js";

export interface DagNode {
  id: string;
  label: string;
  type: string;              // 原语类型（前端选样式）
  parentId?: string;         // 所属容器（parallel/foreach/loop）
  branchLabel?: string;      // conditional 分支标注
}

export interface DagEdge {
  id: string;
  source: string;
  target: string;
  kind: "sequence" | "loop-back" | "branch";
}

interface ConvertCtx {
  nodes: DagNode[];
  edges: DagEdge[];
  seq: number;
}

/** 转换主入口：返回画布节点+边（无布局，布局由前端 dagre/ReactFlow 处理） */
export function treeToDag(def: PipelineDef): { nodes: DagNode[]; edges: DagEdge[] } {
  const ctx: ConvertCtx = { nodes: [], edges: [], seq: 0 };
  convertList(def.steps, ctx, undefined);
  return { nodes: ctx.nodes, edges: ctx.edges };
}

/** 转换步骤序列：头尾相连；返回 [首节点id, 尾节点id]（空序列返回 anchor 透传） */
function convertList(steps: StepNode[], ctx: ConvertCtx, parentId: string | undefined): [string?, string?] {
  let head: string | undefined;
  let tail: string | undefined;
  for (const s of steps) {
    const [sHead, sTail] = convertNode(s, ctx, parentId);
    if (sHead && sTail) {
      if (tail && sHead !== tail) {
        ctx.edges.push({ id: `e${ctx.seq++}`, source: tail, target: sHead, kind: "sequence" });
      }
      head ??= sHead;
      tail = sTail;
    }
  }
  return [head, tail];
}

function convertNode(node: StepNode, ctx: ConvertCtx, parentId: string | undefined): [string?, string?] {
  const label = (node as any).name ?? node.id;
  switch (node.type) {
    case "agent":
    case "sleep": {
      ctx.nodes.push({ id: node.id, label, type: node.type, parentId });
      return [node.id, node.id];
    }
    case "parallel": {
      // 容器节点 + 每个分支子序列的头连入、尾汇合出
      ctx.nodes.push({ id: node.id, label: `∥ ${label}`, type: "parallel" });
      let lastTail: string | undefined;
      let first = true;
      for (const branch of node.steps) {
        const [h, t] = convertList([branch], ctx, node.id);
        if (h) ctx.edges.push({ id: `e${ctx.seq++}`, source: node.id, target: h, kind: "sequence" });
        if (t) {
          if (!first && lastTail) {
            ctx.edges.push({ id: `e${ctx.seq++}`, source: t, target: node.id, kind: "branch" });
          } else {
            ctx.edges.push({ id: `e${ctx.seq++}`, source: t, target: node.id, kind: "branch" });
          }
          lastTail = t;
        }
        first = false;
      }
      return [node.id, node.id];
    }
    case "conditional": {
      ctx.nodes.push({ id: node.id, label: `◇ ${label}`, type: "conditional" });
      for (const b of node.branches) {
        const pv = `${b.predicate.stepId}==${b.predicate.value}`;
        const [h, t] = convertList(b.steps, ctx, node.id);
        if (h) ctx.edges.push({ id: `e${ctx.seq++}`, source: node.id, target: h, kind: "branch", ...{} });
        // 分支标注记在边 id 里不可行——用 branchLabel 字段在边上
        const e = ctx.edges[ctx.edges.length - 1];
        if (e) (e as any).label = pv;
        if (t) ctx.edges.push({ id: `e${ctx.seq++}`, source: t, target: node.id, kind: "branch" });
      }
      if (node.default) {
        const [h, t] = convertList(node.default, ctx, node.id);
        if (h) {
          ctx.edges.push({ id: `e${ctx.seq++}`, source: node.id, target: h, kind: "branch" });
          const e = ctx.edges[ctx.edges.length - 1];
          if (e) (e as any).label = "default";
        }
        if (t) ctx.edges.push({ id: `e${ctx.seq++}`, source: t, target: node.id, kind: "branch" });
      }
      return [node.id, node.id];
    }
    case "loop": {
      ctx.nodes.push({ id: node.id, label: `🔁 ${label}`, type: "loop" });
      const [h, t] = convertList(node.steps, ctx, node.id);
      if (h) ctx.edges.push({ id: `e${ctx.seq++}`, source: node.id, target: h, kind: "sequence" });
      if (t) {
        // 回边：body 尾 → loop 头（虚线）
        ctx.edges.push({ id: `e${ctx.seq++}`, source: t, target: node.id, kind: "loop-back" });
        const e = ctx.edges[ctx.edges.length - 1];
        if (e) (e as any).label = node.loopType === "dowhile" ? `×${node.maxIterations}` : `≤${node.maxIterations}`;
      }
      return [node.id, node.id];
    }
    case "foreach": {
      ctx.nodes.push({ id: node.id, label: `⚡ ${label}`, type: "foreach" });
      const [h, t] = convertList(node.steps, ctx, node.id);
      if (h) ctx.edges.push({ id: `e${ctx.seq++}`, source: node.id, target: h, kind: "sequence" });
      if (t) ctx.edges.push({ id: `e${ctx.seq++}`, source: t, target: node.id, kind: "branch" });
      return [node.id, node.id];
    }
  }
  return [undefined, undefined];
}
