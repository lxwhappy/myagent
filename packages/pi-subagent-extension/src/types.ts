// src/types.ts — subagent 扩展的共享类型
//
// 这些类型同时被扩展包(工具定义)和 server 端(runner 实现)使用。
// 扩展包只定义「工具长什么样」和「spawn 函数的契约」，
// 具体的「如何创建子 agent / 跑完 / 收集输出」由 server 端实现并注入。

/** 子 agent 跑完后的返回结果 */
export interface SubagentResult {
  /** 子 agent 的最终文本输出（交给主 agent 作为 tool result） */
  summary: string;
  /** 子 agent 本轮消耗的 token（可选，用于展示） */
  tokens?: number;
  /** 子 agent token 明细（input/output/cache/total），用于汇总到主会话 */
  tokenBreakdown?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  /** 子 agent 执行的工具调用次数 */
  toolCalls?: number;
  /** 总耗时（毫秒） */
  durationMs?: number;
  /** 失败时的错误信息 */
  error?: string;
}

/** 前端展示用的进度事件 */
export interface SubagentProgressEvent {
  subId: string;
  parentSessionId: string;
  goal: string;
  /** 当前进度阶段 */
  phase: "tool" | "text" | "done" | "error";
  /** 文本增量或工具名 */
  text?: string;
  tool?: string;
}

/** delegate_task 工具可传给 spawn 的选项 */
export interface SubagentSpawnOptions {
  /** 子 agent 工作目录，默认继承父 */
  cwd?: string;
  /** 指定模型（默认用 config.defaultModel） */
  model?: string;
  provider?: string;
  /** 子 agent 最大轮次（防止失控） */
  maxTurns?: number;
}

/**
 * server 端注入的 spawn 函数签名。
 *
 * 签约：给一个父会话 id + 子任务目标 + 背景，跑出一个独立子 agent，
 * 通过 onProgress 回调报告进度，跑完返回结果。
 * 防递归、工具集、事件广播都在实现内部处理。
 */
export type SubagentSpawnFn = (
  parentSessionId: string,
  goal: string,
  context: string | undefined,
  opts: SubagentSpawnOptions,
  onProgress: (e: SubagentProgressEvent) => void,
) => Promise<SubagentResult>;
