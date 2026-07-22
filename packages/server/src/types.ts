// ============================================================
// types.ts — 共享类型定义（前后端通用）
// ============================================================

/** WebSocket 传输的消息信封 */
export interface WSMessage {
  type: string;
  id?: string;          // 请求 ID（关联请求/响应）
  sessionId?: string;   // 会话 ID
  payload?: unknown;    // 数据
  ts?: number;          // 时间戳
}

// ── 客户端 → 服务端 的指令类型 ──

export interface PromptPayload {
  message: string;
  images?: Array<{ type: string; data: string; mimeType: string }>;
}

export interface SetModelPayload {
  provider: string;
  model: string;
}

export interface CompactPayload {
  prompt?: string;
}

// ── 服务端 → 客户端 的事件类型 ──

export interface MessageUpdatePayload {
  messageIndex: number;
  delta: string;
  role?: string;
}

export interface ToolExecutionPayload {
  tool: string;
  input?: unknown;
  output?: string;
  exitCode?: number;
}

export interface UsagePayload {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ErrorPayload {
  message: string;
  code?: number | string;
}
