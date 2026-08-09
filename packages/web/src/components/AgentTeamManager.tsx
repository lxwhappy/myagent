// components/AgentTeamManager.tsx — Agent 团队管理
//
// 团队是一组已有 Agent 预设的有序编排方案。
// 编排模式从 /api/orchestration-modes 动态拉取（内置 8 种 + 自定义）。
//
// AgentTeamManagerSection：内联内容（嵌入设置页面），无 portal/overlay。
// AgentTeamManager：弹窗 wrapper（向后兼容）。

import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAgentTeamsStore, type AgentTeam, type TeamMember } from "../stores/agent-teams";
import { useAgentsStore } from "../stores/agents";
import { useOrchestrationModesStore, type OrchestrationMode } from "../stores/orchestration-modes";
import { Icon } from "./Icon";
import { AgentFlowGraph, buildFlowFromTopology, type FlowNodeDef, type FlowEdgeDef } from "./AgentFlowGraph";

const TEAM_EMOJI_CHOICES = ["👥", "🔧", "🔬", "🏗", "🎯", "⚡", "🚀", "🛡", "📋", "🔄"];

interface EditState {
  isNew: boolean;
  id?: string;
  icon: string;
  name: string;
  description: string;
  mode: string;
  members: TeamMember[];
  maxRetries: number;
  optionValues: Record<string, string | number>;
  dagEdges?: Array<{ source: number; target: number }>;
  customPrompt?: string;
  promptTouched: boolean;  // 用户是否修改过提示词（决定是否覆盖模式默认）
}

const blankEdit: EditState = { isNew: true, icon: "👥", name: "", description: "", mode: "pipeline", members: [], maxRetries: 2, optionValues: {}, promptTouched: false };

/**
 * Agent 团队管理内联内容 — 嵌入设置页面使用。
 */
