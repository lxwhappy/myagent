// stores/chat.ts — 多会话状态（支持 thinking + skills + steering）

import { create } from "zustand";

/** SDK 思考级别 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** 思考级别显示配置 */
export const THINKING_LEVELS: { value: ThinkingLevel; label: string; desc: string; icon: string }[] = [
  { value: "off",      label: "关闭",   desc: "不生成推理 token，最快响应", icon: "🚫" },
  { value: "minimal",  label: "极简",   desc: "极少推理，适合简单问答",     icon: "💭" },
  { value: "low",      label: "低",     desc: "轻量推理，日常任务推荐",     icon: "🧩" },
  { value: "medium",   label: "中",     desc: "中等推理，适合编程/分析",     icon: "🧠" },
  { value: "high",     label: "高",     desc: "深度推理，复杂逻辑/调试",     icon: "🔬" },
  { value: "xhigh",    label: "极高",   desc: "极致推理，数学/架构设计",     icon: "🧪" },
  { value: "max",      label: "最大",   desc: "最大推理预算，最慢最贵",      icon: "💯" },
];

/** pending raw LLM 请求：llm_raw 事件可能先于 message_end 到达，
 *  此时 debugEvent 尚未创建，暂存于此，待 addDebugLLM 时补匹配。 */
interface PendingRaw {
  url: string; method: string; headers?: Record<string, string>;
  body?: string | null; respBody?: string | null;
  durationMs?: number; timestamp?: number;
}
const pendingRaws = new Map<string, PendingRaw[]>();

/** Debug: 单次 LLM 调用的明细记录 */
export interface DebugLLMEvent {
  type: "llm";
  model?: string;
  thinking?: string;  // 该轮 LLM 调用的思考内容（从 thinking_delta 快照）
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
    totalTokens: number;
    cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  durationMs?: number;
  firstTokenMs?: number;
  startTs?: number;    // 调用开始时间戳
  endTs?: number;      // 调用结束时间戳
  // 原始 LLM API 请求/响应（debug 模式下由 fetch 拦截器捕获）
  rawRequest?: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string | null;
  };
  rawResponse?: {
    body?: string | null;
    durationMs?: number;
  };
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
  thinking?: string;        // 思考过程
  tools?: ToolExecution[];  // 该消息关联的工具调用
  skillsUsed?: SkillUsage[]; // 该消息中加载的 Skills
  images?: AttachedImage[];  // 用户发送的图片（缩略图展示）
  systemNotice?: SystemNotice; // 系统通知（压缩等）
  debugEvents?: DebugLLMEvent[]; // Debug: LLM 调用明细
}

/** 系统通知（插入消息流中，非对话内容） */
export interface SystemNotice {
  type: "compaction";
  reason?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  savedPercent?: number;
  aborted?: boolean;
  summary?: string;  // 压缩摘要（compaction_end 时 SDK 返回）
}

/** 用户消息附带的图片（前端展示用） */
export interface AttachedImage {
  data: string;       // base64
  mimeType: string;
  previewUrl?: string; // 本地预览 URL（不持久化）
}

export interface SkillUsage {
  name: string;
  path: string;
}

export interface ToolExecution {
  toolCallId: string;
  tool: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  status: "running" | "done" | "error";
  precedingThinking?: string;
  durationMs?: number;
  startTs?: number;
  partialOutput?: string;  // bash 流式输出（执行中实时累积）
}

/** 子 agent 运行状态（delegate_task 工具触发的隔离子任务） */
export interface SubagentState {
  subId: string;
  goal: string;
  status: "running" | "done" | "error";
  currentTool?: string;
  toolCount: number;
  tokens?: number;
  tokenBreakdown?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  durationMs?: number;
  summary?: string;
  error?: string;
  messages?: Message[];   // 子 agent 的完整执行过程（供钻入查看）
  sdkSessionFile?: string;  // 子 agent SDK session jsonl 日志路径（供下载）
}

