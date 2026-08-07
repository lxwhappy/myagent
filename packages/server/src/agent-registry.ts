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
import { AGENT_DIR } from "./paths.js";
import { setLlmInterceptorSession } from "./llm-interceptor.js";
import { createTodoTool, createDelegateTool, customTools, todoStore } from "./tools/index.js";
import { createAnalyzeImageTool, pushPendingImages } from "./tools/image-tool.js";
import { webSearchTool, webFetchTool } from "./tools/web-tool.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createAskUserTool } from "./tools/ask-tool.js";
import { setFireFn } from "./tools/cron-store.js";
import { runSubagent, abortSubagents } from "./subagent-runner.js";
import { agentConfigStore } from "./agent-configs.js";
import { getSystemInfo } from "./system-info.js";
import { chatSessionStore } from "./chat-sessions.js";

export interface AgentEntry {
  agent: AgentSession;
  cwd: string;
  workspaceId?: string;       // 所属工作空间（定时任务创建时用）
  createdAt: number;
  unsubscribe: () => void;
  /** skill name → SKILL.md filePath（用于 /skillname 语法预处理） */
  skillPaths: Map<string, string>;
}

// ── 定时任务触发回调：创建真实 ChatSession + agent session 执行 ──
// 触发后在对应项目下产生可见的会话记录，用户刷新会话列表即可看到。
import { config as _config } from "./config.js";
import type { CronJob } from "./tools/cron-store.js";
setFireFn(async (job: CronJob) => {
  const wsId = job.workspaceId || "default";
  const title = `[定时] ${job.name} ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  try {
    // 1. 创建真实的 ChatSession（持久化，前端会话列表可见）
    const chatSession = await chatSessionStore.create(wsId, title);

    // 2. 创建 agent session
    await createAgent(chatSession.id, { cwd: job.cwd, agentId: job.agentId });
    const entry = registry.get(chatSession.id);
    if (!entry) return { error: "agent session 创建失败" };

    // 3. 存 user 消息
    const fullPrompt = `[定时任务「${job.name}」触发]\n${job.prompt}`;
    await chatSessionStore.addMessage(chatSession.id, "user", fullPrompt);

    // 4. 执行
    await entry.agent.prompt(fullPrompt);

    // 5. 提取 agent 最后一条回复，存为 assistant 消息
    const messages = entry.agent.messages || [];
    let output = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg: any = messages[i];
      if (msg.role === "assistant" && msg.content) {
        output = typeof msg.content === "string"
          ? msg.content
          : (Array.isArray(msg.content) ? msg.content.map((b: any) => b.text || "").join("") : "");
        if (output) break;
      }
    }
    const finalOutput = output || "(无输出)";
    await chatSessionStore.addMessage(chatSession.id, "assistant", finalOutput);

    return { output: finalOutput };
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }
});

// 全局注册表：chatSessionId → AgentEntry
const registry = new Map<string, AgentEntry>();

export async function createAgent(
  chatSessionId: string,
  opts?: { cwd?: string; provider?: string; model?: string; agentId?: string },
): Promise<string> {
  // 如果该 chatSessionId 已有 agent，先销毁
  destroyAgent(chatSessionId);

  const cwd = opts?.cwd ?? config.workDir;
  const agentDir = AGENT_DIR;

  // 读取 Agent 配置（角色预设），把 systemPrompt 追加到 AGENTS.md 之后
  const agentCfg = opts?.agentId ? await agentConfigStore.get(opts.agentId) : undefined;
  const extraPrompt = agentCfg?.systemPrompt?.trim();
  const sysInfo = getSystemInfo();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    // 始终注入：系统信息 + 角色指令
    appendSystemPromptOverride: (base: string[]) => [
      ...base,
      sysInfo,
      ...(extraPrompt ? [extraPrompt] : []),
    ],
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
  const cronTool = createCronTool(chatSessionId);
  const askUserTool = createAskUserTool(chatSessionId);
  const allCustomTools = [...customTools, todoTool, delegateTool, analyzeImageTool, webSearchTool, webFetchTool, cronTool, askUserTool, ...mcpTools];

  // 合并 excludeTools：基础排除 + per-agent 禁用工具
  const excludeTools = ["find", "ls", ...(agentCfg?.disabledTools ?? [])];

  const { session } = await createAgentSession({
    model,
    cwd,
    resourceLoader: loader,
    thinkingLevel: "off",  // 默认关闭思考，前端可手动开启（省3-15s/轮）
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

  // 查询会话所属的工作空间
  const chatSession = await chatSessionStore.get(chatSessionId);
  const workspaceId = chatSession?.workspaceId;

  registry.set(chatSessionId, {
    agent: session,
    cwd,
    workspaceId,
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

/** 获取会话的工作目录（定时任务创建时用，确保任务绑定到当前项目） */
export function getAgentCwd(chatSessionId: string): string | undefined {
  return registry.get(chatSessionId)?.cwd;
}

/** 获取 agent 的完整系统提示词（SDK 默认 + AGENTS.md + 角色指令） */
export function getAgentSystemPrompt(chatSessionId: string): string | undefined {
  const entry = registry.get(chatSessionId);
  if (!entry) return undefined;
  try {
    return (entry.agent as any).systemPrompt as string;
  } catch {
    return undefined;
  }
}

/** 遍历所有活跃 session，返回 [{ sid, systemPrompt }] */
export function getAllActiveSystemPrompts(): Array<{ sid: string; systemPrompt: string }> {
  const result: Array<{ sid: string; systemPrompt: string }> = [];
  for (const [sid, entry] of registry) {
    try {
      const sp = (entry.agent as any).systemPrompt as string;
      if (sp) result.push({ sid, systemPrompt: sp });
    } catch {}
  }
  return result;
}

/**
 * 把完整 systemPrompt 按来源切分成结构化分段。
 * 拼接顺序（system-prompt.js）：
 *   SDK默认(含Available tools + Guidelines)
 *   → appendSection(Agent角色指令)
 *   → <project_context>(AGENTS.md等)
 *   → Available skills
 *   → Current working directory
 */
export interface PromptSection {
  label: string;
  content: string;
  source: "sdk" | "agent" | "project" | "skills" | "cwd";
}

export function parseSystemPrompt(full: string): PromptSection[] {
  const sections: PromptSection[] = [];

  // 标记及其在完整字符串中的位置
  const markers = {
    projectCtx: full.indexOf("<project_context>"),
    projectCtxEnd: full.indexOf("</project_context>"),
    skills: full.indexOf("The following skills"),
    cwd: full.indexOf("Current working directory:"),
  };
  const hasCtx = markers.projectCtx >= 0 && markers.projectCtxEnd >= 0;
  const hasSkills = markers.skills >= 0;
  const hasCwd = markers.cwd >= 0;

  // 辅助：获取 SDK 默认的结束位置（之后到 project_context/skills/cwd 之间的是 Agent 角色指令）
  const sdkEndMarkers = ["Always read pi .md files completely", "- When working on pi topics"];
  let sdkEnd = -1;
  for (const m of sdkEndMarkers) {
    const idx = full.indexOf(m);
    if (idx >= 0) { sdkEnd = idx + m.length; break; }
  }

  // 计算各段的边界
  const agentStart = sdkEnd >= 0 ? sdkEnd : 0;
  const afterSdk = Math.min(
    ...[hasCtx ? markers.projectCtx : Infinity,
        hasSkills ? markers.skills : Infinity,
        hasCwd ? markers.cwd : Infinity,
        full.length].filter(v => v >= 0)
  );

  // 1. SDK 默认
  const sdkPart = sdkEnd >= 0 ? full.slice(0, afterSdk).trim() : full.slice(0, agentStart).trim();
  if (sdkPart) sections.push({ label: "SDK 默认", content: sdkPart, source: "sdk" });

  // 2. Agent 角色指令（sdkEnd 之后，到 project_context / skills / cwd 之前）
  if (sdkEnd >= 0 && afterSdk > sdkEnd) {
    const agentPart = full.slice(sdkEnd, afterSdk).trim();
    if (agentPart) sections.push({ label: "Agent 角色指令", content: agentPart, source: "agent" });
  }

  // 3. 项目上下文
  if (hasCtx) {
    const ctxContent = full.slice(markers.projectCtx, markers.projectCtxEnd + "</project_context>".length).trim();
    sections.push({ label: "项目上下文 (AGENTS.md)", content: ctxContent, source: "project" });
  }

  // 4. Skills
  if (hasSkills) {
    const skillsEnd = hasCwd && markers.cwd > markers.skills ? markers.cwd : full.length;
    const skillsContent = full.slice(markers.skills, skillsEnd).trim();
    sections.push({ label: "Skills", content: skillsContent, source: "skills" });
  }

  // 5. 工作目录
  if (hasCwd) {
    sections.push({ label: "工作目录", content: full.slice(markers.cwd).trim(), source: "cwd" });
  }

  return sections;
}

/** 获取会话所属的工作空间 ID */
export function getAgentWorkspaceId(chatSessionId: string): string | undefined {
  return registry.get(chatSessionId)?.workspaceId;
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
