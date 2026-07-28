// stores/chat.ts — 多会话状态（支持 thinking + skills）

import { create } from "zustand";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  thinking?: string;        // 思考过程
  tools?: ToolExecution[];  // 该消息关联的工具调用
  skillsUsed?: SkillUsage[]; // 该消息中加载的 Skills
  images?: AttachedImage[];  // 用户发送的图片（缩略图展示）
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
}

let msgCounter = 0;
const empty = (): SessionChatState => ({ messages: [], isGenerating: false, agentCreated: false, skills: [], skillsNotified: false, modelInfo: null, usage: null, activeSkill: null, todos: [], subagents: [] });

interface ChatStore {
  sessions: Record<string, SessionChatState>;
  activeChatSessionId: string | null;
  connected: boolean;
  thinkingEnabled: boolean;
  activeSubId: string | null;   // 当前钻入查看的子 agent id（null=主会话视图）

  setConnected: (v: boolean) => void;
  toggleThinking: () => void;
  setActiveSub: (subId: string | null) => void;
  setActiveChatSession: (id: string | null) => void;
  ensureSession: (id: string) => void;
  setAgentCreated: (id: string, skills?: SkillInfo[], modelInfo?: ModelInfo, agent?: AgentInfo) => void;
  setSessionAgent: (id: string, agentId: string, agent: AgentInfo) => void;
  removeSession: (id: string) => void;
  loadMessages: (id: string, messages: Message[]) => void;
  clearSession: (id: string) => void;
  setUsage: (id: string, usage: UsageInfo) => void;
  setActiveSkill: (id: string, skill: { name: string; path: string } | null) => void;
  setTodos: (id: string, todos: TodoItem[]) => void;
  addSubagent: (id: string, sub: SubagentState) => void;
  updateSubagentProgress: (id: string, subId: string, tool: string) => void;
  finishSubagent: (id: string, subId: string, result: { status: "done" | "error"; summary?: string; tokens?: number; tokenBreakdown?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; durationMs?: number; error?: string }) => void;
  applySubagentEvent: (id: string, subId: string, event: any) => void;
  setSubagents: (id: string, subs: SubagentState[]) => void;

  addUserMessage: (id: string, text: string, images?: AttachedImage[]) => void;
  startAssistantMessage: (id: string) => void;
  appendDelta: (id: string, delta: string) => void;
  appendThinking: (id: string, delta: string) => void;
  finishAssistantMessage: (id: string) => void;
  forceResetGenerating: (id: string) => void;
  addToolStart: (id: string, exec: Partial<ToolExecution> & { toolCallId: string }) => void;
  updateToolEnd: (id: string, toolCallId: string, result: unknown, isError: boolean) => void;
  addSkillUsed: (id: string, skill: SkillUsage) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: {},
  activeChatSessionId: null,
  connected: false,
  thinkingEnabled: (() => { try { return localStorage.getItem("myagent:thinking") === "1"; } catch { return false; } })(),
  activeSubId: null,

  setConnected: (v) => set({ connected: v }),
  setActiveSub: (subId) => set({ activeSubId: subId }),
  setActiveChatSession: (id) => set({ activeChatSessionId: id, activeSubId: null }),
  toggleThinking: () => set((s) => {
    const v = !s.thinkingEnabled;
    try { localStorage.setItem("myagent:thinking", v ? "1" : "0"); } catch {}
    return { thinkingEnabled: v };
  }),

  ensureSession: (id) => set((s) => s.sessions[id] ? {} : { sessions: { ...s.sessions, [id]: empty() } }),

  setAgentCreated: (id, skills, modelInfo, agent) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, agentCreated: true, skills: skills || [], modelInfo: modelInfo ?? sess.modelInfo, agent: agent ?? sess.agent } } };
  }),

  setSessionAgent: (id, agentId, agent) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, agentId, agent } } };
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
      const patch: any = { isStreaming: false };
      if (!last.content && last.thinking && last.thinking.trim()) {
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
    const tool: ToolExecution = { toolCallId: exec.toolCallId, tool: exec.tool ?? "unknown", input: exec.input, status: "running" };
    if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, tools: [...(last.tools || []), tool] };
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs } } };
  }),

  updateToolEnd: (id, toolCallId, result, isError) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    const msgs = [...sess.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant" && last.tools) {
      msgs[msgs.length - 1] = { ...last, tools: last.tools.map(t => t.toolCallId === toolCallId ? { ...t, output: result, isError, status: isError ? "error" : "done" } : t) };
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

  // ── 子 agent（delegate_task）状态 ──
  addSubagent: (id, sub) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, subagents: [...sess.subagents, sub] } } };
  }),
  updateSubagentProgress: (id, subId, tool) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, subagents: sess.subagents.map(sa => sa.subId === subId ? { ...sa, currentTool: tool, toolCount: sa.toolCount + 1 } : sa) } } };
  }),
  finishSubagent: (id, subId, result) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, subagents: sess.subagents.map(sa => sa.subId === subId ? { ...sa, status: result.status, summary: result.summary, tokens: result.tokens, tokenBreakdown: result.tokenBreakdown, durationMs: result.durationMs, error: result.error, currentTool: undefined } : sa) } } };
  }),
  // 把子 agent 的实时事件累积成 messages（结构同主会话，复用 MessageItem 渲染）
  applySubagentEvent: (id, subId, event) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    let touched = false;
    const subagents = sess.subagents.map(sa => {
      if (sa.subId !== subId) return sa;
      touched = true;
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
        case "tool_execution_start": {
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, tools: [...(last.tools || []), { toolCallId: event.toolCallId, tool: event.tool, input: event.input, status: "running" }] };
          break;
        }
        case "tool_execution_end": {
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && last.tools) msgs[msgs.length - 1] = { ...last, tools: last.tools.map(t => t.toolCallId === event.toolCallId ? { ...t, output: event.result, isError: event.isError, status: event.isError ? "error" : "done" } : t) };
          break;
        }
        case "agent_end": {
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && last.isStreaming) {
            // 正文空但 thinking 有内容时，把 thinking 当正文（同主会话逻辑）
            const patch: any = { isStreaming: false };
            if (!last.content && last.thinking && last.thinking.trim()) { patch.content = last.thinking.trim(); patch.thinking = ""; }
            msgs[msgs.length - 1] = { ...last, ...patch };
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
}));
