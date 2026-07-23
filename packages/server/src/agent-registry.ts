// agent-registry.ts — 全局 Agent Session 注册表
//
// 替代旧的 per-WebSocket ConnectionManager。
// 所有 agent 在全局注册，事件通过 event-bus 广播给 SSE 客户端。

import {
  createAgentSession,
  type AgentSession,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { config } from "./config.js";
import { eventBridge } from "./event-bridge.js";
import { mcpManager } from "./mcp-manager.js";
import { emit } from "./event-bus.js";

export interface AgentEntry {
  agent: AgentSession;
  cwd: string;
  createdAt: number;
  unsubscribe: () => void;
}

// 全局注册表：chatSessionId → AgentEntry
const registry = new Map<string, AgentEntry>();

export async function createAgent(
  chatSessionId: string,
  opts?: { cwd?: string; provider?: string; model?: string },
): Promise<string> {
  // 如果该 chatSessionId 已有 agent，先销毁
  destroyAgent(chatSessionId);

  const cwd = opts?.cwd ?? config.workDir;
  const agentDir = process.env.HOME + "/.pi/agent";

  const loader = new DefaultResourceLoader({ cwd, agentDir });
  await loader.reload();

  const provider = opts?.provider ?? config.defaultProvider;
  const modelId = opts?.model ?? config.defaultModel;
  const model = getModel(provider, modelId);
  if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);

  const mcpTools = mcpManager.toToolDefinitions();

  const { session } = await createAgentSession({
    model,
    resourceLoader: loader,
    thinkingLevel: "off",
    ...(mcpTools.length > 0 ? { customTools: mcpTools } : {}),
  });

  const skillsResult = loader.getSkills();
  const skills = skillsResult.skills.map(s => ({ name: s.name, description: s.description }));

  // 绑定事件 → event-bus
  const unsubscribe = eventBridge.bind(chatSessionId, session);

  registry.set(chatSessionId, {
    agent: session,
    cwd,
    createdAt: Date.now(),
    unsubscribe,
  });

  // 发送 agent_created 事件
  emit({
    type: "agent_created",
    chatSessionId,
    payload: {
      skills,
      model: { provider, model: modelId, name: model.name, contextWindow: (model as any).contextWindow ?? 0 },
      mcpTools: mcpTools.length,
    },
    ts: Date.now(),
  });

  console.log(`[agent] created for ${chatSessionId.slice(0, 8)} (cwd=${cwd}, model=${provider}/${modelId}, skills=${skills.length}, mcpTools=${mcpTools.length})`);
  return chatSessionId;
}

export function getAgent(chatSessionId: string): AgentSession | undefined {
  return registry.get(chatSessionId)?.agent;
}

export function destroyAgent(chatSessionId: string): void {
  const entry = registry.get(chatSessionId);
  if (!entry) return;
  entry.unsubscribe();
  try { entry.agent.abort(); } catch {}
  registry.delete(chatSessionId);
  console.log(`[agent] destroyed ${chatSessionId.slice(0, 8)}`);
}

export function destroyAll(): void {
  for (const id of [...registry.keys()]) destroyAgent(id);
}

export function getCount(): number { return registry.size; }
