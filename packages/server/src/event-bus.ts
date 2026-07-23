// event-bus.ts — 全局事件总线
//
// Agent 事件通过这里广播给所有 SSE 连接。
// 每个事件携带 chatSessionId，前端按 ID 分发。

export type AgentEvent = {
  type: string;
  chatSessionId: string;
  payload?: unknown;
  ts: number;
};

type Listener = (event: AgentEvent) => void;
const listeners = new Set<Listener>();

export function emit(event: AgentEvent): void {
  for (const l of listeners) {
    try { l(event); } catch {}
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
