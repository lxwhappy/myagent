import type { WebSocket } from "ws";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export class EventBridge {
  bind(chatSessionId: string, session: AgentSession, ws: WebSocket): () => void {
    const send = (type: string, payload?: unknown) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type, chatSessionId, payload, ts: Date.now() }));
      }
    };

    const sendUsage = () => {
      try {
        const stats = session.getSessionStats();
        const ctx = session.getContextUsage();
        send("usage_update", {
          stats: {
            tokens: stats.tokens,
            cost: stats.cost,
            userMessages: stats.userMessages,
            assistantMessages: stats.assistantMessages,
            toolCalls: stats.toolCalls,
          },
          context: ctx ? {
            tokens: ctx.tokens,
            contextWindow: ctx.contextWindow,
            percent: ctx.percent,
          } : null,
        });
      } catch (e) {
        // 忽略 stats 获取失败
      }
    };

    const handler = (event: AgentSessionEvent) => {
      switch (event.type) {
        case "agent_start": send("agent_start"); break;
        case "agent_end": send("agent_end"); sendUsage(); break;
        case "message_start": break; // 忽略，agent_start 已创建消息
        case "message_end": break;   // 忽略，agent_end 会 finish

        case "message_update": {
          const ae = (event as any).assistantMessageEvent;
          if (!ae) break;

          // 只处理 text_delta — 真正的增量文本
          if (ae.type === "text_delta" && typeof ae.delta === "string") {
            send("message_update", { delta: ae.delta });
          }
          // thinking_delta — 思考过程增量
          else if (ae.type === "thinking_delta" && typeof ae.delta === "string") {
            send("thinking_delta", { delta: ae.delta });
          }
          // toolcall 事件全部忽略（不混入正文）
          // text_start/text_end/thinking_start/thinking_end/toolcall_* 全部忽略
          break;
        }

        case "tool_execution_start":
          send("tool_execution_start", {
            toolCallId: (event as any).toolCallId,
            tool: (event as any).toolName,
            input: (event as any).args,
          });
          break;
        case "tool_execution_update":
          send("tool_execution_update", {
            toolCallId: (event as any).toolCallId,
            partial: (event as any).partialResult,
          });
          break;
        case "tool_execution_end":
          send("tool_execution_end", {
            toolCallId: (event as any).toolCallId,
            tool: (event as any).toolName,
            result: (event as any).result,
            isError: (event as any).isError,
          });
          break;
      }
    };

    return session.subscribe(handler);
  }
}

export const eventBridge = new EventBridge();
