// components/PipelineWorkbench.tsx — 流水线全屏工作台
//
// A1 布局：主区域接管（替代旧侧栏 RunView）。三栏：
//   左：步骤时间线（tl-item 扁平行风格，与聊天过程行同源）
//   中：ReactFlow 画布（B1）/ 步骤钻入过程视图（C1，activeSubId 时）
//   右：步骤详情（verdict / 输入输出 / 钻入按钮）
// 底部工具条：run 元信息（状态/耗时/调用数）+ 中止 + 中间区 tab 切换。
//
// 另导出 PipelineSidebarList：侧栏流水线列表（运行入口 + live 徽标）。

import { useEffect, useMemo, useState } from "react";
import {
  usePipelinesStore, type RunStep, type PipelineDef, type RunIndexEntry,
} from "../stores/pipelines";
import { MessageItem } from "./MessageItem";
import { PipelineCanvas } from "./PipelineCanvas";

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

/** 单个 run 时间线行（tl-item 扁平行风格，对齐聊天过程行视觉） */
function StepRow({ step, selected, onClick }: { step: RunStep; selected: boolean; onClick: () => void }) {
  const meta = STATUS_META[step.status] ?? STATUS_META.pending;
  return (
    <button className={`pw-step-row ${selected ? "selected" : ""}`} onClick={onClick}>
      <span className={`pw-step-dot ${meta.cls}`} />
      <span className="pw-step-label">
        {step.stepId}
        {step.instanceKey && <span className="pw-step-instance">{step.instanceKey.split("#").pop()}</span>}
        {step.iteration > 1 && <span className="pw-step-iter">R{step.iteration}</span>}
        {step.attempt > 1 && <span className="pw-step-att">重{step.attempt}</span>}
      </span>
      {step.verdict && (
        <span className={`pw-verdict v-${step.verdict}`}>
          {step.verdict}
          <em>{step.verdictSource === "command" ? "⌘" : "AI"}</em>
        </span>
      )}
      <span className="pw-step-dur">{fmtDur(step.durationMs)}</span>
    </button>
  );
}

