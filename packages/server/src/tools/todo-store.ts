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

  /** 更新 todo */
  async update(
    chatSessionId: string,
    id: string,
    patch: Partial<Pick<TodoItem, "content" | "status" | "priority">>,
  ): Promise<TodoItem | null> {
    await ensureLoaded();
    const list = data[chatSessionId] || [];
    const item = list.find((t) => t.id === id);
    if (!item) return null;
    if (patch.content !== undefined) item.content = patch.content;
    if (patch.status !== undefined) item.status = patch.status;
    if (patch.priority !== undefined) item.priority = patch.priority;
    item.updatedAt = Date.now();
    await persist();
    broadcast(chatSessionId);
    return item;
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

  /** 清空 todo */
  async clear(chatSessionId: string): Promise<void> {
    await ensureLoaded();
    data[chatSessionId] = [];
    await persist();
    broadcast(chatSessionId);
  },
};
