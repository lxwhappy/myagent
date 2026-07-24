// components/TodoPanel.tsx — TODO 任务列表面板
// 实时显示当前会话的 TODO 列表，支持手动切换状态/删除

import { useState } from "react";
import { useChat } from "../hooks/useChat";
import type { TodoItem } from "../stores/chat";

const STATUS_ICON: Record<string, string> = {
  pending: "⬜",
  in_progress: "🔄",
  completed: "✅",
};

const PRIORITY_DOT: Record<string, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🔵",
};

export function TodoPanel() {
  const { todos, activeChatSessionId } = useChat();
  const [collapsed, setCollapsed] = useState(false);

  if (!activeChatSessionId || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

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
      <div className="todo-panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="todo-panel-chevron">{collapsed ? "▸" : "▾"}</span>
        <span className="todo-panel-icon">📋</span>
        <span className="todo-panel-title">
          任务清单 <strong>{completed}/{total}</strong>
        </span>
        <div className="todo-progress-bar">
          <div className="todo-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="todo-progress-text">{percent}%</span>
      </div>
      {!collapsed && (
        <div className="todo-panel-list">
          {todos.map((t) => (
            <div key={t.id} className={`todo-item todo-${t.status}`}>
              <button
                className="todo-status-btn"
                onClick={() => toggleStatus(t)}
                title={`状态: ${t.status}（点击切换）`}
              >
                {STATUS_ICON[t.status]}
              </button>
              <span className="todo-priority-dot">{PRIORITY_DOT[t.priority]}</span>
              <span className={`todo-content ${t.status === "completed" ? "done" : ""}`}>
                {t.content}
              </span>
              <button className="todo-delete-btn" onClick={() => remove(t)} title="删除">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
