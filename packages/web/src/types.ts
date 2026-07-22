// ─── 类型定义 ─────────────────────────────────────────

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export interface ToolExecution {
  id: string;
  tool: string;
  input?: string;
  output?: string;
  status: "running" | "done" | "error";
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

// ── WebSocket 消息类型 ──
export interface WSMessage {
  type: string;
  sessionId?: string;
  payload?: any;
  ts?: number;
}
