// cron-routes.ts — 定时任务 REST API（供前端管理面板调用）

import type { FastifyInstance } from "fastify";
import { cronStore } from "./tools/cron-store.js";
import { config } from "./config.js";

export function setupCronRoutes(app: FastifyInstance) {
  // 列出所有任务
  app.get("/api/cron/jobs", async () => {
    const jobs = await cronStore.list();
    return { jobs };
  });

  // 创建任务
  app.post("/api/cron/jobs", async (req, reply) => {
    const body = req.body as {
      name?: string; schedule?: string; prompt?: string;
      type?: "cron" | "once"; description?: string; agentId?: string;
      workspaceId?: string;
    } | null;

    if (!body?.name || !body?.schedule || !body?.prompt) {
      reply.status(400);
      return { error: "name, schedule, prompt 必填" };
    }

    try {
      const job = await cronStore.create({
        name: body.name,
        schedule: body.schedule,
        prompt: body.prompt,
        cwd: config.workDir,
        workspaceId: body.workspaceId || "default",
        type: body.type,
        description: body.description,
        agentId: body.agentId,
      });
      return { job };
    } catch (e: any) {
      reply.status(500);
      return { error: e.message };
    }
  });

  // 暂停
  app.post("/api/cron/jobs/:id/pause", async (req) => {
    const { id } = req.params as { id: string };
    const job = await cronStore.pause(id);
    if (!job) return { error: "not found" };
    return { job };
  });

  // 恢复
  app.post("/api/cron/jobs/:id/resume", async (req) => {
    const { id } = req.params as { id: string };
    const job = await cronStore.resume(id);
    if (!job) return { error: "not found" };
    return { job };
  });

  // 删除
  app.delete("/api/cron/jobs/:id", async (req) => {
    const { id } = req.params as { id: string };
    const ok = await cronStore.remove(id);
    return { ok };
  });

  // 手动触发
  app.post("/api/cron/jobs/:id/run", async (req) => {
    const { id } = req.params as { id: string };
    const result = await cronStore.runOnce(id);
    if (!result) return { error: "not found" };
    return result;
  });

  // 获取任务执行历史
  app.get("/api/cron/jobs/:id/history", async (req) => {
    const { id } = req.params as { id: string };
    const executions = await cronStore.getHistory(id, 50);
    return { executions };
  });
}
