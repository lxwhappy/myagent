// tools/todo-tool.ts — TODO 列表工具定义
//
// 供 Agent 调用的 todo 管理工具。
// 核心设计：每次操作返回完整清单快照，让 Agent 始终看到全局进度（prompt 注入效果）。
// 支持操作：add / update / list / delete / clear
// 数据按 chatSessionId 隔离，每次变更实时推送给前端。

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { todoStore } from "./todo-store.js";

// 把 todo 列表格式化成 Agent 可读的快照文本
function formatSnapshot(chatSessionId: string, todos: any[]): string {
  if (todos.length === 0) return "（清单为空）";
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress");
  const lines = todos.map((t, i) => {
    const icon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : "⬜";
    return `${icon} #${i + 1} [${t.id}] ${t.content}${t.status === "completed" ? " (已完成)" : t.status === "in_progress" ? " (进行中)" : ""}`;
  });
  const current = inProgress[0]?.content;
  const warning = inProgress.length > 1
    ? `\n⚠️ 同时有 ${inProgress.length} 个任务"进行中"！同一时间只能有一个 in_progress，请先完成当前任务再推进下一个。`
    : "";
  return [
    `任务清单 (${completed}/${todos.length} 完成):`,
    ...lines,
    current ? `\n当前任务: ${current}` : "",
    completed < todos.length ? `\n⚠️ 还有 ${todos.length - completed} 个任务未完成，请继续推进。` : "\n✅ 全部任务已完成！",
    warning,
  ].join("\n");
}

export function createTodoTool(chatSessionId: string): ToolDefinition {
  return {
    name: "todo",
    label: "TODO",
    executionMode: "sequential", // 串行执行：防止并发 update 导致互斥竞态（多个 in_progress）
    description:
      "管理当前会话的任务清单。遇到多步骤任务（3步以上）时，先用 action=add 添加每个步骤，" +
      "然后开始执行。每完成一步，用 action=update 将该任务状态改为 completed，" +
      "并将下一个任务改为 in_progress。这样用户能实时看到进度。" +
      "状态：pending（待处理）/ in_progress（进行中）/ completed（已完成）。",
    promptSnippet:
      "- todo: 任务清单。先 add 拆步骤，每做完一步 update 状态(completed)，同时把下一步设为 in_progress",
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
      // action 别名映射：LLM 常会用 "complete"/"finish"/"set" 等，
      // 统一归一到合法值，避免 SDK JSON Schema 校验报错
      const ACTION_ALIASES: Record<string, string> = {
        complete: "update", finish: "update", done: "update",
        set: "update", modify: "update", mark: "update",
        add_task: "add", new: "add", create: "add",
        remove: "delete", del: "delete",
        get: "list", all: "list",
        reset: "clear", empty: "clear",
      };
      let { action } = params;
      if (typeof action === "string") {
        const lower = action.toLowerCase();
        action = ACTION_ALIASES[lower] ?? lower;
      }
      // status 别名映射
      const STATUS_ALIASES: Record<string, string> = {
        done: "completed", complete: "completed", finished: "completed",
        working: "in_progress", started: "in_progress", active: "in_progress",
        waiting: "pending", todo: "pending", new: "pending",
      };
      let { content, id, status, priority } = params;
      if (typeof status === "string") {
        status = STATUS_ALIASES[status.toLowerCase()] ?? status.toLowerCase();
      }
      if (typeof priority === "string") {
        priority = priority.toLowerCase();
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
            const item = await todoStore.add(
              chatSessionId,
              content,
              priority || "medium",
            );
            const todos = await todoStore.list(chatSessionId);
            return {
              toolName: "todo",
              summary: `➕ 添加: ${content.slice(0, 40)}`,
              output: `已添加任务 [${item.id}] \"${content}\"\n\n${formatSnapshot(chatSessionId, todos)}`,
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
            // 先按真实 id 查；查不到且 id 是纯数字时，按序号（1-based）回退
            let result = await todoStore.update(chatSessionId, id, patch);
            let resolvedId = id;
            if (!result && /^\d+$/.test(id)) {
              const all = await todoStore.list(chatSessionId);
              const byIndex = all[parseInt(id, 10) - 1];
              if (byIndex) {
                resolvedId = byIndex.id;
                result = await todoStore.update(chatSessionId, resolvedId, patch);
              }
            }
            // 未找到
            if (!result) {
              return {
                toolName: "todo",
                summary: `未找到任务 ${id}`,
                output: `错误：未找到 ID/序号为 ${id} 的任务`,
              } as any;
            }
            // 顺序强制被拒绝 → 反馈给 LLM
            if (!("item" in result)) {
              return {
                toolName: "todo",
                summary: `⛔ 被拒绝`,
                output: `⛔ ${result.error}`,
              } as any;
            }
            const updated = result.item;
            const todos = await todoStore.list(chatSessionId);
            return {
              toolName: "todo",
              summary: `✏️ 更新: ${updated.content.slice(0, 30)} → ${status || "modified"}`,
              output: `已更新任务 [${resolvedId}]: ${updated.content}（状态: ${updated.status}）\n\n${formatSnapshot(chatSessionId, todos)}`,
            } as any;
          }

          case "list": {
            const todos = await todoStore.list(chatSessionId);
            return {
              toolName: "todo",
              summary: todos.length ? `${todos.length} 个任务` : "清单为空",
              output: formatSnapshot(chatSessionId, todos),
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
            // 先按真实 id 删；删不到且 id 是纯数字时，按序号回退
            let ok = await todoStore.remove(chatSessionId, id);
            let resolvedId = id;
            if (!ok && /^\d+$/.test(id)) {
              const all = await todoStore.list(chatSessionId);
              const byIndex = all[parseInt(id, 10) - 1];
              if (byIndex) {
                resolvedId = byIndex.id;
                ok = await todoStore.remove(chatSessionId, resolvedId);
              }
            }
            const todos = await todoStore.list(chatSessionId);
            return {
              toolName: "todo",
              summary: ok ? `🗑 删除: ${resolvedId}` : `未找到 ${id}`,
              output: ok
                ? `已删除任务 ${resolvedId}\n\n${formatSnapshot(chatSessionId, todos)}`
                : `错误：未找到 ID/序号为 ${id} 的任务`,
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
              output: `错误：未知操作 \"${action}\"。支持: add, update, list, delete, clear`,
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
