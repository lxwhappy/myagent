// ============================================================
// quick-prompt-routes.ts — 快捷指令 CRUD API
//
// GET    /api/quick-prompts       — 列表
// POST   /api/quick-prompts       — 新增
// PUT    /api/quick-prompts/:id   — 更新
// DELETE /api/quick-prompts/:id   — 删除
// ============================================================

import type { FastifyInstance } from "fastify";
import { quickPromptStore } from "./quick-prompts.js";

export function setupQuickPromptRoutes(app: FastifyInstance) {
  app.get("/api/quick-prompts", async () => {
    return { prompts: await quickPromptStore.list() };
  });

  app.post("/api/quick-prompts", async (req, reply) => {
    const body = req.body as { icon?: string; label?: string; text?: string } | null;
    if (!body?.label?.trim()) {
      reply.status(400).send({ error: "label is required" });
      return;
    }
    const prompt = await quickPromptStore.create({
      icon: body.icon || "⚡",
      label: body.label!,
      text: body.text || "",
    });
    reply.send({ prompt });
  });

  app.put("/api/quick-prompts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<{ icon: string; label: string; text: string }> | null;
    const prompt = await quickPromptStore.update(id, body || {});
    if (!prompt) { reply.status(404).send({ error: "not found" }); return; }
    reply.send({ prompt });
  });

  app.delete("/api/quick-prompts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await quickPromptStore.remove(id);
    if (!ok) { reply.status(404).send({ error: "not found" }); return; }
    reply.send({ success: true });
  });
}
