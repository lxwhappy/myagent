// index.ts — @myagent/pi-orchestrator 包入口
//
// 编排模式注册表：定义团队如何编排多个 Agent 协作。
//
// 和 pi-subagent-extension 同样的设计模式：
// - 扩展包只定义「模式长什么样」和「prompt/graph 如何生成」
// - server 端负责持久化自定义模式、注入到注册表、驱动编排引擎
// - 前端消费模式列表来渲染 UI、生成可视化 DAG

// 类型
export type {
  OrchestrationMode,
  ModeOption,
  GraphTopology,
  LayoutDirection,
  MemberInfo,
  FlowNodeDef,
  FlowEdgeDef,
  FlowGraph,
  NodeStatus,
  PromptBuildContext,
} from "./src/types.ts";

// 内置模式
export { BUILTIN_MODES } from "./src/builtin-modes.ts";

// 注册表
export {
  getAvailableModes,
  getMode,
  isBuiltInMode,
  getBuiltinModes,
  getCustomModes,
  setCustomModes,
} from "./src/registry.ts";

// prompt 构建
export {
  buildPrompt,
  parseNodeTag,
  getDefaultOptionValues,
} from "./src/prompt-builder.ts";

// 图结构生成
export {
  buildGraph,
  assignNodeIds,
  type MemberWithNodeId,
} from "./src/graph-builder.ts";
