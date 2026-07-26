// src/extension.ts — Pi Extension 工厂
//
// 这是 Pi Agent 扩展系统的入口点。
// 放到 ~/.pi/agent/extensions/pi-todo/index.ts 即可被自动发现加载。
//
// 功能：
// - 注册 todo 工具
// - 监听 agent_start: 兜底标记首个 pending 为 in_progress
// - 监听 agent_end: 兜底标记所有未完成为 completed
// - 漂移检测: 连续 N 个非 todo 工具调用且未更新清单时，注入提醒

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { TodoStore, formatSnapshot } from "./store.ts";
import { createTodoTool } from "./tool.ts";

const DRIFT_THRESHOLD = 4;

// 全局 store 单例（一个 Pi Agent 进程共享一个）
const store = new TodoStore();

export const todoExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  let currentSessionId: string | null = null;
  let nonTodoToolCount = 0;
  let driftReminded = false;

  // 用 session_start 获取当前会话 ID
  pi.on("session_start", (event: any) => {
    currentSessionId = event?.sessionId || `default-${Date.now()}`;
  });

  pi.on("agent_start", async () => {
    if (!currentSessionId) return;
    try {
      const todos = await store.list(currentSessionId);
      if (todos.length === 0) return;
      const inProgress = todos.find((t) => t.status === "in_progress");
      const nextPending = todos.find((t) => t.status === "pending");
      if (!inProgress && nextPending) {
        await store.update(currentSessionId, nextPending.id, { status: "in_progress" });
      }
    } catch {}
  });

  pi.on("agent_end", async () => {
    if (!currentSessionId) return;
    try {
      const todos = await store.list(currentSessionId);
      for (const t of todos) {
        if (t.status !== "completed") {
          await store.update(currentSessionId, t.id, { status: "completed" });
        }
      }
    } catch {}
  });

  pi.on("tool_execution_end", async (event: any) => {
    if (!currentSessionId) return;
    const toolName = event?.toolName;

    if (toolName === "todo") {
      nonTodoToolCount = 0;
      driftReminded = false;
      return;
    }

    nonTodoToolCount++;

    // 漂移提醒
    if (nonTodoToolCount >= DRIFT_THRESHOLD && !driftReminded) {
      try {
        const todos = await store.list(currentSessionId);
        const unfinished = todos.filter((t) => t.status !== "completed");
        if (unfinished.length > 0) {
          driftReminded = true;
          // 提醒通过 tool result 注入（如果有 result 的话）
          // Pi Extension 无法直接修改 result，但可以通过 sendMessage 提醒
          const lines = unfinished.map((t) =>
            `${t.status === "in_progress" ? "🔄" : "⬜"} ${t.content}`
          ).join("\n");
          pi.sendMessage({
            customType: "todo_drift_reminder",
            content: `⚠️ 已连续执行 ${nonTodoToolCount} 个操作未更新任务清单：\n${lines}`,
          });
        }
      } catch {}
    }
  });

  // 注册 todo 工具（每个会话用 currentSessionId 隔离）
  // 由于 Pi Extension 的 registerTool 是一次性的，我们用动态 sessionId
  const todoTool = createTodoTool(store, currentSessionId || "default");
  // 重新封装 execute 以使用动态 sessionId
  pi.registerTool({
    ...todoTool,
    async execute(toolCallId: string, params: any) {
      const sid = currentSessionId || "default";
      const dynTool = createTodoTool(store, sid);
      return dynTool.execute(toolCallId, params);
    },
  });
};

export default todoExtension;
