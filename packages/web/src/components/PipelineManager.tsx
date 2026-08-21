// components/PipelineManager.tsx — 流水线管理（树形表单编辑器 + JSON 双视图）
//
// 嵌入设置页面使用。编辑模型：树形步骤列表（可折叠/增删/上下移）+ 属性面板。
// JSON 视图与表单双向同步（透明原则）。

import { useEffect, useState, useCallback } from "react";
import {
  usePipelinesStore, type PipelineDef, type StepNode,
} from "../stores/pipelines";
import { useAgentsStore } from "../stores/agents";

interface EditState {
  isNew: boolean;
  id?: string;
  name: string;
  description: string;
  icon: string;
  steps: StepNode[];
  maxParallel: number;
  maxLLMCalls: number;
}

const blankEdit: EditState = {
  isNew: true, icon: "➡️", name: "", description: "", steps: [], maxParallel: 3, maxLLMCalls: 40,
};

export function PipelineManagerSection() {
  const pipelines = usePipelinesStore((s) => s.pipelines);
  const loadError = usePipelinesStore((s) => s.loadError);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [issues, setIssues] = useState<{ code: string; message: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");

  useEffect(() => { usePipelinesStore.getState().load(); }, []);

  const startNew = () => {
    setEditing({ ...blankEdit });
    setIssues([]);
    setJsonMode(false);
  };

  const startEdit = (p: PipelineDef) => {
    setEditing({
      isNew: false, id: p.id, name: p.name, description: p.description, icon: p.icon,
      steps: JSON.parse(JSON.stringify(p.steps)),
      maxParallel: p.maxParallel ?? 3, maxLLMCalls: p.budget?.maxLLMCalls ?? 40,
    });
    setIssues([]);
    setJsonMode(false);
  };

  /** 表单 → 提交体 */
  const buildBody = (e: EditState) => ({
    name: e.name.trim(),
    description: e.description,
    icon: e.icon,
    steps: e.steps,
    maxParallel: e.maxParallel,
    budget: { maxLLMCalls: e.maxLLMCalls },
  });

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { alert("请填写名称"); return; }
    setSaving(true);
    try {
      const body = buildBody(editing);
      const res = editing.isNew
        ? await fetch("/api/pipelines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/pipelines/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setIssues(data.issues ?? [{ code: "error", message: data.error }]);
        return;
      }
      setEditing(null);
      await usePipelinesStore.getState().load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: PipelineDef) => {
    if (!confirm(`删除流水线「${p.name}」？执行历史会保留。`)) return;
    await fetch(`/api/pipelines/${p.id}`, { method: "DELETE" });
    await usePipelinesStore.getState().load();
  };

  const handleRun = async (p: PipelineDef) => {
    const input = prompt(`运行「${p.name}」\n输入需求描述：`);
    if (!input?.trim()) return;
    const res = await fetch(`/api/pipelines/${p.id}/runs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: input.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    alert(`已启动 run：${data.runId}`);
  };

  // ── JSON 模式：进出同步 ──
  useEffect(() => {
    if (jsonMode && editing) setJsonText(JSON.stringify(editing.steps, null, 2));
  }, [jsonMode]);

  const applyJson = () => {
    if (!editing) return;
    try {
      const steps = JSON.parse(jsonText);
      setEditing({ ...editing, steps });
      setJsonMode(false);
      setIssues([]);
    } catch (e: any) {
      alert(`JSON 解析失败：${e.message}`);
    }
  };

  // ── 步骤树操作 ──
  const mutateSteps = (fn: (steps: StepNode[]) => StepNode[]) => {
    if (!editing) return;
    setEditing({ ...editing, steps: fn(editing.steps) });
  };

  return (
    <div className="agent-mgr-body">
      {loadError && (
        <div className="mgr-load-error">
          <span>⚠️ 流水线列表加载失败：{loadError}</span>
          <button onClick={() => usePipelinesStore.getState().load()}>重试</button>
        </div>
      )}

      {editing ? (
        <div className="pipeline-editor">
          <div className="pipeline-editor-head">
            <input className="pipeline-icon-input" value={editing.icon} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} maxLength={4} />
            <input className="pipeline-name-input" placeholder="流水线名称" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <button className={`pipeline-mode-btn ${jsonMode ? "on" : ""}`} onClick={() => (jsonMode ? applyJson() : setJsonMode(true))}>
              {jsonMode ? "应用 JSON" : "JSON 视图"}
            </button>
            <button className="settings-close-btn" onClick={() => setEditing(null)} disabled={saving}>取消</button>
            <button className="settings-save-btn" onClick={handleSave} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
          </div>
          <input className="pipeline-desc-input" placeholder="描述（可选）" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          <div className="pipeline-globals">
            <label>并行上限 <input type="number" min={1} max={10} value={editing.maxParallel} onChange={(e) => setEditing({ ...editing, maxParallel: Number(e.target.value) || 1 })} /></label>
            <label>LLM 预算 <input type="number" min={1} value={editing.maxLLMCalls} onChange={(e) => setEditing({ ...editing, maxLLMCalls: Number(e.target.value) || 1 })} /></label>
          </div>

          {jsonMode ? (
            <textarea className="pipeline-json-editor" value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} />
          ) : (
            <StepTreeEditor steps={editing.steps} onChange={mutateSteps} />
          )}

          {issues.length > 0 && (
            <div className="pipeline-issues">
              <strong>校验问题（{issues.length}）：</strong>
              <ul>{issues.map((i, idx) => <li key={idx}>⚠️ {i.message}</li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="agent-mgr-list">
            {pipelines.map((p) => (
              <div key={p.id} className="agent-mgr-row">
                <span className="agent-mgr-icon">{p.icon}</span>
                <div className="agent-mgr-info">
                  <span className="agent-mgr-name">{p.name}</span>
                  {p.description && <span className="agent-mgr-desc">{p.description}</span>}
                  <span className="agent-mgr-model">{p.steps.length} 步骤 · 并行{p.maxParallel} · 预算{p.budget?.maxLLMCalls ?? 40}</span>
                </div>
                <div className="agent-mgr-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="agent-mgr-edit" onClick={() => handleRun(p)} title="运行">▶</button>
                  <button className="agent-mgr-edit" onClick={() => startEdit(p)} title="编辑">✎</button>
                  <button className="agent-mgr-del" onClick={() => handleDelete(p)} title="删除">🗑</button>
                </div>
              </div>
            ))}
          </div>
          <button className="agent-mgr-add" onClick={startNew}>＋ 新建流水线</button>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 树形步骤编辑器
// ════════════════════════════════════════════════════════

function StepTreeEditor({ steps, onChange, depth = 0 }: { steps: StepNode[]; onChange: (fn: (s: StepNode[]) => StepNode[]) => void; depth?: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const agents = useAgentsStore((s) => s.agents);

  const collectIds = (list: StepNode[]): string[] => {
    const ids: string[] = [];
    const walk = (nodes: StepNode[]) => {
      for (const n of nodes) {
        ids.push(n.id);
        if (n.type === "parallel" || n.type === "loop" || n.type === "foreach") walk(n.steps);
        else if (n.type === "conditional") {
          for (const b of n.branches) walk(b.steps);
          if (n.default) walk(n.default);
        }
      }
    };
    walk(list);
    return ids;
  };
  const allIds = collectIds(steps);

  const addStep = (type: StepNode["type"]): void => {
    const id = `${type}-${Date.now().toString(36).slice(-4)}`;
    let node: StepNode;
    switch (type) {
      case "agent":
        node = { type: "agent", id, name: "新步骤", role: "执行", inputsFrom: "all" };
        break;
      case "parallel":
        node = { type: "parallel", id, steps: [] };
        break;
      case "conditional":
        node = { type: "conditional", id, branches: [{ predicate: { kind: "verdict-eq", stepId: "", value: "pass" }, steps: [] }] };
        break;
      case "loop":
        node = { type: "loop", id, loopType: "dowhile", maxIterations: 3, exitWhen: { kind: "verdict-eq", stepId: "", value: "fail" }, steps: [] };
        break;
      case "foreach":
        node = { type: "foreach", id, fromStepId: "", source: "output", steps: [] };
        break;
      default:
        node = { type: "sleep", id, durationMs: 5000 };
    }
    onChange((s) => [...s, node]);
    setSelected(id);
  };

  const removeStep = (id: string) => {
    onChange((s) => s.filter((n) => n.id !== id));
    if (selected === id) setSelected(null);
  };

  const move = (idx: number, dir: -1 | 1) => {
    onChange((s) => {
      const next = [...s];
      const t = idx + dir;
      if (t < 0 || t >= next.length) return s;
      [next[idx], next[t]] = [next[t], next[idx]];
      return next;
    });
  };

  const updateNode = (id: string, patch: Record<string, unknown>) => {
    onChange((s) => s.map((n) => (n.id === id ? ({ ...n, ...patch } as StepNode) : n)));
  };

  return (
    <div className="step-tree" style={{ marginLeft: depth * 12 }}>
      <div className="step-tree-toolbar">
        {(["agent", "parallel", "conditional", "loop", "foreach", "sleep"] as const).map((t) => (
          <button key={t} className="step-add-btn" onClick={() => addStep(t)}>＋{t}</button>
        ))}
      </div>
      {steps.length === 0 && <div className="step-tree-empty">暂无步骤，用上方按钮添加</div>}
      {steps.map((node, idx) => (
        <div key={node.id} className={`step-node-row ${selected === node.id ? "selected" : ""}`}>
          <button className="step-node-main" onClick={() => setSelected(selected === node.id ? null : node.id)}>
            <span className={`step-type-badge t-${node.type}`}>{node.type}</span>
            <span className="step-node-label">{node.type === "agent" ? node.name : node.type === "sleep" ? `${node.durationMs}ms` : node.id}</span>
          </button>
          <span className="step-row-actions">
            <button onClick={() => move(idx, -1)} disabled={idx === 0} title="上移">↑</button>
            <button onClick={() => move(idx, 1)} disabled={idx === steps.length - 1} title="下移">↓</button>
            <button onClick={() => removeStep(node.id)} title="删除">✕</button>
          </span>

          {selected === node.id && (
            <div className="step-props">
              <label>ID <input value={node.id} onChange={(e) => updateNode(node.id, { id: e.target.value } as any)} /></label>
              {node.type === "agent" && (
                <>
                  <label>名称 <input value={node.name} onChange={(e) => updateNode(node.id, { name: e.target.value } as any)} /></label>
                  <label>角色 <input value={node.role} onChange={(e) => updateNode(node.id, { role: e.target.value } as any)} /></label>
                  <label>
                    Agent
                    <select value={node.agentId ?? ""} onChange={(e) => updateNode(node.id, { agentId: e.target.value || undefined } as any)}>
                      <option value="">（默认）</option>
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                    </select>
                  </label>
                  <label>指令 <textarea value={node.instructions ?? ""} onChange={(e) => updateNode(node.id, { instructions: e.target.value } as any)} rows={2} /></label>
                  <label>输入来源 <input value={Array.isArray(node.inputsFrom) ? node.inputsFrom.join(",") : node.inputsFrom} placeholder="all 或 id逗号分隔"
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      updateNode(node.id, { inputsFrom: v === "all" || !v ? "all" : v.split(",").map((s) => s.trim()).filter(Boolean) } as any);
                    }} /></label>
                  <label>重试 <input type="number" min={0} max={3} value={node.retry?.maxRetries ?? 0}
                    onChange={(e) => updateNode(node.id, { retry: { maxRetries: Number(e.target.value) || 0 } } as any)} /></label>
                  <label>产物 <input value={(node.artifacts ?? []).join(",")} placeholder="逗号分隔路径"
                    onChange={(e) => updateNode(node.id, { artifacts: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } as any)} /></label>
                  <details className="step-verdict-box">
                    <summary>裁决 {node.verdict ? "✓" : ""}</summary>
                    {!node.verdict ? (
                      <button onClick={() => updateNode(node.id, { verdict: { type: "pass-fail", promptHint: '输出 ```json {"verdict":"pass|fail"} ```' } } as any)}>添加裁决</button>
                    ) : (
                      <>
                        <label>类型
                          <select value={node.verdict.type} onChange={(e) => updateNode(node.id, { verdict: { ...node.verdict!, type: e.target.value as any } } as any)}>
                            <option value="pass-fail">pass-fail</option>
                            <option value="route">route</option>
                          </select>
                        </label>
                        <label>命令（确定性通道）<input value={node.verdict.command?.cmd ?? ""} placeholder="如 pnpm test（留空=只用LLM）"
                          onChange={(e) => updateNode(node.id, { verdict: { ...node.verdict!, command: e.target.value ? { cmd: e.target.value, passWhen: "pass" } : undefined } } as any)} /></label>
                        <label>Prompt 提示 <textarea value={node.verdict.promptHint ?? ""} rows={2}
                          onChange={(e) => updateNode(node.id, { verdict: { ...node.verdict!, promptHint: e.target.value } } as any)} /></label>
                        <button onClick={() => updateNode(node.id, { verdict: undefined } as any)}>移除裁决</button>
                      </>
                    )}
                  </details>
                  {node.needsUserInput !== undefined && <span className="step-flag">闸门</span>}
                </>
              )}
              {node.type === "loop" && (
                <>
                  <label>类型
                    <select value={node.loopType} onChange={(e) => updateNode(node.id, { loopType: e.target.value as any } as any)}>
                      <option value="dowhile">dowhile（满足继续）</option>
                      <option value="dountil">dountil（满足停止）</option>
                    </select>
                  </label>
                  <label>出口步骤 <select value={node.exitWhen.stepId} onChange={(e) => updateNode(node.id, { exitWhen: { ...node.exitWhen, stepId: e.target.value } } as any)}>
                    <option value="">（选择）</option>
                    {allIds.filter((i) => i !== node.id).map((i) => <option key={i} value={i}>{i}</option>)}
                  </select></label>
                  <label>出口值 <input value={node.exitWhen.value} onChange={(e) => updateNode(node.id, { exitWhen: { ...node.exitWhen, value: e.target.value } } as any)} /></label>
                  <label>最大轮次 <input type="number" min={1} max={5} value={node.maxIterations} onChange={(e) => updateNode(node.id, { maxIterations: Number(e.target.value) || 1 } as any)} /></label>
                </>
              )}
              {node.type === "foreach" && (
                <>
                  <label>来源步骤 <select value={node.fromStepId} onChange={(e) => updateNode(node.id, { fromStepId: e.target.value } as any)}>
                    <option value="">（选择）</option>
                    {allIds.filter((i) => i !== node.id).map((i) => <option key={i} value={i}>{i}</option>)}
                  </select></label>
                  <label>来源
                    <select value={node.source} onChange={(e) => updateNode(node.id, { source: e.target.value as any } as any)}>
                      <option value="output">上游输出</option>
                      <option value="artifact">产物文件</option>
                    </select>
                  </label>
                  {node.source === "artifact" && <label>文件路径 <input value={node.path ?? ""} onChange={(e) => updateNode(node.id, { path: e.target.value } as any)} /></label>}
                  <label>标题键 <input value={node.itemKey ?? ""} placeholder="如 title" onChange={(e) => updateNode(node.id, { itemKey: e.target.value || undefined } as any)} /></label>
                  <label>并发 <input type="number" min={1} max={10} value={node.concurrency ?? 3} onChange={(e) => updateNode(node.id, { concurrency: Number(e.target.value) || 1 } as any)} /></label>
                </>
              )}
              {(node.type === "parallel" || node.type === "loop" || node.type === "foreach") && (
                <div className="step-children">
                  <strong>子步骤</strong>
                  <StepTreeEditor steps={node.steps} onChange={(fn) => updateNode(node.id, { steps: fn(node.steps) } as any)} depth={depth + 1} />
                </div>
              )}
              {node.type === "conditional" && (
                <div className="step-children">
                  {node.branches.map((b, bi) => (
                    <div key={bi} className="cond-branch">
                      <strong>分支 {bi}（{b.predicate.stepId} == {b.predicate.value}）</strong>
                      <StepTreeEditor steps={b.steps} onChange={(fn) => {
                        const branches = node.branches.map((x, xi) => (xi === bi ? { ...x, steps: fn(x.steps) } : x));
                        updateNode(node.id, { branches } as any);
                      }} depth={depth + 1} />
                    </div>
                  ))}
                  <button onClick={() => updateNode(node.id, { branches: [...node.branches, { predicate: { kind: "verdict-eq", stepId: "", value: "" }, steps: [] }] } as any)}>＋ 分支</button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
