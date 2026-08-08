// ============================================================
// agent-team-routes.ts — Agent 团队 CRUD API + 编排模式 API
//
// GET    /api/agent-teams          — 列表
// POST   /api/agent-teams          — 新增
// PUT    /api/agent-teams/:id      — 更新
// DELETE /api/agent-teams/:id      — 删除
//
// GET    /api/orchestration-modes  — 获取所有编排模式（内置+自定义）
// POST   /api/orchestration-modes  — 新建自定义模式
// PUT    /api/orchestration-modes/:id — 更新自定义模式
// DELETE /api/orchestration-modes/:id — 删除自定义模式
// ============================================================

import type { FastifyInstance } from "fastify";
import { agentTeamStore } from "./agent-teams.js";
import type { TeamMember, TeamMode, DagEdge } from "./agent-teams.js";
import { orchestrationModeStore } from "./orchestration-mode-store.js";
import { getAvailableModes, isBuiltInMode } from "@myagent/pi-orchestrator";
import type { OrchestrationMode } from "@myagent/pi-orchestrator";

export function setupAgentTeamRoutes(app: FastifyInstance) {
  // ── 团队 CRUD ──
  app.get("/api/agent-teams", async () => {
    return { teams: await agentTeamStore.list() };
  });

  app.post("/api/agent-teams", async (req, reply) => {
    const body = req.body as { name?: string; description?: string; icon?: string; mode?: TeamMode; members?: TeamMember[]; maxRetries?: number; dagEdges?: DagEdge[]; optionValues?: Record<string, string | number>; customPrompt?: string } | null;
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
      dagEdges: body.dagEdges,
      optionValues: body.optionValues,
      customPrompt: body.customPrompt,
    });
    reply.send({ team });
  });

  app.put("/api/agent-teams/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<{ name: string; description: string; icon: string; mode: TeamMode; members: TeamMember[]; maxRetries: number; dagEdges: DagEdge[]; optionValues: Record<string, string | number>; customPrompt: string }> | null;
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

  // ── 编排模式 CRUD ──

  /** 获取所有编排模式（内置 + 自定义） */
  app.get("/api/orchestration-modes", async () => {
    // 确保 store 已加载（触发 setCustomModes）
    await orchestrationModeStore.list();
    return { modes: getAvailableModes() };
  });

  /** 新建自定义模式 */
  app.post("/api/orchestration-modes", async (req, reply) => {
    const body = req.body as Partial<OrchestrationMode> | null;
    if (!body?.name?.trim()) {
      reply.status(400).send({ error: "name is required" });
      return;
    }
    if (!body.promptTemplate?.trim()) {
      reply.status(400).send({ error: "promptTemplate is required" });
      return;
    }
    const mode = await orchestrationModeStore.create({
      name: body.name,
      icon: body.icon || "🔧",
      description: body.description || "",
      detail: body.detail,
      topology: body.topology || "linear",
      layout: body.layout || "LR",
      minMembers: body.minMembers ?? 2,
      maxMembers: body.maxMembers,
      promptTemplate: body.promptTemplate,
      options: body.options,
    });
    reply.send({ mode });
  });

  /** 更新自定义模式 */
  app.put("/api/orchestration-modes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (isBuiltInMode(id)) {
      reply.status(403).send({ error: "Cannot modify built-in mode" });
      return;
    }
    const body = req.body as Partial<OrchestrationMode> | null;
    const mode = await orchestrationModeStore.update(id, body || {});
    if (!mode) { reply.status(404).send({ error: "not found" }); return; }
    reply.send({ mode });
  });

  /** 删除自定义模式 */
  app.delete("/api/orchestration-modes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (isBuiltInMode(id)) {
      reply.status(403).send({ error: "Cannot delete built-in mode" });
      return;
    }
    const ok = await orchestrationModeStore.remove(id);
    if (!ok) { reply.status(404).send({ error: "not found" }); return; }
    reply.send({ success: true });
  });
}
