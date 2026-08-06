// tools/ask-tool.ts — ask_user 工具：让 Agent 向用户提问（选项交互）
//
// execute 阻塞等待用户在前端选择答案，agent loop 在此处暂停。
// 用户点击选项 → POST /api/agent/:id/ask-response → resolve pending Promise → execute 返回答案。
// 核心机制：SDK agent loop 会 await execute 的 Promise，所以 pending 期间模型不会继续生成。

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { emit } from "../event-bus.js";

interface PendingAsk {
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

// key: `${chatSessionId}:${toolCallId}` → pending promise
const pending = new Map<string, PendingAsk>();

const TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟无回答自动放弃

/** 用户提交答案（由 REST 端点调用） */
export function resolveAsk(
  chatSessionId: string,
  toolCallId: string,
  values: string[],
  labels: string[],
): boolean {
  const key = `${chatSessionId}:${toolCallId}`;
  const p = pending.get(key);
  if (!p) return false;
  clearTimeout(p.timeoutTimer);
  clearInterval(p.heartbeatTimer);
  pending.delete(key);
  if (values.length === 1) {
    p.resolve(`用户选择了「${labels[0]}」（值: ${values[0]}）`);
  } else {
    const list = labels.map((l, i) => `${l}（${values[i]}）`).join("、");
    p.resolve(`用户选择了 ${values.length} 项：${list}`);
  }
  return true;
}

/** 中止该会话所有 pending ask（agent abort / 销毁时调用） */
export function abortAsks(chatSessionId: string) {
  for (const [key, p] of pending) {
    if (key.startsWith(`${chatSessionId}:`)) {
      clearTimeout(p.timeoutTimer);
      clearInterval(p.heartbeatTimer);
      pending.delete(key);
      p.reject(new Error("用户已中止"));
    }
  }
}

export function createAskUserTool(chatSessionId: string): ToolDefinition {
  return {
    name: "ask_user",
    label: "ASK",
    description:
      "向用户提问并等待回答。当你需要澄清需求、确认选项、或让用户做决定时调用。" +
      "用户会在界面上看到问题和选项按钮，点击后你会收到答案。" +
      "question 要简洁；options 每项有 label（显示文字）和 value（实际值）。" +
      "通常 2-5 个选项，不要太多。multiple=true 时允许多选，用户勾选后点确认提交。" +
      "每个选项可设 recommended=true 标记你推荐的选项——单选标 1 个推荐项，" +
      "多选标记你推荐的全选组合。推荐项会在界面上高亮显示，帮助用户快速决策。",
    promptSnippet: "- ask_user: 向用户提问（澄清需求/确认选项时使用，支持单选/多选，选项可标记 recommended 推荐项）",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "要问用户的问题（简洁明了）" },
        multiple: { type: "boolean", description: "是否允许多选，默认 false（单选）" },
        options: {
          type: "array",
          description: "可选的选项列表（2-5 个）",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "选项显示文字" },
              value: { type: "string", description: "选项实际值" },
              description: { type: "string", description: "选项的补充说明（可选）" },
              recommended: { type: "boolean", description: "是否为推荐选项（默认 false）。单选标 1 个，多选标记推荐组合" },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["question", "options"],
    },

    async execute(toolCallId: string, params: any) {
      const question = params?.question as string;
      const options = params?.options as Array<{
        label: string;
        value: string;
        description?: string;
      }>;

      if (!question || !options || !Array.isArray(options) || options.length === 0) {
        const text = JSON.stringify({ error: "缺少 question 或 options" });
        return { content: [{ type: "text" as const, text }], output: text, summary: "❌ 参数缺失" };
      }

      // 阻塞等待用户回答
      const answerText: string = await new Promise<string>((resolve, reject) => {
        const key = `${chatSessionId}:${toolCallId}`;

        // 心跳保活：防止 sse-gateway 的 idle 超时（3 分钟无事件）误杀
        // 每 60s 发一次心跳事件，sse-gateway 的 idle checker 会监听到
        const heartbeatTimer = setInterval(() => {
          emit({
            type: "ask_heartbeat",
            chatSessionId,
            payload: { toolCallId },
            ts: Date.now(),
          });
        }, 60_000);

        // 超时保护：10 分钟无回答 → 自动放弃，返回超时提示给模型
        const timeoutTimer = setTimeout(() => {
          clearInterval(heartbeatTimer);
          pending.delete(key);
          resolve("（用户未回答，已超时）");
        }, TIMEOUT_MS);

        pending.set(key, { resolve, reject, timeoutTimer, heartbeatTimer });
      });

      return {
        content: [{ type: "text" as const, text: answerText }],
        output: answerText,
        summary: `💬 ${answerText.slice(0, 40)}`,
      };
    },
  };
}