export function AgentTeamManagerSection() {
  const teams = useAgentTeamsStore(s => s.teams);
  const agents = useAgentsStore(s => s.agents);
  const modes = useOrchestrationModesStore(s => s.modes);
  const loadModes = useOrchestrationModesStore(s => s.load);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  // 加载编排模式列表
  useEffect(() => { if (modes.length === 0) loadModes(); }, []);

  // 模式查找辅助
  const getMode = (id: string): OrchestrationMode | undefined => modes.find(m => m.id === id);

  const startNew = () => setEditing({ ...blankEdit });
  const startEdit = (t: AgentTeam) => setEditing({
    isNew: false, id: t.id, icon: t.icon, name: t.name,
    description: t.description, mode: t.mode || "pipeline", members: [...t.members],
    maxRetries: t.maxRetries ?? 2,
    optionValues: t.optionValues ?? {},
    dagEdges: t.dagEdges,
    customPrompt: t.customPrompt,
    promptTouched: !!t.customPrompt?.trim(),
  });

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { alert("请填写团队名称"); return; }
    if (editing.members.length === 0) { alert("请至少添加一个成员"); return; }
    const modeDef = getMode(editing.mode);
    if (modeDef && editing.members.length < modeDef.minMembers) {
      alert(`此模式至少需要 ${modeDef.minMembers} 个成员`);
      return;
    }
    if (modeDef?.maxMembers && editing.members.length > modeDef.maxMembers) {
      alert(`此模式最多支持 ${modeDef.maxMembers} 个成员`);
      return;
    }
    setSaving(true);
    // 构建选项值
    const optionValues: Record<string, string | number> = { ...editing.optionValues };
    if (modeDef?.options?.some(o => o.key === "maxRetries")) {
      optionValues.maxRetries = editing.maxRetries;
    }
    if (editing.isNew) {
      const created = await useAgentTeamsStore.getState().create({
        name: editing.name.trim(),
        description: editing.description.trim(),
        icon: editing.icon,
        mode: editing.mode,
        members: editing.members,
        maxRetries: editing.maxRetries,
        optionValues,
        dagEdges: editing.mode === "custom" ? editing.dagEdges : undefined,
        customPrompt: editing.promptTouched ? editing.customPrompt : undefined,
      });
      if (created) setEditing(null);
    } else if (editing.id) {
      const ok = await useAgentTeamsStore.getState().update(editing.id, {
        name: editing.name.trim(),
        description: editing.description.trim(),
        icon: editing.icon,
        mode: editing.mode,
        members: editing.members,
        maxRetries: editing.maxRetries,
        optionValues,
        dagEdges: editing.mode === "custom" ? editing.dagEdges : undefined,
        customPrompt: editing.promptTouched ? editing.customPrompt : undefined,
      });
      if (ok) setEditing(null);
    }
    setSaving(false);
  };

  const handleDelete = async (t: AgentTeam) => {
    if (!confirm(`确定删除团队「${t.name}」？`)) return;
    await useAgentTeamsStore.getState().remove(t.id);
    if (editing?.id === t.id) setEditing(null);
  };

  // ── 成员操作 ──
  const addMember = (agentId: string) => {
    if (!editing) return;
    setEditing({
      ...editing,
      members: [...editing.members, { agentId, role: "成员" }],
    });
  };

  const removeMember = (idx: number) => {
    if (!editing) return;
    setEditing({ ...editing, members: editing.members.filter((_, i) => i !== idx) });
  };

  const moveMember = (idx: number, dir: -1 | 1) => {
    if (!editing) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= editing.members.length) return;
    const arr = [...editing.members];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setEditing({ ...editing, members: arr });
  };

  const updateMember = (idx: number, patch: Partial<TeamMember>) => {
    if (!editing) return;
    setEditing({
      ...editing,
      members: editing.members.map((m, i) => i === idx ? { ...m, ...patch } : m),
    });
  };

  const agentName = (id: string) => agents.find(a => a.id === id)?.name ?? "未知 Agent";
  const agentIcon = (id: string) => agents.find(a => a.id === id)?.icon ?? "❓";

  if (editing) {
    const currentMode = getMode(editing.mode);
    return (
      <div className="agent-mgr-form">
        {/* 图标 + 名称 */}
        <div className="agent-edit-field">
          <label>图标</label>
          <div className="agent-emoji-row">
            <input
              className="agent-emoji-input"
              value={editing.icon}
              onChange={(e) => setEditing({ ...editing, icon: e.target.value.slice(0, 4) })}
              maxLength={4}
            />
            <div className="agent-emoji-choices">
              {TEAM_EMOJI_CHOICES.map(em => (
                <button
                  key={em}
                  className={`agent-emoji-choice ${editing.icon === em ? "sel" : ""}`}
                  onClick={() => setEditing({ ...editing, icon: em })}
                  type="button"
                >{em}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="agent-edit-field">
          <label>团队名称</label>
          <input
            className="settings-input"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder="如：开发+测试团队"
            maxLength={30}
          />
        </div>

        <div className="agent-edit-field">
          <label>描述（可选）</label>
          <input
            className="settings-input"
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            placeholder="一句话说明这个团队的工作流程"
            maxLength={200}
          />
        </div>

        {/* 编排模式选择 */}
        <div className="agent-edit-field">
          <label>编排模式</label>
          <div className="team-mode-selector">
            {modes.map(m => (
              <button
                key={m.id}
                type="button"
                className={`team-mode-card ${editing.mode === m.id ? "active" : ""}`}
                onClick={() => setEditing({ ...editing, mode: m.id })}
              >
                <span className="team-mode-icon">{m.icon}</span>
                <div className="team-mode-text">
                  <span className="team-mode-label">
                    {m.name}
                    {!m.isBuiltIn && <span className="team-mode-custom-tag">自定义</span>}
                  </span>
                  <span className="team-mode-desc">{m.description}</span>
                </div>
              </button>
            ))}
          </div>
          {/* 模式专属选项 */}
          {currentMode?.options?.map(opt => (
            <div key={opt.key} className="team-retries-row">
              <label className="team-retries-label">{opt.label}</label>
              {opt.type === "number" ? (
                <input
                  type="number"
                  min={opt.min}
                  max={opt.max}
                  value={editing.optionValues[opt.key] ?? opt.default ?? 0}
                  onChange={e => setEditing({
                    ...editing,
                    optionValues: { ...editing.optionValues, [opt.key]: parseInt(e.target.value) || 0 },
                    // 兼容 maxRetries 字段
                    ...(opt.key === "maxRetries" ? { maxRetries: parseInt(e.target.value) || 2 } : {}),
                  })}
                  className="settings-input team-retries-input"
                />
              ) : opt.type === "select" ? (
                <select
                  className="settings-input team-retries-input"
                  value={String(editing.optionValues[opt.key] ?? opt.default ?? "")}
                  onChange={e => setEditing({
                    ...editing,
                    optionValues: { ...editing.optionValues, [opt.key]: e.target.value },
                  })}
                >
                  {opt.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  className="settings-input team-retries-input"
                  value={String(editing.optionValues[opt.key] ?? opt.default ?? "")}
                  onChange={e => setEditing({
                    ...editing,
                    optionValues: { ...editing.optionValues, [opt.key]: e.target.value },
                  })}
                />
              )}
            </div>
          ))}
        </div>

        {/* DAG 可视化预览 */}
        {editing.members.length > 0 && currentMode && (
          <div className="agent-edit-field">
            <label>流程预览</label>
            <TeamFlowPreview
              editing={editing}
              mode={currentMode}
              agentIcon={agentIcon}
              agentName={agentName}
              onDagEdgesChange={(dagEdges) => setEditing({ ...editing, dagEdges })}
            />
          </div>
        )}

        {/* 编排指令：展示模式默认模板，用户可修改 */}
        {currentMode && editing.members.length > 0 && (
          <div className="agent-edit-field">
            <label>
              编排指令
              {!editing.promptTouched
                ? <span className="agent-tools-hint">（模式默认，修改后覆盖）</span>
                : <span className="agent-tools-hint">（已自定义，清空恢复默认）</span>
              }
              {editing.promptTouched && (
                <button
                  type="button"
                  className="agent-fullprompt-raw"
                  onClick={() => setEditing({ ...editing, customPrompt: undefined, promptTouched: false })}
                >恢复默认</button>
              )}
            </label>
            <textarea
              className="agent-edit-prompt team-prompt-editor"
              value={editing.promptTouched
                ? (editing.customPrompt ?? "")
                : currentMode.promptTemplate}
              onChange={(e) => setEditing({
                ...editing,
                customPrompt: e.target.value,
                promptTouched: true,
              })}
              placeholder={currentMode.promptTemplate}
              rows={10}
            />
            <div className="agent-edit-hint">
              模板变量 <code>{`{{members_list}}`}</code> <code>{`{{user_message}}`}</code> 等会在执行时自动替换为实际值。
              选中成员后修改角色名/指令会实时影响编排效果。
            </div>
          </div>
        )}

        {/* 团队成员（执行流水线） */}
        <div className="agent-edit-field">
          <label>
            团队成员（按执行顺序）
            {editing.members.length > 0 && (
              <span className="agent-tools-hint">（{editing.members.length} 个成员）</span>
            )}
            {currentMode && (
              <span className="agent-tools-hint">
                （{currentMode.minMembers}{currentMode.maxMembers ? `-${currentMode.maxMembers}` : "+"} 个）
              </span>
            )}
          </label>

          {editing.members.length > 0 && (
            <div className="team-pipeline">
              {editing.members.map((m, idx) => (
                <div key={idx} className="team-pipeline-step">
                  <div className="team-step-header">
                    <span className="team-step-num">{idx + 1}</span>
                    <input
                      className="team-step-role"
                      value={m.role}
                      onChange={(e) => updateMember(idx, { role: e.target.value })}
                      placeholder="角色名（如：开发、测试）"
                      maxLength={20}
                    />
                    <div className="team-step-controls">
                      <button
                        type="button"
                        className="team-step-btn"
                        onClick={() => moveMember(idx, -1)}
                        disabled={idx === 0}
                        title="上移"
                      >↑</button>
                      <button
                        type="button"
                        className="team-step-btn"
                        onClick={() => moveMember(idx, 1)}
                        disabled={idx === editing.members.length - 1}
                        title="下移"
                      >↓</button>
                      <button
                        type="button"
                        className="team-step-btn danger"
                        onClick={() => removeMember(idx)}
                        title="移除"
                      >✕</button>
                    </div>
                  </div>
                  <div className="team-step-agent">
                    <span className="team-step-agent-icon">{agentIcon(m.agentId)}</span>
                    <span className="team-step-agent-name">{agentName(m.agentId)}</span>
                  </div>
                  <textarea
                    className="team-step-instructions"
                    value={m.instructions || ""}
                    onChange={(e) => updateMember(idx, { instructions: e.target.value })}
                    placeholder="该步骤的额外指令（可选，追加到 Agent 的角色指令之后）"
                    rows={2}
                  />
                  {idx < editing.members.length - 1 && <div className="team-step-arrow">↓</div>}
                </div>
              ))}
            </div>
          )}

          {/* 添加成员：从已有 Agent 列表选择 */}
          <div className="team-add-member">
            <div className="team-add-member-label">添加成员：</div>
            <div className="team-add-member-grid">
              {agents
                .filter(a => !editing.members.some(m => m.agentId === a.id))
                .map(a => (
                  <button
                    key={a.id}
                    type="button"
                    className="team-add-agent-chip"
                    onClick={() => addMember(a.id)}
                    title={a.description}
                  >
                    <span>{a.icon}</span>
                    <span>{a.name}</span>
                    <Icon name="i-plus" size={12} />
                  </button>
                ))}
              {agents.filter(a => !editing.members.some(m => m.agentId === a.id)).length === 0 && (
                <span className="agent-tools-fallback-hint">所有 Agent 都已加入</span>
              )}
            </div>
          </div>
        </div>

        {currentMode?.detail && (
          <div className="agent-edit-hint">{currentMode.detail}</div>
        )}

        <div className="agent-edit-actions">
          <button className="settings-close-btn" onClick={() => setEditing(null)} disabled={saving}>取消</button>
          <button className="settings-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-mgr-body">
      {teams.length > 0 ? (
        <div className="agent-mgr-list">
          {teams.map(t => {
            const modeDef = getMode(t.mode);
            return (
              <div key={t.id} className="agent-mgr-row">
                <span className="agent-mgr-icon">{t.icon}</span>
                <div className="agent-mgr-info">
                  <span className="agent-mgr-name">
                    {t.name}
                    <span className="team-mode-badge">{modeDef?.icon ?? "🔧"} {modeDef?.name ?? t.mode}</span>
                  </span>
                  {t.description && <span className="agent-mgr-desc">{t.description}</span>}
                  <span className="team-mgr-members">
                    {t.members.map((m, i) => (
                      <span key={i} className="team-mgr-member-chip">
                        {agentIcon(m.agentId)} {agentName(m.agentId)}
                        {m.role && m.role !== "成员" && <span className="team-mgr-member-role">{m.role}</span>}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="agent-mgr-actions">
                  <button className="agent-mgr-edit" onClick={() => startEdit(t)} title="编辑">
                    <Icon name="i-edit" size={14} />
                  </button>
                  <button className="agent-mgr-del" onClick={() => handleDelete(t)} title="删除">
                    <Icon name="i-trash" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="team-mgr-empty">
          <Icon name="i-users" size={40} />
          <p>还没有团队</p>
          <p className="team-mgr-empty-hint">创建一个团队，把多个 Agent 编排起来<br />例如：开发 → 测试 → 审查</p>
        </div>
      )}
      <button className="agent-mgr-add" onClick={startNew}>
        <Icon name="i-plus" size={16} />
        <span>新建团队</span>
      </button>
    </div>
  );
}

// ── 弹窗 wrapper（向后兼容） ──
export function AgentTeamManager({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal agent-manager-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Agent 团队管理</h2>
          <button className="settings-close" onClick={onClose} title="关闭">✕</button>
        </div>
        <AgentTeamManagerSection />
      </div>
    </div>,
    document.body,
  );
}

// ── 团队流程预览组件 ──
// 非 custom 模式：只读自动布局预览
// custom 模式：可拖拽节点 + 连线 + 删边，边变化通过 onDagEdgesChange 回传父组件
function TeamFlowPreview({ editing, mode, agentIcon, agentName, onDagEdgesChange }: {
  editing: EditState;
  mode: OrchestrationMode;
  agentIcon: (id: string) => string;
  agentName: (id: string) => string;
  onDagEdgesChange?: (edges: Array<{ source: number; target: number }>) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const membersWithInfo = editing.members.map(m => ({
      id: m.agentId,
      name: agentName(m.agentId),
      role: m.role,
      icon: agentIcon(m.agentId),
    }));
    return buildFlowFromTopology(membersWithInfo, mode.topology, editing.dagEdges, undefined);
  }, [editing.members, editing.dagEdges, mode.topology, agentIcon, agentName]);

  if (nodes.length === 0) return null;

  // custom 和 loop 模式：editable 编辑器（可拖拽节点）
  const isEditable = mode.topology === "dag" || mode.topology === "loop";

  if (isEditable) {
    return (
      <div className="team-flow-preview team-flow-editable">
        <div className="team-flow-edit-hint">
          <span>💡 拖拽节点调整位置{mode.topology === "dag" ? " · 从右侧连接点拖到下一个节点创建依赖 · 选中连线后按 Delete 删除" : " · 连线自动生成"}</span>
        </div>
        <AgentFlowGraph
          nodes={nodes}
          edges={edges}
          layout={mode.layout}
          height={280}
          showControls={true}
          editable
          onEdgesChange={mode.topology === "dag" ? (newEdges) => {
            const dagEdges = newEdges.map(e => {
              const sourceIdx = parseInt(e.source.replace("node-", "")) || 0;
              const targetIdx = parseInt(e.target.replace("node-", "")) || 0;
              return { source: sourceIdx, target: targetIdx };
            }).filter(e => e.source !== e.target);
            onDagEdgesChange?.(dagEdges);
          } : undefined}
        />
      </div>
    );
  }

  // 非 custom/loop 模式：只读
  return (
    <div className="team-flow-preview">
      <AgentFlowGraph nodes={nodes} edges={edges} layout={mode.layout} height={220} showControls={false} />
    </div>
  );
}