export interface SkillInfo {
  name: string;
  description: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  icon: string;
}

export interface ModelInfo {
  provider: string;
  model: string;
  name: string;
  contextWindow: number;
}

export interface UsageInfo {
  stats: {
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
  };
  context: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  } | null;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "low" | "medium" | "high";
  createdAt: number;
  updatedAt: number;
}

interface SessionChatState {
  messages: Message[];
  isGenerating: boolean;
  agentCreated: boolean;
  skills: SkillInfo[];
  skillsNotified: boolean;
  modelInfo: ModelInfo | null;
  usage: UsageInfo | null;
  activeSkill: { name: string; path: string } | null;
  todos: TodoItem[];
  subagents: SubagentState[];   // 活跃/刚完成的子 agent（delegate_task）
  agentId?: string;            // 该会话使用的 Agent 预设 id
  agent?: AgentInfo;           // 该会话使用的 Agent 显示信息
  teamId?: string;             // 该会话绑定的 Agent 团队 id（团队模式：编排指令注入系统提示）
  availableTools: string[];    // 该会话实际可用的工具名列表
  toolsWithSource: { name: string; source: string; pkg?: string }[]; // 带来源分类的工具列表
  disabledTools: string[];     // 该会话被禁用的工具名列表
  retryStatus?: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    errorMessage: string;
  } | null;
  autopilot?: {
    phase: string;
    round: number;
    task: string;
    analysis?: string;
    plan?: string;
    result?: string;
    verification?: string;
    issues?: string[];
    error?: string;
  } | null;
  // ── Steering 队列（Agent 执行中排队的干预消息）──
  steeringQueue: string[];    // 🎯 当前工具调用后立即投递
  followUpQueue: string[];    // ⏳ Agent 完全空闲后才投递
  isCompacting: boolean;      // 上下文压缩进行中
}

let msgCounter = 0;
const empty = (): SessionChatState => ({ messages: [], isGenerating: false, agentCreated: false, skills: [], skillsNotified: false, modelInfo: null, usage: null, activeSkill: null, todos: [], subagents: [], availableTools: [], toolsWithSource: [], disabledTools: [], retryStatus: null, autopilot: null, steeringQueue: [], followUpQueue: [], isCompacting: false });

interface ChatStore {
  sessions: Record<string, SessionChatState>;
  activeChatSessionId: string | null;
  connected: boolean;
  thinkingLevel: ThinkingLevel;
  activeSubId: string | null;   // 当前钻入查看的子 agent id（null=主会话视图）

  setConnected: (v: boolean) => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
  setActiveSub: (subId: string | null) => void;
  setActiveChatSession: (id: string | null) => void;
  ensureSession: (id: string) => void;
  setAgentCreated: (id: string, skills?: SkillInfo[], modelInfo?: ModelInfo, agent?: AgentInfo, tools?: string[], disabledTools?: string[], toolsWithSource?: { name: string; source: string; pkg?: string }[]) => void;
  setSessionAgent: (id: string, agentId: string, agent: AgentInfo) => void;
  setSessionTeam: (id: string, teamId: string | undefined) => void;
  removeSession: (id: string) => void;
  loadMessages: (id: string, messages: Message[]) => void;
  clearSession: (id: string) => void;
  setUsage: (id: string, usage: UsageInfo) => void;
  setActiveSkill: (id: string, skill: { name: string; path: string } | null) => void;
  setTodos: (id: string, todos: TodoItem[]) => void;
  addSubagent: (id: string, sub: SubagentState) => void;
  updateSubagentProgress: (id: string, subId: string, tool: string) => void;
  finishSubagent: (id: string, subId: string, result: { status: "done" | "error"; summary?: string; tokens?: number; tokenBreakdown?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; durationMs?: number; error?: string; sdkSessionFile?: string }) => void;
  applySubagentEvent: (id: string, subId: string, event: any) => void;
  setSubagents: (id: string, subs: SubagentState[]) => void;

