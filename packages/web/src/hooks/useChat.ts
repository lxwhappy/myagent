// hooks/useChat.ts — 修复：一个 agent 回合只创建一条消息
// delta 缓冲：GLM 等 API 可能一次性 dump 大量 token（burst），
// 用 requestAnimationFrame 渐进释放，让用户看到平滑的流式效果。

import { useEffect, useCallback } from "react";
import { sseClient } from "../services/sse-client";
import { useChatStore } from "../stores/chat";
import { playCompletionSound } from "../hooks/useAudio";

let eventsBound = false;

// 防重复发送 guard：记录最近一次发送，相同内容在短时间内的重复调用会被忽略
let lastSentText = "";
let lastSentTime = 0;

// ── Delta 缓冲系统 ──
// GLM-4.7 的 SSE 经常在 8s 静默后 7ms 内 dump 200+ 字符。
// 浏览器一帧(16ms)内收到全部 delta → 文字一次性闪现，看不到流式。
// 这里把 delta 先存入缓冲，用 RAF 每帧释放一部分，产生逐字流式视觉效果。
interface DeltaBuffer {
  text: string;
  rafId: number | null;
  lastUpdateTime: number; // 最近一次有新 delta 进入缓冲的时间
}
const deltaBuffers = new Map<string, DeltaBuffer>();
// 目标完成时间（ms）：burst 结束后剩余内容在此时长内释放完
const FLUSH_TARGET_MS = 600;
// 每帧最少/最多释放字符数
const MIN_CHARS_PER_FRAME = 3;
const MAX_CHARS_PER_FRAME = 50;

function pushDelta(sid: string, delta: string) {
  let buf = deltaBuffers.get(sid);
  if (!buf) {
    buf = { text: "", rafId: null, lastUpdateTime: 0 };
    deltaBuffers.set(sid, buf);
  }
  buf.text += delta;
  buf.lastUpdateTime = Date.now();
  if (buf.rafId === null) scheduleFlush(sid);
}

function scheduleFlush(sid: string) {
  const buf = deltaBuffers.get(sid);
  if (!buf || buf.rafId !== null) return;

  const flush = () => {
    const b = deltaBuffers.get(sid);
    if (!b) return;

    if (b.text.length === 0) {
      b.rafId = null;
      return;
    }

    // 自适应释放速率：缓冲越大，每帧释放越多（保证在 ~FLUSH_TARGET_MS 内完成）
    // 但如果最近有新 delta 涌入（burst 还在进行），保守一点别太快释放完
    const elapsed = Date.now() - b.lastUpdateTime;
    const isStillReceiving = elapsed < 100; // 100ms 内有新 delta = burst 进行中

    let charsPerFrame: number;
    if (isStillReceiving) {
      // burst 中：匀速释放，让用户看到正在输入
      charsPerFrame = MIN_CHARS_PER_FRAME;
    } else {
      // burst 结束：加速释放剩余内容
      const framesLeft = Math.ceil(FLUSH_TARGET_MS / 16.7);
      charsPerFrame = Math.max(MIN_CHARS_PER_FRAME, Math.ceil(b.text.length / framesLeft));
      charsPerFrame = Math.min(charsPerFrame, MAX_CHARS_PER_FRAME);
    }

    const chunk = b.text.slice(0, charsPerFrame);
    b.text = b.text.slice(charsPerFrame);

    useChatStore.getState().appendDelta(sid, chunk);

    if (b.text.length > 0) {
      b.rafId = requestAnimationFrame(flush);
    } else {
      b.rafId = null;
    }
  };

  buf.rafId = requestAnimationFrame(flush);
}

// 立即释放所有缓冲（用于 agent_end / error）
function flushAllDeltas(sid: string) {
  const buf = deltaBuffers.get(sid);
  if (!buf) return;
  if (buf.rafId !== null) {
    cancelAnimationFrame(buf.rafId);
    buf.rafId = null;
  }
  if (buf.text.length > 0) {
    useChatStore.getState().appendDelta(sid, buf.text);
    buf.text = "";
  }
}

