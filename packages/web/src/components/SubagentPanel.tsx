// components/SubagentPanel.tsx — 子 agent 实时状态展示
//
// 当主 agent 调用 delegate_task 委派子任务时，这里显示子 agent 的实时进度：
// 正在执行的工具、工具调用次数；完成后显示结果摘要 + token/耗时。
// 直接从 chat store 读取当前会话的 subagents 状态（由 SSE 事件驱动更新）。

import { useChatStore } from "../stores/chat";

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
                {running ? "🔄" : sa.status === "done" ? "✅" : "❌"}
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
