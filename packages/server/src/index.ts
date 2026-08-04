// index.ts — 服务端入口
//
// 启动 Fastify HTTP + SSE 服务
// 生产模式下同时托管前端静态文件（单进程架构）

import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { migrateIfNeeded } from "./migrate.js";
import { setLlmInterceptorEnabled } from "./llm-interceptor.js";

// ── 一次性数据迁移：~/.pi/agent/ → ~/.myagent/（幂等）──
migrateIfNeeded();

// LLM 拦截器：始终 patch fetch，debug 模式由前端通过 API 动态控制
setLlmInterceptorEnabled(true);

import { setupSSEGateway } from "./sse-gateway.js";
import { setupWorkspaceRoutes } from "./workspace.js";
import { setupSettingsRoutes } from "./settings-routes.js";
import { setupAgentRoutes } from "./agent-routes.js";
import { setupCronRoutes } from "./cron-routes.js";
import { mcpManager } from "./mcp-manager.js";
import { restoreAllJobs, cronStore } from "./tools/cron-store.js";

/**
 * 查找前端静态文件目录。
 * - 打包发布模式：public/ 位于 server bundle 上一级（dist-release/public）
 * - 环境变量覆盖：MYAGENT_PUBLIC_DIR
 * - 开发模式：不托管静态文件（前端走 Vite dev server + CORS）
 */
function findPublicDir(): string | null {
  // 1. 环境变量显式指定
  if (process.env.MYAGENT_PUBLIC_DIR && existsSync(process.env.MYAGENT_PUBLIC_DIR)) {
    return process.env.MYAGENT_PUBLIC_DIR;
  }
  // 2. 相对于当前模块定位（打包后 dist-release/server/index.js → ../public）
  const here = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "public"),       // 打包模式：server/ → ../public
    resolve(here, "..", "..", "web", "dist"), // monorepo: server/dist → ../../web/dist
  ];
  for (const c of candidates) {
    if (existsSync(resolve(c, "index.html"))) return c;
  }
  return null;
}

async function main() {
  const app = Fastify({ logger: true });

  // 插件
  await app.register(cors, { origin: config.corsOrigin });

  // SSE + REST API（所有 /api/* 路由）
  setupSSEGateway(app);

  // Workspace 文件浏览 API
  setupWorkspaceRoutes(app);

  // 设置管理 API（MCP / Models / Skills）
  setupSettingsRoutes(app);

  // Agent 配置管理 API（角色预设 CRUD）
  setupAgentRoutes(app);

  // 定时任务管理 API
  setupCronRoutes(app);

  // 健康检查
  app.get("/health", async () => ({ status: "ok", ts: Date.now() }));

  // ── 静态文件托管（生产模式）──
  const publicDir = findPublicDir();
  if (publicDir) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
      wildcard: false, // 手动处理 SPA fallback
    });
    // SPA fallback：非 API、非静态文件的请求统一返回 index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.code(404).send({ error: "Not found" });
      } else {
        reply.sendFile("index.html");
      }
    });
    console.log(`  Static:       ${publicDir}`);
  }

  // 启动
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`\n  MyAgent Server running at http://${config.host}:${config.port}`);
    console.log(`  SSE:          http://${config.host}:${config.port}/api/events`);
    console.log(`  Health:       http://${config.host}:${config.port}/health\n`);

    // 启动后异步连接 MCP servers（不阻塞启动）
    mcpManager.connectAll().then(({ connected, failed }) => {
      if (connected.length > 0) console.log(`  MCP: connected ${connected.join(", ")}`);
      if (failed.length > 0) console.log(`  MCP: failed ${failed.map(f => f.name).join(", ")}`);
    }).catch((e) => console.error("[mcp] startup connect error:", e.message));

    // 恢复定时任务（宿主级调度，独立于 agent session）
    restoreAllJobs().catch((e) => console.error("[cron] restore error:", e.message));

    // 优雅关闭：停止所有定时任务
    process.on("SIGINT", () => { cronStore.stopAll(); process.exit(0); });
    process.on("SIGTERM", () => { cronStore.stopAll(); process.exit(0); });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
