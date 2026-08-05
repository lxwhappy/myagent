// src/extension.ts — Pi Extension 工厂
//
// 只负责注册 todo 工具 + 状态注入。
// 不做任何自动推进/自动完成 — 完全由 LLM 管理 todo 状态。

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { TodoStore } from "./store.ts";
import { createTodoTool } from "./tool.ts";

const store = new TodoStore();

export const todoExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  let currentSessionId: string | null = null;

  pi.on("session_start", (event: any) => {
    currentSessionId = event?.sessionId || `default-${Date.now()}`;
  });

  const todoTool = createTodoTool(store, currentSessionId || "default");
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
