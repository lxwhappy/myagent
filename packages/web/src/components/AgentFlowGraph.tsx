// components/AgentFlowGraph.tsx — 多 Agent 协作 DAG 可视化
//
// 通用 React Flow + Dagre 自动布局渲染引擎。
// 支持 5 种拓扑：linear / star / fanout / ring / dag
// 两种模式：
//   readonly  — 自动布局，不可拖拽（实时执行视图、非 custom 预览）
//   editable  — 可拖拽节点、可拖拽连线、可删边（custom 模式编辑器）
//
// 节点状态实时更新（pending → running → done → error），由 SSE 事件驱动。

import { useMemo, useCallback, useEffect, useRef, type CSSProperties } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type EdgeChange,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  addEdge,
  BaseEdge,
  getSmoothStepPath,
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
  editable?: boolean;  // 是否显示可拖拽的 Handle
  [key: string]: unknown;
}

export type LayoutDirection = "LR" | "TB";

// ── Dagre 自动布局 ──
function layoutWithDagre(nodes: Node[], edges: Edge[], direction: LayoutDirection): { nodes: Node[]; edges: Edge[] } {

  // ── 检测是否有回环边（双向边），有则手动布局不走 dagre ──
  const hasBidirectional = edges.some(e =>
    edges.some(e2 => e2.source === e.target && e2.target === e.source && e.id !== e2.id));

  if (hasBidirectional && nodes.length <= 3) {
    // loop 模式专用布局：节点上下错开排列
    // executor 在左上，evaluator 在右上（有 finalizer 则居中下方）
    const NODE_W = 180, NODE_H = 80;
    const GAP_X = 280, GAP_Y = 120;
    const layoutNodes = nodes.map((node, i) => {
      let x: number, y: number;
      if (i === 0) { x = 0; y = 0; }               // executor 左上
      else if (i === 1) { x = GAP_X; y = 0; }       // evaluator 右上
      else { x = GAP_X / 2; y = GAP_Y; }             // finalizer 居中下方
      return { ...node, position: { x, y: y } };
    });
    return { nodes: layoutNodes, edges };
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: direction === "LR" ? 120 : 80,
  });
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

// ── Handle 样式（editable 模式下可见可拖） ──
const handleStyleHidden: CSSProperties = { opacity: 0 };

// ── 自定义回环边：强制向下弯曲的 SmoothStep 路径 ──
function LoopBackEdge({ source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style }: any) {
  // 强制从底部出、底部入，加偏移量让线绕到节点下方
  const offsetY = 60;
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY: sourceY + offsetY,
    targetX, targetY: targetY + offsetY,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Bottom,
    borderRadius: 16,
  });
  return <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />;
}

const loopEdgeTypes = { loopback: LoopBackEdge };
const handleStyleVisible: CSSProperties = {
  width: 10, height: 10,
  background: "var(--accent)",
  border: "2px solid var(--surface)",
  borderRadius: "50%",
};

