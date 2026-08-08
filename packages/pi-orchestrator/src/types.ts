// src/types.ts — 编排模式核心类型定义
//
// 设计原则（第一性原理）：
// 1. 模式 = 数据，不是代码。每种模式是一个纯数据对象（OrchestrationMode）
// 2. prompt 是模板字符串，通过变量插值生成编排指令
// 3. 图结构由拓扑类型决定，不需要每种模式单独写布局代码
// 4. 节点标记系统：prompt 里嵌入 [team:nodeId]，运行时从 delegate_task 的 goal 解析
//
// 这些类型同时被扩展包（模式定义）和 server 端（指令生成）使用。

/** 图拓扑类型 — 决定 DAG 的布局算法 */
export type GraphTopology =
  | "linear"    // A→B→C（pipeline, evaluator）
  | "star"      // 中心→[A,B,C]（supervisor, router）
  | "fanout"    // Split→[A,B,C]→Merge（parallel, mapreduce）
  | "ring"      // A↔B↔C↔A（debate）
  | "loop"      // executor→evaluator 回环（loop）
  | "dag";      // 用户自定义边（custom）

/** Dagre 布局方向 */
export type LayoutDirection = "LR" | "TB";

/** 模式选项定义 — 用户可调整的参数 */
export interface ModeOption {
  key: string;
  label: string;
  type: "number" | "select" | "text";
  default?: string | number;
  options?: string[];  // type === "select" 时
  min?: number;
  max?: number;
}

/** 编排模式 — 一个纯数据对象，定义如何编排团队 */
export interface OrchestrationMode {
  /** 唯一标识（内置用英文 key，自定义用 uuid） */
  id: string;
  /** 显示名称 */
  name: string;
  /** emoji 图标 */
  icon: string;
  /** 简短描述（模式选择卡片用） */
  description: string;
  /** 详细说明（帮助文案） */
  detail?: string;
  /** 是否内置（内置不可删除） */
  isBuiltIn: boolean;

  /** 成员数量约束 */
  minMembers: number;
  maxMembers?: number;  // undefined = 不限制

  /** 图拓扑 */
  topology: GraphTopology;
  /** 布局方向 */
  layout: LayoutDirection;

  /**
   * prompt 模板 — 支持变量插值
   * 变量列表：
   *   {{user_message}}        — 用户原始消息
   *   {{members_list}}        — 成员列表（已格式化）
   *   {{member_N_name}}       — 第 N 个成员的名字（0-based）
   *   {{member_N_role}}       — 第 N 个成员的角色
   *   {{member_N_instructions}} — 第 N 个成员的额外指令
   *   {{max_retries}}         — 最大重试次数
   *   {{options.xxx}}         — 模式自定义选项值
   */
  promptTemplate: string;

  /** 模式专属选项（evaluator 的 maxRetries、debate 的 rounds 等） */
  options?: ModeOption[];
}

/** 成员信息（给 prompt 模板插值用） */
export interface MemberInfo {
  agentId: string;
  name: string;
  icon: string;
  role: string;
  instructions?: string;
}

/** DAG 节点定义（给前端 React Flow 用） */
export interface FlowNodeDef {
  id: string;
  label: string;
  role: string;
  icon: string;
  status?: NodeStatus;
  duration?: number;
  retryCount?: number;
  isCoordinator?: boolean;
}

/** DAG 边定义 */
export interface FlowEdgeDef {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  dashed?: boolean;
}

/** 节点运行时状态 */
export type NodeStatus = "pending" | "running" | "done" | "error" | "skipped";

/** 图结构生成结果 */
export interface FlowGraph {
  nodes: FlowNodeDef[];
  edges: FlowEdgeDef[];
}

/** prompt 构建参数 */
export interface PromptBuildContext {
  mode: OrchestrationMode;
  members: MemberInfo[];
  userMessage: string;
  /** 模式选项的实际值（key → value） */
  optionValues: Record<string, string | number>;
  /** 共享黑板：前序步骤的产出，注入到后续步骤的 context（loop 模式用） */
  sharedContext?: string;
}
