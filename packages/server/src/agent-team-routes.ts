// ============================================================
// agent-team-routes.ts — Agent 团队 CRUD API
//
// GET    /api/agent-teams          — 列表
// POST   /api/agent-teams          — 新增
// PUT    /api/agent-teams/:id      — 更新
// DELETE /api/agent-teams/:id      — 删除
// ============================================================

import type { FastifyInstance } from "fastify";
import { agentTeamStore } from "./agent-teams.js";
import type { TeamMember, TeamMode } from "./agent-teams.js";

export function setupAgentTeamRoutes(app: FastifyInstance) {
  app.get("/api/agent-teams", async () => {
    return { teams: await agentTeamStore.list() };
  });

  app.post("/api/agent-teams", async (req, reply) => {
    const body = req.body as { name?: string; description?: string; icon?: string; mode?: TeamMode; members?: TeamMember[]; maxRetries?: number } | null;
    if (!body?.name?.trim()) {
      reply.status(400).send({ error: "name is required" });
      return;
    }
    const team = await agentTeamStore.create({
      name: body.name!,
      description: body.description,
      icon: body.icon,
      mode: body.mode,
      members: body.members,
      maxRetries: body.maxRetries,
    });
    reply.send({ team });
  });

  app.put("/api/agent-teams/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<{ name: string; description: string; icon: string; mode: TeamMode; members: TeamMember[]; maxRetries: number }> | null;
    const team = await agentTeamStore.update(id, body || {});
    if (!team) { reply.status(404).send({ error: "not found" }); return; }
    reply.send({ team });
  });

  app.delete("/api/agent-teams/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await agentTeamStore.remove(id);
    if (!ok) { reply.status(404).send({ error: "not found" }); return; }
    reply.send({ success: true });
  });
}
