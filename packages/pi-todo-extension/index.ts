// index.ts — pi-todo-extension 包入口
//
// 三种使用方式：
//
// 1. Pi Extension（CLI 自动发现）：
//    软链/复制到 ~/.pi/agent/extensions/pi-todo/
//    Pi Agent 启动时自动加载，无需代码改动。
//
// 2. myagent / Web 项目（customTools 模式）：
//    import { TodoStore, createTodoTool } from "@myagent/pi-todo-extension"
//    const store = new TodoStore({ onChange: (sid, todos) => broadcast(sid, todos) })
//    const tool = createTodoTool(store, sessionId)
//    createAgentSession({ customTools: [tool] })
//
// 3. 直接用 Store（不注册工具，只做数据管理）：
//    import { TodoStore } from "@myagent/pi-todo-extension/store"

// ── Extension 工厂（CLI 入口）──
export { todoExtension, default } from "./src/extension.ts";

// ── 核心导出（库模式）──
export { TodoStore, formatSnapshot } from "./src/store.ts";
export type { TodoItem, TodoStatus, TodoPriority, TodoStoreOptions, TodoChangeCallback } from "./src/store.ts";
export { createTodoTool } from "./src/tool.ts";