export function PipelineWorkbench({ onClose }: { onClose: () => void }) {
  const activeRun = usePipelinesStore((s) => s.activeRun);
  const runHistory = usePipelinesStore((s) => s.runHistory);
  const activeSubId = usePipelinesStore((s) => s.activeSubId);
  const subagents = usePipelinesStore((s) => s.subagents);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"canvas" | "process">("canvas");
  const [, forceTick] = useState(0);

  useEffect(() => { usePipelinesStore.getState().loadRunHistory(); }, []);

  // run 切换时重置选择与钻入缓存
  useEffect(() => {
    setSelectedKey(null);
    usePipelinesStore.getState().resetSubagents();
  }, [activeRun?.runId]);

  // 活跃 run 的实时耗时刷新
  useEffect(() => {
    if (!activeRun || activeRun.status !== "running") return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [activeRun?.runId, activeRun?.status]);

  const activeSub = activeSubId ? subagents[activeSubId] : undefined;
  const run = activeRun;
  const isLive = run?.status === "running";
  const selectedStep = useMemo(() => {
    if (!run || !selectedKey) return null;
    return run.steps.find((s) => stepKey(s) === selectedKey) ?? null;
  }, [run, selectedKey]);

  // ── 历史空态（还没选中 run）──
  if (!run) {
    return (
      <div className="pw-root">
        <div className="pw-head">
          <div className="pw-title"><strong>流水线执行</strong><span className="pw-sub">运行历史</span></div>
          <button className="pw-close" onClick={onClose}>✕</button>
        </div>
        <div className="pw-body pw-history-body">
          {runHistory.map((h) => (
            <button key={h.runId} className="pw-hist-row" onClick={() => usePipelinesStore.getState().loadRun(h.runId)}>
              <span className={`pw-run-badge rs-${h.status}`}>{h.status}</span>
              <span className="pw-hist-name">{h.pipelineName}</span>
              <span className="pw-hist-time">{fmtTime(h.startedAt)}</span>
              {h.llmCalls != null && <span className="pw-hist-calls">{h.llmCalls} 次</span>}
            </button>
          ))}
          {runHistory.length === 0 && <div className="pw-empty">暂无执行历史<br /><span>从「设置 → 流水线」或流水线列表运行</span></div>}
        </div>
      </div>
    );
  }

  return (
    <div className="pw-root">
      <div className="pw-head">
        <div className="pw-title">
          <strong>run {run.runId.slice(0, 14)}…</strong>
          <span className={`pw-run-badge rs-${run.status}`}>{run.status}{run.abortReason ? `(${run.abortReason})` : ""}</span>
          {isLive && <span className="pw-live-dot" />}
        </div>
        <div className="pw-meta">
          <span>⏱ {fmtDur(run.endedAt ? run.endedAt - run.startedAt : Date.now() - run.startedAt)}</span>
          <span>调用 {run.usage.llmCalls} 次</span>
          {run.stats && <span>✓{run.stats.success} ✗{run.stats.failed} ○{run.stats.skipped}</span>}
        </div>
        {isLive ? (
          <button className="pw-abort" onClick={async () => {
            await fetch(`/api/pipeline-runs/${run.runId}/abort`, { method: "POST" });
          }}>中止</button>
        ) : (
          <button className="pw-hist-toggle" onClick={() => usePipelinesStore.getState().clearActiveRun()}>历史</button>
        )}
        <button className="pw-close" onClick={onClose}>✕</button>
      </div>

      <div className="pw-body">
        {/* 左栏：步骤时间线 */}
        <div className="pw-timeline">
          {run.steps.map((s, i) => {
            const key = stepKey(s);
            return <StepRow key={key + i} step={s} selected={selectedKey === key} onClick={() => setSelectedKey(key)} />;
          })}
          {run.steps.length === 0 && <div className="pw-empty small">等待第一个步骤…</div>}
        </div>

        {/* 中栏：画布 / 钻入过程视图 */}
        <div className="pw-center">
          {activeSub ? (
            <PipelineStepDrill />
          ) : (
            <>
              <div className="pw-center-tabs">
                <button className={tab === "canvas" ? "on" : ""} onClick={() => setTab("canvas")}>画布</button>
                <button className={tab === "process" ? "on" : ""} onClick={() => setTab("process")}>过程流</button>
              </div>
              {tab === "canvas" ? (
                <PipelineCanvas pipelineId={run.pipelineId} steps={run.steps} />
              ) : (
                <PipelineProcessStream steps={run.steps} onSelect={(k) => setSelectedKey(k)} />
              )}
            </>
          )}
        </div>

        {/* 右栏：步骤详情 */}
        <div className="pw-detail">
          {selectedStep ? (
            <StepDetail step={selectedStep} />
          ) : (
            <div className="pw-empty small">点击时间线步骤查看详情</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 步骤定位 key */
function stepKey(s: RunStep): string {
  return `${s.stepId}|${s.instanceKey ?? ""}|${s.attempt}|${s.iteration}`;
}

/** 中栏「过程流」tab：按执行顺序平铺所有子 agent 消息（不钻入也能看） */
function PipelineProcessStream({ steps, onSelect }: { steps: RunStep[]; onSelect: (key: string) => void }) {
  const subagents = usePipelinesStore((s) => s.subagents);
  const entries = Object.values(subagents);
  const ordered = useMemo(() => {
    // 按 subId 在 steps 里出现的顺序
    const order = new Map<string, number>();
    steps.forEach((s, i) => { if (s.subId) order.set(s.subId, i); });
    return entries.sort((a, b) => (order.get(a.subId) ?? 999) - (order.get(b.subId) ?? 999));
  }, [entries.map(e => e.subId).join(","), steps]);

  if (ordered.length === 0) return <div className="pw-empty small">暂无子 agent 执行记录<br /><span>运行流水线后，每个步骤的子 agent 过程会实时流式出现在这里</span></div>;
  return (
    <div className="pw-process-stream">
      {ordered.map((sa) => (
        <div key={sa.subId} className="pw-process-block">
          <button className="pw-process-block-head" onClick={() => onSelect(stepKey(steps.find(s => s.subId === sa.subId) ?? { stepId: "", instanceKey: "", attempt: 1, iteration: 1, status: "pending" }))}>
            <span className={`pw-sub-dot ${sa.status}`} />
            <span className="pw-process-block-title">{sa.goal.slice(0, 80)}</span>
            <span className="pw-process-block-dur">{fmtDur(sa.durationMs)}</span>
            <span className="pw-process-open">钻入 →</span>
          </button>
        </div>
      ))}
    </div>
  );
}

/** C1 步骤钻入：与 ChatPanel 子 agent 钻入同构，MessageItem 列表（ProcessSection 扁平行风格） */
function PipelineStepDrill() {
  const activeSubId = usePipelinesStore((s) => s.activeSubId);
  const sub = usePipelinesStore((s) => (s.activeSubId ? s.subagents[s.activeSubId] : undefined));
  const bottomRef = useMemo(() => ({ current: null as HTMLDivElement | null }), []);
  const msgCount = sub?.messages.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgCount]);

  if (!sub) return null;
  return (
    <div className="pw-drill">
      <div className="subagent-view-bar">
        <button className="subagent-back-btn" onClick={() => usePipelinesStore.getState().setActiveSubId(null)}>
          <span className="subagent-back-arrow">←</span> 返回画布
        </button>
        <div className="subagent-view-title">
          <span className="subagent-view-icon">{sub.status === "running" ? "●" : sub.status === "done" ? "✓" : "✕"}</span>
          <span className="subagent-view-goal">{sub.goal.slice(0, 100)}</span>
        </div>
        <div className="subagent-view-status">
          {sub.status === "running" ? "执行中…" : sub.status === "done" ? "已完成" : "出错"}
          {sub.tokens != null && <span className="pw-drill-tokens">{sub.tokens} tok</span>}
        </div>
      </div>
      <div className="messages">
        {sub.messages.length === 0 ? (
          <div className="pw-empty small" style={{ minHeight: 120 }}>
            {sub.status === "running" ? "子 agent 正在启动…" : "暂无执行记录"}
          </div>
        ) : (
          sub.messages.map((msg) => <MessageItem key={msg.id} msg={msg} />)
        )}
        <div ref={(el) => { bottomRef.current = el; }} />
      </div>
    </div>
  );
}

/** 右栏步骤详情（含钻入按钮） */
function StepDetail({ step }: { step: RunStep }) {
  const subagents = usePipelinesStore((s) => s.subagents);
  const sub = step.subId ? subagents[step.subId] : undefined;
  const meta = STATUS_META[step.status] ?? STATUS_META.pending;
  return (
    <div className="pw-detail-inner">
      <h3>
        {step.stepId}
        {step.instanceKey ? ` · ${step.instanceKey}` : ""}
        {step.iteration > 1 ? ` · 第${step.iteration}轮` : ""}
      </h3>
      <div className="pw-detail-grid">
        <span>状态</span><b>{meta.label}</b>
        <span>耗时</span><b>{fmtDur(step.durationMs)}</b>
        {step.verdict && <>
          <span>裁决</span>
          <b>{step.verdict}（{step.verdictSource === "command" ? "命令通道" : "LLM通道"}）</b>
        </>}
      </div>
      {sub && (
        <button className="pw-drill-btn" onClick={() => usePipelinesStore.getState().setActiveSubId(sub.subId)}>
          钻入执行过程 →
        </button>
      )}
      {step.warnings?.length ? (
        <div className="pw-warnings">{step.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>
      ) : null}
      {step.error && <div className="pw-error">✗ {step.error}</div>}
      <details open>
        <summary>输入</summary>
        <pre>{step.inputDigest ?? "（无）"}</pre>
      </details>
      <details open>
        <summary>输出</summary>
        <pre>{step.output ?? "（无）"}</pre>
      </details>
    </div>
  );
}

// ── 侧栏流水线列表（运行入口） ──

/** 侧栏：流水线定义列表 + 最近运行（点击 → loadRun + 打开 workbench） */
export function PipelineSidebarList({ onOpenRun }: { onOpenRun: () => void }) {
  const pipelines = usePipelinesStore((s) => s.pipelines);
  const runHistory = usePipelinesStore((s) => s.runHistory);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    usePipelinesStore.getState().load();
    usePipelinesStore.getState().loadRunHistory();
  }, []);

  const handleRun = async (p: PipelineDef) => {
    const input = prompt(`运行「${p.name}」\n输入需求描述：`);
    if (!input?.trim()) return;
    setRunning(p.id);
    try {
      const res = await fetch(`/api/pipelines/${p.id}/runs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      await usePipelinesStore.getState().loadRun(data.runId);
      usePipelinesStore.getState().loadRunHistory();
      onOpenRun();
    } finally {
      setRunning(null);
    }
  };

  const openRun = async (runId: string) => {
    await usePipelinesStore.getState().loadRun(runId);
    onOpenRun();
  };

  return (
    <div className="pw-sidebar-list">
      <div className="pw-sidebar-group">
        <div className="pw-sidebar-head">流水线</div>
        {pipelines.map((p) => (
          <div key={p.id} className="pw-sidebar-prow">
            <span className="pw-sidebar-picon">{p.icon}</span>
            <span className="pw-sidebar-pname" title={p.description}>{p.name}</span>
            <button className="pw-sidebar-run" title="运行" disabled={running === p.id}
              onClick={() => handleRun(p)}>{running === p.id ? "…" : "▶"}</button>
          </div>
        ))}
        {pipelines.length === 0 && (
          <div className="pw-empty small">暂无流水线<br /><span>在「设置 → 流水线」创建</span></div>
        )}
      </div>
      <div className="pw-sidebar-group">
        <div className="pw-sidebar-head">最近运行</div>
        {runHistory.slice(0, 15).map((h: RunIndexEntry) => (
          <button key={h.runId} className="pw-sidebar-hrow" onClick={() => openRun(h.runId)}>
            <span className={`pw-run-badge rs-${h.status}`}>{h.status === "running" ? "●" : h.status === "success" ? "✓" : h.status === "failed" ? "✗" : "○"}</span>
            <span className="pw-sidebar-hname">{h.pipelineName}</span>
            <span className="pw-sidebar-htime">{fmtTime(h.startedAt)}</span>
          </button>
        ))}
        {runHistory.length === 0 && <div className="pw-empty small">暂无运行</div>}
      </div>
    </div>
  );
}
