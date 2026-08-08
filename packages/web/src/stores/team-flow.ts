// stores/team-flow.ts — 团队执行实时可视化状态
//
// 消费 SSE 事件 team_flow_start / subagent_start / subagent_end / team_flow_end
// 驱动 DAG 节点状态联动（pending → running → done/error）
//
// 数据流：
//   1. team_flow_start → 初始化 nodes + edges（全 pending）
//   2. subagent_start with [team:nodeId] goal → 节点变 running
//   3. subagent_end → 节点变 done + 记录 duration/summary
//   4. team_flow_end → 全部完成

import { create } from "zustand";

export type NodeStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface TeamFlowNode {
  id: string;
  label: string;
  role: string;
  icon: string;
  status: NodeStatus;
  duration?: number;
  summary?: string;
  isCoordinator?: boolean;
  retryCount?: number;
}

export interface TeamFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
}

interface TeamFlowState {
  /** 当前活跃的团队执行（null = 无） */
  active: {
    teamId: string;
    teamName: string;
    modeId: string;
    modeName: string;
    topology: string;
    layout: string;
    nodes: TeamFlowNode[];
    edges: TeamFlowEdge[];
  } | null;

  /** team_flow_start 事件 → 初始化 */
  onStart: (payload: {
    teamId: string;
    teamName: string;
    modeId: string;
    modeName: string;
    topology: string;
    layout: string;
    nodes: Array<{ id: string; label: string; role: string; icon: string; status: string }>;
    edges: Array<{ id: string; source: string; target: string; label?: string; dashed?: boolean }>;
  }) => void;

  /** 节点状态更新（由 subagent_start/end 事件驱动） */
  updateNode: (nodeId: string, patch: Partial<TeamFlowNode>) => void;

  /** 从 goal 文本解析 nodeId 标记 */
  resolveNodeId: (goal: string) => string | null;

  /** 团队执行结束 */
  onEnd: () => void;

  /** 清空 */
  clear: () => void;
}

/** 从 goal 文本解析 [team:nodeId] 标记 */
function parseNodeTag(goal: string): string | null {
  const match = goal?.match(/^\[team:([^\]]+)\]/);
  return match ? match[1] : null;
}

export const useTeamFlowStore = create<TeamFlowState>((set, get) => ({
  active: null,

  onStart: (payload) => set({
    active: {
      teamId: payload.teamId,
      teamName: payload.teamName,
      modeId: payload.modeId,
      modeName: payload.modeName,
      topology: payload.topology,
      layout: payload.layout,
      nodes: payload.nodes.map(n => ({ ...n, status: n.status as NodeStatus })),
      edges: payload.edges,
    },
  }),

  updateNode: (nodeId, patch) => set(s => {
    if (!s.active) return s;
    return {
      active: {
        ...s.active,
        nodes: s.active.nodes.map(n => n.id === nodeId ? { ...n, ...patch } : n),
      },
    };
  }),

  resolveNodeId: (goal) => parseNodeTag(goal),

  onEnd: () => {
    // 保留最终状态，3 秒后自动清空
    setTimeout(() => {
      const cur = get().active;
      if (cur && cur.nodes.every(n => n.status === "done" || n.status === "error" || n.status === "skipped")) {
        set({ active: null });
      }
    }, 3000);
  },

  clear: () => set({ active: null }),
}));
