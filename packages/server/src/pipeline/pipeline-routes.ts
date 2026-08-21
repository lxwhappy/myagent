// ============================================================
// pipeline-routes.ts — 流水线 REST API
//
// GET    /api/pipelines                     — 列表
// POST   /api/pipelines                     — 创建（先校验）
// GET    /api/pipelines/:id                 — 详情
// PUT    /api/pipelines/:id                 — 更新（重校验）
// DELETE /api/pipelines/:id                 — 删除（不影响 run 历史）
// POST   /api/pipelines/:id/validate        — 只校验
// POST   /api/pipelines/:id/runs            — 触发执行
// GET    /api/pipelines/:id/runs            — 历史（index 过滤）
// GET    /api/pipelines/:id/dag             — 画布视图 DAG
// GET    /api/pipeline-runs                 — 全部历史
// GET    /api/pipeline-runs/:runId          — run 详情
// POST   /api/pipeline-runs/:runId/abort    — 中止
// ============================================================

import type { FastifyInstance } from "fastify";
import { pipelineStore, validatePipeline, type PipelineDef } from "./pipeline-defs.js";
import { runStore } from "./run-store.js";
import {
  startPipelineRun, registerRun, abortRun,
  getActiveRunCount, PIPELINE_CONCURRENCY,
} from "./pipeline-engine.js";
import { createRealSpawnJob } from "./spawn-for-pipeline.js";
import { treeToDag } from "./tree-to-dag.js";
import { config } from "../config.js";

const spawnJob = createRealSpawnJob();

export function setupPipelineRoutes(app: FastifyInstance) {
  app.get("/api/pipelines", async () => {
    return { pipelines: await pipelineStore.list() };
  });

  app.post("/api/pipelines", async (req, reply) => {
    const body = req.body as Partial<PipelineDef> | null;
    if (!body?.name) { reply.status(400).send({ error: "name 必填" }); return; }
    const { def, issues } = await pipelineStore.create(body as any);
    if (!def) { reply.status(400).send({ error: "校验失败", issues }); return; }
    reply.status(201).send({ pipeline: def });
  });

  app.get("/api/pipelines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const def = await pipelineStore.get(id);
    if (!def) { reply.status(404).send({ error: "流水线不存在" }); return; }
    reply.send({ pipeline: def });
  });

  app.put("/api/pipelines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<PipelineDef> | null;
    const { def, issues } = await pipelineStore.update(id, body ?? {});
    if (!def) {
      const notFound = issues.some((i) => i.code === "not-found");
      reply.status(notFound ? 404 : 400).send({ error: notFound ? "流水线不存在" : "校验失败", issues });
      return;
    }
    reply.send({ pipeline: def });
  });

  app.delete("/api/pipelines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await pipelineStore.remove(id);
    if (!ok) { reply.status(404).send({ error: "流水线不存在" }); return; }
    reply.send({ success: true });
  });

  app.post("/api/pipelines/:id/validate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<PipelineDef> | null;
    // 有 body 就校验 body（编辑器实时反馈），否则校验已存的
    const target = body ? { ...(await pipelineStore.get(id) ?? {}), ...body } as PipelineDef : await pipelineStore.get(id);
    if (!target) { reply.status(404).send({ error: "流水线不存在" }); return; }
    reply.send({ issues: validatePipeline(target) });
  });

  app.post("/api/pipelines/:id/runs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { input?: string; cwd?: string } | null;
    const def = await pipelineStore.get(id);
    if (!def) { reply.status(404).send({ error: "流水线不存在" }); return; }
    if (!body?.input?.trim()) { reply.status(400).send({ error: "input 必填" }); return; }

    // 进程级并发闸
    if (getActiveRunCount() >= PIPELINE_CONCURRENCY) {
      reply.status(429).send({ error: `同时执行的流水线已达上限（${PIPELINE_CONCURRENCY}），请稍后再试` });
      return;
    }

    const handle = await startPipelineRun(def, body.input.trim(), { type: "manual" }, {
      spawnJob,
      runCommand: undefined as any,   // 引擎内部用默认真实现
      cwd: body.cwd ?? config.workDir,
    });
    registerRun(handle);
    reply.status(201).send({ runId: handle.runId });
  });

  app.get("/api/pipelines/:id/runs", async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send({ runs: await runStore.listByPipeline(id) });
  });

  app.get("/api/pipelines/:id/dag", async (req, reply) => {
    const { id } = req.params as { id: string };
    const def = await pipelineStore.get(id);
    if (!def) { reply.status(404).send({ error: "流水线不存在" }); return; }
    reply.send(treeToDag(def));
  });

  app.get("/api/pipeline-runs", async () => {
    return { runs: await runStore.listIndex() };
  });

  app.get("/api/pipeline-runs/:runId", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await runStore.get(runId);
    if (!run) { reply.status(404).send({ error: "run 不存在" }); return; }
    reply.send({ run });
  });

  app.post("/api/pipeline-runs/:runId/abort", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const ok = abortRun(runId);
    reply.send({ success: ok, message: ok ? "已发送中止信号" : "run 不在运行中（可能已结束）" });
  });
}
