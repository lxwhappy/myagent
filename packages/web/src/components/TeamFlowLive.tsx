// components/TeamFlowLive.tsx — 团队执行实时可视化
//
// 对话区顶部浮动显示团队 DAG，节点状态随 SSE 事件实时更新：
//   team_flow_start → 初始化全 pending
//   subagent_start  → 节点变 running（通过 goal 里的 [team:nodeId] 标记映射）
//   subagent_end    → 节点变 done + duration
//   team_flow_end   → 全部完成，3 秒后自动消失

import { useTeamFlowStore } from "../stores/team-flow";
import { AgentFlowGraph, type FlowNodeDef, type FlowEdgeDef, type AgentNodeStatus, type LayoutDirection } from "./AgentFlowGraph";

export function TeamFlowLive() {
  const active = useTeamFlowStore(s => s.active);

  if (!active) return null;

  const nodes: FlowNodeDef[] = active.nodes.map(n => ({
    id: n.id,
    label: n.label,
    role: n.role,
    icon: n.icon,
    status: n.status as AgentNodeStatus,
    duration: n.duration,
    isCoordinator: n.isCoordinator,
  }));

  const edges: FlowEdgeDef[] = active.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    dashed: e.dashed,
  }));

  const layout = (active.layout as LayoutDirection) || "LR";

  // 统计状态
  const running = active.nodes.filter(n => n.status === "running").length;
  const done = active.nodes.filter(n => n.status === "done").length;
  const total = active.nodes.length;
  const allDone = done === total;

  return (
    <div className={`team-flow-live ${allDone ? "team-flow-done" : ""}`}>
      <div className="team-flow-live-header">
        <span className="team-flow-live-title">
          {active.teamName}
          <span className="team-flow-live-mode">{active.modeName}</span>
        </span>
        <span className="team-flow-live-stats">
          {!allDone && running > 0 && (
            <span className="team-flow-stat-running">
              <span className="team-flow-pulse-dot" />
              {running} 个执行中
            </span>
          )}
          <span className="team-flow-stat-done">{done}/{total} 完成</span>
        </span>
      </div>
      <div className="team-flow-live-graph">
        <AgentFlowGraph
          nodes={nodes}
          edges={edges}
          layout={layout}
          height={180}
          showControls={false}
        />
      </div>
    </div>
  );
}
