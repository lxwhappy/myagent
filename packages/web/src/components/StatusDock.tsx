// components/StatusDock.tsx — 统一状态面板
//
// 将 TodoPanel 和 TeamFlowLive 整合到一个容器中：
// - 只有一种活跃时直接展示（无 tab）
// - 两种都活跃时用 tab 切换
// - 共享同一套视觉语言（border-bottom strip、surface 背景、一致的排版）
// - 整体可折叠
// - 团队执行中自动切到团队 tab，执行完自动切回任务 tab

import { useState, useEffect } from "react";
import { useChat } from "../hooks/useChat";
import type { TodoItem } from "../stores/chat";
import { useTeamFlowStore } from "../stores/team-flow";
import { AgentFlowGraph, type FlowNodeDef, type FlowEdgeDef, type AgentNodeStatus, type LayoutDirection } from "./AgentFlowGraph";

function parseTodoContent(content: string): { title: string; desc?: string } {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return { title: content };
  return { title: lines[0], desc: lines.slice(1).join(" · ") };
}

const TODO_STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
};

export function StatusDock() {
  const { todos, activeChatSessionId } = useChat();
  const teamActive = useTeamFlowStore(s => s.active);

  const hasTodos = activeChatSessionId && todos.length > 0;
  const hasTeam = !!teamActive;
  const showDock = hasTodos || hasTeam;

  // tab 状态
  const [tab, setTab] = useState<"todos" | "team">("todos");
  const [collapsed, setCollapsed] = useState(false);

  // 团队执行中自动切 tab
  useEffect(() => {
    if (hasTeam) setTab("team");
    else if (hasTodos) setTab("todos");
  }, [hasTeam, hasTodos]);

  if (!showDock) return null;

  const showTabs = hasTodos && hasTeam;

  return (
    <div className={`status-dock ${collapsed ? "collapsed" : ""}`}>
      <div className="status-dock-bar">
        {/* Tab 切换（或单标题） */}
        {showTabs ? (
          <div className="status-dock-tabs">
            <button
              className={`status-dock-tab ${tab === "team" ? "active" : ""}`}
              onClick={() => { setTab("team"); setCollapsed(false); }}
            >
              <span className="status-dock-tab-icon">👥</span>
              <span>团队</span>
              {teamActive && (
                <span className="status-dock-tab-badge">
                  {teamActive.nodes.filter(n => n.status === "running").length > 0
                    ? `${teamActive.nodes.filter(n => n.status === "running").length}▶`
                    : `${teamActive.nodes.filter(n => n.status === "done").length}/${teamActive.nodes.length}`}
                </span>
              )}
            </button>
            <button
              className={`status-dock-tab ${tab === "todos" ? "active" : ""}`}
              onClick={() => { setTab("todos"); setCollapsed(false); }}
            >
              <span className="status-dock-tab-icon">📋</span>
              <span>任务</span>
              <span className="status-dock-tab-badge">
                {todos.filter(t => t.status === "completed").length}/{todos.length}
              </span>
            </button>
          </div>
        ) : (
          <div className="status-dock-single-title" onClick={() => setCollapsed(!collapsed)}>
            <span className="status-dock-chevron">{collapsed ? "▸" : "▾"}</span>
            <span>{hasTeam ? "👥" : "📋"}</span>
            <span className="status-dock-single-label">
              {hasTeam ? teamActive!.teamName : "任务清单"}
            </span>
            {hasTeam ? (
              <span className="status-dock-stat">
                {teamActive!.nodes.filter(n => n.status === "done").length}/{teamActive!.nodes.length}
              </span>
            ) : (
              <span className={`status-dock-stat ${todos.every(t => t.status === "completed") ? "done" : ""}`}>
                {todos.filter(t => t.status === "completed").length}/{todos.length}
              </span>
            )}
            {hasTodos && todos.some(t => t.status === "in_progress") && collapsed && (
              <span className="status-dock-pulse" />
            )}
          </div>
        )}

        {/* 折叠按钮（tab 模式下） */}
        {showTabs && (
          <button
            className="status-dock-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "展开" : "收起"}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        )}
      </div>

      {/* 内容区 */}
      {!collapsed && (
        <div className="status-dock-body">
          {(tab === "team" || (!showTabs && hasTeam)) && teamActive && (
            <TeamFlowContent />
          )}
          {(tab === "todos" || (!showTabs && hasTodos)) && hasTodos && (
            <TodoListContent todos={todos} sid={activeChatSessionId!} />
          )}
        </div>
      )}
    </div>
  );
}

// ── 团队可视化内容 ──
function TeamFlowContent() {
  const active = useTeamFlowStore(s => s.active)!;

  const nodes: FlowNodeDef[] = active.nodes.map(n => ({
    id: n.id, label: n.label, role: n.role, icon: n.icon,
    status: n.status as AgentNodeStatus,
    duration: n.duration, isCoordinator: n.isCoordinator,
  }));
  const edges: FlowEdgeDef[] = active.edges.map(e => ({
    id: e.id, source: e.source, target: e.target, dashed: e.dashed,
  }));

  const layout = (active.layout as LayoutDirection) || "LR";
  const running = active.nodes.filter(n => n.status === "running").length;

  return (
    <div className="status-dock-team">
      {running > 0 && (
        <div className="status-dock-team-progress">
          <span className="status-dock-pulse-dot" />
          {running} 个 Agent 执行中 · {active.modeName}
        </div>
      )}
      <AgentFlowGraph nodes={nodes} edges={edges} layout={layout} height={160} showControls={false} />
    </div>
  );
}

// ── 任务列表内容 ──
function TodoListContent({ todos, sid }: { todos: TodoItem[]; sid: string }) {
  const toggleStatus = async (todo: TodoItem) => {
    const next =
      todo.status === "pending" ? "in_progress"
      : todo.status === "in_progress" ? "completed"
      : "pending";
    await fetch(`/api/todos/${sid}/${todo.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
  };

  const remove = async (todo: TodoItem) => {
    await fetch(`/api/todos/${sid}/${todo.id}`, { method: "DELETE" });
  };

  return (
    <div className="status-dock-todos">
      {todos.map((t) => {
        const { title, desc } = parseTodoContent(t.content);
        const isDone = t.status === "completed";
        const isActive = t.status === "in_progress";
        return (
          <div key={t.id} className="todo-row">
            <button
              className={`todo-indicator todo-ind-${t.status}`}
              onClick={() => toggleStatus(t)}
              title={`状态: ${TODO_STATUS_LABELS[t.status]}（点击切换）`}
            />
            <div className="todo-text">
              <div className={`todo-row-title ${isDone ? "done" : ""}`}>{title}</div>
              {desc && <div className="todo-row-desc">{desc}</div>}
            </div>
            {isActive && <span className="todo-row-badge">进行中</span>}
            <button className="todo-delete-btn" onClick={() => remove(t)} title="删除">✕</button>
          </div>
        );
      })}
    </div>
  );
}
