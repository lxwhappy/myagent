// src/graph-builder.ts — 根据拓扑类型生成 DAG 节点和边
//
// 5 种拓扑：
//   linear  — 线性链：node-0 → node-1 → node-2
//   star    — 星形：coordinator → [node-0, node-1, ...]
//   fanout  — 扇出扇入：splitter → [node-0, node-1, ...] → merger
//   ring    — 环形：node-0 ↔ node-1 ↔ node-2 ↔ node-0
//   dag     — 自定义边：使用 team.dagEdges
//
// nodeId 命名规则（和 prompt 模板中的 [team:xxx-N] 标记对应）：
//   linear:    step-0, step-1, ...
//   star:      coordinator → worker-0, worker-1, ...
//   fanout:    splitter-0 → worker-1, worker-2, ... → merger-last
//   ring:      debater-0, debater-1, ...
//   dag:       node-0, node-1, ...

import type {
  GraphTopology,
  FlowNodeDef,
  FlowEdgeDef,
  FlowGraph,
  MemberInfo,
  NodeStatus,
} from "./types.ts";

/** 成员信息扩展（带 nodeId 标记，用于 prompt 生成和运行时映射） */
export interface MemberWithNodeId extends MemberInfo {
  /** 在 DAG 中的节点 ID（对应 prompt 里的 [team:nodeId]） */
  nodeId: string;
}

/**
 * 根据拓扑类型为每个成员分配 nodeId
 * prompt 模板里的 [team:xxx-N] 标记和这里的 nodeId 一一对应
 */
export function assignNodeIds(
  members: MemberInfo[],
  topology: GraphTopology,
): MemberWithNodeId[] {
  switch (topology) {
    case "linear":
      return members.map((m, i) => ({ ...m, nodeId: `step-${i}` }));

    case "star": {
      // 第一个是 coordinator，其余是 workers
      return members.map((m, i) => ({
        ...m,
        nodeId: i === 0 ? "coordinator" : `worker-${i - 1}`,
      }));
    }

    case "fanout": {
      // 第一个是 splitter，最后一个是 merger，中间是 workers
      const n = members.length;
      return members.map((m, i) => {
        if (i === 0) return { ...m, nodeId: "splitter-0" };
        if (i === n - 1) return { ...m, nodeId: "reducer-last" };
        return { ...m, nodeId: `worker-${i}` };
      });
    }

    case "ring":
      return members.map((m, i) => ({ ...m, nodeId: `debater-${i}` }));

    case "dag":
    default:
      return members.map((m, i) => ({ ...m, nodeId: `node-${i}` }));
  }
}

/**
 * 根据拓扑类型生成 DAG 节点和边
 * @param members 成员列表（已含 nodeId）
 * @param topology 拓扑类型
 * @param statuses 可选的运行时状态（nodeId → status/duration）
 * @param customEdges 自定义边（仅 topology === "dag" 时使用）
 */
export function buildGraph(
  members: MemberWithNodeId[],
  topology: GraphTopology,
  statuses?: Record<string, { status: NodeStatus; duration?: number; retryCount?: number }>,
  customEdges?: Array<{ source: number; target: number }>,
): FlowGraph {
  if (members.length === 0) return { nodes: [], edges: [] };

  const getNodeStatus = (nodeId: string) => statuses?.[nodeId];

  // ── 通用：生成节点 ──
  const buildNode = (m: MemberWithNodeId, isCoord = false): FlowNodeDef => {
    const s = getNodeStatus(m.nodeId);
    return {
      id: m.nodeId,
      label: m.name,
      role: m.role,
      icon: m.icon,
      status: s?.status,
      duration: s?.duration,
      retryCount: s?.retryCount,
      isCoordinator: isCoord,
    };
  };

  // ── 通用：生成边 ──
  const edge = (source: string, target: string, opts?: { label?: string; dashed?: boolean; animated?: boolean }): FlowEdgeDef => ({
    id: `e-${source}-${target}`,
    source,
    target,
    ...opts,
  });

  switch (topology) {
    // ── linear: A → B → C ──
    case "linear": {
      const nodes = members.map(m => buildNode(m));
      const edges: FlowEdgeDef[] = [];
      for (let i = 0; i < members.length - 1; i++) {
        edges.push(edge(members[i].nodeId, members[i + 1].nodeId));
      }
      return { nodes, edges };
    }

    // ── star: coordinator → [worker-0, worker-1, ...] ──
    case "star": {
      const coord = members[0];
      const workers = members.slice(1);
      const nodes = [
        buildNode(coord, true),
        ...workers.map(m => buildNode(m)),
      ];
      const edges = workers.map(w => edge(coord.nodeId, w.nodeId));
      return { nodes, edges };
    }

    // ── fanout: splitter → [workers] → merger ──
    case "fanout": {
      const splitter = members[0];
      const merger = members[members.length - 1];
      const workers = members.slice(1, -1);

      // 特殊情况：只有 2 个成员 → splitter → merger（没有中间 worker）
      if (workers.length === 0) {
        return {
          nodes: [buildNode(splitter, true), buildNode(merger)],
          edges: [edge(splitter.nodeId, merger.nodeId)],
        };
      }

      const nodes = [
        buildNode(splitter, true),
        ...workers.map(m => buildNode(m)),
        buildNode(merger),
      ];
      const edges: FlowEdgeDef[] = [
        ...workers.map(w => edge(splitter.nodeId, w.nodeId)),
        ...workers.map(w => edge(w.nodeId, merger.nodeId)),
      ];
      return { nodes, edges };
    }

    // ── ring: A ↔ B ↔ C ↔ A ──
    case "ring": {
      const nodes = members.map(m => buildNode(m));
      const edges: FlowEdgeDef[] = [];
      for (let i = 0; i < members.length; i++) {
        const next = (i + 1) % members.length;
        edges.push(edge(
          members[i].nodeId,
          members[next].nodeId,
          { dashed: false },
        ));
      }
      return { nodes, edges };
    }

    // ── dag: 自定义边 ──
    case "dag":
    default: {
      const nodes = members.map(m => buildNode(m));
      const edges: FlowEdgeDef[] = (customEdges || []).map((ce, i) =>
        edge(
          members[ce.source]?.nodeId ?? `node-${ce.source}`,
          members[ce.target]?.nodeId ?? `node-${ce.target}`,
        ),
      );
      // 如果没有自定义边，退化成 linear（至少能跑）
      if (edges.length === 0 && members.length > 1) {
        for (let i = 0; i < members.length - 1; i++) {
          edges.push(edge(members[i].nodeId, members[i + 1].nodeId));
        }
      }
      return { nodes, edges };
    }
  }
}
