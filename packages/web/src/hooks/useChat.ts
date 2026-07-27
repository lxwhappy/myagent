// hooks/useChat.ts — 修复：一个 agent 回合只创建一条消息
// delta 缓冲：GLM 等 API 可能一次性 dump 大量 token（burst），
// 用 requestAnimationFrame 渐进释放，让用户看到平滑的流式效果。

import { useEffect, useCallback } from "react";
import { sseClient } from "../services/sse-client";
import { useChatStore } from "../stores/chat";
import { useWorkspaceStore } from "../stores/workspace";
import { useAgentsStore } from "../stores/agents";
import { playCompletionSound } from "../hooks/useAudio";

let eventsBound = false;

// 防重复发送 guard：记录最近一次发送，相同内容在短时间内的重复调用会被忽略
let lastSentText = "";
let lastSentTime = 0;

// ── 流式存盘系统 ──
// 流式过程中 debounce(2s) 把 thinking+tools+subagents+content upsert 到服务端，
// 这样刷新后能恢复"生成中"状态（思考过程、工具调用、子 agent 进度不丢）。
// agent_end 时 saveReply 会做最终存盘（isStreaming=false）。
const streamingPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const STREAMING_PERSIST_INTERVAL = 2000;

function scheduleStreamingPersist(chatSessionId: string) {
  // 已有定时器 → 等它到期（debounce）
  if (streamingPersistTimers.has(chatSessionId)) return;
  const timer = setTimeout(() => {
    streamingPersistTimers.delete(chatSessionId);
    persistStreamingState(chatSessionId);
  }, STREAMING_PERSIST_INTERVAL);
  streamingPersistTimers.set(chatSessionId, timer);
}

