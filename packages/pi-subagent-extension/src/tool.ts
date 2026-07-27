// src/tool.ts — delegate_task ToolDefinition 工厂
//
// 这个工具让主 agent 能把独立的子任务委派给一个隔离的子 agent。
// 子 agent 有自己的上下文窗口和编码工具，跑完后只把结果摘要返回给主 agent，
// 从而避免子任务的中间细节（大量文件读取、试错）污染主 agent 的上下文。
//
// 「如何 spawn 子 agent」由 server 端通过 spawn 函数注入（依赖反转），
// 因此这个文件不依赖 myagent 的任何 server 内部模块，可独立测试。

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SubagentSpawnFn } from "./types.ts";

export interface CreateDelegateToolOptions {
  /** server 端实现的 spawn 函数（见 subagent-runner.ts） */
  spawn: SubagentSpawnFn;
  /** 父会话 id（用于隔离 + 事件归属） */
  sessionId: string;
}

export function createDelegateTool(opts: CreateDelegateToolOptions): ToolDefinition {
  const { spawn, sessionId } = opts;

  return {
    name: "delegate_task",
    label: "SUB",
    description:
      "把独立子任务委派给隔离的子 agent 执行。子 agent 有自己的上下文和编码工具，" +
      "跑完后只返回结果摘要。适合：需要读大量文件的问题、可独立验证的调研/重构。" +
      "注意：子 agent 看不到当前对话，goal 必须自包含。",
    promptSnippet:
      "- delegate_task: 委派独立子任务给隔离的子 agent。子 agent 无对话历史，goal+context 要自包含。适合上下文密集/可并行的子任务",
    promptGuidelines: [
      "遇到可独立完成、且会消耗大量上下文（读多个文件、试错）的子任务时，用 delegate_task 委派，保持主对话精简",
      "委派时 goal 要足够明确自包含（子 agent 看不到本对话），必要时在 context 里补充背景",
    ],
    parameters: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description:
            "子任务的明确目标。必须自包含——子 agent 看不到当前对话历史。" +
            "写清楚要做什么、产出什么。例：\"找出 packages/server/src 下所有引用 ZAI_API_KEY 的文件，列出文件路径和行号\"",
        },
        context: {
          type: "string",
          description:
            "给子 agent 的背景信息（可选）。比如相关文件路径、约定、已知约束。" +
            "子 agent 没有本对话上下文，必要的背景都要在这里写清。",
        },
        cwd: {
          type: "string",
          description: "子 agent 的工作目录（可选，默认继承当前工作空间）",
        },
        model: {
          type: "string",
          description: "子 agent 使用的模型 id（可选，默认和主 agent 相同）",
        },
      },
      required: ["goal"],
    },

    async execute(_toolCallId: string, params: any) {
      const { goal, context, cwd, model } = params;
      if (!goal || typeof goal !== "string") {
        return {
          toolName: "delegate_task",
          summary: "委派失败：缺少 goal",
          output: "错误：delegate_task 需要 goal 参数",
          isError: true,
        } as any;
      }

      const subId = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const startedAt = Date.now();

      try {
        // onProgress 由 server 端的 spawn 内部已直接 emit 到 event-bus，
        // 这里传入的回调仅作兜底日志（避免扩展包直接依赖 event-bus）。
        const result = await spawn(
          sessionId,
          goal,
          context,
          { cwd, model },
          (e) => {
            // 兜底：若 server 未自行 emit，这里也不会重复（server 实现负责发事件）
          },
        );

        const durationMs = Date.now() - startedAt;
        const meta: string[] = [];
        if (result.tokens) meta.push(`${result.tokens} tok`);
        if (result.toolCalls != null) meta.push(`${result.toolCalls} 工具调用`);
        meta.push(`${(durationMs / 1000).toFixed(1)}s`);
        const metaStr = meta.length ? `（${meta.join("，")}）` : "";

        if (result.error) {
          return {
            toolName: "delegate_task",
            summary: `❌ 子任务失败: ${goal.slice(0, 30)}`,
            output: `子 agent 执行失败${metaStr}：\n${result.error}\n\n已产出：\n${result.summary}`,
            isError: true,
          } as any;
        }

        return {
          toolName: "delegate_task",
          summary: `✅ 子任务完成: ${goal.slice(0, 30)}${metaStr}`,
          output: result.summary,
        } as any;
      } catch (err: any) {
        return {
          toolName: "delegate_task",
          summary: `❌ 委派异常: ${err.message?.slice(0, 50)}`,
          output: `delegate_task 执行异常：${err.message}`,
          isError: true,
        } as any;
      }
    },
  };
}
