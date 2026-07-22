// components/TaskSummaryCard.tsx — Agent 回合结束后的结构化状态卡

import type { SessionStats } from "../utils/sessionStats";

interface Props {
  stats: SessionStats;
  isStreaming?: boolean;
  onOpenChanges?: () => void;
}

export function TaskSummaryCard({ stats, isStreaming, onOpenChanges }: Props) {
  const { totalActions, edits, commands, reads, searches, errors, filesChanged } = stats;
  const hasErrors = errors > 0;
  const fileCount = filesChanged.length;

  return (
    <div className={`task-card ${hasErrors ? "task-card-error" : ""} ${isStreaming ? "task-card-streaming" : ""}`}>
      {/* 顶部状态行 */}
      <div className="task-card-header">
        <div className="task-card-status">
          <span className={`task-card-dot ${isStreaming ? "dot-running" : hasErrors ? "dot-error" : "dot-done"}`} />
          <span className="task-card-status-text">
            {isStreaming ? "执行中…" : hasErrors ? `${errors} 个错误` : "已完成"}
          </span>
        </div>
        <div className="task-card-meta">
          {totalActions} actions
        </div>
      </div>

      {/* 指标网格 */}
      <div className="task-card-metrics">
        <Metric label="编辑" value={edits} icon="edit" />
        <Metric label="命令" value={commands} icon="terminal" />
        <Metric label="读取" value={reads} icon="read" hidden={reads === 0} />
        <Metric label="搜索" value={searches} icon="search" hidden={searches === 0} />
      </div>

      {/* 文件变更 */}
      {fileCount > 0 && (
        <div className="task-card-files">
          <div className="task-card-files-label">
            {fileCount} 个文件变更
            {onOpenChanges && (
              <button className="task-card-files-link" onClick={onOpenChanges}>
                查看变更 →
              </button>
            )}
          </div>
          <div className="task-card-files-list">
            {filesChanged.slice(0, 5).map(f => (
              <div key={f.path} className="task-card-file">
                <span className={`task-card-file-dot ${f.lastStatus === "error" ? "dot-error" : "dot-done"}`} />
                <span className="task-card-file-name">{f.name}</span>
                {f.edits > 1 && <span className="task-card-file-count">×{f.edits}</span>}
              </div>
            ))}
            {fileCount > 5 && (
              <div className="task-card-file-more">+{fileCount - 5} 更多</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hidden }: { label: string; value: number; icon: string; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <div className="task-card-metric">
      <span className="task-card-metric-value">{value}</span>
      <span className="task-card-metric-label">{label}</span>
    </div>
  );
}
