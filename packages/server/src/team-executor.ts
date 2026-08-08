// ============================================================
// team-executor.ts — Agent 团队执行编排引擎（registry 驱动）
//
// 从 @myagent/pi-orchestrator 获取模式定义，通过模板引擎生成编排指令。
// 不再硬编码 switch/case，新增模式只需在注册表注册。
//
// 可视化通过 SSE 事件驱动：
//   team_flow_start  — 团队执行开始（携带 mode + members + graph 结构）
//   team_flow_update — 节点状态更新（pending→running→done/error）
//   team_flow_end    — 团队执行结束
// ============================================================

import { agentTeamStore, type AgentTeam, type TeamMember } from "./agent-teams.js";
import { agentConfigStore } from "./agent-configs.js";
import { emit } from "./event-bus.js";
import {
  getMode,
  buildPrompt,
  buildGraph,
  assignNodeIds,
  getDefaultOptionValues,
  type MemberInfo,
  type OrchestrationMode,
} from "@myagent/pi-orchestrator";

// 获取成员的 Agent 名称
async function getMemberInfo(member: TeamMember): Promise<MemberInfo> {
  const agent = await agentConfigStore.get(member.agentId);
  return {
    agentId: member.agentId,
    name: agent?.name ?? "未知 Agent",
    icon: agent?.icon ?? "🤖",
    role: member.role,
    instructions: member.instructions,
  };
}

/** 主入口：根据团队 ID 和用户消息，生成编排指令 */
export async function buildTeamPrompt(teamId: string, userMessage: string): Promise<string | null> {
  const team = await agentTeamStore.get(teamId);
  if (!team || team.members.length === 0) return null;

  // 获取编排模式
  const mode = getMode(team.mode);
  if (!mode) {
    console.error(`[team-executor] Unknown mode: ${team.mode}`);
    return null;
  }

  // 获取成员信息
  const members: MemberInfo[] = await Promise.all(team.members.map(getMemberInfo));

  // 合并选项默认值 + 团队配置值
  const optionValues = { ...getDefaultOptionValues(mode) };
  if (team.maxRetries != null && mode.options?.some(o => o.key === "maxRetries")) {
    optionValues.maxRetries = team.maxRetries;
  }

  // 构建 prompt：优先使用团队自定义指令
  const prompt = team.customPrompt?.trim()
    ? team.customPrompt
    : buildPrompt({ mode, members, userMessage, optionValues });

  // 发送团队执行开始事件（携带 graph 结构，驱动前端可视化）
  const membersWithIds = assignNodeIds(members, mode.topology);
  const graph = buildGraph(membersWithIds, mode.topology, undefined, team.dagEdges);

  emit({
    type: "team_flow_start",
    chatSessionId: "_global",
    payload: {
      teamId: team.id,
      teamName: team.name,
      modeId: mode.id,
      modeName: mode.name,
      topology: mode.topology,
      layout: mode.layout,
      nodes: graph.nodes.map(n => ({ id: n.id, label: n.label, role: n.role, icon: n.icon, status: "pending" })),
      edges: graph.edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label, dashed: e.dashed })),
    },
    ts: Date.now(),
  });

  return prompt;
}

/**
 * 添加 API 端点：预览团队的编排 prompt（不执行，仅返回生成的指令）
 * POST /api/agent-teams/:id/preview
 */
export function setupTeamExecutorRoutes(app: import("fastify").FastifyInstance) {
  app.post("/api/agent-teams/:id/preview", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { message?: string } | null;
    const message = body?.message || "示例任务";
    const prompt = await buildTeamPrompt(id, message);
    if (!prompt) {
      reply.status(404).send({ error: "Team not found or has no members" });
      return;
    }
    reply.send({ prompt });
  });
}
