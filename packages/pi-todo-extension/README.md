# pi-todo-extension

Pi Agent 的任务清单工具 — 多步骤任务进度跟踪。

## 安装

### 方式一：CLI Pi Agent（自动发现）

```bash
# 软链到全局扩展目录
ln -s /path/to/pi-todo-extension ~/.pi/agent/extensions/pi-todo
```

Pi Agent 启动时自动发现并加载，无需额外配置。

### 方式二：项目内使用（customTools 模式）

```ts
import { TodoStore, createTodoTool } from "@myagent/pi-todo-extension";

const store = new TodoStore({
  onChange: (sessionId, todos) => {
    // 桥接到你的事件系统（SSE/WebSocket 等）
  },
});

const todoTool = createTodoTool(store, sessionId);
createAgentSession({ customTools: [todoTool] });
```

## 工具用法（LLM 调用）

```
todo(action="add", content="分析项目结构")
todo(action="update", id="1", status="in_progress")
todo(action="update", id="1", status="completed")
todo(action="list")
todo(action="delete", id="1")
```

支持别名：`complete`/`done`/`finish` → `update`，`new`/`create` → `add` 等。

## 架构

```
store.ts    — TodoStore（文件持久化 + 回调通知，零框架依赖）
tool.ts     — createTodoTool(store, sessionId) → ToolDefinition
extension.ts — Pi Extension 工厂（registerTool + 生命周期事件）
index.ts    — 包入口（同时导出 Extension 和库接口）
```
