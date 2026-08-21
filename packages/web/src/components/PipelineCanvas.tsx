// components/PipelineCanvas.tsx — ReactFlow + dagre 流水线画布（B1）
//
// - 拉 /api/pipelines/:id/dag 拿节点+边，dagre 自动布局
// - run 进行时把 RunStep 状态实时叠加到节点（运行中描边脉冲/完成绿/失败红/未跑灰）
// - 边样式：sequence 实线 / branch 虚线+谓词 label / loop-back 弧形
// - 点击节点 = 选中对应时间线步骤（通过 onSelectStep 回调）

import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  type Node, type Edge, type NodeProps, Handle, Position, useNodesState, useEdgesState, useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { usePipelinesStore, type RunStep } from "../stores/pipelines";

interface DagNode { id: string; label: string; type: string; parentId?: string; branchLabel?: string }
interface DagEdge { id: string; source: string; target: string; kind: "sequence" | "loop-back" | "branch"; label?: string }

/** 节点状态汇总：同名 stepId 的多个 RunStep（重试/迭代/分片）合并取最新 */
function statusOfSteps(steps: RunStep[]): Record<string, RunStep> {
  const byStep: Record<string, RunStep> = {};
  for (const s of steps) {
    byStep[s.stepId] = s; // 后写的覆盖（steps 按完成顺序 append）
  }
  return byStep;
}

// ── dagre 布局 ──
const NODE_W = 176;
const NODE_H = 44;
function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

/** 自定义节点：紧凑卡片（icon + 标题 + 状态徽标） */
function StepCard({ data, selected }: NodeProps) {
  const d = data as { label: string; nodeType: string; status?: string; verdict?: string; live?: boolean };
  const typeIcon: Record<string, string> = { agent: "🤖", parallel: "∥", conditional: "◇", loop: "🔁", foreach: "⚡", sleep: "zzz" };
  return (
    <div className={`pwf-node d-${d.nodeType} st-${d.status ?? "idle"} ${selected ? "pwf-selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="pwf-icon">{typeIcon[d.nodeType] ?? "?"}</span>
      <span className="pwf-label">{d.label}</span>
      {d.verdict && <span className={`pwf-verdict v-${d.verdict}`}>{d.verdict}</span>}
      {d.live && <span className="pwf-live" />}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { step: StepCard };

function CanvasInner({ pipelineId, steps, onSelectStep }: { pipelineId: string; steps: RunStep[]; onSelectStep?: (key: string) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  // 拉静态 DAG 结构
  useEffect(() => {
    fetch(`/api/pipelines/${pipelineId}/dag`).then((r) => r.json()).then((dag: { nodes: DagNode[]; edges: DagEdge[] }) => {
      const rfNodes: Node[] = dag.nodes.map((n) => ({
        id: n.id,
        type: "step",
        position: { x: 0, y: 0 },
        data: { label: n.label.replace(/^[∥◇🔁⚡]\s*/, ""), nodeType: n.type, rawLabel: n.label },
      }));
      const rfEdges: Edge[] = dag.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: e.kind === "loop-back",
        label: e.label,
        labelStyle: { fontSize: 10 },
        labelBgStyle: { fill: "var(--surface, #fff)" },
        style: e.kind === "sequence" ? { stroke: "var(--border, #ccc)" }
          : e.kind === "loop-back" ? { stroke: "var(--accent, #2f6feb)", strokeDasharray: "6 3" }
          : { stroke: "var(--muted, #888)", strokeDasharray: "2 3" },
      }));
      // 布局要在首次测量后；先放初始位置，用 requestAnimationFrame 两帧后布局
      setNodes(rfNodes);
      setEdges(rfEdges);
      requestAnimationFrame(() => requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 })));
    }).catch(() => {});
  }, [pipelineId, setNodes, setEdges, fitView]);

  // run 状态变化 → 叠加到节点（保留用户拖拽位置：只更新 data）
  const byStep = useMemo(() => statusOfSteps(steps), [steps]);
  useEffect(() => {
    setNodes((nds) => nds.map((n) => {
      const rs = byStep[n.id as string];
      if (!rs) return n;
      return {
        ...n,
        data: {
          ...n.data,
          status: rs.status,
          verdict: rs.verdict,
          live: rs.status === "running",
        },
      };
    }));
  }, [byStep, setNodes]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    const rs = byStep[node.id as string];
    if (rs && onSelectStep) onSelectStep(`${rs.stepId}|${rs.instanceKey ?? ""}|${rs.attempt}|${rs.iteration}`);
  }, [byStep, onSelectStep]);

  // 首次布局（节点测量完成后）
  const initialLayout = useCallback(() => {
    setNodes((nds) => layoutNodes(nds, edges));
  }, [edges, setNodes]);

  // 节点数量变化时重新布局
  useEffect(() => {
    if (nodes.length === 0) return;
    const t = setTimeout(() => setNodes((nds) => layoutNodes(nds, edges)), 50);
    return () => clearTimeout(t);
  }, [nodes.length, edges, setNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onNodeClick={onNodeClick}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
      maxZoom={1.8}
    >
      <Background gap={20} size={1.5} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={2} />
    </ReactFlow>
  );
}

export function PipelineCanvas({ pipelineId, steps, onSelectStep }: { pipelineId: string; steps: RunStep[]; onSelectStep?: (key: string) => void }) {
  return (
    <div className="pwf-root" style={{ width: "100%", height: "100%" }}>
      <ReactFlowProvider>
        <CanvasInner pipelineId={pipelineId} steps={steps} onSelectStep={onSelectStep} />
      </ReactFlowProvider>
    </div>
  );
}
