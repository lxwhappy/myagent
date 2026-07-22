import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { getConnection, destroyConnection } from "./session-manager.js";
import type { WSMessage } from "./types.js";

export function setupWSGateway(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, async (socket: WebSocket, _req: any) => {
    console.log("[ws] client connected");
    const conn = getConnection(socket);

    socket.on("message", async (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); }
      catch { socket.send(JSON.stringify({ type: "error", payload: { message: "Invalid JSON" } })); return; }

      // 所有命令必须带 chatSessionId（除了 switch_workspace）
      const chatSessionId = msg.chatSessionId;
      const payload = msg.payload || {};

      try {
        switch (msg.type) {
          // ── 为某个聊天会话创建独立的 Agent ──
          case "create_agent": {
            if (!chatSessionId) { socket.send(JSON.stringify({ type: "error", payload: { message: "chatSessionId required" } })); return; }
            // session-manager 内部会发 agent_created 事件（携带 skills + model + mcpTools）
            await conn.createAgent(chatSessionId, { cwd: payload.cwd, provider: payload.provider, model: payload.model });
            break;
          }

          // ── 发送 prompt ──
          case "prompt": {
            let agent = conn.getAgent(chatSessionId);
            // Agent 不存在时自动创建（处理 server 重启/WS 重连等场景）
            if (!agent) {
              await conn.createAgent(chatSessionId, { cwd: payload.cwd, provider: payload.provider, model: payload.model });
              agent = conn.getAgent(chatSessionId);
            }
            if (!agent) { socket.send(JSON.stringify({ type: "error", chatSessionId, payload: { message: "Failed to create agent" } })); return; }
            await agent.prompt(payload.message, { images: payload.images });
            break;
          }

          // ── 中止某个会话的生成 ──
          case "abort": {
            const agent = conn.getAgent(chatSessionId);
            if (agent) await agent.abort();
            break;
          }

          // ── 切换工作空间：销毁所有 agent，通知前端重新创建 ──
          case "switch_workspace": {
            // 不销毁——新会话会创建新 agent，旧 agent 自然留着
            socket.send(JSON.stringify({ type: "workspace_switched", ts: Date.now() }));
            break;
          }

          // ── 销毁某个会话 ──
          case "destroy_agent": {
            conn.destroyAgent(chatSessionId);
            break;
          }

          default:
            socket.send(JSON.stringify({ type: "error", payload: { message: `Unknown: ${msg.type}` } }));
        }
      } catch (err: any) {
        console.error(`[ws] error (${msg.type}):`, err?.message);
        socket.send(JSON.stringify({ type: "error", chatSessionId, payload: { message: err?.message ?? "Error", command: msg.type } }));
      }
    });

    socket.on("close", async () => {
      destroyConnection(socket);
      console.log("[ws] disconnected, all agents destroyed");
    });
  });
}
