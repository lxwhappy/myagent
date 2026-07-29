// components/SubagentPanel.tsx — 子 agent 实时状态展示
//
// 当主 agent 调用 delegate_task 委派子任务时，这里显示子 agent 的实时进度：
// 正在执行的工具、工具调用次数；完成后显示结果摘要 + token/耗时。
// 直接从 chat store 读取当前会话的 subagents 状态（由 SSE 事件驱动更新）。

import { useState, useEffect, useMemo } from "react";
import { useChatStore } from "../stores/chat";
import type { Message } from "../stores/chat";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { MessageItem } from "./MessageItem";

export function SubagentPanel() {
  const sid = useChatStore(s => s.activeChatSessionId);
  // 无条件调用 hook（hooks 规则）。当 session 不存在时返回 undefined，
  // 下面用 ?? 兜底。不能在 selector 里写 `?: []`——每次新数组会触发无限渲染。
  const subagents = useChatStore(s =>
    sid ? s.sessions[sid]?.subagents : undefined
  ) ?? [];
  const setActiveSub = useChatStore(s => s.setActiveSub);
  if (!subagents.length) return null;

  return (
    <div className="subagent-panel">
      {subagents.map(sa => {
        const running = sa.status === "running";
        return (
          <div
            key={sa.subId}
            className={`subagent-card subagent-${sa.status} subagent-clickable`}
            onClick={() => setActiveSub(sa.subId)}
            role="button"
            tabIndex={0}
          >
            <div className="subagent-head">
              <span className="subagent-icon">
                {running ? <Icon name="i-loader" size={14} className="icon-spin" /> : sa.status === "done" ? <Icon name="i-check" size={14} /> : <Icon name="i-x" size={14} />}
              </span>
              <span className="subagent-goal" title={sa.goal}>{sa.goal}</span>
              <span className="subagent-enter">点击查看 →</span>
            </div>

            {running && (
              <div className="subagent-progress">
                {sa.currentTool ? `执行 ${sa.currentTool}` : "思考中…"}
                {sa.toolCount > 0 && ` · ${sa.toolCount} 次调用`}
              </div>
            )}

            {sa.status === "done" && sa.summary && (
              <div className="subagent-summary">
                {sa.summary.slice(0, 160)}{sa.summary.length > 160 ? "…" : ""}
              </div>
            )}
            {sa.status === "error" && sa.error && (
              <div className="subagent-error">{sa.error}</div>
            )}

            {!running && (sa.tokens != null || sa.durationMs != null) && (
              <div className="subagent-meta">
                {sa.tokens != null && `${sa.tokens} tok`}
                {sa.tokens != null && sa.durationMs != null && " · "}
                {sa.durationMs != null && `${(sa.durationMs / 1000).toFixed(1)}s`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 子 agent 过程详情：统一折叠面板（顶部摘要栏 + 展开看每条消息的思考/工具） ──
// 参考设计：顶部摘要「过程详情 · N 条消息 · M 次工具调用」，点击展开/收起整个执行过程。
// 配色沿用 design system（accent 钴蓝系），非参考图的红色。
export function SubagentProcessDetail({
  messages,
  status,
  currentTool,
  toolCount,
}: {
  messages: Message[];
  status: "running" | "done" | "error";
  currentTool?: string;
  toolCount: number;
}) {
  const running = status === "running";
  const [open, setOpen] = useState(true);

  // 执行中保持展开，让用户实时看到进度
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  // 从消息里精确统计工具调用次数（兜底用 store 的 toolCount）
  const toolCalls = useMemo(
    () => messages.reduce((sum, m) => sum + (m.tools?.length || 0), 0) || toolCount,
    [messages, toolCount],
  );

  const statusText = running ? "执行中" : status === "done" ? "已完成" : "出错";

  return (
    <div className={`sub-detail${open ? " expanded" : ""}`}>
      <button type="button" className="sub-detail-header" onClick={() => setOpen(!open)}>
        <Icon
          name="i-chevron"
          size={16}
          className={`sub-detail-chevron${open ? "" : " collapsed"}`}
        />
        <span className="sub-detail-title">过程详情</span>
        <span className="sub-detail-summary">
          {messages.length} 条消息 · {toolCalls} 次工具调用
        </span>
        <span className="sub-detail-spacer" />
        {running && currentTool && (
          <span className="sub-detail-running" title={currentTool}>{currentTool}…</span>
        )}
        <span className={`sub-detail-status ${status}`}>{statusText}</span>
      </button>
      {open && (
        <div className="sub-detail-body">
          {messages.map(msg => (
            <MessageItem key={msg.id} msg={msg} />
          ))}
        </div>
      )}
    </div>
  );
}
