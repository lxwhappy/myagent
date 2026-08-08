// components/AgentFlowGraph.tsx — 多 Agent 协作 DAG 可视化
//
// 使用 React Flow + Dagre 自动布局渲染 Agent 团队的执行流程图。
// 节点状态实时更新（pending → running → done → error），由 SSE 事件驱动。
//
// 三种编排模式的 DAG 结构：
//   pipeline:   A → B → C（线性链）
//   supervisor: Supervisor → [A, B, C]（星形）
//   evaluator:  Generator → Evaluator → (pass → done | fail → Generator 重试)

import { useMemo, useCallback, type CSSProperties } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";

// ── 节点数据类型 ──
export type AgentNodeStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface AgentNodeData {
  label: string;
  role: string;
  icon: string;
  status: AgentNodeStatus;
  duration?: number;   // ms
  summary?: string;    // 完成后的摘要
  isCoordinator?: boolean;
  retryCount?: number;
  [key: string]: unknown;
}

// ── Dagre 自动布局 ──
const LAYOUT_OPTIONS = {
  "pipeline": { rankdir: "LR", nodesep: 40, ranksep: 80 },
  "supervisor": { rankdir: "TB", nodesep: 50, ranksep: 60 },
  "evaluator": { rankdir: "LR", nodesep: 40, ranksep: 80 },
};

function layoutWithDagre(nodes: Node[], edges: Edge[], mode: TeamMode): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph(LAYOUT_OPTIONS[mode] || LAYOUT_OPTIONS.supervisor);
  g.setDefaultEdgeLabel(() => ({}));

  const NODE_W = 180;
  const NODE_H = 80;

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_W, height: NODE_H });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes = nodes.map(node => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
    };
  });

  return { nodes: layoutNodes, edges };
}

// ── 状态颜色映射（严格使用 design tokens） ──
const STATUS_COLORS: Record<AgentNodeStatus, string> = {
  pending: "var(--muted)",
  running: "var(--warn)",
  done: "var(--success)",
  error: "var(--danger)",
  skipped: "var(--muted)",
};

const STATUS_BG: Record<AgentNodeStatus, string> = {
  pending: "var(--surface)",
  running: "color-mix(in oklab, var(--warn), transparent 90%)",
  done: "color-mix(in oklab, var(--success), transparent 92%)",
  error: "color-mix(in oklab, var(--danger), transparent 90%)",
  skipped: "var(--bg)",
};

