// src/store.ts — TodoStore: 独立的任务存储，零框架依赖
//
// 核心设计：回调式通知，不直接依赖任何事件总线。
// - CLI Pi Extension: 回调可选（不影响功能）
// - myagent Web: 回调桥接到 SSE/event-bus
// 持久化到文件，按 sessionId 隔离。

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// ── Types ──

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoPriority = "low" | "medium" | "high";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: number;
  updatedAt: number;
}

/** 变更回调：存储内容变化时触发，由宿主环境决定如何处理 */
export type TodoChangeCallback = (sessionId: string, todos: TodoItem[]) => void;

export interface TodoStoreOptions {
  /** 持久化文件路径，默认 ~/.pi/agent/todos.json */
  filePath?: string;
  /** 数据变更回调（可多个） */
  onChange?: TodoChangeCallback;
}

// ── Store ──

export class TodoStore {
  private data: Record<string, TodoItem[]> = {};
  private loaded = false;
  private filePath: string;
  private callbacks = new Set<TodoChangeCallback>();

  constructor(opts?: TodoStoreOptions) {
    this.filePath = opts?.filePath ?? defaultTodoPath();
    if (opts?.onChange) this.callbacks.add(opts.onChange);
  }

  /** 注册变更回调 */
  onChange(cb: TodoChangeCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (existsSync(this.filePath)) {
        const raw = await readFile(this.filePath, "utf-8");
        this.data = JSON.parse(raw);
      }
    } catch {
      this.data = {};
    }
  }

  private async persist() {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }

  private notify(sessionId: string) {
    const todos = this.data[sessionId] || [];
    for (const cb of this.callbacks) {
      try { cb(sessionId, [...todos]); } catch { /* 回调失败不影响存储 */ }
    }
  }

  // ── CRUD ──

  async list(sessionId: string): Promise<TodoItem[]> {
    await this.ensureLoaded();
    return [...(this.data[sessionId] || [])];
  }

  async add(
    sessionId: string,
    content: string,
    priority: TodoPriority = "medium",
  ): Promise<TodoItem> {
    await this.ensureLoaded();
    if (!this.data[sessionId]) this.data[sessionId] = [];
    const item: TodoItem = {
      id: randomUUID().slice(0, 8),
      content,
      status: "pending",
      priority,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data[sessionId].push(item);
    await this.persist();
    this.notify(sessionId);
    return item;
  }

  async update(
    sessionId: string,
    id: string,
    patch: Partial<Pick<TodoItem, "content" | "status" | "priority">>,
  ): Promise<TodoItem | null> {
    await this.ensureLoaded();
    const list = this.data[sessionId] || [];
    const item = list.find((t) => t.id === id);
    if (!item) return null;
    if (patch.content !== undefined) item.content = patch.content;
    if (patch.status !== undefined) item.status = patch.status;
    if (patch.priority !== undefined) item.priority = patch.priority;
    item.updatedAt = Date.now();
    await this.persist();
    this.notify(sessionId);
    return item;
  }

  async remove(sessionId: string, id: string): Promise<boolean> {
    await this.ensureLoaded();
    const list = this.data[sessionId] || [];
    const before = list.length;
    this.data[sessionId] = list.filter((t) => t.id !== id);
    if (this.data[sessionId].length < before) {
      await this.persist();
      this.notify(sessionId);
      return true;
    }
    return false;
  }

  async clear(sessionId: string): Promise<void> {
    await this.ensureLoaded();
    this.data[sessionId] = [];
    await this.persist();
    this.notify(sessionId);
  }

  /** 序号回退查找：id 是纯数字时按 1-based 序号查找 */
  findByIndex(sessionId: string, id: string): TodoItem | null {
    const list = this.data[sessionId] || [];
    if (/^\d+$/.test(id)) {
      return list[parseInt(id, 10) - 1] || null;
    }
    return list.find((t) => t.id === id) || null;
  }
}

// ── Helpers ──

function defaultTodoPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/";
  return join(home, ".pi", "agent", "todos.json");
}

/** 格式化 todo 快照为 Agent 可读文本 */
export function formatSnapshot(todos: TodoItem[]): string {
  if (todos.length === 0) return "（清单为空）";
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress");
  const lines = todos.map((t, i) => {
    const icon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : "⬜";
    return `${icon} #${i + 1} [${t.id}] ${t.content}${t.status === "completed" ? " (已完成)" : t.status === "in_progress" ? " (进行中)" : ""}`;
  });
  const current = inProgress[0]?.content;
  return [
    `任务清单 (${completed}/${todos.length} 完成):`,
    ...lines,
    current ? `\n当前任务: ${current}` : "",
    completed < todos.length ? `\n⚠️ 还有 ${todos.length - completed} 个任务未完成，请继续推进。` : "\n✅ 全部任务已完成！",
  ].join("\n");
}
