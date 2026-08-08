// components/AgentTeamManager.tsx — Agent 团队管理弹窗
//
// 团队是一组已有 Agent 预设的有序编排方案。
// 支持创建/编辑/删除团队，添加成员（引用已有 Agent），设置角色和执行顺序。
// 典型用法：开发Agent写代码 → 测试Agent检查 → 审查Agent总结

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAgentTeamsStore, type AgentTeam, type TeamMember, type TeamMode } from "../stores/agent-teams";
import { useAgentsStore } from "../stores/agents";
import { Icon } from "./Icon";
import { AgentFlowGraph, buildFlowFromTeam, type FlowNodeDef, type FlowEdgeDef } from "./AgentFlowGraph";

const TEAM_EMOJI_CHOICES = ["👥", "🔧", "🔬", "🏗", "🎯", "⚡", "🚀", "🛡", "📋", "🔄"];

const MODE_META: Record<TeamMode, { label: string; icon: string; desc: string }> = {
  pipeline: { label: "流水线", icon: "➡️", desc: "A → B → C，顺序执行，上一步输出传给下一步" },
  supervisor: { label: "主控调度", icon: "🎯", desc: "Supervisor 智能分解任务，按需调度专家" },
  evaluator: { label: "评估迭代", icon: "🔄", desc: "生成 → 评估 → 不达标重试，直到通过" },
};

interface EditState {
  isNew: boolean;
  id?: string;
  icon: string;
  name: string;
  description: string;
  mode: TeamMode;
  members: TeamMember[];
  maxRetries: number;
}

const blankEdit: EditState = { isNew: true, icon: "👥", name: "", description: "", mode: "pipeline", members: [], maxRetries: 2 };

export function AgentTeamManager({ onClose }: { onClose: () => void }) {
  const teams = useAgentTeamsStore(s => s.teams);
  const agents = useAgentsStore(s => s.agents);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const startNew = () => setEditing({ ...blankEdit });
  const startEdit = (t: AgentTeam) => setEditing({
    isNew: false, id: t.id, icon: t.icon, name: t.name,
    description: t.description, mode: t.mode || "pipeline", members: [...t.members],
    maxRetries: t.maxRetries ?? 2,
  });

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { alert("请填写团队名称"); return; }
    if (editing.members.length === 0) { alert("请至少添加一个成员"); return; }
    if (editing.mode === "evaluator" && editing.members.length < 2) { alert("评估模式至少需要 2 个成员（生成+评估）"); return; }
    setSaving(true);
    if (editing.isNew) {
      const created = await useAgentTeamsStore.getState().create({
        name: editing.name.trim(),
        description: editing.description.trim(),
        icon: editing.icon,
        mode: editing.mode,
        members: editing.members,
        maxRetries: editing.mode === "evaluator" ? editing.maxRetries : undefined,
      });
      if (created) setEditing(null);
    } else if (editing.id) {
      const ok = await useAgentTeamsStore.getState().update(editing.id, {
        name: editing.name.trim(),
        description: editing.description.trim(),
        icon: editing.icon,
        mode: editing.mode,
        members: editing.members,
        maxRetries: editing.mode === "evaluator" ? editing.maxRetries : undefined,
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
    const agent = agents.find(a => a.id === agentId);
    setEditing({
      ...editing,
      members: [...editing.members, { agentId, role: agent?.name ?? "成员" }],
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

  return createPortal(
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal agent-manager-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Agent 团队管理</h2>
          <button className="settings-close" onClick={onClose} title="关闭">✕</button>
        </div>

        {!editing ? (
          <div className="agent-mgr-body">
            {teams.length > 0 ? (
              <div className="agent-mgr-list">
                {teams.map(t => (
                  <div key={t.id} className="agent-mgr-row">
                    <span className="agent-mgr-icon">{t.icon}</span>
                    <div className="agent-mgr-info">
                      <span className="agent-mgr-name">
                        {t.name}
                        <span className="team-mode-badge">{MODE_META[t.mode || "pipeline"]?.icon} {MODE_META[t.mode || "pipeline"]?.label}</span>
                      </span>
                      {t.description && <span className="agent-mgr-desc">{t.description}</span>}
                      <span className="team-mgr-members">
                        {t.members.map((m, i) => (
                          <span key={i} className="team-mgr-member-chip">
                            {agentIcon(m.agentId)} {m.role}
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
                ))}
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
        ) : (
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
                {(Object.entries(MODE_META) as [TeamMode, typeof MODE_META[TeamMode]][]).map(([key, meta]) => (
                  <button
                    key={key}
                    type="button"
                    className={`team-mode-card ${editing.mode === key ? "active" : ""}`}
                    onClick={() => setEditing({ ...editing, mode: key })}
                  >
                    <span className="team-mode-icon">{meta.icon}</span>
                    <div className="team-mode-text">
                      <span className="team-mode-label">{meta.label}</span>
                      <span className="team-mode-desc">{meta.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
              {editing.mode === "evaluator" && (
                <div className="team-retries-row">
                  <label className="team-retries-label">最大重试次数</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={editing.maxRetries}
                    onChange={e => setEditing({ ...editing, maxRetries: Math.min(5, Math.max(1, parseInt(e.target.value) || 2)) })}
                    className="settings-input team-retries-input"
                  />
                </div>
              )}
            </div>

            {/* DAG 可视化预览 */}
            {editing.members.length > 0 && (
              <div className="agent-edit-field">
                <label>流程预览</label>
                <TeamFlowPreview editing={editing} agentIcon={agentIcon} agentName={agentName} />
              </div>
            )}

            {/* 团队成员（执行流水线） */}
            <div className="agent-edit-field">
              <label>
                团队成员（按执行顺序）
                {editing.members.length > 0 && (
                  <span className="agent-tools-hint">（{editing.members.length} 个成员）</span>
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

            <div className="agent-edit-hint">
              团队成员按顺序执行：用户消息先发给第一个成员，其输出作为上下文传给下一个成员。
              可用于"开发→测试→审查"等流水线场景。
            </div>

            <div className="agent-edit-actions">
              <button className="settings-close-btn" onClick={() => setEditing(null)} disabled={saving}>取消</button>
              <button className="settings-save-btn" onClick={handleSave} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── 团队流程预览组件 ──
function TeamFlowPreview({ editing, agentIcon, agentName }: {
  editing: EditState;
  agentIcon: (id: string) => string;
  agentName: (id: string) => string;
}) {
  const { nodes, edges } = useMemo(() => {
    const membersWithInfo = editing.members.map(m => ({
      ...m,
      icon: agentIcon(m.agentId),
      name: agentName(m.agentId),
    }));
    return buildFlowFromTeam(membersWithInfo, editing.mode);
  }, [editing.members, editing.mode, agentIcon, agentName]);

  if (nodes.length === 0) return null;

  return (
    <div className="team-flow-preview">
      <AgentFlowGraph nodes={nodes} edges={edges} mode={editing.mode} height={220} showControls={false} />
    </div>
  );
}
