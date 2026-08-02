// event-bridge.ts — Agent 事件 → event-bus 桥接
//
// 将 AgentSession 的事件转换为前端可用的格式，通过 event-bus 广播。

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { emit } from "./event-bus.js";
import { chatSessionStore } from "./chat-sessions.js";
import { todoStore } from "./tools/index.js";

// 漂移检测阈值：连续 N 个非 todo 工具调用且未更新清单时，触发提醒
const DRIFT_THRESHOLD = 4;

export class EventBridge {
  bind(chatSessionId: string, session: AgentSession): () => void {
    const send = (type: string, payload?: unknown) => {
      emit({ type, chatSessionId, payload, ts: Date.now() });
    };

    // 漂移检测：连续非 todo 工具调用计数
    let nonTodoToolCount = 0;
    let driftReminded = false;

    // auto-advance：模型不可靠时兜底推进
    // - autoAdvance(): agent_start 时标记首个 pending 为 in_progress
    // - autoAdvance(true): 每个非 todo 工具完成后推进一格
    //   只推进 in_progress→completed，不会跳过未完成的任务
    async function autoAdvance(advance = false) {
      try {
        const todos = await todoStore.list(chatSessionId);
        if (todos.length === 0) return;
        const inProgress = todos.find((t: any) => t.status === "in_progress");
        const nextPending = todos.find((t: any) => t.status === "pending");

        if (advance && inProgress) {
          // 推进：当前 → completed，下一个 pending → in_progress
          await todoStore.update(chatSessionId, inProgress.id, { status: "completed" });
          if (nextPending) {
            await todoStore.update(chatSessionId, nextPending.id, { status: "in_progress" });
          }
        } else if (!inProgress && nextPending) {
          // 回合开始：标记首个 pending
          await todoStore.update(chatSessionId, nextPending.id, { status: "in_progress" });
        }
      } catch {}
    }

    // agent 结束时：剩余未完成的全部标记完成
    async function autoFinish() {
      try {
        const todos = await todoStore.list(chatSessionId);
        for (const t of todos) {
          if (t.status !== "completed") {
            await todoStore.update(chatSessionId, t.id, { status: "completed" });
          }
        }
      } catch {}
    }

    const sendUsage = () => {
      try {
        const stats = session.getSessionStats();
        const ctx = session.getContextUsage();
        const usage = {
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
        };
        send("usage_update", usage);
        // 持久化到会话文件，刷新后可恢复
        chatSessionStore.setUsage(chatSessionId, usage).catch(() => {});
      } catch {}
    };

    // ── Debug 计时追踪 ──
    // 记录每个 LLM 调用和工具调用的耗时，附带在事件 payload 里推给前端
    const llmTimings = new Map<string, { startTs: number; firstTokenTs?: number }>();
    const toolTimings = new Map<string, number>();

    const handler = async (event: AgentSessionEvent) => {
      switch (event.type) {
        case "agent_start": send("agent_start"); autoAdvance(); break;
        case "agent_end": send("agent_end"); autoFinish(); sendUsage(); break;
        case "message_start": {
          // 记录 LLM 调用开始时间（用服务器本地时间，和 message_end 的 Date.now() 一致）
          llmTimings.set("current", { startTs: Date.now() });
          break;
        }
        case "message_update": {
          const ae = (event as any).assistantMessageEvent;
          if (!ae) break;
          // 首个 text_delta 或 thinking_delta → 记录首 token 时间
          if ((ae.type === "text_delta" || ae.type === "thinking_delta") && typeof ae.delta === "string") {
            const t = llmTimings.get("current");
            if (t && !t.firstTokenTs) t.firstTokenTs = Date.now();
          }
          if (ae.type === "text_delta" && typeof ae.delta === "string") {
            send("message_update", { delta: ae.delta });
          } else if (ae.type === "thinking_delta" && typeof ae.delta === "string") {
            send("thinking_delta", { delta: ae.delta });
          }
          break;
        }
        case "message_end": {
          // 附带本次 LLM 调用的完整 token 明细 + 耗时
          const msg = (event as any).message;
          const t = llmTimings.get("current");
          const now = Date.now();
          const debug = t ? {
            startTs: t.startTs,
            endTs: now,
            llmDurationMs: now - t.startTs,
            firstTokenMs: t.firstTokenTs ? t.firstTokenTs - t.startTs : undefined,
          } : undefined;
          if (msg?.usage) {
            send("message_end", { usage: msg.usage, model: msg.model, debug });
          } else {
            send("message_end", { debug });
          }
          // API 调用日志：每次 LLM 调用结束打印模型 / token / 耗时
          {
            const u = msg?.usage;
            const dur = debug?.llmDurationMs;
            const durStr = dur != null ? (dur < 1000 ? `${dur}ms` : `${(dur / 1000).toFixed(1)}s`) : "—";
            const tokStr = u
              ? `↑${u.input ?? 0} ↓${u.output ?? 0}` +
                (u.cacheRead ? ` 🗄${u.cacheRead}` : "") +
                (u.reasoning ? ` 💭${u.reasoning}` : "") +
                (u.cost?.total ? ` $${u.cost.total.toFixed(4)}` : "")
              : "(无 usage)";
            console.log(`[llm] ${chatSessionId.slice(0, 8)} ${msg?.model || "?"} · ${durStr} · ${tokStr}`);
          }
          llmTimings.delete("current");
          sendUsage();  // 每条消息结束就更新累计用量
          break;
        }

        // ── 自动重试：SDK 在 API 失败时自动重试，转发给前端显示状态 ──
        case "auto_retry_start": {
          const e = event as any;
          console.log(`[retry] ${chatSessionId.slice(0, 8)} 自动重试 ${e.attempt}/${e.maxAttempts}，${e.delayMs}ms 后重试，错误: ${(e.errorMessage || "").slice(0, 80)}`);
          send("auto_retry_start", {
            attempt: e.attempt, maxAttempts: e.maxAttempts,
            delayMs: e.delayMs, errorMessage: e.errorMessage,
          });
          break;
        }
        case "auto_retry_end": {
          const e = event as any;
          if (!e.success) {
            console.log(`[retry] ${chatSessionId.slice(0, 8)} 重试失败（共 ${e.attempt} 次）: ${(e.finalError || "").slice(0, 80)}`);
          }
          send("auto_retry_end", { success: e.success, attempt: e.attempt, finalError: e.finalError });
          break;
        }

        case "compaction_start": {
          const reason = (event as any).reason;
          console.log(`\n========== [COMPACTION] START  session=${chatSessionId.slice(0, 8)}  reason=${reason} ==========`);
          send("compaction_start", { reason });
          break;
        }
        case "compaction_end": {
          const r = (event as any).result || {};
          const reason = (event as any).reason;
          const aborted = (event as any).aborted;
          const before = r.tokensBefore ?? "?";
          const after = r.estimatedTokensAfter ?? "?";
          const saved = (typeof before === "number" && typeof after === "number") ? `${Math.round((1 - after / before) * 100)}%` : "?";
          console.log(`========== [COMPACTION] END  session=${chatSessionId.slice(0, 8)}  reason=${reason}  aborted=${aborted} ==========`);
          console.log(`[COMPACTION] tokensBefore=${before}  estAfter=${after}  压缩率=${saved}`);
          if (r.summary) console.log(`[COMPACTION] 摘要预览(前300字):\n${(r.summary as string).slice(0, 300)}\n`);
          send("compaction_end", { reason, aborted, tokensBefore: before, estimatedTokensAfter: after, summary: r.summary });
          break;
        }

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
          const toolCallId = (event as any).toolCallId;
          const args = (event as any).args;
          toolTimings.set(toolCallId, Date.now());  // 记录工具开始时间
          if (toolName === "read" && args) {
            const filePath = typeof args === "string" ? args : (args.path || args.filePath || "");
            if (typeof filePath === "string" && /SKILL\.md$/i.test(filePath)) {
              const parts = filePath.replace(/\/SKILL\.md$/i, "").split("/");
              const skillName = parts[parts.length - 1];
              send("skill_used", { name: skillName, path: filePath });
            }
          }
          send("tool_execution_start", {
            toolCallId,
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
        case "tool_execution_end": {
          const toolName = (event as any).toolName;
          // 漂移检测：非 todo 工具计数
          if (toolName === "todo") {
            nonTodoToolCount = 0;
            driftReminded = false;
          } else {
            nonTodoToolCount++;
            // 非 todo 工具完成 → 自动推进任务状态
            autoAdvance(true);
          }
          let result = (event as any).result;
          // 漂移提醒：连续 N 个非 todo 工具且有未完成任务时，注入提醒到 result
          if (toolName !== "todo" && nonTodoToolCount >= DRIFT_THRESHOLD && !driftReminded) {
            try {
              const todos = await todoStore.list(chatSessionId);
              const unfinished = todos.filter((t: any) => t.status !== "completed");
              if (unfinished.length > 0) {
                const lines = unfinished.map((t: any) =>
                  `${t.status === "in_progress" ? "🔄" : "⬜"} ${t.content}`
                ).join("\n");
                const reminder = `\n\n⚠️ [任务提醒] 你已连续执行 ${nonTodoToolCount} 个操作但未更新任务清单。请检查进度并更新状态：\n${lines}`;
                // 安全拼接：只修改 result.content 的文本内容（SDK AgentToolResult 结构）
                if (result && typeof result === "object" && Array.isArray(result.content)) {
                  const firstText = result.content.find((c: any) => c.type === "text");
                  if (firstText && typeof firstText.text === "string") {
                    firstText.text += reminder;
                  } else {
                    result.content.push({ type: "text", text: reminder });
                  }
                } else if (typeof result === "string") {
                  result += reminder;
                } else {
                  result = { content: [{ type: "text", text: reminder }] };
                }
                driftReminded = true;
              }
            } catch {}
          }
          // 修正：bash 命令 exit 1 且无 stdout 输出 → 多为 grep/find 未匹配、test 条件不满足等，
          // 不是真正的执行错误，不应标记为 isError（否则前端显示 ✕ 误导用户）
          let isError = (event as any).isError;
          if (isError && result && typeof result === "object" && Array.isArray(result.content)) {
            const text = result.content.find((c: any) => c.type === "text")?.text ?? "";
            // 匹配 "(no output)" 后跟 exit code 1（实际格式含双换行 \n\n，之前正则只匹配单 \n 导致漏判）
            if (/^\(no output\)\s*\n+Command exited with code 1$/.test(text.trim())) {
              isError = false;
            }
          }
          const toolCallId = (event as any).toolCallId;
          const startTs = toolTimings.get(toolCallId);
          const now = Date.now();
          const durationMs = startTs ? now - startTs : undefined;
          toolTimings.delete(toolCallId);
          send("tool_execution_end", {
            toolCallId,
            tool: toolName,
            result,
            isError,
            debug: durationMs != null ? { startTs, endTs: now, durationMs } : undefined,
          });
          break;
        }
      }
    };

    return session.subscribe(handler);
  }
}

export const eventBridge = new EventBridge();