export function useChat() {
  const store = useChatStore();

  useEffect(() => {
    if (eventsBound) return;
    eventsBound = true;
    sseClient.connect();

    sseClient.onMessage((msg) => {
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

        // agent 回合结束：收尾 + 持久化 + 提示音
        case "agent_end":
          if (sid) {
            flushAllDeltas(sid);
            chat.finishAssistantMessage(sid);
            saveReply(sid);
            playCompletionSound();
          }
          break;

        // message_start/end：回合内不建新消息
        case "message_start":
          break;

        case "message_update":
          if (sid) {
            const d = typeof msg.payload?.delta === "string" ? msg.payload.delta
              : typeof msg.payload?.text === "string" ? msg.payload.text : "";
            if (d) pushDelta(sid, d); // 缓冲 + RAF 渐进释放
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

        case "skill_used":
          if (sid && msg.payload) {
            chat.setActiveSkill(sid, msg.payload);
            chat.addSkillUsed(sid, msg.payload);
          }
          break;

        case "error":
          console.error("[agent error]", msg.payload);
          if (sid) {
            flushAllDeltas(sid);
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
    sseClient.createAgent(chatSessionId, { cwd });
  }, []);

  const switchToSession = useCallback((chatSessionId: string) => {
    useChatStore.getState().setActiveChatSession(chatSessionId);
  }, []);

  const sendMessage = useCallback(async (text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>) => {
    if (!text.trim() && !images?.length) return;
    // 防重复：相同内容在 800ms 内只处理一次（应对输入法/双击等时序竞态）
    const now = Date.now();
    if (text === lastSentText && !images && now - lastSentTime < 800) {
      console.warn("[chat] duplicate send suppressed:", text.slice(0, 30));
      return;
    }
    lastSentText = text;
    lastSentTime = now;

    let sid = useChatStore.getState().activeChatSessionId;

    // 兜底：如果没有活跃会话，尝试自动创建一个
    if (!sid) {
      const wsState = (window as any).__wsStore?.getState?.() ?? (window as any).__wsStore;
      const workspaces = wsState?.workspaces || [];
      const activeWs = wsState?.activeId ? workspaces.find((w: any) => w.id === wsState.activeId) : null;
      const targetWs = activeWs || workspaces[0];
      if (!targetWs) {
        alert("请先添加一个工作空间");
        return;
      }
      try {
        const res = await fetch(`/api/workspaces/${targetWs.id}/sessions`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        const sessionData = await res.json();
        if (!res.ok) { alert("创建会话失败: " + sessionData.error); return; }
        wsState.setActive(targetWs.id);
        wsState.addSession(targetWs.id, sessionData);
        wsState.setActiveSession(sessionData.id);
        useChatStore.getState().ensureSession(sessionData.id);
        useChatStore.getState().setActiveChatSession(sessionData.id);
        sseClient.createAgent(sessionData.id, { cwd: targetWs.path });
        sid = sessionData.id;
        if (!(window as any).__chatToAppSession) (window as any).__chatToAppSession = {};
        (window as any).__chatToAppSession[sessionData.id] = sessionData.id;
      } catch (e: any) {
        alert("创建会话失败: " + e.message);
        return;
      }
    }

    const sess = useChatStore.getState().sessions[sid!];
    if (!sess || sess.isGenerating) return;

    const isFirst = sess.messages.length === 0;
    useChatStore.getState().addUserMessage(sid!, text);

    const ws = (window as any).__wsStore?.getState?.() ?? (window as any).__wsStore;
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
    sseClient.prompt(sid!, text, images);
  }, []);

  const abort = useCallback(() => {
    const sid = useChatStore.getState().activeChatSessionId;
    if (sid) sseClient.abort(sid);
  }, []);

  const loadSession = useCallback(async (chatSessionId: string, appSessionId: string) => {
    try {
      // 正在生成的会话：内存中的状态比服务端更新，直接切换不重载
      const existing = useChatStore.getState().sessions[chatSessionId];
      if (existing?.isGenerating) {
        useChatStore.getState().setActiveChatSession(chatSessionId);
        return;
      }

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
      if (sess && !sess.agentCreated) sseClient.createAgent(chatSessionId);
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
    activeSkill: activeSession?.activeSkill ?? null,
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
