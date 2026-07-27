// index.ts — pi-subagent-extension 包入口
//
// 和 pi-todo-extension 一样的双模式：
//
// 1. myagent / Web 项目（customTools 模式，当前主要用法）：
//    import { createDelegateTool } from "@myagent/pi-subagent-extension"
//    const tool = createDelegateTool({ spawn: runner.run, sessionId })
//    createAgentSession({ customTools: [..., tool] })
//    spawn 函数由 server 端 subagent-runner.ts 实现。
//
// 2. Pi Extension（CLI 自动发现）：
//    软链到 ~/.pi/agent/extensions/pi-subagent/
//    （见 src/extension.ts，需要 CLI 注入 spawn 能力，当前为占位）
//
// 关键设计：扩展包本身不含「如何创建子 agent」的逻辑（那依赖 myagent 的
// config / createAgentSession / event-bus）。扩展包只定义工具契约，
// server 端通过依赖注入提供 spawn 函数。这样扩展包可复用、可测试。

export { createDelegateTool } from "./src/tool.ts";
export type {
  SubagentResult,
  SubagentProgressEvent,
  SubagentSpawnOptions,
  SubagentSpawnFn,
} from "./src/types.ts";
