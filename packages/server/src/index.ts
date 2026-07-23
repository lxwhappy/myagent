// index.ts — 服务端入口
//
// 启动 Fastify HTTP + SSE 服务

import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { setupSSEGateway } from "./sse-gateway.js";
import { setupWorkspaceRoutes } from "./workspace.js";
import { setupSettingsRoutes } from "./settings-routes.js";
import { mcpManager } from "./mcp-manager.js";

async function main() {
  const app = Fastify({ logger: true });

  // 插件
  await app.register(cors, { origin: config.corsOrigin });

  // SSE + REST API
  setupSSEGateway(app);

  // Workspace 文件浏览 API
  setupWorkspaceRoutes(app);

  // 设置管理 API（MCP / Models / Skills）
  setupSettingsRoutes(app);

  // 健康检查
  app.get("/health", async () => ({ status: "ok", ts: Date.now() }));

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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
