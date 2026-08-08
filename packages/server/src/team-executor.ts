// ============================================================
// team-executor.ts — Agent 团队执行编排引擎
//
// 根据 team.mode 生成不同的编排指令，注入到主会话的 prompt 中。
// 三种模式：
//   pipeline   — 线性链：A→B→C，每个 delegate 的 context 包含上一个的结果
//   supervisor — 主控调度：主 Agent 智能分解任务，delegate 给各 Worker
//   evaluator  — 评估迭代：Generator→Evaluator，不达标则带反馈重试
//
// 编排指令通过 prompt 注入方式实现（不需要后端真正有多 Agent 调度器），
// 主 Agent 用 delegate_task 工具按指令依次调用各成员角色。
//
// 可视化通过 SSE 事件驱动：
//   team_flow_start  — 团队执行开始（携带 mode + members）
//   team_flow_update — 节点状态更新（pending→running→done/error）
//   team_flow_end    — 团队执行结束
// ============================================================

import { agentTeamStore, type AgentTeam, type TeamMember } from "./agent-teams.js";
import { agentConfigStore } from "./agent-configs.js";
import { emit } from "./event-bus.js";

// 获取成员的 Agent 名称
async function getMemberInfo(member: TeamMember) {
  const agent = await agentConfigStore.get(member.agentId);
  return {
    name: agent?.name ?? "未知 Agent",
    icon: agent?.icon ?? "🤖",
    systemPrompt: agent?.systemPrompt ?? "",
  };
}

/** 构建 pipeline 模式的编排指令 */
async function buildPipelinePrompt(team: AgentTeam, userMessage: string): Promise<string> {
  const steps: string[] = [];
  for (let i = 0; i < team.members.length; i++) {
    const m = team.members[i];
    const info = await getMemberInfo(m);
    const extra = m.instructions ? `\n     额外要求：${m.instructions}` : "";
    steps.push(`  ${i + 1}. [${m.role}] 调用 delegate_task，goal 为"${info.name}的职责范围内任务"。
     背景：${i === 0 ? "用户原始请求" : "上一步的输出结果"}。
     确保该 Agent 的专业能力被充分利用。${extra}`);
  }

  return `[团队任务 · 流水线模式] 请按以下步骤依次执行（使用 delegate_task 工具）：

${steps.join("\n")}

执行规则：
- 每一步必须等上一步完成后再开始
- 每步的 delegate_task 的 context 参数应包含上一步的输出摘要
- 最后一步完成后，汇总所有步骤的结果

用户请求：${userMessage}`;
}

/** 构建 supervisor 模式的编排指令 */
async function buildSupervisorPrompt(team: AgentTeam, userMessage: string): Promise<string> {
  const workers: string[] = [];
  for (let i = 0; i < team.members.length; i++) {
    const m = team.members[i];
    const info = await getMemberInfo(m);
    const extra = m.instructions ? `（特殊要求：${m.instructions}）` : "";
    workers.push(`  - ${m.role}（${info.name} ${info.icon}）：适合${info.systemPrompt ? "该领域专业任务" : "通用任务"}${extra}`);
  }

  return `[团队任务 · 主控调度模式] 你是 Supervisor（主控 Agent），负责分解任务并调度专家 Agent 执行。

可用专家：
${workers.join("\n")}

执行规则：
- 分析用户请求，决定需要调用哪些专家
- 用 delegate_task 依次调用需要的专家 Agent
- 如果多个专家的任务互不依赖，可以并行调用
- 收集所有专家的结果后，综合汇总输出给用户
- 不要自己做专业工作，交给专家做

用户请求：${userMessage}`;
}

/** 构建 evaluator 模式的编排指令 */
async function buildEvaluatorPrompt(team: AgentTeam, userMessage: string): Promise<string> {
  const generator = team.members[0];
  const evaluator = team.members[1] ?? generator;
  const genInfo = await getMemberInfo(generator);
  const evalInfo = await getMemberInfo(evaluator);
  const maxRetries = team.maxRetries ?? 2;

  const finalizer = team.members[2] ? await getMemberInfo(team.members[2]) : null;

  return `[团队任务 · 评估迭代模式] 请按以下流程执行（使用 delegate_task 工具）：

1. [生成] 调用 delegate_task，让${genInfo.name}（${generator.role}）完成用户请求
2. [评估] 调用 delegate_task，让${evalInfo.name}（${evaluator.role}）审查生成结果
   - 评估标准：正确性、完整性、代码质量（如适用）
   - 输出格式：PASS 或 FAIL + 具体问题列表
3. 如果评估结果为 FAIL：
   - 将评估反馈作为 context，重新调用${genInfo.name}修改
   - 重复步骤 2-3，最多重试 ${maxRetries} 次
4. 评估通过后，${finalizer ? `调用${finalizer.name}做最终整理输出` : "输出最终结果"}

${generator.instructions ? `生成者额外要求：${generator.instructions}\n` : ""}${evaluator.instructions ? `评估者额外要求：${evaluator.instructions}\n` : ""}
执行规则：
- 每次 delegate 是独立的子 Agent 调用
- 评估者必须给出明确的 PASS/FAIL 判断
- 最终输出必须包含所有修改痕迹

用户请求：${userMessage}`;
}

/** 主入口：根据团队 ID 和用户消息，生成编排指令 */
export async function buildTeamPrompt(teamId: string, userMessage: string): Promise<string | null> {
  const team = await agentTeamStore.get(teamId);
  if (!team || team.members.length === 0) return null;

  // 发送团队执行开始事件（驱动前端可视化）
  emit({
    type: "team_flow_start",
    chatSessionId: "_global", // 团队级事件，不绑定特定会话
    payload: {
      teamId: team.id,
      teamName: team.name,
      mode: team.mode,
      members: await Promise.all(team.members.map(async (m, i) => {
        const info = await getMemberInfo(m);
        return {
          id: `${team.mode === "supervisor" ? "worker" : team.mode === "evaluator" ? ["generator", "evaluator", "final"][i] : "step"}-${i}`,
          agentId: m.agentId,
          name: info.name,
          icon: info.icon,
          role: m.role,
        };
      })),
    },
    ts: Date.now(),
  });

  switch (team.mode) {
    case "supervisor":
      return buildSupervisorPrompt(team, userMessage);
    case "evaluator":
      return buildEvaluatorPrompt(team, userMessage);
    case "pipeline":
    default:
      return buildPipelinePrompt(team, userMessage);
  }
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
