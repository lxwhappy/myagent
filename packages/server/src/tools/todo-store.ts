// tools/todo-store.ts — TODO 列表存储（按 chatSessionId 隔离）
//
// 内存存储 + 持久化到 ~/.pi/agent/myagent-todos.json
// 每个会话有独立的 todo 列表

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import { emit } from "../event-bus.js";
import { PATHS, AGENT_DIR } from "../paths.js";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: "low" | "medium" | "high";
  createdAt: number;
  updatedAt: number;
}

interface TodoStoreData {
  [chatSessionId: string]: TodoItem[];
}

const TODO_FILE = PATHS.todos;

let data: TodoStoreData = {};
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(TODO_FILE)) {
      const raw = await readFile(TODO_FILE, "utf-8");
      data = JSON.parse(raw);
    }
  } catch {
    data = {};
  }
}

async function persist() {
  const dir = dirname(TODO_FILE);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(TODO_FILE, JSON.stringify(data, null, 2));
}

/** 广播 todo_update 事件给前端 */
function broadcast(chatSessionId: string) {
  emit({
    type: "todo_update",
    chatSessionId,
    payload: { todos: data[chatSessionId] || [] },
    ts: Date.now(),
  });
}

export const todoStore = {
  /** 获取会话的 todo 列表 */
  async list(chatSessionId: string): Promise<TodoItem[]> {
    await ensureLoaded();
    return data[chatSessionId] || [];
  },

  /** 添加 todo */
  async add(
    chatSessionId: string,
    content: string,
    priority: "low" | "medium" | "high" = "medium",
  ): Promise<TodoItem> {
    await ensureLoaded();
    if (!data[chatSessionId]) data[chatSessionId] = [];
    const item: TodoItem = {
      id: randomUUID().slice(0, 8),
      content,
      status: "pending",
      priority,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    data[chatSessionId].push(item);
    await persist();
    broadcast(chatSessionId);
    return item;
  },

  /** 更新 todo。状态约束：
   *  1. 同一会话只能有一个 in_progress
   *  2. 顺序强制：只允许操作当前 in_progress 或紧邻的下一个 pending，
   *     跳步操作会被拒绝（返回 { error } 供 tool 层反馈给 LLM）。
   *  返回 { item } 成功，{ error } 被拒绝，null 未找到。 */
  async update(
    chatSessionId: string,
    id: string,
    patch: Partial<Pick<TodoItem, "content" | "status" | "priority">>,
  ): Promise<{ item: TodoItem } | { error: string } | null> {
    await ensureLoaded();
    const list = data[chatSessionId] || [];
    const item = list.find((t) => t.id === id);
    if (!item) return null;

    // 只改 content/priority（不走顺序检查）
    if (patch.status === undefined) {
      if (patch.content !== undefined) item.content = patch.content;
      if (patch.priority !== undefined) item.priority = patch.priority;
      item.updatedAt = Date.now();
      await persist();
      broadcast(chatSessionId);
      return { item };
    }

    // ── status 变更：顺序强制 ──
    const currentInProgress = list.find((t) => t.status === "in_progress");

    if (patch.status === "in_progress") {
      // 已有其他 in_progress → 拒绝
      if (currentInProgress && currentInProgress.id !== item.id) {
        return { error: `必须先完成当前任务「${currentInProgress.content}」再开始下一个！` };
      }
      // 只允许第一个 pending（即紧邻的下一个）设为 in_progress
      const firstPending = list.find((t) => t.status === "pending");
      if (firstPending && firstPending.id !== item.id) {
        return { error: `必须按顺序执行！下一个应该是「${firstPending.content}」，不能跳到「${item.content}」` };
      }
    }

    if (patch.status === "completed") {
      // 只允许标记当前 in_progress 为 completed（不能跳着 completed）
      if (currentInProgress && currentInProgress.id !== item.id) {
        return { error: `必须按顺序执行！当前任务是「${currentInProgress.content}」，请先完成它` };
      }
    }

    // 通过检查 → 应用变更
    if (patch.content !== undefined) item.content = patch.content;
    if (patch.priority !== undefined) item.priority = patch.priority;
    item.status = patch.status;
    item.updatedAt = Date.now();
    await persist();
    broadcast(chatSessionId);
    return { item };
  },

  /** 删除 todo */
  async remove(chatSessionId: string, id: string): Promise<boolean> {
    await ensureLoaded();
    const list = data[chatSessionId] || [];
    const before = list.length;
    data[chatSessionId] = list.filter((t) => t.id !== id);
    if (data[chatSessionId].length < before) {
      await persist();
      broadcast(chatSessionId);
      return true;
    }
    return false;
  },

  /** 批量标记全部完成（agent_end 兜底用，绕过顺序强制） */
  async forceCompleteAll(chatSessionId: string): Promise<void> {
    await ensureLoaded();
    const list = data[chatSessionId] || [];
    let changed = false;
    for (const t of list) {
      if (t.status !== "completed") {
        t.status = "completed";
        t.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) {
      await persist();
      broadcast(chatSessionId);
    }
  },

  /** 清空 todo */
  async clear(chatSessionId: string): Promise<void> {
    await ensureLoaded();
    data[chatSessionId] = [];
    await persist();
    broadcast(chatSessionId);
  },
};
