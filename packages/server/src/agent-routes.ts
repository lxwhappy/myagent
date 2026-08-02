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

  app.delete("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await agentConfigStore.remove(id);
    if (!ok) { reply.status(400).send({ error: "无法删除（不存在或为内置 Agent）" }); return; }
    reply.send({ success: true });
  });
}
