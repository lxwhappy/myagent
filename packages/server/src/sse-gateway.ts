// sse-gateway.ts — SSE 事件流 + REST API 命令端点
//
// 替代旧版 WebSocket 网关。
// GET  /api/events           — 全局 SSE 事件流（所有 agent 事件）
// POST /api/agent/:id/create — 创建 agent
// POST /api/agent/:id/prompt — 发送消息
// POST /api/agent/:id/abort  — 中止生成
// DEL  /api/agent/:id        — 销毁 agent

import type { FastifyInstance } from "fastify";
import { subscribe, emit } from "./event-bus.js";
import { createAgent, getAgent, destroyAgent, setThinkingLevel, getAgentModelInput, getSkillPaths } from "./agent-registry.js";
import { abortSubagents } from "./subagent-runner.js";
import { pushPendingImages } from "./tools/image-tool.js";
import { todoStore } from "./tools/index.js";

export function setupSSEGateway(app: FastifyInstance) {
  // ── 全局 SSE 事件流 ──
  app.get("/api/events", async (req, reply) => {
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // nginx 不缓冲
    });

    // 发一个 connected 事件让前端知道连上了
    raw.write(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);

    // 订阅事件总线
    const onEvent = (event: any) => {
      try {
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {}
    };
    const unsubscribe = subscribe(onEvent);

    // 30s 心跳（防止代理/防火墙空闲断连）
    const heartbeat = setInterval(() => {
      try { raw.write(": heartbeat\n\n"); } catch {}
    }, 30_000);

    // 客户端断开时清理
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ── 创建 Agent ──
  app.post("/api/agent/:id/create", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { cwd?: string; provider?: string; model?: string; agentId?: string } | null;
    try {
      await createAgent(id, { cwd: body?.cwd, provider: body?.provider, model: body?.model, agentId: body?.agentId });
      reply.send({ success: true });
    } catch (err: any) {
      reply.status(500).send({ error: err?.message ?? "Unknown" });
    }
  });

  // ── 发送消息 ──
  app.post("/api/agent/:id/prompt", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { message?: string; images?: unknown; cwd?: string; thinking?: boolean } | null;

    let agent = getAgent(id);
    if (!agent) {
      // 自动创建（server 重启等场景）
      await createAgent(id, { cwd: body?.cwd });
      agent = getAgent(id);
    }
    if (!agent) {
      reply.status(404).send({ error: "Failed to create agent" });
      return;
    }

    // 对话中动态切换思考级别（影响本轮及后续）。
    // thinking=true → medium（setThinkingLevel 内部会 clamp 到模型支持范围）
    // thinking=false → off
    if (body?.thinking !== undefined) {
      setThinkingLevel(id, body.thinking ? "medium" : "off");
    }

    console.log(`[prompt] ${id.slice(0, 8)}: ${String(body?.message).slice(0, 60)}${body?.thinking ? " [thinking]" : ""}${body?.images ? ` [${(body.images as any[]).length}图]` : ""}`);
    try {
      let message = body?.message ?? "";
      let promptImages = body?.images; // 传给 agent 的图片（vision 模型直传用，非 vision 模型不传）

      // ── 图片处理：当前模型不支持 vision 时，图片存到待处理队列，文本加提示 ──
      if (body?.images && Array.isArray(body.images) && body.images.length > 0) {
        const modelInput = getAgentModelInput(id);
        const supportsVision = modelInput.includes("image");

        if (!supportsVision) {
          // 模型不支持 vision：图片存队列 + 改写 prompt 文本提示 agent 调 analyze_image
          const imgs = body.images as Array<{ data: string; mimeType: string; type?: string }>;
          pushPendingImages(id, imgs.map((img, i) => ({
            id: `img_${Date.now()}_${i}`,
            data: img.data,
            mimeType: img.mimeType,
          })));
          const hint = `\n\n[系统提示：用户发送了 ${imgs.length} 张图片。请立即调用 analyze_image 工具查看图片内容，然后回答用户的问题。]`;
          message = message + hint;
          promptImages = undefined; // 不把图片传给不支持 vision 的模型
          console.log(`[prompt] ${id.slice(0, 8)} 模型不支持 vision，${imgs.length} 张图片已存队列，提示 agent 调 analyze_image`);
        }
      }

      // 新一轮对话：清空上一轮的 todo（每轮交互独立，不累加）
      try {
        await todoStore.clear(id);
      } catch {}

      // ── /skillname 语法预处理 ──
      // 用户通过 skill picker 插入 /skillname，但 LLM 不认识这个语法。
      // 拦截并翻译成明确指令：去掉 /skillname 前缀 + 追加系统提示要求 read SKILL.md
      const skillPaths = getSkillPaths(id);
      if (skillPaths && skillPaths.size > 0) {
        const slashMatch = message.match(/(?:^|\s)\/([a-zA-Z0-9][\w.-]*)/);
        if (slashMatch) {
          const requestedName = slashMatch[1];
          // 精确匹配 → 模糊匹配（前缀/包含）
          let matched: [string, string] | undefined;
          if (skillPaths.has(requestedName)) {
            matched = [requestedName, skillPaths.get(requestedName)!];
          } else {
            for (const [name, path] of skillPaths) {
              if (name.startsWith(requestedName) || name.includes(requestedName)) {
                matched = [name, path];
                break;
              }
            }
          }
          if (matched) {
            const [skillName, skillPath] = matched;
            // 移除 /skillname 部分，保留其余文本
            message = message.replace(slashMatch[0], "").trim();
            const hint = `\n\n[系统提示：用户指定使用 skill "${skillName}"。请立即用 read 工具读取 ${skillPath}，按照其中的指令完成任务。]`;
            message = message + hint;
            // 立即通知前端技能已加载（不等 LLM read SKILL.md）
            emit({ type: "skill_used", chatSessionId: id, payload: { name: skillName, path: skillPath }, ts: Date.now() });
            console.log(`[prompt] ${id.slice(0, 8)} skill 注入: ${skillName} → ${skillPath}`);
          }
        }
      }

      // 不 await — 事件通过 SSE 流式返回
      // ── 空闲超时保护 ──
      // session.prompt() 在 API 429（余额不足）等场景下可能卡死
      // （既不 resolve 也不 reject），.catch() 永远等不到。
      // 用一个临时订阅者追踪活动，长时间无事件就 abort + emit error 解锁前端。
      const IDLE_TIMEOUT_MS = 180_000; // 3 分钟无任何事件判定卡死
      let lastActivity = Date.now();
      const idleUnsub = agent.subscribe?.(() => { lastActivity = Date.now(); });
      const idleChecker = setInterval(() => {
        if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
          clearInterval(idleChecker);
          idleUnsub?.();
          console.error(`[prompt] ${id.slice(0, 8)} 卡死（${IDLE_TIMEOUT_MS / 1000}s 无响应），自动中止`);
          agent.abort().catch(() => {});
          emit({
            type: "error", chatSessionId: id,
            payload: { message: `Agent ${IDLE_TIMEOUT_MS / 1000}s 无响应，疑似 API 异常（余额不足/限流/网络）。已自动中止，请检查后重试。` },
            ts: Date.now(),
          });
        }
      }, 15_000);
      idleChecker.unref?.();

      const cleanup = () => { clearInterval(idleChecker); idleUnsub?.(); };
      agent.prompt(message, { images: promptImages as any })
        .then(() => { cleanup(); })
        .catch((err: any) => {
          cleanup();
          emit({ type: "error", chatSessionId: id, payload: { message: `Agent error: ${err?.message ?? "Unknown"}` }, ts: Date.now() });
        });
      reply.send({ success: true });
    } catch (err: any) {
      reply.status(500).send({ error: err?.message ?? "Unknown" });
    }
  });

  // ── 中止生成 ──
  app.post("/api/agent/:id/abort", async (req, reply) => {
    const { id } = req.params as { id: string };
    // 先终止该会话下所有活跃的子 agent（防止主会话停了子 agent 还在跑）
    abortSubagents(id);
    const agent = getAgent(id);
    if (agent) {
      await agent.abort();
    } else {
      // agent 不存在（已被 destroy/重建/重启）：发 error 事件让前端解锁
      emit({ type: "error", chatSessionId: id, payload: { message: "agent_unavailable" }, ts: Date.now() });
    }
    reply.send({ success: true });
  });

  // ── 销毁 Agent ──
  app.delete("/api/agent/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    destroyAgent(id);
    reply.send({ success: true });
  });
}
