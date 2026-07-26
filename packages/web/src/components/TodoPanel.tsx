// components/TodoPanel.tsx — 任务进度面板
// Agent 执行多步骤任务时，在此实时展示任务清单和进度。
// 固定在消息区上方，始终可见。无任务时不占位。

import { useState } from "react";
import { useChat } from "../hooks/useChat";
import type { TodoItem } from "../stores/chat";

// 把 todo content 拆成 标题 + 描述（按换行分）
function parseContent(content: string): { title: string; desc?: string } {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return { title: content };
  return { title: lines[0], desc: lines.slice(1).join(" · ") };
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
};

export function TodoPanel() {
  const { todos, activeChatSessionId } = useChat();
  const [collapsed, setCollapsed] = useState(false);

  // 无任务：完全不渲染（不占空间）
  if (!activeChatSessionId || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const total = todos.length;

  const toggleStatus = async (todo: TodoItem) => {
    const next =
      todo.status === "pending"
        ? "in_progress"
        : todo.status === "in_progress"
          ? "completed"
          : "pending";
    await fetch(`/api/todos/${activeChatSessionId}/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
  };

  const remove = async (todo: TodoItem) => {
    await fetch(`/api/todos/${activeChatSessionId}/${todo.id}`, {
      method: "DELETE",
    });
  };

  return (
    <div className={`todo-panel ${collapsed ? "collapsed" : ""}`}>
      {/* 头部：标题 + 进度徽章 */}
      <div className="todo-panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="todo-panel-chevron">{collapsed ? "▸" : "▾"}</span>
        <span className="todo-panel-title">任务清单</span>
        <span className={`todo-panel-badge ${completed === total ? "all-done" : ""}`}>
          {completed}/{total}
        </span>
        {inProgress > 0 && collapsed && (
          <span className="todo-panel-pulse" />
        )}
      </div>

      {!collapsed && (
        <div className="todo-panel-list">
          {todos.map((t) => {
            const { title, desc } = parseContent(t.content);
            const isDone = t.status === "completed";
            const isActive = t.status === "in_progress";
            return (
              <div key={t.id} className="todo-row">
                <button
                  className={`todo-indicator todo-ind-${t.status}`}
                  onClick={() => toggleStatus(t)}
                  title={`状态: ${STATUS_LABELS[t.status]}（点击切换）`}
                />
                <div className="todo-text">
                  <div className={`todo-row-title ${isDone ? "done" : ""}`}>{title}</div>
                  {desc && <div className="todo-row-desc">{desc}</div>}
                </div>
                {isActive && (
                  <span className="todo-row-badge">进行中</span>
                )}
                <button className="todo-delete-btn" onClick={() => remove(t)} title="删除">
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
