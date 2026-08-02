// ============================================================
// agent-routes.ts — Agent 配置 CRUD API
//
// GET    /api/agents          — 列表
// POST   /api/agents          — 新增
// PUT    /api/agents/:id      — 更新
// DELETE /api/agents/:id      — 删除（内置不可删）
// ============================================================

import type { FastifyInstance } from "fastify";
import { agentConfigStore } from "./agent-configs.js";
import { getAllActiveSystemPrompts, parseSystemPrompt } from "./agent-registry.js";

export function setupAgentRoutes(app: FastifyInstance) {
  app.get("/api/agents", async () => {
    return { agents: await agentConfigStore.list() };
  });

  app.post("/api/agents", async (req, reply) => {
    const body = req.body as { name?: string; description?: string; systemPrompt?: string; icon?: string; model?: string } | null;
    if (!body?.name?.trim()) {
      reply.status(400).send({ error: "name is required" });
      return;
    }
    const agent = await agentConfigStore.create({
      name: body.name!,
      description: body.description,
      systemPrompt: body.systemPrompt,
      icon: body.icon,
      model: body.model,
    });
    reply.send({ agent });
  });

  app.put("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<{ name: string; description: string; systemPrompt: string; icon: string; model: string; disabledTools: string[]; enabledMcpServers: string[] }> | null;
    const agent = await agentConfigStore.update(id, body || {});
    if (!agent) { reply.status(404).send({ error: "not found" }); return; }
    reply.send({ agent });
  });

  // 获取 Agent 当前生效的完整系统提示词（SDK 默认 + AGENTS.md + 角色指令）
  // 需要有一个活跃会话使用该 Agent，否则返回 404
  app.get("/api/agents/:id/system-prompt", async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await agentConfigStore.get(id);
    if (!agent) { reply.status(404).send({ error: "agent not found" }); return; }
    // 遍历所有活跃 session 的 systemPrompt，找包含该 agent 角色指令的
    const all = getAllActiveSystemPrompts();
    for (const { systemPrompt } of all) {
      // 默认 Agent（无 systemPrompt）匹配任何；自定义的匹配包含其角色指令的
      if (agent.systemPrompt ? systemPrompt.includes(agent.systemPrompt) : true) {
        const sections = parseSystemPrompt(systemPrompt);
        reply.send({ sections, full: systemPrompt });
        return;
      }
    }
    reply.status(404).send({ error: "没有活跃会话使用此 Agent。请先用该 Agent 发一条消息，系统提示词在会话创建时生成。" });
  });

  app.delete("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await agentConfigStore.remove(id);
    if (!ok) { reply.status(400).send({ error: "无法删除（不存在或为内置 Agent）" }); return; }
    reply.send({ success: true });
  });
}
