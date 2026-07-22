// hooks/useChat.ts — 修复：一个 agent 回合只创建一条消息

import { useEffect, useCallback } from "react";
import { wsClient } from "../services/ws-client";
import { useChatStore } from "../stores/chat";

let eventsBound = false;

// 防重复发送 guard：记录最近一次发送，相同内容在短时间内的重复调用会被忽略
let lastSentText = "";
let lastSentTime = 0;

export function useChat() {
  const store = useChatStore();

  useEffect(() => {
    if (eventsBound) return;
    eventsBound = true;
    wsClient.connect();

    wsClient.onMessage((msg) => {
      const chat = useChatStore.getState();
      (window as any).__chatStore = useChatStore;
      const sid = msg.chatSessionId;

      switch (msg.type) {
        case "agent_created":
          if (sid) chat.setAgentCreated(sid, msg.payload?.skills, msg.payload?.model);
          break;

        // agent 回合开始：创建唯一一条 assistant 消息
        case "agent_start":
          if (sid) chat.startAssistantMessage(sid);
          break;

        // agent 回合结束：收尾 + 持久化
        case "agent_end":
          if (sid) { chat.finishAssistantMessage(sid); saveReply(sid); }
          break;

        // message_start/end：回合内不建新消息
        case "message_start":
          break;

        case "message_update":
          if (sid) {
            const d = typeof msg.payload?.delta === "string" ? msg.payload.delta
              : typeof msg.payload?.text === "string" ? msg.payload.text : "";
            if (d) chat.appendDelta(sid, d);
          }
          break;

        case "thinking_delta":
          if (sid && typeof msg.payload?.delta === "string") chat.appendThinking(sid, msg.payload.delta);
          break;

        case "message_end":
          break; // 不做 finish，等 agent_end

        case "tool_execution_start":
          if (sid) chat.addToolStart(sid, { toolCallId: msg.payload.toolCallId, tool: msg.payload.tool, input: msg.payload.input });
          break;
        case "tool_execution_end":
          if (sid) chat.updateToolEnd(sid, msg.payload.toolCallId, msg.payload.result, msg.payload.isError);
          break;

        case "usage_update":
          if (sid && msg.payload) chat.setUsage(sid, msg.payload);
          break;

        case "error":
          console.error("[agent error]", msg.payload);
          if (sid) {
            // 确保有一条 assistant message 来显示错误
            const s = useChatStore.getState().sessions[sid];
            const last = s?.messages[s.messages.length - 1];
            if (!last || last.role !== "assistant" || !last.isStreaming) {
              chat.startAssistantMessage(sid);
            }
            chat.appendDelta(sid, `> Error: ${msg.payload?.message}`);
            chat.finishAssistantMessage(sid);
          }
          break;
      }
    });
  }, []);

  const createChatSession = useCallback((chatSessionId: string, cwd?: string) => {
    useChatStore.getState().ensureSession(chatSessionId);
    useChatStore.getState().setActiveChatSession(chatSessionId);
    wsClient.send({ type: "create_agent", chatSessionId, payload: { cwd } });
  }, []);

  const switchToSession = useCallback((chatSessionId: string) => {
    useChatStore.getState().setActiveChatSession(chatSessionId);
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    // 防重复：相同内容在 800ms 内只处理一次（应对输入法/双击等时序竞态）
    const now = Date.now();
    if (text === lastSentText && now - lastSentTime < 800) {
      console.warn("[chat] duplicate send suppressed:", text.slice(0, 30));
      return;
    }
    lastSentText = text;
    lastSentTime = now;

    const chat = useChatStore.getState();
    const sid = chat.activeChatSessionId; if (!sid) return;
    const sess = chat.sessions[sid]; if (!sess || sess.isGenerating) return;

    // 获取当前工作空间路径（用于后端 auto-create agent）
    const ws = (window as any).__wsStore?.getState?.() ?? (window as any).__wsStore;
    const activeWs = ws?.workspaces?.find((w: any) => w.id === ws?.activeId);
    const cwd = activeWs?.path;

    const isFirst = sess.messages.length === 0;

    chat.addUserMessage(sid, text);

    if (ws?.activeSessionId) {
      fetch(`/api/sessions/${ws.activeSessionId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: text }),
      });
      if (isFirst) {
        const title = text.slice(0, 30) + (text.length > 30 ? "..." : "");
        fetch(`/api/sessions/${ws.activeSessionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
        ws.updateSession(ws.activeSessionId, { title });
      }
    }
    // prompt 带 cwd，后端会在 agent 不存在时自动创建
    wsClient.send({ type: "prompt", chatSessionId: sid, payload: { message: text, cwd } });
  }, []);

  const abort = useCallback(() => {
    const sid = useChatStore.getState().activeChatSessionId;
    if (sid) wsClient.send({ type: "abort", chatSessionId: sid });
  }, []);

  const loadSession = useCallback(async (chatSessionId: string, appSessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${appSessionId}`);
      const data = await res.json();
      if (!res.ok) return;

      const chat = useChatStore.getState();
      chat.ensureSession(chatSessionId);
      chat.loadMessages(chatSessionId, (data.messages || []).map((m: any) => ({ id: m.id, role: m.role, content: m.content })));
      if (!(window as any).__chatToAppSession) (window as any).__chatToAppSession = {};
      (window as any).__chatToAppSession[chatSessionId] = appSessionId;

      // 重新读取 store（前面的 set 已更新 state，旧 chat 引用是 stale 的）
      const fresh = useChatStore.getState();
      const sess = fresh.sessions[chatSessionId];
      if (sess && !sess.agentCreated) wsClient.send({ type: "create_agent", chatSessionId, payload: {} });
      fresh.setActiveChatSession(chatSessionId);
    } catch (e) { console.error("Failed to load session:", e); }
  }, []);

  const activeId = store.activeChatSessionId;
  const activeSession = activeId ? store.sessions[activeId] : null;

  return {
    messages: activeSession?.messages ?? [],
    isGenerating: activeSession?.isGenerating ?? false,
    skills: activeSession?.skills ?? [],
    skillsNotified: activeSession?.skillsNotified ?? false,
    modelInfo: activeSession?.modelInfo ?? null,
    usage: activeSession?.usage ?? null,
    connected: store.connected,
    activeChatSessionId: activeId,
    createChatSession,
    switchToSession,
    sendMessage,
    abort,
    loadSession,
  };
}

function saveReply(chatSessionId: string) {
  const ws = (window as any).__wsStore?.getState?.() ?? (window as any).__wsStore;
  const map = (window as any).__chatToAppSession;
  const appSessionId = map?.[chatSessionId] ?? ws?.activeSessionId;
  if (!appSessionId) return;
  const sess = useChatStore.getState().sessions[chatSessionId];
  if (!sess) return;
  const last = sess.messages[sess.messages.length - 1];
  if (last?.role === "assistant" && last.content) {
    fetch(`/api/sessions/${appSessionId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "assistant", content: last.content }),
    });
  }
}
