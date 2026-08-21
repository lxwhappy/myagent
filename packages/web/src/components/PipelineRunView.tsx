// components/PipelineRunView.tsx — 流水线运行视图
//
// 三块：树形时间线（实时状态）/ step 详情（输出/verdict/warnings）/ 历史列表。
// SSE pipeline_flow_update 事件实时合并 step 状态（App.tsx 里接线）。

import { useEffect, useState } from "react";
import {
  usePipelinesStore, type PipelineRun, type RunStep, type RunIndexEntry,
} from "../stores/pipelines";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "待执行", cls: "st-pending" },
  running: { label: "执行中", cls: "st-running" },
  success: { label: "成功", cls: "st-success" },
  error: { label: "失败", cls: "st-error" },
  skipped: { label: "跳过", cls: "st-skipped" },
  waiting_input: { label: "等待输入", cls: "st-waiting" },
};

function fmtDur(ms?: number) {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(ts?: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

export function PipelineRunView({ onClose }: { onClose?: () => void }) {
  const activeRun = usePipelinesStore((s) => s.activeRun);
  const runHistory = usePipelinesStore((s) => s.runHistory);
  const [selectedStep, setSelectedStep] = useState<RunStep | null>(null);
  const [tab, setTab] = useState<"timeline" | "canvas" | "history">("timeline");

  useEffect(() => {
    usePipelinesStore.getState().loadRunHistory();
  }, []);

  useEffect(() => {
    setSelectedStep(null);
  }, [activeRun?.runId]);

  // 无 activeRun 时始终显示历史列表（侧栏入口的主要内容）
  const effectiveTab = activeRun ? tab : "history";

  if (!activeRun) {
    return (
      <div className="pipeline-run-view">
        <div className="pipeline-run-head">
          <div className="pipeline-run-title"><strong>流水线执行</strong></div>
          <div className="pipeline-run-tabs">
            <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>历史</button>
          </div>
        </div>
        <div className="pipeline-run-body">
          {effectiveTab === "history" ? (
            <div className="pipeline-history">
              {runHistory.map((h) => (
                <button key={h.runId} className="pipeline-hist-row"
                  onClick={() => usePipelinesStore.getState().loadRun(h.runId)}>
                  <span className={`run-status-badge rs-${h.status}`}>{h.status}</span>
                  <span className="hist-name">{h.pipelineName}</span>
                  <span className="hist-time">{fmtTime(h.startedAt)}</span>
                  {h.llmCalls != null && <span className="hist-calls">{h.llmCalls} 次</span>}
                </button>
              ))}
              {runHistory.length === 0 && <div className="step-tree-empty">暂无执行历史<br /><span style={{ fontSize: 10 }}>从「设置 → 流水线」点 ▶ 运行</span></div>}
            </div>
          ) : (
            <div className="pipeline-run-empty">
              <span>📤</span>
              <p>没有正在查看的 run</p>
            </div>
          )}
        </div>
        {onClose && <button className="settings-close" onClick={onClose}>✕</button>}
      </div>
    );
  }

  const run = activeRun;
  const isLive = run.status === "running";

  return (
    <div className="pipeline-run-view">
      <div className="pipeline-run-head">
        <div className="pipeline-run-title">
          <strong>run {run.runId.slice(0, 14)}…</strong>
          <span className={`run-status-badge rs-${run.status}`}>
            {run.status}{run.abortReason ? `(${run.abortReason})` : ""}
          </span>
          {isLive && <span className="run-live-dot" />}
        </div>
        <div className="pipeline-run-meta">
          <span>⏱ {fmtDur(run.endedAt ? run.endedAt - run.startedAt : Date.now() - run.startedAt)}</span>
          <span>🤖 {run.usage.llmCalls} 次调用</span>
          {run.stats && <span>✓{run.stats.success} ✗{run.stats.failed} ○{run.stats.skipped}</span>}
        </div>
        {isLive && (
          <button className="pipeline-abort-btn" onClick={async () => {
            await fetch(`/api/pipeline-runs/${run.runId}/abort`, { method: "POST" });
          }}>中止</button>
        )}
        <div className="pipeline-run-tabs">
          {(["timeline", "canvas", "history"] as const).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "timeline" ? "时间线" : t === "canvas" ? "画布" : "历史"}
            </button>
          ))}
        </div>
        {onClose && <button className="settings-close" onClick={onClose}>✕</button>}
      </div>

      <div className="pipeline-run-body">
        {effectiveTab === "timeline" && (
          <div className="pipeline-timeline-layout">
            <div className="pipeline-timeline">
              {run.steps.map((s, i) => {
                const meta = STATUS_META[s.status] ?? STATUS_META.pending;
                return (
                  <button key={`${s.stepId}-${s.instanceKey ?? ""}-${s.attempt}-${s.iteration}-${i}`}
                    className={`pipeline-step-row ${selectedStep === s ? "selected" : ""}`}
                    onClick={() => setSelectedStep(s)}>
                    <span className={`step-status-dot ${meta.cls}`} />
                    <span className="step-tl-label">
                      {s.stepId}
                      {s.instanceKey && <span className="step-tl-instance">{s.instanceKey}</span>}
                      {s.iteration > 1 && <span className="step-tl-iter">R{s.iteration}</span>}
                      {s.attempt > 1 && <span className="step-tl-att">重{s.attempt}</span>}
                    </span>
                    {s.verdict && (
                      <span className={`step-verdict-badge v-${s.verdict}`}>
                        {s.verdict}
                        <em>{s.verdictSource === "command" ? "⌘" : "🤖"}</em>
                      </span>
                    )}
                    <span className="step-tl-dur">{fmtDur(s.durationMs)}</span>
                    <span className="step-tl-time">{fmtTime(s.endedAt ?? s.startedAt)}</span>
                  </button>
                );
              })}
              {run.steps.length === 0 && <div className="step-tree-empty">等待第一个步骤…</div>}
            </div>
            <div className="pipeline-step-detail">
              {selectedStep ? (
                <>
                  <h3>
                    {selectedStep.stepId}
                    {selectedStep.instanceKey ? ` · ${selectedStep.instanceKey}` : ""}
                    {selectedStep.iteration > 1 ? ` · 第${selectedStep.iteration}轮` : ""}
                  </h3>
                  <div className="detail-grid">
                    <span>状态</span><b>{STATUS_META[selectedStep.status]?.label ?? selectedStep.status}</b>
                    <span>耗时</span><b>{fmtDur(selectedStep.durationMs)}</b>
                    {selectedStep.verdict && <>
                      <span>裁决</span>
                      <b>{selectedStep.verdict}（{selectedStep.verdictSource === "command" ? "命令通道" : "LLM通道"}）</b>
                    </>}
                    {selectedStep.subId && <><span>子Agent</span><b className="detail-sub">{selectedStep.subId}</b></>}
                  </div>
                  {selectedStep.warnings?.length ? (
                    <div className="detail-warnings">
                      {selectedStep.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
                    </div>
                  ) : null}
                  {selectedStep.error && <div className="detail-error">✗ {selectedStep.error}</div>}
                  <details open>
                    <summary>输入</summary>
                    <pre>{selectedStep.inputDigest ?? "（无）"}</pre>
                  </details>
                  <details open>
                    <summary>输出</summary>
                    <pre>{selectedStep.output ?? "（无）"}</pre>
                  </details>
                </>
              ) : (
                <div className="pipeline-run-empty"><p>点击左侧步骤查看详情</p></div>
              )}
            </div>
          </div>
        )}

        {effectiveTab === "canvas" && <PipelineCanvasTab pipelineId={run.pipelineId} />}

        {effectiveTab === "history" && (
          <div className="pipeline-history">
            {runHistory.map((h) => (
              <button key={h.runId} className={`pipeline-hist-row ${h.runId === run.runId ? "current" : ""}`}
                onClick={() => usePipelinesStore.getState().loadRun(h.runId)}>
                <span className={`run-status-badge rs-${h.status}`}>{h.status}</span>
                <span className="hist-name">{h.pipelineName}</span>
                <span className="hist-time">{fmtTime(h.startedAt)}</span>
                {h.llmCalls != null && <span className="hist-calls">{h.llmCalls} 次调用</span>}
              </button>
            ))}
            {runHistory.length === 0 && <div className="step-tree-empty">暂无执行历史</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** 只读画布 tab：拉 /dag 渲染简化 DAG（HTML/CSS 版本，不依赖 ReactFlow 重复实例） */
function PipelineCanvasTab({ pipelineId }: { pipelineId: string }) {
  const [dag, setDag] = useState<{ nodes: { id: string; label: string; type: string }[]; edges: { source: string; target: string; kind: string; label?: string }[] } | null>(null);

  useEffect(() => {
    fetch(`/api/pipelines/${pipelineId}/dag`).then((r) => r.json()).then(setDag).catch(() => {});
  }, [pipelineId]);

  if (!dag) return <div className="step-tree-empty">加载画布…</div>;

  // 简单分层：按拓扑序排（后端已按树序输出，直接用索引近似分层）
  return (
    <div className="pipeline-canvas-simple">
      {dag.nodes.map((n) => (
        <div key={n.id} className={`dag-node d-${n.type}`}>{n.label}</div>
      ))}
      <div className="dag-edges-legend">
        {dag.edges.map((e) => (
          <div key={`${e.source}-${e.target}`} className={`dag-edge-info k-${e.kind}`}>
            {e.source} → {e.target} {e.label ? `(${e.label})` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
