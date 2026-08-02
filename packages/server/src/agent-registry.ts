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
import { createTodoTool, createDelegateTool, customTools, todoStore } from "./tools/index.js";
import { createAnalyzeImageTool, pushPendingImages } from "./tools/image-tool.js";
import { webSearchTool, webFetchTool } from "./tools/web-tool.js";
import { runSubagent, abortSubagents } from "./subagent-runner.js";
import { agentConfigStore } from "./agent-configs.js";

export interface AgentEntry {
  agent: AgentSession;
  cwd: string;
  createdAt: number;
  unsubscribe: () => void;
  /** skill name → SKILL.md filePath（用于 /skillname 语法预处理） */
  skillPaths: Map<string, string>;
}

// 全局注册表：chatSessionId → AgentEntry
const registry = new Map<string, AgentEntry>();

export async function createAgent(
  chatSessionId: string,
  opts?: { cwd?: string; provider?: string; model?: string; agentId?: string },
): Promise<string> {
  // 如果该 chatSessionId 已有 agent，先销毁
  destroyAgent(chatSessionId);

  const cwd = opts?.cwd ?? config.workDir;
  const agentDir = process.env.HOME + "/.pi/agent";

  // 读取 Agent 配置（角色预设），把 systemPrompt 追加到 AGENTS.md 之后
  const agentCfg = opts?.agentId ? await agentConfigStore.get(opts.agentId) : undefined;
  const extraPrompt = agentCfg?.systemPrompt?.trim();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    appendSystemPromptOverride: extraPrompt ? (base: string[]) => [...base, extraPrompt] : undefined,
  });
  await loader.reload();

  const provider = opts?.provider ?? config.defaultProvider;
  const modelId = opts?.model ?? agentCfg?.model ?? config.defaultModel;
  const model = getModel(provider, modelId);
  if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);

  const allMcpTools = mcpManager.toToolDefinitions();
  // 按 Agent 配置的 enabledMcpServers 白名单过滤（默认空=不启用任何 MCP server）
  const enabledServers = agentCfg?.enabledMcpServers ?? [];
  const mcpTools = enabledServers.length > 0
    ? allMcpTools.filter(t => {
        // MCP 工具名格式: mcp__<server>__<tool>
        const parts = t.name.split("__");
        return parts.length >= 2 && enabledServers.includes(parts[1]);
      })
    : [];

  // 组装所有自定义工具：todo + delegate + analyze_image + web_search + web_fetch + (已过滤的)MCP
  const todoTool = createTodoTool(todoStore, chatSessionId);
  const delegateTool = createDelegateTool({ spawn: runSubagent, sessionId: chatSessionId, cwd });
  const analyzeImageTool = createAnalyzeImageTool(chatSessionId);
  const allCustomTools = [...customTools, todoTool, delegateTool, analyzeImageTool, webSearchTool, webFetchTool, ...mcpTools];

  // 合并 excludeTools：基础排除 + per-agent 禁用工具
  const excludeTools = ["find", "ls", ...(agentCfg?.disabledTools ?? [])];

  const { session } = await createAgentSession({
    model,
    cwd,
    resourceLoader: loader,
    thinkingLevel: "medium",
    excludeTools,
    customTools: allCustomTools,
  });

  const skillsResult = loader.getSkills();
  const skills = skillsResult.skills.map(s => ({ name: s.name, description: s.description }));

  // 构建 skill name → filePath 映射（用于 /skillname 语法预处理）
  const skillPaths = new Map<string, string>();
  for (const s of skillsResult.skills) {
    if (s.filePath) skillPaths.set(s.name, s.filePath);
  }

  // 绑定事件 → event-bus
  const unsubscribe = eventBridge.bind(chatSessionId, session);

  registry.set(chatSessionId, {
    agent: session,
    cwd,
    createdAt: Date.now(),
    unsubscribe,
    skillPaths,
  });

  // 构建带来源分类的工具列表（用 SDK sourceInfo 分类，比硬编码准确）
  const mcpNames = new Set(mcpTools.map(t => t.name));
  const allToolsRaw: any[] = (session as any).getAllTools?.() ?? [];
  const toolsWithSource = allToolsRaw.map((t: any) => {
    const name: string = t.name;
    const rawSource: string = t.sourceInfo?.source || "";
    const sourcePath: string = t.sourceInfo?.path || "";

    let group: string;
    let pkg: string | undefined;
    if (rawSource === "builtin") {
      group = "builtin";
    } else if (rawSource.startsWith("npm:") || rawSource.startsWith("git:")) {
      group = "extension";
      pkg = rawSource.replace(/^(npm:|git:)/, "");
    } else if (rawSource === "local" || rawSource === "auto") {
      if (mcpNames.has(name)) { group = "mcp"; }
      else {
        group = "extension";
        pkg = sourcePath.split("/node_modules/")[1]?.split("/")[0];
      }
    } else {
      // source=sdk → customTools（<sdk:xxx>）
      group = "custom";
    }
    return { name, source: group, pkg };
  });

  // 发送 agent_created 事件
  const existingTodos = await todoStore.list(chatSessionId);
  emit({
    type: "agent_created",
    chatSessionId,
    payload: {
      skills,
      model: { provider, model: modelId, name: model.name, contextWindow: (model as any).contextWindow ?? 0 },
      mcpTools: mcpTools.length,
      todos: existingTodos,
      tools: toolsWithSource.map(t => t.name),
      toolsWithSource,
      disabledTools: agentCfg?.disabledTools ?? [],
      enabledMcpServers: enabledServers,
      agent: agentCfg
        ? { id: agentCfg.id, name: agentCfg.name, icon: agentCfg.icon }
        : { id: "default", name: "MyAgent", icon: "🤖" },
    },
    ts: Date.now(),
  });

  console.log(`[agent] created for ${chatSessionId.slice(0, 8)} (cwd=${cwd}, model=${provider}/${modelId}, agent=${agentCfg?.id ?? "default"}, skills=${skills.length}, mcpTools=${mcpTools.length})`);
  return chatSessionId;
}

