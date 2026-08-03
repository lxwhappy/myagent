// ============================================================
// tools/index.ts — 自定义工具示例
//
// 通过 createAgentSession({ customTools: [...] }) 传入
// ============================================================

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/** 天气查询工具（示例） */
export const weatherTool: ToolDefinition = {
  name: "get_weather",
  description: "查询指定城市的当前天气",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "城市名（中文或英文）" },
    },
    required: ["city"],
  },
  execute: async ({ city }: { city: string }) => {
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
      const data = await res.json() as any;
      const cur = data.current_condition?.[0];
      if (!cur) return JSON.stringify({ city, error: "No data" });
      return JSON.stringify({
        city,
        temp: `${cur.temp_C}°C`,
        feelsLike: `${cur.FeelsLikeC}°C`,
        desc: cur.weatherDesc?.[0]?.value ?? "Unknown",
        humidity: `${cur.humidity}%`,
        wind: `${cur.windspeedKmph} km/h`,
      });
    } catch (err: any) {
      return JSON.stringify({ city, error: err.message });
    }
  },
};

/** 时间查询工具 */
export const timeTool: ToolDefinition = {
  name: "get_time",
  description: "获取当前时间和日期",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "时区，如 Asia/Shanghai, America/New_York",
      },
    },
  },
  execute: async ({ timezone }: { timezone?: string }) => {
    const tz = timezone ?? "UTC";
    try {
      const now = new Date().toLocaleString("zh-CN", {
        timeZone: tz,
        dateStyle: "full",
        timeStyle: "long",
      });
      return JSON.stringify({ timezone: tz, datetime: now });
    } catch {
      return JSON.stringify({ error: `Invalid timezone: ${tz}` });
    }
  },
};

/** 导出所有自定义工具 */
// 性能优化：只保留核心工具（weather/time 是示例，移除以减少 GLM-4.7 prefill 延迟）
export const customTools: ToolDefinition[] = [];

// todo 工具已迁移到独立包 @myagent/pi-todo-extension
export { TodoStore } from "@myagent/pi-todo-extension/src/store.ts";
export { createTodoTool } from "@myagent/pi-todo-extension/src/tool.ts";
export type { TodoItem, TodoStatus, TodoPriority } from "@myagent/pi-todo-extension/src/store.ts";

// subagent 委派工具（来自 @myagent/pi-subagent-extension）
// spawn 函数由 server 端 subagent-runner.ts 实现，在 agent-registry 里组装注入
export { createDelegateTool } from "@myagent/pi-subagent-extension/src/tool.ts";
export type { SubagentSpawnFn, SubagentResult, SubagentSpawnOptions } from "@myagent/pi-subagent-extension/src/types.ts";

// 共享 store 单例（带 SSE 广播回调）
import { TodoStore as _TodoStore } from "@myagent/pi-todo-extension/src/store.ts";
import { emit } from "../event-bus.js";
import { PATHS } from "../paths.js";

export const todoStore = new _TodoStore({
  filePath: PATHS.todos,
  onChange: (chatSessionId, todos) => {
    emit({ type: "todo_update", chatSessionId, payload: { todos }, ts: Date.now() });
  },
});
