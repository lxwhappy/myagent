// ============================================================
// session-manager.ts — 多 Agent Session 并发管理
//
// 一个 WS 连接维护多个 Pi Agent Session。
// 每个 chatSessionId 对应一个独立的 Agent，互不干扰。
// ============================================================

import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import {
  createAgentSession,
  type AgentSession,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getModel, getModels, getProviders } from "@earendil-works/pi-ai/compat";
import { config } from "./config.js";
import { eventBridge } from "./event-bridge.js";
import { mcpManager } from "./mcp-manager.js";

export interface AgentSessionEntry {
  agent: AgentSession;
  ws: WebSocket;
  cwd: string;
  createdAt: number;
  unsubscribe: () => void;
}

/** 一个 WebSocket 连接对应一个 ConnectionManager */
export class ConnectionManager {
  // chatSessionId → AgentSessionEntry
  private sessions = new Map<string, AgentSessionEntry>();
  private ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  async createAgent(chatSessionId: string, opts?: { cwd?: string; provider?: string; model?: string }): Promise<string> {
    // 如果该 chatSessionId 已有 agent，先销毁
    this.destroyAgent(chatSessionId);

    const cwd = opts?.cwd ?? config.workDir;
    const agentDir = process.env.HOME + "/.pi/agent";

    const loader = new DefaultResourceLoader({ cwd, agentDir });
    await loader.reload();

    // 模型：优先用请求传入的，其次 config 默认
    const provider = opts?.provider ?? config.defaultProvider;
    const modelId = opts?.model ?? config.defaultModel;
    const model = getModel(provider, modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);

    // 收集 MCP tools，注入 agent
    const mcpTools = mcpManager.toToolDefinitions();

    const { session } = await createAgentSession({
      model,
      resourceLoader: loader,
      thinkingLevel: "off",  // 关闭 thinking（GLM-4.7 通过 openai-completions 对 thinking 支持不好）
      ...(mcpTools.length > 0 ? { customTools: mcpTools } : {}),
    });

    // 获取已加载的 skills
    const skillsResult = loader.getSkills();
    const skills = skillsResult.skills.map(s => ({ name: s.name, description: s.description }));

    // 绑定事件：每个 agent 的事件都带上 chatSessionId
    const unsubscribe = eventBridge.bind(chatSessionId, session, this.ws);

    this.sessions.set(chatSessionId, {
      agent: session,
      ws: this.ws,
      cwd,
      createdAt: Date.now(),
      unsubscribe,
    });

    // 发送 agent_created 事件（携带 skills 列表 + 模型信息 + contextWindow + mcp tools 数量）
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify({
        type: "agent_created",
        chatSessionId,
        payload: {
          skills,
          model: { provider, model: modelId, name: model.name, contextWindow: (model as any).contextWindow ?? 0 },
          mcpTools: mcpTools.length,
        },
        ts: Date.now(),
      }));
    }

    console.log(`[agent] created for ${chatSessionId.slice(0, 8)} (cwd=${cwd}, model=${provider}/${modelId}, skills=${skills.length}, mcpTools=${mcpTools.length})`);
    return chatSessionId;
  }

  getAgent(chatSessionId: string): AgentSession | undefined {
    return this.sessions.get(chatSessionId)?.agent;
  }

  destroyAgent(chatSessionId: string) {
    const entry = this.sessions.get(chatSessionId);
    if (!entry) return;
    entry.unsubscribe();
    try { entry.agent.abort(); } catch {}
    this.sessions.delete(chatSessionId);
    console.log(`[agent] destroyed chatSession ${chatSessionId.slice(0, 8)}`);
  }

  destroyAll() {
    for (const id of [...this.sessions.keys()]) {
      this.destroyAgent(id);
    }
  }

  get count() { return this.sessions.size; }
}

// WebSocket → ConnectionManager 映射
const connections = new WeakMap<WebSocket, ConnectionManager>();

export function getConnection(ws: WebSocket): ConnectionManager {
  let cm = connections.get(ws);
  if (!cm) {
    cm = new ConnectionManager(ws);
    connections.set(ws, cm);
  }
  return cm;
}

export function destroyConnection(ws: WebSocket) {
  const cm = connections.get(ws);
  if (cm) {
    cm.destroyAll();
    connections.delete(ws);
  }
}
