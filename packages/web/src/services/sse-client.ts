// sse-client.ts — SSE + REST API 客户端（替代 ws-client.ts）
//
// EventSource 接收服务端事件，fetch POST 发送命令。
// 浏览器原生 EventSource 自动重连，无需手写 reconnect 逻辑。

import { useChatStore } from "../stores/chat";

type MessageHandler = (msg: any) => void;

class SSEClient {
  private eventSource: EventSource | null = null;
  private handler: MessageHandler | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private firstConnect = true;
  // SSE 断线后需要重建的 agent 列表
  private knownAgents = new Map<string, { cwd?: string; agentId?: string }>();

  connect() {
    if (this.eventSource?.readyState === EventSource.OPEN) return;

    console.log("[sse] connecting to /api/events");
    this.eventSource = new EventSource("/api/events");

    this.eventSource.onopen = () => {
      console.log("[sse] connected" + (this.firstConnect ? "" : " (reconnect)"));
      useChatStore.getState().setConnected(true);

      // 重连后：后端 agent 可能已被销毁（进程重启），需对所有已创建的会话重建 agent
      if (!this.firstConnect) {
        const { sessions } = useChatStore.getState();
        let rebuilt = 0;
        for (const sid of Object.keys(sessions)) {
          if (sessions[sid].agentCreated) {
            useChatStore.getState().setAgentCreated(sid, []);
            const info = this.knownAgents.get(sid);
            this.createAgent(sid, { cwd: info?.cwd, agentId: info?.agentId ?? sessions[sid].agentId });
            rebuilt++;
          }
        }
        if (rebuilt > 0) console.log(`[sse] reconnect: rebuilt ${rebuilt} agent(s)`);
      }
      this.firstConnect = false;
    };

    this.eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // 忽略 connected / heartbeat 等内部事件
        if (msg.type === "connected") return;
        this.handler?.(msg);
      } catch (err) {
        console.error("[sse] parse error:", err);
      }
    };

    this.eventSource.onerror = () => {
      console.log("[sse] connection error, will auto-reconnect");
      useChatStore.getState().setConnected(false);
      // EventSource 浏览器会自动重连，但如果 readyState 是 CLOSED 说明彻底断了
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    };
  }

  // ── REST API 命令 ──

  async createAgent(chatSessionId: string, opts?: { cwd?: string; agentId?: string }) {
    this.knownAgents.set(chatSessionId, { cwd: opts?.cwd, agentId: opts?.agentId });
    try {
      await fetch(`/api/agent/${encodeURIComponent(chatSessionId)}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: opts?.cwd, agentId: opts?.agentId }),
      });
    } catch (err) {
      console.error("[sse] createAgent failed:", err);
    }
  }

  async prompt(chatSessionId: string, message: string, images?: unknown, thinking?: boolean) {
    try {
      await fetch(`/api/agent/${encodeURIComponent(chatSessionId)}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, images, thinking }),
      });
    } catch (err) {
      console.error("[sse] prompt failed:", err);
    }
  }

  async abort(chatSessionId: string) {
    try {
      await fetch(`/api/agent/${encodeURIComponent(chatSessionId)}/abort`, { method: "POST" });
    } catch (err) {
      console.error("[sse] abort failed:", err);
    }
  }

  async askResponse(chatSessionId: string, toolCallId: string, values: string[], labels: string[]) {
    try {
      await fetch(`/api/agent/${encodeURIComponent(chatSessionId)}/ask-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId, values, labels }),
      });
    } catch (err) {
      console.error("[sse] askResponse failed:", err);
    }
  }

  async destroyAgent(chatSessionId: string) {
    this.knownAgents.delete(chatSessionId);
    try {
      await fetch(`/api/agent/${encodeURIComponent(chatSessionId)}`, { method: "DELETE" });
    } catch (err) {
      console.error("[sse] destroyAgent failed:", err);
    }
  }

  onMessage(handler: MessageHandler) {
    this.handler = handler;
  }

  get connected() {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}

export const sseClient = new SSEClient();
