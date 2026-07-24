// tools/todo-tool.ts — TODO 列表工具定义
//
// 供 Agent 调用的 todo 管理工具。
// 支持操作：add / update / list / delete / clear
// 数据按 chatSessionId 隔离，每次变更实时推送给前端。

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { todoStore } from "./todo-store.js";

// 通过闭包注入 chatSessionId（在 session-manager 创建 agent 时绑定）
export function createTodoTool(chatSessionId: string): ToolDefinition {
  return {
    name: "todo",
    label: "TODO",
    description:
      "管理当前会话的任务清单（TODO list）。支持添加、更新状态、删除、查看任务。" +
      "适合多步骤任务时跟踪进度。状态：pending（待处理）/ in_progress（进行中）/ completed（已完成）。",
    promptSnippet:
      "- todo: 管理任务清单。action=add(添加任务) / update(更新状态或内容) / list(查看全部) / delete(删除) / clear(清空)",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["add", "update", "list", "delete", "clear"],
          description: "要执行的操作",
        },
        content: {
          type: "string",
          description: "任务内容（add 时必填，update 时可选用于修改内容）",
        },
        id: {
          type: "string",
          description: "任务 ID（update / delete 时必填）",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed"],
          description: "任务状态（update 时可选）",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "优先级（add 时可选，默认 medium）",
        },
      },
      required: ["action"],
    },
    async execute(_toolCallId: string, params: any) {
      const { action, content, id, status, priority } = params;

      try {
        switch (action) {
          case "add": {
            if (!content) {
              return {
                toolName: "todo",
                summary: "add 失败：缺少 content",
                output: "错误：add 操作需要提供 content 参数",
              } as any;
            }
            const item = await todoStore.add(
              chatSessionId,
              content,
              priority || "medium",
            );
            return {
              toolName: "todo",
              summary: `➕ 添加: ${content.slice(0, 40)}`,
              output: `已添加任务 [${item.id}] "${content}"（优先级: ${item.priority}）`,
            } as any;
          }

          case "update": {
            if (!id) {
              return {
                toolName: "todo",
                summary: "update 失败：缺少 id",
                output: "错误：update 操作需要提供 id 参数",
              } as any;
            }
            const patch: any = {};
            if (content !== undefined) patch.content = content;
            if (status !== undefined) patch.status = status;
            if (priority !== undefined) patch.priority = priority;
            const updated = await todoStore.update(chatSessionId, id, patch);
            if (!updated) {
              return {
                toolName: "todo",
                summary: `未找到任务 ${id}`,
                output: `错误：未找到 ID 为 ${id} 的任务`,
              } as any;
            }
            return {
              toolName: "todo",
              summary: `✏️ 更新: ${id} → ${status || "modified"}`,
              output: `已更新任务 [${id}]: ${updated.content}（状态: ${updated.status}）`,
            } as any;
          }

          case "list": {
            const todos = await todoStore.list(chatSessionId);
            if (todos.length === 0) {
              return {
                toolName: "todo",
                summary: "清单为空",
                output: "当前没有任务。使用 action=add 添加任务。",
              } as any;
            }
            const lines = todos.map((t) => {
              const icon =
                t.status === "completed"
                  ? "✅"
                  : t.status === "in_progress"
                    ? "🔄"
                    : "⬜";
              const p =
                t.priority === "high"
                  ? "🔴"
                  : t.priority === "low"
                    ? "🔵"
                    : "🟡";
              return `${icon} ${p} [${t.id}] ${t.content}`;
            });
            return {
              toolName: "todo",
              summary: `${todos.length} 个任务`,
              output: `任务清单（${todos.length}）:\n${lines.join("\n")}`,
            } as any;
          }

          case "delete": {
            if (!id) {
              return {
                toolName: "todo",
                summary: "delete 失败：缺少 id",
                output: "错误：delete 操作需要提供 id 参数",
              } as any;
            }
            const ok = await todoStore.remove(chatSessionId, id);
            return {
              toolName: "todo",
              summary: ok ? `🗑 删除: ${id}` : `未找到 ${id}`,
              output: ok
                ? `已删除任务 ${id}`
                : `错误：未找到 ID 为 ${id} 的任务`,
            } as any;
          }

          case "clear": {
            await todoStore.clear(chatSessionId);
            return {
              toolName: "todo",
              summary: "🧹 清空",
              output: "已清空所有任务",
            } as any;
          }

          default:
            return {
              toolName: "todo",
              summary: `未知操作: ${action}`,
              output: `错误：未知操作 "${action}"。支持: add, update, list, delete, clear`,
            } as any;
        }
      } catch (err: any) {
        return {
          toolName: "todo",
          summary: `错误: ${err.message}`,
          output: `todo 工具执行失败: ${err.message}`,
          isError: true,
        } as any;
      }
    },
  };
}
