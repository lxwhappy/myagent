// src/tool.ts — Todo ToolDefinition 工厂
//
// 接收一个 TodoStore 实例 + sessionId，返回 Pi Agent 的 ToolDefinition。
// 完全自包含：别名映射、序号回退、快照格式化都在这里。

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  type TodoStore, type TodoStatus, type TodoPriority,
  formatSnapshot,
} from "./store.ts";

// action 别名：LLM 常会用 complete/finish/done 等
const ACTION_ALIASES: Record<string, string> = {
  complete: "update", finish: "update", done: "update",
  set: "update", modify: "update", mark: "update",
  add_task: "add", new: "add", create: "add",
  remove: "delete", del: "delete",
  get: "list", all: "list",
  reset: "clear", empty: "clear",
};

// status 别名
const STATUS_ALIASES: Record<string, TodoStatus> = {
  done: "completed", complete: "completed", finished: "completed",
  working: "in_progress", started: "in_progress", active: "in_progress",
  waiting: "pending", todo: "pending", new: "pending",
};

export function createTodoTool(store: TodoStore, sessionId: string): ToolDefinition {
  return {
    name: "todo",
    label: "TODO",
    description:
      "管理当前会话的任务清单。多步骤任务先用 action=add 添加步骤，" +
      "每完成一步用 action=update 更新状态。状态：pending/in_progress/completed。",
    promptSnippet:
      "- todo: 任务清单。先 add 拆步骤，每做完一步 update 状态(completed)，同时把下一步设为 in_progress",
    promptGuidelines: [
      "遇到3步以上任务时，必须先用 todo add 创建清单，按顺序执行，每步更新状态",
    ],
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "要执行的操作。合法值: add(添加), update(更新状态/内容), list(查看全部), delete(删除), clear(清空)。也接受常见别名: complete/done/finish→update, new/create→add, remove/del→delete, get/all→list, reset/empty→clear",
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
          description: "任务状态（update 时可选）。合法值: pending(待处理), in_progress(进行中), completed(已完成)。也接受: done/complete→completed, working/started→in_progress, waiting/todo→pending",
        },
        priority: {
          type: "string",
          description: "优先级（add 时可选，默认 medium）。合法值: low, medium, high",
        },
      },
      required: ["action"],
    },

    async execute(_toolCallId: string, params: any) {
      let { action } = params;
      if (typeof action === "string") {
        action = ACTION_ALIASES[action.toLowerCase()] ?? action.toLowerCase();
      }
      let { content, id, status, priority } = params;
      if (typeof status === "string") {
        status = STATUS_ALIASES[status.toLowerCase()] ?? status.toLowerCase();
      }
      if (typeof priority === "string") {
        priority = priority.toLowerCase() as TodoPriority;
      }

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
            const item = await store.add(sessionId, content, priority || "medium");
            const todos = await store.list(sessionId);
            return {
              toolName: "todo",
              summary: `➕ 添加: ${content.slice(0, 40)}`,
              output: `已添加任务 [${item.id}] "${content}"\n\n${formatSnapshot(todos)}`,
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
            // 先按真实 id 查；查不到且 id 是纯数字时，按序号回退
            let updated = await store.update(sessionId, id, patch);
            let resolvedId = id;
            if (!updated && /^\d+$/.test(id)) {
              const byIndex = store.findByIndex(sessionId, id);
              if (byIndex) {
                resolvedId = byIndex.id;
                updated = await store.update(sessionId, resolvedId, patch);
              }
            }
            if (!updated) {
              return {
                toolName: "todo",
                summary: `未找到任务 ${id}`,
                output: `错误：未找到 ID/序号为 ${id} 的任务`,
              } as any;
            }
            const todos = await store.list(sessionId);
            return {
              toolName: "todo",
              summary: `✏️ 更新: ${updated.content.slice(0, 30)} → ${status || "modified"}`,
              output: `已更新任务 [${resolvedId}]: ${updated.content}（状态: ${updated.status}）\n\n${formatSnapshot(todos)}`,
            } as any;
          }

          case "list": {
            const todos = await store.list(sessionId);
            return {
              toolName: "todo",
              summary: todos.length ? `${todos.length} 个任务` : "清单为空",
              output: formatSnapshot(todos),
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
            let ok = await store.remove(sessionId, id);
            let resolvedId = id;
            if (!ok && /^\d+$/.test(id)) {
              const byIndex = store.findByIndex(sessionId, id);
              if (byIndex) {
                resolvedId = byIndex.id;
                ok = await store.remove(sessionId, resolvedId);
              }
            }
            const todos = await store.list(sessionId);
            return {
              toolName: "todo",
              summary: ok ? `🗑 删除: ${resolvedId}` : `未找到 ${id}`,
              output: ok
                ? `已删除任务 ${resolvedId}\n\n${formatSnapshot(todos)}`
                : `错误：未找到 ID/序号为 ${id} 的任务`,
            } as any;
          }

          case "clear": {
            await store.clear(sessionId);
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
