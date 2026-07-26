// components/AgentManager.tsx — Agent 管理弹窗：增删改查角色预设
//
// 每个预设的 systemPrompt 会追加到 AGENTS.md 之后，用于定义 Agent 的人设/专长。
// 内置「默认」Agent 不可删除/改名，但所有 Agent 的配置都可编辑。

import { useState } from "react";
import { createPortal } from "react-dom";
import { useAgentsStore, type AgentConfig } from "../stores/agents";
import { Icon } from "./Icon";

const EMOJI_CHOICES = ["🤖", "👩‍💻", "🎨", "📝", "🔬", "💼", "🧪", "🦾", "🌍", "📚"];

interface EditState {
  isNew: boolean;
  id?: string;
  icon: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
}

const blankEdit: EditState = { isNew: true, icon: "🤖", name: "", description: "", systemPrompt: "", model: "" };

export function AgentManager({ onClose, onSwitchActive }: { onClose: () => void; onSwitchActive?: (id: string) => void }) {
  const agents = useAgentsStore(s => s.agents);
  const activeAgentId = useAgentsStore(s => s.activeAgentId);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const startNew = () => setEditing({ ...blankEdit });
  const startEdit = (a: AgentConfig) => setEditing({
    isNew: false, id: a.id, icon: a.icon, name: a.name,
    description: a.description, systemPrompt: a.systemPrompt, model: a.model || "",
  });

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { alert("请填写名称"); return; }
    setSaving(true);
    if (editing.isNew) {
      const created = await useAgentsStore.getState().create({
        name: editing.name.trim(),
        description: editing.description.trim(),
        systemPrompt: editing.systemPrompt,
        icon: editing.icon,
        model: editing.model.trim() || undefined,
      });
      if (created) setEditing(null);
    } else if (editing.id) {
      const ok = await useAgentsStore.getState().update(editing.id, {
        name: editing.name.trim(),
        description: editing.description.trim(),
        systemPrompt: editing.systemPrompt,
        icon: editing.icon,
        model: editing.model.trim(),
      });
      if (ok) setEditing(null);
    }
    setSaving(false);
  };

  const handleDelete = async (a: AgentConfig) => {
    if (a.isBuiltIn) return;
    if (!confirm(`确定删除 Agent「${a.name}」？`)) return;
    await useAgentsStore.getState().remove(a.id);
    if (editing?.id === a.id) setEditing(null);
  };

  const handleActivate = (id: string) => {
    useAgentsStore.getState().setActive(id);
    onSwitchActive?.(id);
    onClose();
  };

  return createPortal(
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal agent-manager-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Agent 管理</h2>
          <button className="settings-close" onClick={onClose} title="关闭">✕</button>
        </div>

        {!editing ? (
          <div className="agent-mgr-body">
            <div className="agent-mgr-list">
              {agents.map(a => (
                <div
                  key={a.id}
                  className={`agent-mgr-row ${activeAgentId === a.id ? "active" : ""}`}
                  onClick={() => handleActivate(a.id)}
                >
                  <span className="agent-mgr-icon">{a.icon}</span>
                  <div className="agent-mgr-info">
                    <span className="agent-mgr-name">
                      {a.name}
                      {a.isBuiltIn && <span className="agent-mgr-builtin">内置</span>}
                    </span>
                    {a.description && <span className="agent-mgr-desc">{a.description}</span>}
                    {a.model && <span className="agent-mgr-model">{a.model}</span>}
                  </div>
                  {activeAgentId === a.id && <span className="agent-mgr-current" title="当前使用">●</span>}
                  <div className="agent-mgr-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="agent-mgr-edit" onClick={() => startEdit(a)} title="编辑">
                      <Icon name="i-edit" size={14} />
                    </button>
                    {!a.isBuiltIn && (
                      <button className="agent-mgr-del" onClick={() => handleDelete(a)} title="删除">
                        <Icon name="i-trash" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button className="agent-mgr-add" onClick={startNew}>
              <Icon name="i-plus" size={16} />
              <span>新建 Agent</span>
            </button>
          </div>
        ) : (
          <div className="agent-mgr-form">
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
                  {EMOJI_CHOICES.map(em => (
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
              <label>名称</label>
              <input
                className="settings-input"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="如：翻译官、代码审查员"
                maxLength={30}
              />
            </div>

            <div className="agent-edit-field">
              <label>描述（可选）</label>
              <input
                className="settings-input"
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="一句话说明这个 Agent 擅长什么"
                maxLength={100}
              />
            </div>

            <div className="agent-edit-field">
              <label>模型（可选，留空用默认）</label>
              <input
                className="settings-input"
                value={editing.model}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                placeholder="如：glm-4.7"
              />
            </div>

            <div className="agent-edit-field">
              <label>角色指令（System Prompt）</label>
              <textarea
                className="agent-edit-prompt"
                value={editing.systemPrompt}
                onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
                placeholder={"定义这个 Agent 的人设、专长、语气、规则…\n例如：\n你是一位资深前端工程师，擅长 React 和 TypeScript。\n回答要简洁，给出可直接运行的代码。"}
                rows={8}
              />
              <span className="agent-edit-hint">这段指令会追加到项目 AGENTS.md 之后，对使用该 Agent 的会话生效。</span>
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
