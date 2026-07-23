// event-bridge.ts — Agent 事件 → event-bus 桥接
//
// 将 AgentSession 的事件转换为前端可用的格式，通过 event-bus 广播。

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { emit } from "./event-bus.js";

export class EventBridge {
  bind(chatSessionId: string, session: AgentSession): () => void {
    const send = (type: string, payload?: unknown) => {
      emit({ type, chatSessionId, payload, ts: Date.now() });
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
      } catch {}
    };

    const handler = (event: AgentSessionEvent) => {
      switch (event.type) {
        case "agent_start": send("agent_start"); break;
        case "agent_end": send("agent_end"); sendUsage(); break;
        case "message_start": break;
        case "message_end": break;

        case "message_update": {
          const ae = (event as any).assistantMessageEvent;
          if (!ae) break;
          if (ae.type === "text_delta" && typeof ae.delta === "string") {
            send("message_update", { delta: ae.delta });
          } else if (ae.type === "thinking_delta" && typeof ae.delta === "string") {
            send("thinking_delta", { delta: ae.delta });
          }
          break;
        }

        case "tool_execution_start": {
          const toolName = (event as any).toolName;
          const args = (event as any).args;
          if (toolName === "read" && args) {
            const filePath = typeof args === "string" ? args : (args.path || args.filePath || "");
            if (typeof filePath === "string" && /SKILL\.md$/i.test(filePath)) {
              const parts = filePath.replace(/\/SKILL\.md$/i, "").split("/");
              const skillName = parts[parts.length - 1];
              send("skill_used", { name: skillName, path: filePath });
            }
          }
          send("tool_execution_start", {
            toolCallId: (event as any).toolCallId,
            tool: toolName,
            input: args,
          });
          break;
        }
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
