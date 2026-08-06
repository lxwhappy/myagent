// components/QuickPromptManager.tsx — 快捷指令管理弹窗：增删改查
//
// 用户可自由新增、编辑、删除快捷指令（包括内置默认指令）。
// 数据通过 stores/quick-prompts 同步到后端 ~/.myagent/quick-prompts.json。

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuickPromptStore, type QuickPrompt } from "../stores/quick-prompts";
import { Icon } from "./Icon";

const EMOJI_CHOICES = ["⚡", "📁", "🐛", "🔍", "📝", "🧪", "📖", "🔄", "🚀", "🔧", "💡", "🎯", "✨", "📋", "🎨", "🔥"];

interface EditState {
  isNew: boolean;
  id?: string;
  icon: string;
  label: string;
  text: string;
}

const blankEdit: EditState = { isNew: true, icon: "⚡", label: "", text: "" };

export function QuickPromptManager({ onClose }: { onClose: () => void }) {
  const prompts = useQuickPromptStore(s => s.prompts);
  const add = useQuickPromptStore(s => s.add);
  const update = useQuickPromptStore(s => s.update);
  const remove = useQuickPromptStore(s => s.remove);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startNew = () => { setSaveError(null); setEditing({ ...blankEdit }); };
  const startEdit = (p: QuickPrompt) => { setSaveError(null); setEditing({ isNew: false, id: p.id, icon: p.icon, label: p.label, text: p.text }); };

  const handleSave = async () => {
    if (!editing || !editing.label.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing.isNew) {
        await add(editing.icon, editing.label.trim(), editing.text);
      } else if (editing.id) {
        await update(editing.id, { icon: editing.icon, label: editing.label.trim(), text: editing.text });
      }
      setEditing(null);
    } catch (e: any) {
      setSaveError(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除这个快捷指令？")) return;
    try {
      await remove(id);
    } catch (e: any) {
      alert(e?.message || "删除失败");
    }
  };

  return createPortal(
    <div className="modal-overlay show" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2>快捷指令管理</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {!editing ? (
          <>
            <div className="qp-mgr-list">
              {prompts.map(p => (
                <div key={p.id} className="qp-mgr-item">
                  <span className="qp-mgr-icon">{p.icon}</span>
                  <div className="qp-mgr-info">
                    <span className="qp-mgr-label">{p.label}</span>
                    <span className="qp-mgr-text">{p.text}</span>
                  </div>
                  <button type="button" className="qp-mgr-edit" onClick={() => startEdit(p)} title="编辑">
                    <Icon name="i-edit" size={14} />
                  </button>
                  <button type="button" className="qp-mgr-del" onClick={() => handleDelete(p.id)} title="删除">
                    <Icon name="i-x" size={14} />
                  </button>
                </div>
              ))}
              {prompts.length === 0 && (
                <div className="qp-mgr-empty">暂无快捷指令</div>
              )}
            </div>
            <div className="modal-footer">
              <div className="modal-actions">
                <button className="modal-btn-cancel" onClick={onClose}>关闭</button>
                <button className="modal-btn-confirm" onClick={startNew}>+ 新增指令</button>
              </div>
            </div>
          </>
        ) : (
          <div className="qp-mgr-edit-form">
            <div className="qp-mgr-field">
              <label>图标</label>
              <div className="qp-mgr-emoji-row">
                {EMOJI_CHOICES.map(e => (
                  <button
                    key={e}
                    type="button"
                    className={`qp-mgr-emoji ${editing.icon === e ? "active" : ""}`}
                    onClick={() => setEditing({ ...editing, icon: e })}
                  >{e}</button>
                ))}
              </div>
            </div>
            <div className="qp-mgr-field">
              <label>名称</label>
              <input
                type="text"
                value={editing.label}
                onChange={e => setEditing({ ...editing, label: e.target.value })}
                placeholder="如：代码审查"
                maxLength={20}
                autoFocus
              />
            </div>
            <div className="qp-mgr-field">
              <label>提示文本</label>
              <textarea
                value={editing.text}
                onChange={e => setEditing({ ...editing, text: e.target.value })}
                placeholder="插入到输入框的文本，如：帮我审查这段代码："
                rows={3}
              />
            </div>
            {saveError && (
              <div className="qp-mgr-error">{saveError}</div>
            )}
            <div className="modal-footer">
              <div className="modal-actions">
                <button className="modal-btn-cancel" onClick={() => setEditing(null)}>取消</button>
                <button className="modal-btn-confirm" onClick={handleSave} disabled={saving || !editing.label.trim()}>
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
