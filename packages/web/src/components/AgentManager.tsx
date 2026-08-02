// components/AgentManager.tsx — Agent 管理弹窗：增删改查角色预设
//
// 每个预设的 systemPrompt 会追加到 AGENTS.md 之后，用于定义 Agent 的人设/专长。
// 内置「默认」Agent 不可删除/改名，但所有 Agent 的配置都可编辑。

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAgentsStore, type AgentConfig } from "../stores/agents";
import { useChatStore } from "../stores/chat";
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
  disabledTools: string[];
  enabledMcpServers: string[];
}

const blankEdit: EditState = { isNew: true, icon: "🤖", name: "", description: "", systemPrompt: "", model: "", disabledTools: [], enabledMcpServers: [] };

export function AgentManager({ onClose, onSwitchActive }: { onClose: () => void; onSwitchActive?: (id: string) => void }) {
  const agents = useAgentsStore(s => s.agents);
  const activeAgentId = useAgentsStore(s => s.activeAgentId);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const startNew = () => setEditing({ ...blankEdit });
  const startEdit = (a: AgentConfig) => setEditing({
    isNew: false, id: a.id, icon: a.icon, name: a.name,
    description: a.description, systemPrompt: a.systemPrompt, model: a.model || "",
    disabledTools: a.disabledTools || [],
    enabledMcpServers: a.enabledMcpServers || [],
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
        model: editing.model.trim() || undefined,
        disabledTools: editing.disabledTools,
        enabledMcpServers: editing.enabledMcpServers,
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
              <label>工具开关 {!editing.disabledTools.length && <span className="agent-tools-hint">（全部启用）</span>}</label>
              <AgentToolsToggle
                disabledTools={editing.disabledTools}
                onChange={(tools) => setEditing({ ...editing, disabledTools: tools })}
              />
            </div>

            <div className="agent-edit-field">
              <label>MCP 工具 {editing.enabledMcpServers.length === 0 && <span className="agent-tools-hint">（默认全部关闭）</span>}</label>
              <AgentMcpSelector
                enabledMcpServers={editing.enabledMcpServers}
                onChange={(tools) => setEditing({ ...editing, enabledMcpServers: tools })}
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

// ── 工具开关组件（分组展示） ──
interface ToolItem { name: string; source: string; pkg?: string }
const GROUP_META: Record<string, { icon: string; label: string }> = {
  builtin:   { icon: "🛠", label: "内置工具" },
  custom:    { icon: "⚙️", label: "自定义工具" },
  extension: { icon: "📦", label: "扩展工具" },
  mcp:       { icon: "🔌", label: "MCP" },
};
const GROUP_ORDER = ["builtin", "custom", "extension", "mcp"];
const FALLBACK_TOOLS_SRC: ToolItem[] = [
  { name: "read", source: "builtin" }, { name: "write", source: "builtin" },
  { name: "edit", source: "builtin" }, { name: "bash", source: "builtin" },
  { name: "zai_web_search", source: "custom" }, { name: "web_fetch", source: "custom" },
  { name: "analyze_image", source: "custom" }, { name: "todo", source: "custom" },
  { name: "delegate_task", source: "custom" },
  { name: "source_check", source: "extension", pkg: "pi-web-access" },
  { name: "fetch_content", source: "extension", pkg: "pi-web-access" },
  { name: "get_search_content", source: "extension", pkg: "pi-web-access" },
  { name: "web_search", source: "extension", pkg: "pi-web-access" },
];

function AgentToolsToggle({ disabledTools, onChange }: { disabledTools: string[]; onChange: (tools: string[]) => void }) {
  const sid = useChatStore(s => s.activeChatSessionId);
  const sessionTools = useChatStore(s => sid ? s.sessions[sid]?.toolsWithSource : undefined) ?? [];
  // Merge: sessionTools 是权威来源（含新扩展），FALLBACK 兜底保证被禁用的工具
  // （已从 session 的 toolsWithSource 中移除）始终可见、可重新启用。
  // MCP 工具不在此处展示，由独立的 AgentMcpSelector 管理。
  const seen = new Set<string>();
  const allTools: ToolItem[] = [];
  for (const t of sessionTools) { if (t.source !== "mcp") { allTools.push(t); seen.add(t.name); } }
  for (const t of FALLBACK_TOOLS_SRC) { if (!seen.has(t.name)) allTools.push(t); }

  // 按来源分组
  const groups: Record<string, ToolItem[]> = {};
  for (const t of allTools) {
    const src = GROUP_META[t.source] ? t.source : "extension"; // 未知来源归到扩展
    if (!groups[src]) groups[src] = [];
    groups[src].push(t);
  }

  const toggle = (name: string) => {
    if (disabledTools.includes(name)) {
      onChange(disabledTools.filter(t => t !== name));
    } else {
      onChange([...disabledTools, name]);
    }
  };

  const enabledCount = allTools.filter(t => !disabledTools.includes(t.name)).length;

  return (
    <>
      <div className="agent-tools-summary">{enabledCount} / {allTools.length} 个工具启用</div>
      {GROUP_ORDER.filter(g => groups[g]?.length).map(g => (
        <div key={g} className="agent-tools-group">
          <div className="agent-tools-group-label">
            {GROUP_META[g].icon} {GROUP_META[g].label}
            <span className="agent-tools-group-count">{groups[g].length}</span>
          </div>
          <div className="agent-tools-grid">
            {groups[g].map(t => {
              const enabled = !disabledTools.includes(t.name);
              return (
                <button
                  key={t.name}
                  type="button"
                  className={`agent-tool-chip ${enabled ? "on" : "off"}`}
                  onClick={() => toggle(t.name)}
                  title={t.pkg ? `来自 ${t.pkg}` : undefined}
                >
                  <span className="agent-tool-dot" />
                  <span>{t.name}</span>
                  {t.pkg && <span className="agent-tool-pkg">{t.pkg}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {sessionTools.length === 0 && (
        <span className="agent-tools-fallback-hint">新建会话后可见完整工具列表</span>
      )}
    </>
  );
}

// ── MCP server 选择器（默认全部关闭，按 server 启用） ──
interface McpToolInfo { server: string; name: string; description?: string }

function AgentMcpSelector({ enabledMcpServers, onChange }: { enabledMcpServers: string[]; onChange: (servers: string[]) => void }) {
  const [servers, setServers] = useState<string[]>([]);
  const [toolCounts, setToolCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  // 拉取所有已连接 MCP server 的工具列表，提取 server 名
  useEffect(() => {
    fetch("/api/mcp/tools").then(r => r.json()).then((data: { tools?: McpToolInfo[] }) => {
      const tools = data.tools || [];
      const names = new Set<string>();
      const counts: Record<string, number> = {};
      for (const t of tools) {
        names.add(t.server);
        counts[t.server] = (counts[t.server] || 0) + 1;
      }
      setServers([...names]);
      setToolCounts(counts);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  if (!loaded) return <span className="agent-tools-fallback-hint">加载 MCP 列表…</span>;
  if (servers.length === 0) return <span className="agent-tools-fallback-hint">未连接任何 MCP server</span>;

  const toggle = (server: string) => {
    if (enabledMcpServers.includes(server)) {
      onChange(enabledMcpServers.filter(s => s !== server));
    } else {
      onChange([...enabledMcpServers, server]);
    }
  };

  return (
    <>
      <div className="agent-tools-summary">{enabledMcpServers.length} / {servers.length} 个 MCP server 启用</div>
      <div className="agent-tools-grid">
        {servers.map(server => {
          const enabled = enabledMcpServers.includes(server);
          return (
            <button
              key={server}
              type="button"
              className={`agent-tool-chip ${enabled ? "on" : "off"}`}
              onClick={() => toggle(server)}
              title={`${toolCounts[server] || 0} 个工具`}
            >
              <span className="agent-tool-dot" />
              <span>{server}</span>
              <span className="agent-tool-pkg">{toolCounts[server] || 0} tools</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