// ── 自定义节点组件 ──
function AgentNode({ data }: NodeProps) {
  const d = data as AgentNodeData;
  const status = d.status;
  const borderColor = STATUS_COLORS[status];
  const bgColor = STATUS_BG[status];
  const isRunning = status === "running";

  const cardStyle: CSSProperties = {
    border: `1.5px solid ${borderColor}`,
    borderRadius: "var(--radius-md)",
    background: bgColor,
    padding: "10px 14px",
    width: 180,
    position: "relative",
    transition: "all var(--motion-fast)",
    boxShadow: isRunning ? `0 0 0 3px color-mix(in oklab, ${borderColor}, transparent 75%)` : "none",
  };

  return (
    <div style={cardStyle}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      {/* 状态指示点 */}
      <div style={{
        position: "absolute",
        top: 8, right: 8,
        width: 8, height: 8,
        borderRadius: "50%",
        background: borderColor,
        animation: isRunning ? "agent-flow-pulse 1.2s infinite" : "none",
      }} />

      {/* 图标 + 名称 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 16 }}>{d.icon}</span>
        <span style={{
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          color: "var(--fg)",
          fontFamily: "var(--font-body)",
        }}>{d.label}</span>
      </div>

      {/* 角色 */}
      <div style={{
        fontSize: 11,
        color: "var(--muted)",
        marginBottom: 2,
      }}>{d.role}</div>

      {/* 耗时 */}
      {d.duration != null && (
        <div style={{
          fontSize: 10,
          color: "var(--muted)",
          fontFamily: "var(--font-mono)",
        }}>
          {d.duration < 1000 ? `${d.duration}ms` : `${(d.duration / 1000).toFixed(1)}s`}
          {d.retryCount ? ` · 重试${d.retryCount}次` : ""}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

export type TeamMode = "pipeline" | "supervisor" | "evaluator";

export interface FlowNodeDef {
  id: string;
  label: string;
  role: string;
  icon: string;
  status?: AgentNodeData["status"];
  duration?: number;
  retryCount?: number;
  isCoordinator?: boolean;
}

export interface FlowEdgeDef {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  dashed?: boolean;
}

// ── 主组件 ──
interface AgentFlowGraphProps {
  nodes: FlowNodeDef[];
  edges: FlowEdgeDef[];
  mode: TeamMode;
  height?: number | string;
  showControls?: boolean;
}

export function AgentFlowGraph({ nodes: nodeDefs, edges: edgeDefs, mode, height = 300, showControls = true }: AgentFlowGraphProps) {
  const inner = <AgentFlowGraphInner nodes={nodeDefs} edges={edgeDefs} mode={mode} height={height} showControls={showControls} />;
  return <ReactFlowProvider>{inner}</ReactFlowProvider>;
}

function AgentFlowGraphInner({ nodes: nodeDefs, edges: edgeDefs, mode, height = 300, showControls = true }: AgentFlowGraphProps) {
  // 转换为 React Flow 格式
  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = nodeDefs.map(n => ({
      id: n.id,
      type: "agent",
      data: {
        label: n.label,
        role: n.role,
        icon: n.icon,
        status: n.status || "pending",
        duration: n.duration,
        retryCount: n.retryCount,
        isCoordinator: n.isCoordinator,
      },
      position: { x: 0, y: 0 }, // Dagre 会覆盖
    }));

    const rfEdges: Edge[] = edgeDefs.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: e.animated ?? false,
      style: {
        stroke: e.dashed ? "var(--muted)" : "var(--border)",
        strokeWidth: 1.5,
        strokeDasharray: e.dashed ? "5 3" : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--border)", width: 16, height: 16 },
      labelStyle: { fontSize: 10, fill: "var(--muted)" },
      labelBgStyle: { fill: "var(--surface)" },
    }));

    return layoutWithDagre(rfNodes, rfEdges, mode);
  }, [nodeDefs, edgeDefs, mode]);

  const defaultEdgeOptions = useMemo(() => ({
    style: { stroke: "var(--border)", strokeWidth: 1.5 },
  }), []);

  return (
    <div style={{ width: "100%", height, position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll={false}
        zoomOnPinch
      >
        <Background color="var(--border)" gap={20} size={1} />
        {showControls && <Controls position="bottom-right" showInteractive={false} />}
      </ReactFlow>
    </div>
  );
}

// ── 辅助：根据团队成员和模式自动生成 DAG 节点和边 ──
export function buildFlowFromTeam(
  members: { agentId: string; role: string; icon: string; name: string }[],
  mode: TeamMode,
  statuses?: Record<string, AgentNodeData>,
): { nodes: FlowNodeDef[]; edges: FlowEdgeDef[] } {
  if (members.length === 0) return { nodes: [], edges: [] };

  if (mode === "pipeline") {
    const nodes: FlowNodeDef[] = members.map((m, i) => ({
      id: `step-${i}`,
      label: m.name,
      role: m.role,
      icon: m.icon,
      status: statuses?.[`step-${i}`]?.status,
      duration: statuses?.[`step-${i}`]?.duration,
    }));
    const edges: FlowEdgeDef[] = members.slice(0, -1).map((_, i) => ({
      id: `e-${i}`,
      source: `step-${i}`,
      target: `step-${i + 1}`,
    }));
    return { nodes, edges };
  }

  if (mode === "supervisor") {
    const nodes: FlowNodeDef[] = [
      {
        id: "supervisor",
        label: "Supervisor",
        role: "主控调度",
        icon: "🎯",
        isCoordinator: true,
        status: statuses?.["supervisor"]?.status,
      },
      ...members.map((m, i) => ({
        id: `worker-${i}`,
        label: m.name,
        role: m.role,
        icon: m.icon,
        status: statuses?.[`worker-${i}`]?.status,
        duration: statuses?.[`worker-${i}`]?.duration,
      })),
    ];
    const edges: FlowEdgeDef[] = members.map((_, i) => ({
      id: `e-sup-${i}`,
      source: "supervisor",
      target: `worker-${i}`,
    }));
    return { nodes, edges };
  }

  // evaluator: Generator → Evaluator, fail 回到 Generator
  if (members.length < 2) {
    // 只有一个成员时退化为 pipeline
    return buildFlowFromTeam(members, "pipeline", statuses);
  }
  const gen = members[0];
  const eval_ = members[1];
  const nodes: FlowNodeDef[] = [
    {
      id: "generator",
      label: gen.name,
      role: gen.role || "生成",
      icon: gen.icon,
      status: statuses?.["generator"]?.status,
      retryCount: statuses?.["generator"]?.retryCount,
    },
    {
      id: "evaluator",
      label: eval_.name,
      role: eval_.role || "评估",
      icon: eval_.icon,
      status: statuses?.["evaluator"]?.status,
    },
  ];
  const edges: FlowEdgeDef[] = [
    { id: "e-gen-eval", source: "generator", target: "evaluator" },
    { id: "e-eval-pass", source: "evaluator", target: "generator", label: "✗ 重试", dashed: true, animated: false },
  ];
  // 如果有第三个成员，加为最终输出
  if (members[2]) {
    nodes.push({
      id: "final",
      label: members[2].name,
      role: members[2].role || "输出",
      icon: members[2].icon,
      status: statuses?.["final"]?.status,
    });
    edges.push({ id: "e-eval-pass2", source: "evaluator", target: "final", label: "✓ 通过" });
  } else {
    // 标记 evaluator 的 pass 出口
    edges[1] = { ...edges[1], target: "generator", label: "✗ 退回修改", dashed: true };
    edges.push({ id: "e-eval-done", source: "evaluator", target: "evaluator", label: "✓ 通过" });
  }
  return { nodes, edges };
}
