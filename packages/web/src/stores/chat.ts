// stores/chat.ts — 多会话状态（支持 thinking + skills）

import { create } from "zustand";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  thinking?: string;        // 思考过程
  tools?: ToolExecution[];  // 该消息关联的工具调用
}

export interface ToolExecution {
  toolCallId: string;
  tool: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  status: "running" | "done" | "error";
}

export interface SkillInfo {
  name: string;
  description: string;
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

interface SessionChatState {
  messages: Message[];
  isGenerating: boolean;
  agentCreated: boolean;
  skills: SkillInfo[];
  skillsNotified: boolean;
  modelInfo: ModelInfo | null;
  usage: UsageInfo | null;
}

let msgCounter = 0;
const empty = (): SessionChatState => ({ messages: [], isGenerating: false, agentCreated: false, skills: [], skillsNotified: false, modelInfo: null, usage: null });

interface ChatStore {
  sessions: Record<string, SessionChatState>;
  activeChatSessionId: string | null;
  connected: boolean;

  setConnected: (v: boolean) => void;
  setActiveChatSession: (id: string | null) => void;
  ensureSession: (id: string) => void;
  setAgentCreated: (id: string, skills?: SkillInfo[], modelInfo?: ModelInfo) => void;
  removeSession: (id: string) => void;
  loadMessages: (id: string, messages: Message[]) => void;
  clearSession: (id: string) => void;
  setUsage: (id: string, usage: UsageInfo) => void;

  addUserMessage: (id: string, text: string) => void;
  startAssistantMessage: (id: string) => void;
  appendDelta: (id: string, delta: string) => void;
  appendThinking: (id: string, delta: string) => void;
  finishAssistantMessage: (id: string) => void;
  addToolStart: (id: string, exec: Partial<ToolExecution> & { toolCallId: string }) => void;
  updateToolEnd: (id: string, toolCallId: string, result: unknown, isError: boolean) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: {},
  activeChatSessionId: null,
  connected: false,

  setConnected: (v) => set({ connected: v }),
  setActiveChatSession: (id) => set({ activeChatSessionId: id }),

  ensureSession: (id) => set((s) => s.sessions[id] ? {} : { sessions: { ...s.sessions, [id]: empty() } }),

  setAgentCreated: (id, skills, modelInfo) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, agentCreated: true, skills: skills || [], modelInfo: modelInfo ?? sess.modelInfo } } };
  }),

  removeSession: (id) => set((s) => { const n = { ...s.sessions }; delete n[id]; return { sessions: n }; }),

  loadMessages: (id, messages) => set((s) => ({
    sessions: { ...s.sessions, [id]: { ...empty(), messages, agentCreated: s.sessions[id]?.agentCreated || false } },
  })),

  clearSession: (id) => set((s) => ({ sessions: { ...s.sessions, [id]: empty() } })),

  setUsage: (id, usage) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, usage } } };
  }),

  addUserMessage: (id, text) => set((s) => {
    const sess = s.sessions[id]; if (!sess) return {};
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: [...sess.messages, { id: `u-${msgCounter++}`, role: "user", content: text }] } } };
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
    return { sessions: { ...s.sessions, [id]: { ...sess, messages: msgs, isGenerating: false } } };
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
}));