function persistStreamingState(chatSessionId: string) {
  const store = useChatStore.getState();
  const sess = store.sessions[chatSessionId];
  if (!sess) return;
  const last = sess.messages[sess.messages.length - 1];
  if (!last || last.role !== "assistant" || !last.isStreaming) return;

  // 映射到 appSessionId
  const map = (window as any).__chatToAppSession;
  const ws = (window as any).__wsStore?.getState?.() ?? (window as any).__wsStore;
  const appSessionId = map?.[chatSessionId] ?? ws?.activeSessionId;
  if (!appSessionId) return;

  const body: any = {
    id: last.id,
    role: "assistant",
    content: last.content,
    isStreaming: true,
  };
  if (last.thinking) body.thinking = last.thinking;
  if (last.tools && last.tools.length) body.tools = last.tools;
  if (last.skillsUsed && last.skillsUsed.length) body.skillsUsed = last.skillsUsed;
  if (sess.subagents && sess.subagents.length) {
    body.subagents = sess.subagents.map(sa => ({
      subId: sa.subId, goal: sa.goal, status: sa.status,
      toolCount: sa.toolCount, tokens: (sa.tokens as any)?.total ?? sa.tokens,
      durationMs: sa.durationMs, summary: sa.summary, error: sa.error, messages: sa.messages,
    }));
  }

  fetch(`/api/sessions/${appSessionId}/messages/upsert`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

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
const MIN_CHARS_PER_FRAME = 6;
const MAX_CHARS_PER_FRAME = 80;

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

    // 自适应释放速率：根据当前缓冲区大小动态计算每帧释放字符数
    // 目标是让大缓冲快速清完（不卡顿），小缓冲慢速释放（有打字感）
    // 不再区分 burst/非 burst —— GLM-4.7 的 delta 间隔不稳定，固定慢速会导致 2000 字要 11 秒
    const framesLeft = Math.ceil(FLUSH_TARGET_MS / 16.7);
    let charsPerFrame = Math.max(MIN_CHARS_PER_FRAME, Math.ceil(b.text.length / framesLeft));
    charsPerFrame = Math.min(charsPerFrame, MAX_CHARS_PER_FRAME);

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
          if (sid) {
            chat.setAgentCreated(sid, msg.payload?.skills, msg.payload?.model, msg.payload?.agent);
            if (msg.payload?.todos) chat.setTodos(sid, msg.payload.todos);
            // 同步会话的 agentId + 显示信息（来自服务端创建结果）
            if (msg.payload?.agent) chat.setSessionAgent(sid, msg.payload.agent.id, msg.payload.agent);
          }
          break;

        // agent 回合开始：创建唯一一条 assistant 消息
        case "agent_start":
          if (sid) { chat.startAssistantMessage(sid); scheduleStreamingPersist(sid); }
          break;

        // agent 回合结束：收尾 + 持久化 + 提示音
        case "agent_end":
          if (sid) {
            // 清除流式存盘定时器（saveReply 会做最终存盘）
            const t = streamingPersistTimers.get(sid); if (t) { clearTimeout(t); streamingPersistTimers.delete(sid); }
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
            if (d) { pushDelta(sid, d); scheduleStreamingPersist(sid); } // 缓冲 + RAF 渐进释放 + debounce 存盘
          }
          break;

        case "thinking_delta":
          if (sid && typeof msg.payload?.delta === "string") { chat.appendThinking(sid, msg.payload.delta); scheduleStreamingPersist(sid); }
          break;

        case "message_end":
          break; // 不做 finish，等 agent_end

        case "tool_execution_start":
          if (sid) { chat.addToolStart(sid, { toolCallId: msg.payload.toolCallId, tool: msg.payload.tool, input: msg.payload.input }); scheduleStreamingPersist(sid); }
          break;
        case "tool_execution_end":
          if (sid) { chat.updateToolEnd(sid, msg.payload.toolCallId, msg.payload.result, msg.payload.isError); scheduleStreamingPersist(sid); }
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

        case "todo_update":
          if (sid && msg.payload?.todos) chat.setTodos(sid, msg.payload.todos);
          break;

        // ── 子 agent（delegate_task 工具触发的隔离子任务）──
        case "subagent_start":
          if (sid && msg.payload) chat.addSubagent(sid, { subId: msg.payload.subId, goal: msg.payload.goal, status: "running", toolCount: 0 });
          break;
        case "subagent_progress":
          if (sid && msg.payload) chat.updateSubagentProgress(sid, msg.payload.subId, msg.payload.tool);
          break;
        case "subagent_end":
          if (sid && msg.payload) {
            const p = msg.payload;
            chat.finishSubagent(sid, p.subId, { status: p.error ? "error" : "done", summary: p.summary, tokens: p.tokens, durationMs: p.durationMs, error: p.error });
          }
          break;

        // ── 子 agent 完整事件流（供钻入查看执行过程）──
        case "subagent_event":
          if (sid && msg.payload) chat.applySubagentEvent(sid, msg.payload.subId, msg.payload.event);
          break;

        case "error":
          console.error("[agent error]", msg.payload);
          if (sid) {
            flushAllDeltas(sid);
            // abort 时后端发的 agent_unavailable：静默解锁，不显示错误文字
            if (msg.payload?.message === "agent_unavailable") {
              chat.forceResetGenerating(sid);
              break;
            }
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
    // 用当前选中的 Agent 预设创建（默认 agent 不附加 systemPrompt）
    const agentId = useAgentsStore.getState().activeAgentId;
    if (agentId && agentId !== "default") {
      const cfg = useAgentsStore.getState().getActive();
      useChatStore.getState().setSessionAgent(chatSessionId, agentId, { id: cfg.id, name: cfg.name, icon: cfg.icon });
    }
    sseClient.createAgent(chatSessionId, { cwd, agentId });
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
        sseClient.createAgent(sessionData.id, { cwd: targetWs.path, agentId: useAgentsStore.getState().activeAgentId });
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
    sseClient.prompt(sid!, text, images, useChatStore.getState().thinkingEnabled);
  }, []);

  const abort = useCallback(() => {
    const sid = useChatStore.getState().activeChatSessionId;
    if (!sid) return;
    sseClient.abort(sid);
    // 兜底：abort 后无论后端结果，强制解除生成状态
    // （agent 可能已被 destroy/重建，abort 对新 agent 是 no-op，不靠这个会卡死）
    setTimeout(() => useChatStore.getState().forceResetGenerating(sid), 200);
  }, []);

  // 切换当前会话使用的 Agent：记录选中项 + 销毁旧 agent session + 用新配置重建
  const switchAgent = useCallback(async (agentId: string) => {
    const cfg = useAgentsStore.getState().getById(agentId);
    if (!cfg) return;
    useAgentsStore.getState().setActive(agentId);

    const sid = useChatStore.getState().activeChatSessionId;
    if (!sid) return;
    const info = { id: cfg.id, name: cfg.name, icon: cfg.icon };
    useChatStore.getState().setSessionAgent(sid, agentId, info);

    // 销毁旧 agent（若正在生成，destroy 会 abort，但不会发 agent_end）
    // 立即强制重置生成状态，防止前端卡在"思考中"
    await sseClient.destroyAgent(sid);
    useChatStore.getState().forceResetGenerating(sid);
    useChatStore.getState().setAgentCreated(sid, []);
    const ws = useWorkspaceStore.getState();
    const activeWs = ws.workspaces.find(w => w.id === ws.activeId);
    sseClient.createAgent(sid, { cwd: activeWs?.path, agentId });
  }, []);

  const loadSession = useCallback(async (chatSessionId: string, appSessionId: string, forceCwd?: string) => {
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
      // 恢复完整消息：content + thinking + tools + skillsUsed + isStreaming（支持刷新回放）
      const restoredMsgs = (data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        thinking: m.thinking,
        tools: m.tools,
        skillsUsed: m.skillsUsed,
        isStreaming: m.isStreaming === true,  // 恢复"生成中"标记
      }));
      chat.loadMessages(chatSessionId, restoredMsgs);
      // 如果最后一条消息是流式中（刷新前 agent 还在跑），标记会话为 generating，
      // 这样 SSE 重连后后续 delta 会 appendDelta 到这条消息，agent_end 时正常收尾
      const lastMsg = restoredMsgs[restoredMsgs.length - 1];
      if (lastMsg?.isStreaming && lastMsg?.role === "assistant") {
        useChatStore.setState((s) => {
          const sess = s.sessions[chatSessionId];
          if (!sess) return {};
          return { sessions: { ...s.sessions, [chatSessionId]: { ...sess, isGenerating: true } } };
        });
      }
      // 从最后一条含 subagents 的 assistant 消息恢复子 agent 快照（支持刷新后钻入回放）
      const lastWithSubs = [...(data.messages || [])].reverse().find((m: any) => m.subagents && m.subagents.length);
      if (lastWithSubs) {
        chat.setSubagents(chatSessionId, lastWithSubs.subagents.map((sa: any) => ({
          subId: sa.subId,
          goal: sa.goal,
          status: sa.status,
          toolCount: sa.toolCount || 0,
          tokens: sa.tokens,
          durationMs: sa.durationMs,
          summary: sa.summary,
          error: sa.error,
          messages: sa.messages,
        })));
      }
      // 恢复上次保存的 usage（刷新后不丢失）
      if (data.lastUsage) chat.setUsage(chatSessionId, data.lastUsage);
      if (!(window as any).__chatToAppSession) (window as any).__chatToAppSession = {};
      (window as any).__chatToAppSession[chatSessionId] = appSessionId;

      // 重新读取 store（前面的 set 已更新 state，旧 chat 引用是 stale 的）
      const fresh = useChatStore.getState();
      const sess = fresh.sessions[chatSessionId];
      if (sess && (!sess.agentCreated || forceCwd)) {
        const cwd = forceCwd ?? (() => {
          const ws = useWorkspaceStore.getState();
          const activeWs = ws.workspaces.find(w => w.id === ws.activeId);
          return activeWs?.path;
        })();
        // 优先用该会话已绑定的 Agent，否则用当前选中的
        sseClient.createAgent(chatSessionId, { cwd, agentId: sess.agentId ?? useAgentsStore.getState().activeAgentId });
      }
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
    todos: activeSession?.todos ?? [],
    agent: activeSession?.agent ?? null,
    agentId: activeSession?.agentId ?? null,
    connected: store.connected,
    activeChatSessionId: activeId,
    createChatSession,
    switchToSession,
    sendMessage,
    abort,
    loadSession,
    switchAgent,
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
    // 存完整 assistant 消息（thinking + tools + skillsUsed + subagents），支持刷新回放
    const body: any = { role: "assistant", content: last.content, id: last.id };
    if (last.thinking) body.thinking = last.thinking;
    if (last.tools && last.tools.length) body.tools = last.tools;
    if (last.skillsUsed && last.skillsUsed.length) body.skillsUsed = last.skillsUsed;
    // 把会话级的 subagents 快照存在这条 assistant 消息上（刷新后恢复钻入视图）
    if (sess.subagents && sess.subagents.length) {
      body.subagents = sess.subagents.map(sa => ({
        subId: sa.subId,
        goal: sa.goal,
        status: sa.status,
        toolCount: sa.toolCount,
        tokens: (sa.tokens as any)?.total ?? sa.tokens,
        durationMs: sa.durationMs,
        summary: sa.summary,
        error: sa.error,
        messages: sa.messages,
      }));
    }
    fetch(`/api/sessions/${appSessionId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}