  addUserMessage: (id: string, text: string, images?: AttachedImage[]) => void;
  addSystemNotice: (id: string, notice: SystemNotice) => void;
  setCompacting: (id: string, v: boolean) => void;
  startAssistantMessage: (id: string) => void;
  appendDelta: (id: string, delta: string) => void;
  appendThinking: (id: string, delta: string) => void;
  finishAssistantMessage: (id: string) => void;
  forceResetGenerating: (id: string) => void;
  addToolStart: (id: string, exec: Partial<ToolExecution> & { toolCallId: string }) => void;
  updateToolEnd: (id: string, toolCallId: string, result: unknown, isError: boolean, debug?: { durationMs?: number; startTs?: number }) => void;
  appendToolPartial: (id: string, toolCallId: string, delta: string) => void;
  addSkillUsed: (id: string, skill: SkillUsage) => void;
  setRetryStatus: (id: string, status: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string } | null) => void;
  setAutopilotState: (id: string, state: { phase: string; round: number; task: string; analysis?: string; plan?: string; result?: string; verification?: string; issues?: string[]; error?: string }) => void;
  setAutopilotStream: (id: string, phase: string, snippet: string) => void;
  finishAutopilot: (id: string, summary: string) => void;
  addDebugLLM: (id: string, evt: DebugLLMEvent) => void;
  /** 删除最后一条 assistant 消息（用于重新生成） */
  removeLastAssistant: (id: string) => string | null;
  /** 将原始 LLM API 请求/响应附加到最近的 debugEvent */
  attachRawLLM: (id: string, raw: { url: string; method: string; headers?: Record<string, string>; body?: string | null; respBody?: string | null; durationMs?: number; timestamp?: number }) => void;
  // ── Steering 队列 ──
  setQueuedMessages: (id: string, queues: { steering: string[]; followUp: string[] }) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: {},
  activeChatSessionId: null,
  connected: false,
  // 思考默认关闭：思考模式会让 GLM-4.7 每轮多花 3-15s 生成推理 token。
  // 大部分场景不需要深度思考，用户可手动点 🧠 按钮切换级别。
  thinkingLevel: (() => {
    try {
      const saved = localStorage.getItem("myagent:thinking");
      // 向后兼容：旧版存 "1"/"0"，映射到 medium/off
      if (saved === "1") return "medium" as ThinkingLevel;
      if (saved === "0" || saved === null) return "off" as ThinkingLevel;
      return saved as ThinkingLevel;
    } catch { return "off" as ThinkingLevel; }
  })(),
  activeSubId: null,

  setConnected: (v) => set({ connected: v }),
  setActiveSub: (subId) => set({ activeSubId: subId }),
  setActiveChatSession: (id) => set({ activeChatSessionId: id, activeSubId: null }),
  setThinkingLevel: (level) => {
    try { localStorage.setItem("myagent:thinking", level); } catch {}
    set({ thinkingLevel: level });
  },

  ensureSession: (id) => set((s) => s.sessions[id] ? {} : { sessions: { ...s.sessions, [id]: empty() } }),

  setAgentCreated: (id, skills, modelInfo, agent, tools, disabledTools, toolsWithSource) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, agentCreated: true, skills: skills || [], modelInfo: modelInfo ?? sess.modelInfo, agent: agent ?? sess.agent, availableTools: tools ?? [], disabledTools: disabledTools ?? [], toolsWithSource: toolsWithSource ?? [] } } };
  }),

  setSessionAgent: (id, agentId, agent) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, agentId, agent } } };
  }),

  setSessionTeam: (id, teamId) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, teamId } } };
  }),

  removeSession: (id) => set((s) => { const n = { ...s.sessions }; delete n[id]; return { sessions: n }; }),

  loadMessages: (id, messages) => set((s) => {
    const existing = s.sessions[id];
    if (!existing) {
      // 新会话：初始化完整状态
      return { sessions: { ...s.sessions, [id]: { ...empty(), messages } } };
    }
    // 已有会话：只更新消息，保留所有运行时状态（isGenerating, skills, modelInfo, usage 等）
    // 这保证切换会话时不会丢失正在进行的流式状态
    return { sessions: { ...s.sessions, [id]: { ...existing, messages } } };
  }),

  clearSession: (id) => set((s) => ({ sessions: { ...s.sessions, [id]: empty() } })),

  setUsage: (id, usage) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, usage } } };
  }),

  setActiveSkill: (id, skill) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, activeSkill: skill } } };
  }),

  setTodos: (id, todos) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, todos } } };
  }),

  addUserMessage: (id, text, images) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: [...sess.messages, { id: `u-${msgCounter++}`, role: "user", content: text, images }] } } };
  }),

  addSystemNotice: (id, notice) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: [...sess.messages, { id: `sys-${msgCounter++}`, role: "system", content: "", systemNotice: notice }] } } };
  }),

  setCompacting: (id, v) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, isCompacting: v } } };
  }),

  startAssistantMessage: (id) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages]; const last = msgs[msgs.length - 1];
    // 如果最后一条是空的 streaming assistant 消息，直接复用（防止重复 agent_start 产生空消息）
    if (last?.role === "assistant" && last.isStreaming && !last.content && !(last.tools && last.tools.length)) {
      return { sessions: { ...s.sessions, [id]: { ...sess, isGenerating: true } } };
    }
    // 如果最后一条是空的已结束 assistant 消息，替换它
    if (last?.role === "assistant" && !last.isStreaming && !last.content && !(last.tools && last.tools.length)) {
      msgs[msgs.length - 1] = { id: `a-${msgCounter++}`, role: "assistant", content: "", isStreaming: true, thinking: "", tools: [] };
      return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs, isGenerating: true } } };
    }
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: [...msgs, { id: `a-${msgCounter++}`, role: "assistant", content: "", isStreaming: true, thinking: "", tools: [] }], isGenerating: true } } };
  }),

  appendDelta: (id, delta) => { if (!delta) return; set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages]; const last = msgs[msgs.length - 1];
    if (last?.role === "assistant" && last.isStreaming) msgs[msgs.length - 1] = { ...last, content: last.content + delta };
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
  })},

  appendThinking: (id, delta) => { if (!delta) return; set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages]; const last = msgs[msgs.length - 1];
    if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, thinking: (last.thinking || "") + delta };
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
  })},

  finishAssistantMessage: (id) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages]; const last = msgs[msgs.length - 1];
    if (last?.role === "assistant") {
      // 如果正文为空但 thinking 有内容，把 thinking 当正文显示
      // 但仅在没有任何工具调用时才提升——有 ask_user 等工具时，
      // thinking 已被快照到 tool.precedingThinking，直接当正文会裸露推理
      const patch: any = { isStreaming: false };
      if (!last.content && last.thinking && last.thinking.trim() && !(last.tools && last.tools.length)) {
        patch.content = last.thinking.trim();
        patch.thinking = "";
      }
      msgs[msgs.length - 1] = { ...last, ...patch };
      // 如果消息完全空（无内容、无 thinking、无 tools），移除它
      const fin = msgs[msgs.length - 1];
      if (fin && !fin.content && !(fin.thinking && fin.thinking.trim()) && !(fin.tools && fin.tools.length)) {
        msgs.pop();
      }
    }
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs, isGenerating: false, activeSkill: null } } };
  }),

  // 强制重置生成状态：用于 agent 被 destroy / abort 后兜底解锁前端卡死
  // （destroy 不发 agent_end，abort 若 agent 已不在跑也无效，isGenerating 会卡住）
  forceResetGenerating: (id) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages];
    const last = msgs[msgs.length - 1];
    // 关闭最后一条 streaming 消息；若完全空则移除
    if (last?.role === "assistant" && last.isStreaming) {
      if (!last.content && !(last.thinking && last.thinking.trim()) && !(last.tools && last.tools.length)) {
        msgs.pop();
      } else {
        msgs[msgs.length - 1] = { ...last, isStreaming: false };
      }
    }
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs, isGenerating: false, activeSkill: null } } };
  }),

  addToolStart: (id, exec) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages]; const last = msgs[msgs.length - 1];
    if (last?.role === "assistant") {
      // 把当前累积的 thinking 快照到新工具上，然后重置缓冲——实现思考-工具交替
      const currentThinking = (last.thinking || "").trim();
      const tool: ToolExecution = { toolCallId: exec.toolCallId, tool: exec.tool ?? "unknown", input: exec.input, status: "running", precedingThinking: currentThinking || undefined };
      msgs[msgs.length - 1] = { ...last, thinking: "", tools: [...(last.tools || []), tool] };
    }
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
  }),

  updateToolEnd: (id, toolCallId, result, isError, debug) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant" && last.tools) {
      msgs[msgs.length - 1] = { ...last, tools: last.tools.map(t => t.toolCallId === toolCallId ? { ...t, output: result, isError, status: isError ? "error" : "done", durationMs: debug?.durationMs, startTs: debug?.startTs, partialOutput: undefined } as ToolExecution : t) };
    }
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
  }),

  appendToolPartial: (id, toolCallId, delta) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant" && last.tools) {
      msgs[msgs.length - 1] = {
        ...last,
        tools: last.tools.map(t =>
          t.status === "running"
            ? { ...t, partialOutput: (t.partialOutput || "") + delta }
            : t
        ),
      };
    }
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
  }),

  addSkillUsed: (id, skill) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages]; const last = msgs[msgs.length - 1];
    if (last?.role === "assistant") {
      const existing = last.skillsUsed || [];
      // 去重：同名的 skill 不重复添加
      if (!existing.some(sk => sk.name === skill.name)) {
        msgs[msgs.length - 1] = { ...last, skillsUsed: [...existing, skill] };
      }
    }
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
  }),

  setRetryStatus: (id, status) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, retryStatus: status } } };
  }),

  setAutopilotState: (id, state) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, autopilot: state, isGenerating: true } } };
  }),

  setAutopilotStream: (id, phase, snippet) => set((s) => {
    const sess = s.sessions[id]; if (!sess || !sess.autopilot) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, autopilot: { ...sess.autopilot, phase, stream: snippet } } } };
  }),

  finishAutopilot: (id, summary) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages];
    // 把 autopilot 结果作为一条 assistant 消息注入
    msgs.push({ id: `a-${msgCounter++}`, role: "assistant", content: summary, tools: [] });
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs, autopilot: null, isGenerating: false } } };
  }),

  addDebugLLM: (id, evt) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant") {
      // 快照当前累积的 thinking 到本次 LLM 调用记录
      // 正常时序：thinking_delta → message_end(addDebugLLM) → tool_execution_start(清空 thinking)
      // 异常时序（SDK 事件乱序 / 会话重放）：tool_execution_start 先于 message_end 到达，
      //   thinking 已被切到 tool.precedingThinking 并清空 msg.thinking → 回退取最后一个工具的 precedingThinking
      let thinking = (last.thinking || "").trim();
      if (!thinking && last.tools?.length) {
        const lastTool = last.tools[last.tools.length - 1];
        thinking = (lastTool.precedingThinking || "").trim();
      }
      // 补匹配 pending raw：llm_raw 可能先于此事件到达
      let rawRequest: any | undefined;
      let rawResponse: any | undefined;
      const pending = pendingRaws.get(id);
      if (pending && pending.length) {
        const evtTs = evt.startTs;
        let bestIdx = -1, bestDiff = Infinity;
        for (let j = 0; j < pending.length; j++) {
          if (evtTs == null) { bestIdx = j; break; }
          const diff = Math.abs(evtTs - (pending[j].timestamp ?? 0));
          if (diff < bestDiff) { bestDiff = diff; bestIdx = j; }
        }
        // 5s 内视为同一次调用
        if (bestIdx >= 0 && (evtTs == null || bestDiff < 5000)) {
          const r = pending.splice(bestIdx, 1)[0];
          rawRequest = { url: r.url, method: r.method, headers: r.headers, body: r.body };
          rawResponse = { body: r.respBody, durationMs: r.durationMs };
          if (!pending.length) pendingRaws.delete(id);
        }
      }
      msgs[msgs.length - 1] = { ...last, debugEvents: [...(last.debugEvents || []), { ...evt, thinking: thinking || undefined, rawRequest, rawResponse }] };
    }
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
  }),

  // ── 子 agent（delegate_task）状态 ──
  addSubagent: (id, sub) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    // 去重：同一 subId 不重复添加（SSE 重连可能重放事件）
    if (sess.subagents.some(sa => sa.subId === sub.subId)) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, subagents: [...sess.subagents, sub] } } };
  }),
  updateSubagentProgress: (id, subId, tool) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, subagents: sess.subagents.map(sa => sa.subId === subId ? { ...sa, currentTool: tool, toolCount: sa.toolCount + 1 } : sa) } } };
  }),
  finishSubagent: (id, subId, result) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, subagents: sess.subagents.map(sa => sa.subId === subId ? { ...sa, status: result.status, summary: result.summary, tokens: result.tokens, tokenBreakdown: result.tokenBreakdown, durationMs: result.durationMs, error: result.error, sdkSessionFile: result.sdkSessionFile, currentTool: undefined } : sa) } } };
  }),
  // 把子 agent 的实时事件累积成 messages（结构同主会话，复用 MessageItem 渲染）
  applySubagentEvent: (id, subId, event) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    let touched = false;
    const subagents = sess.subagents.map(sa => {
      if (sa.subId !== subId) return sa;
      touched = true;
      // 调试日志：追踪事件路由（排查子 agent messages 串台问题）
      if (event.type === "agent_start" || event.type === "agent_end") {
        console.log(`[subagent-event] ${subId.slice(-8)} ${event.type} | msgs before: ${(sa.messages||[]).length}`);
      }
      const msgs = [...(sa.messages || [])];
      let subMsgCounter = msgs.length;
      switch (event.type) {
        case "agent_start":
          // 子 agent 回合开始：创建一条 assistant 消息（复用主会话的流式结构）
          msgs.push({ id: `subm-${subId}-${subMsgCounter}`, role: "assistant", content: "", isStreaming: true, thinking: "", tools: [] });
          break;
        case "message_update": {
          if (!event.delta) break;
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && last.isStreaming) msgs[msgs.length - 1] = { ...last, content: last.content + event.delta };
          break;
        }
        case "thinking_delta": {
          if (!event.delta) break;
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, thinking: (last.thinking || "") + event.delta };
          break;
        }
        case "message_end": {
          // 记录本次 LLM 调用的 token 明细 + 耗时（与主会话 addDebugLLM 同构）
          // 只记录带 usage 的真实调用（SDK 对部分 provider 会多发空 message_end）
          if (!event.usage) break;
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            // 快照当前 thinking（正常时序：thinking → message_end → tool_start 清空）
            let thinking = (last.thinking || "").trim();
            if (!thinking && last.tools?.length) {
              thinking = (last.tools[last.tools.length - 1].precedingThinking || "").trim();
            }
            const evt: DebugLLMEvent = {
              type: "llm",
              model: event.model,
              usage: event.usage,
              durationMs: event.debug?.llmDurationMs,
              firstTokenMs: event.debug?.firstTokenMs,
              startTs: event.debug?.startTs,
              endTs: event.debug?.endTs,
              thinking: thinking || undefined,
            };
            msgs[msgs.length - 1] = { ...last, debugEvents: [...(last.debugEvents || []), evt] };
          }
          break;
        }
        case "tool_execution_start": {
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            const ct = (last.thinking || "").trim();
            msgs[msgs.length - 1] = { ...last, thinking: "", tools: [...(last.tools || []), { toolCallId: event.toolCallId, tool: event.tool, input: event.input, status: "running", precedingThinking: ct || undefined, startTs: event.debug?.startTs ?? Date.now() }] };
          }
          break;
        }
        case "tool_execution_end": {
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && last.tools) msgs[msgs.length - 1] = { ...last, tools: last.tools.map(t => t.toolCallId === event.toolCallId ? { ...t, output: event.result, isError: event.isError, status: event.isError ? "error" : "done", durationMs: event.debug?.durationMs, startTs: event.debug?.startTs ?? t.startTs } : t) };
          break;
        }
        case "agent_end": {
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && last.isStreaming) {
            // 子 agent 结束：只关闭 streaming 状态，不把 thinking 提升为 content。
            // 子 agent 的 thinking 是内部推理（执行计划、方案分析），不是给用户看的正文。
            msgs[msgs.length - 1] = { ...last, isStreaming: false };
          }
          break;
        }
      }
      return { ...sa, messages: msgs };
    });
    if (!touched) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, subagents } } };
  }),
  setSubagents: (id, subs) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, subagents: subs } } };
  }),

  removeLastAssistant: (id) => {
    let lastUserText: string | null = null;
    set((s) => {
      const sess = s.sessions[id]; if (!sess) return {};
      const msgs = [...sess.messages];
      // 从末尾找最后一条 assistant 消息并删除
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs.splice(i, 1);
          break;
        }
      }
      // 找最后一条 user 消息的文本（用于重新发送）
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "user") {
          lastUserText = msgs[i].content;
          break;
        }
      }
      return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
    });
    return lastUserText;
  },

  attachRawLLM: (id, raw) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages];
    // 找最后一条 assistant 消息
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") {
        const msg = msgs[i];
        let events = [...(msg.debugEvents || [])];
        // llm_raw 是异步收集完整个 SSE 流后才发出的，可能延迟到下一个
        // debugEvent 创建之后才到达。用时间戳匹配：raw.timestamp（fetch 发起
        // 时间）与 debugEvent.startTs（message_start 时间）只差几十 ms，找最
        // 接近且还没 rawRequest 的。
        const rawTs = raw.timestamp ?? Date.now();
        let bestIdx = -1;
        let bestDiff = Infinity;
        for (let j = 0; j < events.length; j++) {
          if (events[j].rawRequest) continue; // 已有 raw，跳过
          const evtTs = events[j].startTs;
          if (evtTs == null) { if (bestIdx < 0) bestIdx = j; continue; }
          const diff = Math.abs(evtTs - rawTs);
          if (diff < bestDiff) { bestDiff = diff; bestIdx = j; }
        }
        if (bestIdx >= 0) {
          events = events.map((e, j) => j === bestIdx ? {
            ...e,
            rawRequest: { url: raw.url, method: raw.method, headers: raw.headers, body: raw.body },
            rawResponse: { body: raw.respBody, durationMs: raw.durationMs },
          } : e);
          msgs[i] = { ...msg, debugEvents: events };
        } else {
          // 没有可匹配的 event（message_end 可能还没到）→ 暂存，等 addDebugLLM 补匹配
          const arr = pendingRaws.get(id) || [];
          arr.push({ url: raw.url, method: raw.method, headers: raw.headers, body: raw.body, respBody: raw.respBody, durationMs: raw.durationMs, timestamp: raw.timestamp });
          pendingRaws.set(id, arr);
        }
        break;
      }
    }
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
  }),

  setQueuedMessages: (id, queues) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, steeringQueue: queues.steering, followUpQueue: queues.followUp } } };
  }),
}));
