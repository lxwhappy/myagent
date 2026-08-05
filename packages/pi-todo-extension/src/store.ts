// src/store.ts — Todo 列表存储
//
// 设计参照 Claude Code 的 todo_write：
// - 只有三个方法：write（全量覆盖）/ list / clear
// - 没有 add/update/remove/delete — 每次写入都是完整列表
// - 没有 server 端自动推进、互斥、顺序强制 — 完全由 LLM 管理
// - 按 sessionId 隔离，通过 onChange 回调广播给前端

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { randomUUID } from "crypto";

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

interface TodoStoreConfig {
  filePath?: string;
  onChange?: (sessionId: string, todos: TodoItem[]) => void;
}

const DEFAULT_PRIORITY: TodoPriority = "medium";

export class TodoStore {
  private data: Record<string, TodoItem[]> = {};
  private loaded = false;
  private filePath: string | null;
  private onChange?: (sessionId: string, todos: TodoItem[]) => void;

  constructor(config: TodoStoreConfig = {}) {
    this.filePath = config.filePath ?? null;
    this.onChange = config.onChange;
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    if (this.filePath && existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(await readFile(this.filePath, "utf-8"));
      } catch {
        this.data = {};
      }
    }
  }

  private async persist() {
    if (!this.filePath) return;
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (e: any) {
      console.error("[todo-store] persist failed:", e.message);
    }
  }

  private notify(sessionId: string) {
    this.onChange?.(sessionId, this.data[sessionId] || []);
  }

  /** 获取列表 */
  async list(sessionId: string): Promise<TodoItem[]> {
    await this.ensureLoaded();
    return this.data[sessionId] || [];
  }

  /**
   * 全量写入：用新列表完全替换当前列表。
   * 保留已有项的 id（通过 content 匹配），新项生成 id。
   * 这是唯一的状态变更入口 — 没有 add/update/delete。
   */
  async write(sessionId: string, items: Array<{ content: string; status?: TodoStatus; priority?: TodoPriority }>): Promise<TodoItem[]> {
    await this.ensureLoaded();
    const existing = this.data[sessionId] || [];
    const now = Date.now();

    const result: TodoItem[] = items.map((item, i) => {
      // 尝试按位置匹配保留 id（列表通常只增不换序）
      const match = existing[i];
      return {
        id: match?.id ?? randomUUID().slice(0, 8),
        content: item.content,
        status: item.status ?? "pending",
        priority: item.priority ?? match?.priority ?? DEFAULT_PRIORITY,
        createdAt: match?.createdAt ?? now,
        updatedAt: now,
      };
    });

    this.data[sessionId] = result;
    await this.persist();
    this.notify(sessionId);
    return result;
  }

  /** 清空 */
  async clear(sessionId: string): Promise<void> {
    await this.ensureLoaded();
    if (this.data[sessionId]?.length) {
      this.data[sessionId] = [];
      await this.persist();
      this.notify(sessionId);
    }
  }
}

/** 格式化快照文本（注入给 LLM 用） */
export function formatSnapshot(todos: TodoItem[]): string {
  if (todos.length === 0) return "（清单为空）";
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress");
  const lines = todos.map((t, i) => {
    const icon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : "⬜";
    const suffix = t.status === "completed" ? " (已完成)" : t.status === "in_progress" ? " (进行中)" : "";
    return `${icon} #${i + 1} ${t.content}${suffix}`;
  });
  const current = inProgress[0]?.content;
  const status = completed === todos.length
    ? "\n✅ 全部完成！"
    : `\n⚠️ 还有 ${todos.length - completed} 个任务未完成，请继续。`;
  const focus = current ? `\n📌 当前任务: ${current}` : "";
  return [
    `任务清单 (${completed}/${todos.length} 完成):`,
    ...lines,
    status,
    focus,
  ].join("\n");
}