// ── 自定义节点组件 ──
function AgentNode({ data }: NodeProps) {
  const d = data as AgentNodeData;
  const status = d.status;
  const borderColor = STATUS_COLORS[status];
  const bgColor = STATUS_BG[status];
  const isRunning = status === "running";
  const editable = d.editable;
  const hStyle = editable ? handleStyleVisible : handleStyleHidden;

  const cardStyle: CSSProperties = {
    border: `1.5px solid ${borderColor}`,
    borderRadius: "var(--radius-md)",
    background: bgColor,
    padding: "10px 14px",
    width: 180,
    position: "relative",
    transition: "all var(--motion-fast) var(--ease-standard)",
    boxShadow: isRunning ? `0 0 0 3px color-mix(in oklab, ${borderColor}, transparent 75%)` : "none",
    cursor: editable ? "grab" : "default",
  };

  return (
    <div style={cardStyle}>
      <Handle type="target" position={Position.Left} style={hStyle} />
      <Handle type="target" position={Position.Bottom} id="bottom" style={hStyle} />

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
        {d.isCoordinator && (
          <span style={{
            fontSize: 9,
            color: "var(--accent)",
            background: "var(--accent-tint)",
            borderRadius: "var(--radius-pill)",
            padding: "1px 6px",
            fontWeight: 600,
          }}>主控</span>
        )}
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

      <Handle type="source" position={Position.Right} style={hStyle} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={hStyle} />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

// ── 类型定义 ──
export interface FlowNodeDef {
  id: string;
  label: string;
  role: string;
  icon: string;
  status?: AgentNodeStatus;
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

// ── 主组件 props ──
interface AgentFlowGraphProps {
  nodes: FlowNodeDef[];
  edges: FlowEdgeDef[];
  layout?: LayoutDirection;
  height?: number | string;
  showControls?: boolean;
  /** editable 模式：可拖拽节点 + 连线 + 删边 */
  editable?: boolean;
  /** editable 模式：边变化回调（增删边时触发） */
  onEdgesChange?: (edges: FlowEdgeDef[]) => void;
}

export function AgentFlowGraph(props: AgentFlowGraphProps) {
  const inner = <AgentFlowGraphInner {...props} />;
  return <ReactFlowProvider>{inner}</ReactFlowProvider>;
}

// ── readonly 模式（自动布局，不可交互） ──
function ReadonlyGraph({ nodes: nodeDefs, edges: edgeDefs, layout = "LR", height = 300, showControls = true }: AgentFlowGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = nodeDefs.map(n => ({
      id: n.id,
      type: "agent",
      data: {
        label: n.label, role: n.role, icon: n.icon,
        status: n.status || "pending",
        duration: n.duration, retryCount: n.retryCount,
        isCoordinator: n.isCoordinator,
      },
      position: { x: 0, y: 0 },
    }));

    const rfEdges: Edge[] = edgeDefs.map(e => {
      const isLoopBack = e.source !== e.target && edgeDefs.some(e2 =>
        e2.source === e.target && e2.target === e.source);
      return {
        id: e.id, source: e.source, target: e.target, label: e.label,
        animated: e.animated ?? false,
        // 回环边用自定义组件，强制向下弯曲
        ...(isLoopBack ? { type: "loopback" } : {}),
        style: {
          stroke: e.dashed ? "var(--accent)" : "var(--border)",
          strokeWidth: 1.5,
          strokeDasharray: e.dashed ? "5 3" : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: e.dashed ? "var(--accent)" : "var(--border)", width: 16, height: 16 },
        labelStyle: { fontSize: 10, fill: e.dashed ? "var(--accent)" : "var(--muted)" },
        labelBgStyle: { fill: "var(--surface)" },
      };
    });

    return layoutWithDagre(rfNodes, rfEdges, layout);
  }, [nodeDefs, edgeDefs, layout]);

  const defaultEdgeOptions = useMemo(() => ({
    style: { stroke: "var(--border)", strokeWidth: 1.5 },
  }), []);

  return (
    <div style={{ width: "100%", height, position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={loopEdgeTypes}
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

// ── editable 模式（可拖拽 + 连线 + 删边） ──
// 设计要点（第一性原理）：
// 1. Dagre 布局只在首次挂载时做一次 — 用户拖拽后位置由 useNodesState 管理
// 2. 成员增减：已有节点保留位置，新节点追加到合理位置（不触发全局重布局）
// 3. 不用 effect 同步外部 nodeDefs → 内部 nodes（避免循环更新导致位置被覆盖）
// 4. 边变化只在实际增删时通知外部（handleConnect / onEdgesChange）
function EditableGraph({ nodes: nodeDefs, edges: edgeDefs, layout = "LR", height = 300, showControls = true, onEdgesChange: onEdgesChangeExt }: AgentFlowGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState<Edge>([]);
  const initialized = useRef(false);

  // ── 首次挂载：Dagre 布局初始化 ──
  useEffect(() => {
    if (initialized.current || nodeDefs.length === 0) return;
    initialized.current = true;

    const rfNodes: Node[] = nodeDefs.map(n => ({
      id: n.id,
      type: "agent",
      data: {
        label: n.label, role: n.role, icon: n.icon,
        status: n.status || "pending",
        duration: n.duration, retryCount: n.retryCount,
        isCoordinator: n.isCoordinator,
        editable: true,
      },
      position: { x: 0, y: 0 },
    }));
    const rfEdges: Edge[] = edgeDefs.map(e => ({
      id: e.id, source: e.source, target: e.target,
      animated: e.animated ?? false,
      style: {
        stroke: e.dashed ? "var(--muted)" : "var(--border)",
        strokeWidth: 1.5,
        strokeDasharray: e.dashed ? "5 3" : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--border)", width: 16, height: 16 },
    }));
    const laid = layoutWithDagre(rfNodes, rfEdges, layout);
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [nodeDefs, edgeDefs, layout, setNodes, setEdges]);

  // ── 成员增减：增量更新（不重置已有节点位置） ──
  const knownIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(nodeDefs.map(n => n.id));
    const prevIds = knownIds.current;

    const added = nodeDefs.filter(n => !prevIds.has(n.id));
    const removed = [...prevIds].filter(id => !currentIds.has(id));

    if (added.length === 0 && removed.length === 0) return;

    // 删除已移除的节点和关联边
    if (removed.length > 0) {
      setNodes(ns => ns.filter(n => !removed.includes(n.id)));
      setEdges(es => es.filter(e => !removed.includes(e.source) && !removed.includes(e.target)));
    }

    // 新增节点：追加到末尾，位置在已有节点右侧
    if (added.length > 0) {
      setNodes(ns => {
        const maxX = ns.length > 0 ? Math.max(...ns.map(n => n.position.x)) : 0;
        const newNodes = added.map((n, i) => ({
          id: n.id,
          type: "agent" as const,
          data: {
            label: n.label, role: n.role, icon: n.icon,
            status: n.status || "pending" as AgentNodeStatus,
            duration: n.duration, retryCount: n.retryCount,
            isCoordinator: n.isCoordinator,
            editable: true,
          },
          position: { x: maxX + 220 + i * 220, y: 0 },
        }));
        return [...ns, ...newNodes];
      });
    }

    knownIds.current = currentIds;
  }, [nodeDefs, setNodes, setEdges]);

  // ── 连线：拖拽 Handle 创建新边 ──
  const handleConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    if (conn.source === conn.target) return;
    setEdges(eds => addEdge({
      ...conn,
      animated: false,
      style: { stroke: "var(--border)", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--border)", width: 16, height: 16 },
    }, eds));
  }, [setEdges]);

  // ── edges 增删后通知外部（只在边数量变化时通知，避免循环） ──
  const lastEdgeCount = useRef(0);
  useEffect(() => {
    if (edges.length === lastEdgeCount.current) return;
    lastEdgeCount.current = edges.length;
    const simpleEdges: FlowEdgeDef[] = edges.map(e => ({
      id: e.id, source: e.source, target: e.target,
    }));
    onEdgesChangeExt?.(simpleEdges);
  }, [edges, onEdgesChangeExt]);

  const defaultEdgeOptions = useMemo(() => ({
    style: { stroke: "var(--border)", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--border)", width: 16, height: 16 },
  }), []);

  return (
    <div style={{ width: "100%", height, position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChangeInternal}
        onConnect={handleConnect}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background color="var(--border)" gap={20} size={1} />
        {showControls && <Controls position="bottom-right" showInteractive={false} />}
        <MiniMap
          position="bottom-left"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          nodeColor={() => "var(--accent-tint)"}
          maskColor="color-mix(in oklab, var(--bg), transparent 40%)"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

// ── 主入口：根据 editable 分发 ──
function AgentFlowGraphInner(props: AgentFlowGraphProps) {
  if (props.editable) return <EditableGraph {...props} />;
  return <ReadonlyGraph {...props} />;
}

// ── 辅助：根据团队成员和拓扑类型自动生成 DAG 节点和边（前端版） ──
export type GraphTopology = "linear" | "star" | "fanout" | "ring" | "loop" | "dag";

export function buildFlowFromTopology(
  members: { id: string; name: string; role: string; icon: string }[],
  topology: GraphTopology,
  customEdges?: Array<{ source: number; target: number }>,
  statuses?: Record<string, { status: AgentNodeStatus; duration?: number; retryCount?: number }>,
): { nodes: FlowNodeDef[]; edges: FlowEdgeDef[] } {
  if (members.length === 0) return { nodes: [], edges: [] };

  const edge = (s: string, t: string, opts?: Partial<FlowEdgeDef>): FlowEdgeDef => ({
    id: `e-${s}-${t}`, source: s, target: t, ...opts,
  });

  switch (topology) {
    case "linear": {
      const nodes: FlowNodeDef[] = members.map((m, i) => ({
        id: `step-${i}`, label: m.name, role: m.role, icon: m.icon,
        status: statuses?.[`step-${i}`]?.status,
        duration: statuses?.[`step-${i}`]?.duration,
      }));
      const edges: FlowEdgeDef[] = members.slice(0, -1).map((_, i) =>
        edge(`step-${i}`, `step-${i + 1}`),
      );
      return { nodes, edges };
    }

    case "star": {
      const nodes: FlowNodeDef[] = [
        { id: "coordinator", label: members[0].name, role: members[0].role, icon: members[0].icon, isCoordinator: true, status: statuses?.["coordinator"]?.status },
        ...members.slice(1).map((m, i) => ({
          id: `worker-${i}`, label: m.name, role: m.role, icon: m.icon,
          status: statuses?.[`worker-${i}`]?.status,
        })),
      ];
      const edges: FlowEdgeDef[] = members.slice(1).map((_, i) =>
        edge("coordinator", `worker-${i}`),
      );
      return { nodes, edges };
    }

    case "fanout": {
      const n = members.length;
      const nodes: FlowNodeDef[] = [
        { id: "splitter-0", label: members[0].name, role: members[0].role, icon: members[0].icon, isCoordinator: true, status: statuses?.["splitter-0"]?.status },
        ...members.slice(1, -1).map((m, i) => ({
          id: `worker-${i}`, label: m.name, role: m.role, icon: m.icon,
          status: statuses?.[`worker-${i}`]?.status,
        })),
        { id: "reducer-last", label: members[n-1].name, role: members[n-1].role, icon: members[n-1].icon, status: statuses?.["reducer-last"]?.status },
      ];
      const workers = members.slice(1, -1);
      if (workers.length === 0) {
        return { nodes, edges: [edge("splitter-0", "reducer-last")] };
      }
      const edges: FlowEdgeDef[] = [
        ...workers.map((_, i) => edge("splitter-0", `worker-${i}`)),
        ...workers.map((_, i) => edge(`worker-${i}`, "reducer-last")),
      ];
      return { nodes, edges };
    }

    case "ring": {
      const nodes: FlowNodeDef[] = members.map((m, i) => ({
        id: `debater-${i}`, label: m.name, role: m.role, icon: m.icon,
        status: statuses?.[`debater-${i}`]?.status,
      }));
      const edges: FlowEdgeDef[] = members.map((_, i) => {
        const next = (i + 1) % members.length;
        return edge(`debater-${i}`, `debater-${next}`);
      });
      return { nodes, edges };
    }

    case "loop": {
      const nodeIds = members.map((_, i) =>
        i === 0 ? "executor" : i === 1 ? "evaluator" : "finalizer");
      const nodes: FlowNodeDef[] = members.map((m, i) => ({
        id: nodeIds[i], label: m.name, role: m.role, icon: m.icon,
        status: statuses?.[nodeIds[i]]?.status,
      }));
      const edges: FlowEdgeDef[] = [
        edge("executor", "evaluator", { label: "评估" }),
        edge("evaluator", "executor", { label: "FAIL 重试", dashed: true, animated: true }),
      ];
      if (members.length > 2) {
        edges.push(edge("evaluator", "finalizer", { label: "PASS" }));
      }
      return { nodes, edges };
    }

    case "dag":
    default: {
      const nodes: FlowNodeDef[] = members.map((m, i) => ({
        id: `node-${i}`, label: m.name, role: m.role, icon: m.icon,
        status: statuses?.[`node-${i}`]?.status,
      }));
      const edges: FlowEdgeDef[] = (customEdges || []).map(ce =>
        edge(`node-${ce.source}`, `node-${ce.target}`),
      );
      if (edges.length === 0 && members.length > 1) {
        for (let i = 0; i < members.length - 1; i++) {
          edges.push(edge(`node-${i}`, `node-${i + 1}`));
        }
      }
      return { nodes, edges };
    }
  }
}

// ── 向后兼容：旧的 buildFlowFromTeam 签名 ──
export function buildFlowFromTeam(
  members: { agentId: string; role: string; icon: string; name: string }[],
  mode: string,
  statuses?: Record<string, { status: AgentNodeStatus; duration?: number; retryCount?: number }>,
): { nodes: FlowNodeDef[]; edges: FlowEdgeDef[] } {
  const modeToTopology: Record<string, GraphTopology> = {
    pipeline: "linear", supervisor: "star", evaluator: "linear",
    parallel: "fanout", debate: "ring", router: "star",
    mapreduce: "fanout", custom: "dag", loop: "loop",
  };
  const topology = modeToTopology[mode] || "linear";
  const adaptedMembers = members.map(m => ({ id: m.agentId, name: m.name, role: m.role, icon: m.icon }));
  return buildFlowFromTopology(adaptedMembers, topology, undefined, statuses);
}
