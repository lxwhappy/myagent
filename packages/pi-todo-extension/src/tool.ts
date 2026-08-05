// src/tool.ts — Todo ToolDefinition 工厂
//
// 设计参照 Claude Code 的 todo_write：
// - 只有一个操作：write（全量覆盖）
// - LLM 每次调用都传入完整的任务列表
// - 每次返回当前快照，让 LLM 始终看到全局进度
//
// 用法示例：
//   todo({ todos: [{ content: "读取文件", status: "completed" }, { content: "分析结构", status: "in_progress" }] })

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type TodoStore, type TodoStatus, formatSnapshot } from "./store.ts";

export function createTodoTool(store: TodoStore, sessionId: string): ToolDefinition {
  return {
    name: "todo",
    label: "TODO",
    executionMode: "sequential",
    description:
      "管理当前会话的任务清单（全量覆盖语义）。遇到 3 步以上的复杂任务时调用此工具。" +
      "每次调用传入完整列表，系统会替换旧列表。每完成一步，更新对应条目的 status 后重新调用。",
    promptSnippet:
      "- todo: 任务清单（全量覆盖）。每次传完整列表: [{content, status}]。" +
      "遇到3步以上任务先创建清单，每做完一步更新状态后重写整个列表。" +
      "status: pending→in_progress→completed，同一时间最多1个in_progress",
    promptGuidelines: [
      "遇到3步以上任务时，必须先用 todo 创建清单，按顺序执行",
      "每完成一步，用 todo 更新列表（把对应项标记 completed，下一项标记 in_progress）",
      "同一时间最多只能有 1 个 in_progress 任务",
    ],
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description:
            "完整的任务列表（会替换旧列表）。每项格式: { content: 任务描述, status: 'pending'|'in_progress'|'completed' }。" +
            "传入时请包含列表中的所有任务，不只是修改的部分。",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "任务描述（简洁明确）" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "任务状态: pending=待处理, in_progress=进行中(同一时间最多1个), completed=已完成",
              },
            },
            required: ["content"],
          },
        },
      },
      required: ["todos"],
    },

    async execute(_toolCallId: string, params: any) {
      const { todos: items } = params;
      if (!Array.isArray(items)) {
        return {
          toolName: "todo",
          summary: "失败：缺少 todos 数组",
          output: "错误：todos 参数必须是数组。格式: [{ content, status }]",
        } as any;
      }

      // 校验：同一时间最多 1 个 in_progress
      const inProgress = items.filter((t: any) => t.status === "in_progress");
      if (inProgress.length > 1) {
        return {
          toolName: "todo",
          summary: `⚠️ 有 ${inProgress.length} 个进行中，请只保留 1 个`,
          output: `错误：同时有 ${inProgress.length} 个任务标记为 in_progress，同一时间只能有 1 个。\n` +
            `请修正后重新提交：先把当前任务的标记改为 completed，再把下一个改为 in_progress。`,
        } as any;
      }

      // 写入
      const normalized = items.map((t: any) => ({
        content: String(t.content ?? "").trim(),
        status: (["pending", "in_progress", "completed"].includes(t.status) ? t.status : "pending") as TodoStatus,
      })).filter((t: any) => t.content);

      await store.write(sessionId, normalized);
      const snapshot = await store.list(sessionId);

      const summary = snapshot.length === 0
        ? "🧹 清空清单"
        : `${snapshot.filter(t => t.status === "completed").length}/${snapshot.length} 完成`;

      return {
        toolName: "todo",
        summary,
        output: formatSnapshot(snapshot),
      } as any;
    },
  };
}