export function getAgent(chatSessionId: string): AgentSession | undefined {
  return registry.get(chatSessionId)?.agent;
}

/** 获取会话的 skill name → filePath 映射（用于 /skillname 语法预处理） */
export function getSkillPaths(chatSessionId: string): Map<string, string> | undefined {
  return registry.get(chatSessionId)?.skillPaths;
}

/** 获取 agent 当前模型的 input 能力（["text"] 或 ["text","image"]），用于判断是否需要图片工具兜底 */
export function getAgentModelInput(chatSessionId: string): string[] {
  const model = registry.get(chatSessionId)?.agent.model as any;
  return model?.input ?? ["text"];
}

// 动态切换思考级别（在 prompt 前调用，对下一轮 agent 回合生效）
// setThinkingLevel 内部会 clamp 到当前模型支持的范围。
export function setThinkingLevel(chatSessionId: string, level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"): boolean {
  const entry = registry.get(chatSessionId);
  if (!entry) return false;
  try {
    entry.agent.setThinkingLevel(level);
    return true;
  } catch {
    return false;
  }
}

export function destroyAgent(chatSessionId: string): void {
  const entry = registry.get(chatSessionId);
  if (!entry) return;
  // 连带终止该会话下所有活跃的子 agent
  abortSubagents(chatSessionId);
  entry.unsubscribe();
  try { entry.agent.abort(); } catch {}
  registry.delete(chatSessionId);
  console.log(`[agent] destroyed ${chatSessionId.slice(0, 8)}`);
}

export function destroyAll(): void {
  for (const id of [...registry.keys()]) destroyAgent(id);
}

export function getCount(): number { return registry.size; }

/**
 * 从活跃 session 获取各扩展实际注册的工具数量。
 * resolve() 只返回入口文件数（1个），工具是运行时动态注册的，
 * 只有从 session.getAllTools() 才能拿到真实工具列表。
 * 返回 { "pi-web-access": 4, "@juicesharp/rpiv-todo": 1, ... }
 */
export function getExtensionToolCounts(): Record<string, number> {
  for (const entry of registry.values()) {
    const allTools: any[] = (entry.agent as any).getAllTools?.() ?? [];
    const counts: Record<string, number> = {};
    for (const t of allTools) {
      const src: string = t.sourceInfo?.source || "";
      // npm:pi-web-access → pi-web-access
      const pkg = src.startsWith("npm:") || src.startsWith("git:")
        ? src.replace(/^(npm:|git:)/, "")
        : (t.sourceInfo?.path ? (t.sourceInfo.path.split("/node_modules/")[1]?.split("/")[0] ?? "") : "");
      if (pkg) counts[pkg] = (counts[pkg] || 0) + 1;
    }
    return counts;
  }
  return {};
}
