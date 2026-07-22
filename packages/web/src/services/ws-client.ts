import { useChatStore } from "../stores/chat";

type MessageHandler = (msg: any) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private handler: MessageHandler | null = null;  // 只允许一个 handler
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private firstConnect = true;  // 首次连接 vs 重连
  private pendingQueue: any[] = [];  // 未连接时排队的消息

  constructor() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.url = `${proto}//${location.host}/ws`;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    console.log(`[ws] connecting to ${this.url}`);
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("[ws] connected" + (this.firstConnect ? "" : " (reconnect)"));
      useChatStore.getState().setConnected(true);

      // 重连后：后端 agent 已被销毁，需对所有已创建的会话重建 agent
      if (!this.firstConnect) {
        const { sessions } = useChatStore.getState();
        let rebuilt = 0;
        for (const sid of Object.keys(sessions)) {
          if (sessions[sid].agentCreated) {
            useChatStore.getState().setAgentCreated(sid, []);
            this.send({ type: "create_agent", chatSessionId: sid, payload: {} });
            rebuilt++;
          }
        }
        if (rebuilt > 0) console.log(`[ws] reconnect: rebuilt ${rebuilt} agent(s)`);
      }
      this.firstConnect = false;

      // flush 排队的消息（连接前 send 被排队的）
      if (this.pendingQueue.length > 0) {
        console.log(`[ws] flushing ${this.pendingQueue.length} queued message(s)`);
        for (const msg of this.pendingQueue) {
          this.ws?.send(JSON.stringify(msg));
        }
        this.pendingQueue = [];
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // 只调用唯一的 handler
        this.handler?.(msg);
      } catch (err) {
        console.error("[ws] parse error:", err);
      }
    };

    this.ws.onclose = () => {
      console.log("[ws] disconnected");
      useChatStore.getState().setConnected(false);
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (err) => {
      console.error("[ws] error:", err);
    };
  }

  send(msg: any) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      // 未连接时排队，连接成功后自动 flush（不再静默丢弃）
      this.pendingQueue.push(msg);
      console.warn(`[ws] not connected, queued ${msg.type} (${this.pendingQueue.length} pending)`);
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  // 只保留一个 handler，重复调用会替换
  onMessage(handler: MessageHandler) {
    this.handler = handler;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsClient = new WSClient();
