// components/SettingsPanel.tsx — 设置面板：模型切换 / Skills 列表 / MCP 配置
// Claude Warm Light 暖色调设计

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useWorkspaceStore } from "../stores/workspace";
import { useDebugStore } from "../stores/debug";

type Tab = "models" | "skills" | "extensions" | "mcp" | "cron" | "workspace" | "debug";

interface ModelInfo {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  input: string[];
}
interface ProviderGroup {
  provider: string;
  models: ModelInfo[];
}
interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
}
interface McpServerStatus {
  name: string;
  command: string;
  args: string[];
  status: "connected" | "disconnected" | "error";
  toolCount: number;
  error?: string;
}
interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function SettingsPanel({ onClose, onSwitchWorkspace, onAddWorkspace }: {
  onClose: () => void;
  onSwitchWorkspace: (wsId: string) => void;
  onAddWorkspace: () => void;
}) {
  const [tab, setTab] = useState<Tab>("models");

  const NAV_ITEMS: { key: Tab; icon: string; label: string }[] = [
    { key: "models", icon: "🤖", label: "模型" },
    { key: "skills", icon: "⚡", label: "Skills" },
    { key: "extensions", icon: "📦", label: "扩展" },
    { key: "mcp", icon: "🔌", label: "MCP" },
    { key: "cron", icon: "🕐", label: "定时任务" },
    { key: "workspace", icon: "📁", label: "工作空间" },
    { key: "debug", icon: "🔧", label: "Debug" },
  ];

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>设置</h2>
          <button className="settings-close" onClick={onClose} title="关闭">✕</button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.key}
                className={`settings-nav-item ${tab === item.key ? "active" : ""}`}
                onClick={() => setTab(item.key)}
              >
                <span className="settings-nav-icon">{item.icon}</span>
                <span className="settings-nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-body">
            {tab === "models" && <ModelsTab />}
            {tab === "skills" && <SkillsTab />}
            {tab === "extensions" && <ExtensionsTab />}
            {tab === "mcp" && <McpTab />}
            {tab === "cron" && <CronTab />}
            {tab === "workspace" && <WorkspaceTab onSwitchWorkspace={onSwitchWorkspace} onAddWorkspace={onAddWorkspace} onClose={onClose} />}
            {tab === "debug" && <DebugTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 模型切换 Tab ──
function ModelsTab() {
  const [data, setData] = useState<{ current: { provider: string; model: string }, providers: ProviderGroup[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/models").then(r => r.json()).then(d => {
      setData(d);
      setExpandedProvider(d.current?.provider || null);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const switchModel = async (provider: string, model: string) => {
    setSwitching(true);
    try {
      const res = await fetch("/api/models/default", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      const d = await res.json();
      if (d.ok) {
        alert(`已切换到 ${d.current.name}（新会话生效）`);
        load();
      } else {
        alert("切换失败: " + d.error);
      }
    } catch (e: any) { alert("错误: " + e.message); }
    setSwitching(false);
  };

  if (loading) return <div className="settings-loading">加载模型列表…</div>;
  if (!data) return <div className="settings-error">加载失败</div>;

  const currentKey = data.current.provider + "/" + data.current.model;

  return (
    <div className="settings-models">
      <div className="settings-current">
        当前模型：<strong>{data.current.provider} / {data.current.model}</strong>
        <span className="settings-hint">（切换后新会话生效）</span>
      </div>
      <input
        className="settings-filter"
        placeholder="🔍 搜索模型…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="settings-provider-list">
        {data.providers.map(p => {
          const filtered = filter
            ? p.models.filter(m => (m.name + m.id + p.provider).toLowerCase().includes(filter.toLowerCase()))
            : p.models;
          if (filtered.length === 0) return null;
          const expanded = expandedProvider === p.provider;
          return (
            <div key={p.provider} className="settings-provider">
              <div
                className="settings-provider-header"
                onClick={() => setExpandedProvider(expanded ? null : p.provider)}
              >
                <span className="settings-chevron">{expanded ? "▾" : "▸"}</span>
                <span className="settings-provider-name">{p.provider}</span>
                <span className="settings-provider-count">{p.models.length} 个模型</span>
              </div>
              {expanded && (
                <div className="settings-model-list">
                  {filtered.map(m => {
                    const key = p.provider + "/" + m.id;
                    const active = key === currentKey;
                    return (
                      <div
                        key={key}
                        className={`settings-model-item ${active ? "active" : ""}`}
                        onClick={() => !active && !switching && switchModel(p.provider, m.id)}
                      >
                        <div className="settings-model-info">
                          <span className="settings-model-name">{m.name}</span>
                          <span className="settings-model-meta">
                            {m.reasoning && <span className="tag tag-reasoning">推理</span>}
                            {m.input.includes("image") && <span className="tag tag-vision">视觉</span>}
                            <span className="tag tag-ctx">{(m.contextWindow / 1000).toFixed(0)}K ctx</span>
                          </span>
                        </div>
                        <span className="settings-model-id">{m.id}</span>
                        {active && <span className="settings-model-check">✓</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Skills 列表 Tab ──
function SkillsTab() {
  const [data, setData] = useState<{ skills: SkillInfo[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetch("/api/skills").then(r => r.json()).then(d => { setData(d); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const content = await file.text();
      // 从文件名推断 skill 名称
      const baseName = file.name.replace(/\.md$/i, "").replace(/SKILL$/i, "").trim() || "custom-skill";
      const res = await fetch("/api/skills/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: baseName, content }),
      });
      const d = await res.json();
      if (d.ok) {
        alert(`✅ Skill "${d.skill.name}" 上传成功！\n新会话生效。`);
        load();
      } else {
        alert("上传失败: " + d.error);
      }
    } catch (e: any) {
      alert("错误: " + e.message);
    }
    setUploading(false);
    setShowUpload(false);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`删除 Skill "${name}"？`)) return;
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
    const d = await res.json();
    if (d.ok) { load(); } else { alert("删除失败: " + d.error); }
  };

  if (loading) return <div className="settings-loading">加载 Skills…</div>;
  const skills = data?.skills || [];
  const filtered = filter
    ? skills.filter(s => (s.name + s.description).toLowerCase().includes(filter.toLowerCase()))
    : skills;

  return (
    <div className="settings-skills">
      <div className="settings-skill-upload">
        <button className="skill-upload-btn" onClick={() => setShowUpload(!showUpload)} disabled={uploading}>
          {uploading ? "⏳ 上传中…" : "⬆ 上传 Skill"}
        </button>
        <span className="skill-upload-hint">支持 .md 文件，保存到 ~/.pi/agent/skills/</span>
      </div>

      {showUpload && (
        <div
          className={`skill-upload-dropzone ${dragOver ? "drag-over" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleUpload(file);
          }}
        >
          <div className="skill-upload-dropzone-text">📁 点击选择或拖放 SKILL.md 文件</div>
          <div className="skill-upload-dropzone-hint">文件名将作为 Skill 名称</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,text/markdown"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          />
        </div>
      )}

      <div className="settings-current">
        已安装 <strong>{skills.length}</strong> 个 Skills
      </div>
      <input
        className="settings-filter"
        placeholder="🔍 搜索 Skill…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="settings-skill-list">
        {filtered.map(s => (
          <div key={s.name} className="settings-skill-item">
            <div className="settings-skill-head">
              <span className="settings-skill-name">⚡ {s.name}</span>
              {s.disableModelInvocation && <span className="tag tag-manual">手动调用</span>}
              <button className="skill-delete-btn" onClick={() => handleDelete(s.name)} title="删除">✕</button>
            </div>
            <div className="settings-skill-desc">{s.description}</div>
            <div className="settings-skill-path" title={s.filePath}>{s.filePath}</div>
          </div>
        ))}
        {filtered.length === 0 && <div className="settings-empty">无匹配 Skill</div>}
      </div>
    </div>
  );
}

// ── MCP 配置 Tab ──
function McpTab() {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [config, setConfig] = useState<Record<string, McpServerConfig>>({});
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCmd, setNewCmd] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>>>({});
  const [loadingTools, setLoadingTools] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [srvRes, cfgRes] = await Promise.all([
      fetch("/api/mcp/servers").then(r => r.json()),
      fetch("/api/mcp/config").then(r => r.json()),
    ]);
    setServers(srvRes.servers || []);
    setConfig((cfgRes.mcpServers || {}));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleServer = async (name: string) => {
    if (expandedServer === name) {
      setExpandedServer(null);
      return;
    }
    setExpandedServer(name);
    // 如果还没有加载过该 server 的 tools，加载它
    if (!serverTools[name]) {
      setLoadingTools(name);
      try {
        const res = await fetch(`/api/mcp/tools/${encodeURIComponent(name)}`);
        const d = await res.json();
        setServerTools(prev => ({ ...prev, [name]: d.tools || [] }));
      } catch { setServerTools(prev => ({ ...prev, [name]: [] })); }
      setLoadingTools(null);
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      const res = await fetch("/api/mcp/reload", { method: "POST" });
      const d = await res.json();
      const msg = d.connected?.length ? `已连接: ${d.connected.join(", ")}` : "无连接";
      const fail = d.failed?.length ? `\n失败: ${d.failed.map((f: any) => `${f.name}(${f.error})`).join(", ")}` : "";
      alert(msg + fail);
      setServerTools({}); // 清除缓存的 tools
      load();
    } catch (e: any) { alert("重载失败: " + e.message); }
    setReloading(false);
  };

  const addServer = async () => {
    if (!newName.trim() || !newCmd.trim()) { alert("名称和命令必填"); return; }
    const newCfg = {
      ...config,
      [newName.trim()]: {
        command: newCmd.trim(),
        args: newArgs.trim() ? newArgs.trim().split(/\s+/) : [],
      },
    };
    await fetch("/api/mcp/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcpServers: newCfg }),
    });
    setConfig(newCfg);
    setNewName(""); setNewCmd(""); setNewArgs(""); setEditing(false);
  };

  const removeServer = async (name: string) => {
    if (!confirm(`删除 MCP server "${name}"？`)) return;
    const newCfg = { ...config };
    delete newCfg[name];
    await fetch("/api/mcp/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcpServers: newCfg }),
    });
    setConfig(newCfg);
    setServerTools(prev => { const n = { ...prev }; delete n[name]; return n; });
  };

  if (loading) return <div className="settings-loading">加载 MCP…</div>;

  return (
    <div className="settings-mcp">
      <div className="settings-mcp-toolbar">
        <div className="settings-current">
          {Object.keys(config).length} 个配置 · {servers.filter(s => s.status === "connected").length} 个已连接
        </div>
        <button className="btn-mcp-reload" onClick={reload} disabled={reloading}>
          {reloading ? "⏳ 重连中…" : "🔄 重载连接"}
        </button>
        <button className="btn-mcp-add" onClick={() => setEditing(!editing)}>+ 添加 Server</button>
      </div>

      {editing && (
        <div className="mcp-edit-form">
          <input placeholder="名称（如 filesystem）" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="命令（如 npx）" value={newCmd} onChange={(e) => setNewCmd(e.target.value)} />
          <input placeholder="参数（空格分隔，如 -y @modelcontextprotocol/server-filesystem /tmp）" value={newArgs} onChange={(e) => setNewArgs(e.target.value)} />
          <div className="mcp-edit-actions">
            <button className="btn-mcp-save" onClick={addServer}>保存</button>
            <button className="btn-mcp-cancel" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="settings-mcp-list">
        {servers.length === 0 && (
          <div className="settings-empty">
            还没有 MCP server。点击「+ 添加 Server」配置第一个。
            <div className="settings-mcp-hint">
              例如：npx -y @modelcontextprotocol/server-filesystem /path/to/dir
            </div>
          </div>
        )}
        {servers.map(s => {
          const expanded = expandedServer === s.name;
          const tools = serverTools[s.name];
          return (
            <div key={s.name} className={`mcp-server-item status-${s.status}`}>
              <div className="mcp-server-head" onClick={() => s.status === "connected" && toggleServer(s.name)} style={{ cursor: s.status === "connected" ? "pointer" : "default" }}>
                <span className={`mcp-status-dot status-${s.status}`} />
                <span className="mcp-server-name">{s.name}</span>
                <span className="mcp-server-status">{s.status}</span>
                {s.toolCount > 0 && <span className="tag tag-tools">{s.toolCount} tools</span>}
                {s.status === "connected" && (
                  <span className="mcp-server-chevron">{expanded ? "▾" : "▸"}</span>
                )}
                <button className="mcp-server-del" onClick={(e) => { e.stopPropagation(); removeServer(s.name); }}>✕</button>
              </div>
              <div className="mcp-server-cmd">{s.command} {s.args.join(" ")}</div>
              {expanded && s.status === "connected" && (
                <div className="mcp-tools-panel">
                  {loadingTools === s.name && <div className="mcp-tools-loading">加载工具列表…</div>}
                  {tools && tools.length === 0 && <div className="mcp-tools-empty">无可用工具</div>}
                  {tools && tools.length > 0 && tools.map(t => (
                    <div key={t.name} className="mcp-tool-item">
                      <div className="mcp-tool-name">🔧 {t.name}</div>
                      {t.description && <div className="mcp-tool-desc">{t.description}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 工作空间管理 Tab ──
function WorkspaceTab({ onSwitchWorkspace, onAddWorkspace, onClose }: {
  onSwitchWorkspace: (wsId: string) => void;
  onAddWorkspace: () => void;
  onClose: () => void;
}) {
  const activeId = useWorkspaceStore(s => s.activeId);
  const removeWorkspace = useWorkspaceStore(s => s.removeWorkspace);
  const [data, setData] = useState<{ workspaces: Array<{ id: string; name: string; path: string }> } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/workspaces").then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`移除工作空间「${name}」？\n（仅从列表移除，不删除磁盘文件）`)) return;
    await fetch(`/api/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" });
    removeWorkspace(id);
    load();
  };

  const handleSwitch = (id: string) => {
    if (id === activeId) return;
    onSwitchWorkspace(id);
    onClose();
  };

  if (loading) return <div className="settings-loading">加载工作空间…</div>;
  const workspaces = data?.workspaces || [];

  return (
    <div className="settings-workspaces">
      <div className="settings-current">
        共 <strong>{workspaces.length}</strong> 个工作空间
        <button className="ws-add-btn" onClick={() => { onAddWorkspace(); onClose(); }}>📁 添加工作空间…</button>
      </div>
      <div className="ws-manage-list">
        {workspaces.length === 0 && (
          <div className="settings-empty">还没有工作空间，点击上方添加。</div>
        )}
        {workspaces.map(w => (
          <div key={w.id} className={`ws-manage-item ${w.id === activeId ? "active" : ""}`}>
            <div className="ws-manage-info" onClick={() => handleSwitch(w.id)}>
              <Icon name="i-folder" size={16} className="ws-manage-icon" />
              <div className="ws-manage-text">
                <span className="ws-manage-name">
                  {w.name}
                  {w.id === activeId && <span className="tag tag-active">当前</span>}
                </span>
                <span className="ws-manage-path" title={w.path}>{w.path}</span>
              </div>
            </div>
            <button className="ws-manage-del" onClick={() => handleDelete(w.id, w.name)} title="移除">✕</button>
          </div>
        ))}
      </div>
      <div className="settings-hint" style={{ marginTop: 12 }}>
        点击切换工作空间；✕ 仅从列表移除，不删除磁盘文件。
      </div>
    </div>
  );
}

// ── Debug 模式 Tab ──
function DebugTab() {
  const enabled = useDebugStore(s => s.enabled);
  const toggle = useDebugStore(s => s.toggle);

  return (
    <div className="settings-debug">
      <div className="settings-debug-intro">
        Debug 模式会在对话区展示 Agent 的内部运行过程，帮助你理解每一步发生了什么：
        <ul>
          <li>每个工具调用的执行耗时（ms）</li>
          <li>每次 LLM API 调用的首 token 时间和总耗时</li>
          <li>每次 LLM 调用的精确 token 明细（输入/输出/缓存读写/费用）</li>
          <li>上下文压缩、自动重试等内部事件的触发时机</li>
        </ul>
      </div>
      <label className="settings-debug-toggle">
        <input type="checkbox" checked={enabled} onChange={toggle} />
        <span>启用 Debug 模式</span>
      </label>
      <div className="settings-hint">
        {enabled
          ? "✅ 已开启 — 对话区的每条 AI 回复下方会显示详细的时间线。"
          : "关闭 — 对话区不显示调试信息。"}
      </div>
    </div>
  );
}

// ── 扩展管理 ──
interface ExtPackage {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
  skills: number;
  tools: number;
  prompts: number;
}

function ExtensionsTab() {
  const [packages, setPackages] = useState<ExtPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [installSource, setInstallSource] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/extensions").then(r => r.json()).then(d => {
      setPackages(d.packages || []);
      setError(d.error || null);
      setLoading(false);
    }).catch(() => { setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const handleInstall = async () => {
    const src = installSource.trim();
    if (!src) return;
    setAction(`安装 ${src}…`);
    setError(null);
    try {
      const res = await fetch("/api/extensions/install", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: src }),
      });
      const d = await res.json();
      if (!d.ok) setError(d.error);
      else setInstallSource("");
      load();
    } catch (e: any) { setError(e.message); }
    setAction(null);
  };

  const handleUninstall = async (source: string) => {
    setAction(`卸载 ${source}…`);
    setError(null);
    try {
      const res = await fetch("/api/extensions/uninstall", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const d = await res.json();
      if (!d.ok) setError(d.error);
      load();
    } catch (e: any) { setError(e.message); }
    setAction(null);
  };

  const sourceIcon = (source: string) => {
    if (source.startsWith("npm:")) return "📦";
    if (source.startsWith("git:")) return "🔧";
    return "📁";
  };
  const sourceName = (source: string) => {
    return source.replace(/^(npm:|git:)/, "").replace(/^@/, "").split("/").pop() || source;
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        扩展管理
        {packages.length > 0 && <span className="settings-count">{packages.length}</span>}
      </div>
      <p className="settings-desc">
        安装第三方扩展来添加工具、技能、提示模板。
        来源格式：<code>npm:@scope/name</code>、<code>git:https://...</code>、<code>./local/path</code>
      </p>

      <div className="ext-install-bar">
        <input
          className="ext-input"
          type="text"
          placeholder="npm:@scope/package-name"
          value={installSource}
          onChange={(e) => setInstallSource(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleInstall()}
          disabled={!!action}
        />
        <button className="ext-install-btn" onClick={handleInstall} disabled={!installSource.trim() || !!action}>
          安装
        </button>
      </div>

      {error && <div className="ext-error">{error}</div>}
      {action && <div className="ext-action">{action}</div>}

      {loading ? (
        <div className="ext-empty">加载中…</div>
      ) : packages.length === 0 ? (
        <div className="ext-empty">还没有安装任何扩展</div>
      ) : (
        <div className="ext-list">
          {packages.map((pkg, i) => (
            <div key={i} className="ext-card">
              <div className="ext-card-icon">{sourceIcon(pkg.source)}</div>
              <div className="ext-card-info">
                <div className="ext-card-name">{sourceName(pkg.source)}</div>
                <div className="ext-card-source" title={pkg.source}>{pkg.source}</div>
                <div className="ext-card-meta">
                  <span className="ext-badge">{pkg.scope === "user" ? "全局" : "项目"}</span>
                  {pkg.skills > 0 && <span className="ext-badge">⚡ {pkg.skills}</span>}
                  {pkg.tools > 0 && <span className="ext-badge">🔧 {pkg.tools}</span>}
                  {pkg.prompts > 0 && <span className="ext-badge">📝 {pkg.prompts}</span>}
                  {!pkg.installedPath && <span className="ext-badge ext-badge-warn">未安装</span>}
                </div>
              </div>
              <button className="ext-uninstall-btn" onClick={() => handleUninstall(pkg.source)} disabled={!!action} title="卸载">
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ext-hint">安装/卸载后需新建会话生效</div>
    </div>
  );
}

// ── 定时任务 Tab ──
interface CronJobInfo {
  id: string; name: string; schedule: string; prompt: string;
  enabled: boolean; type: "cron" | "once";
  workspaceId?: string;
  lastRun?: number; nextRun?: number; runCount: number;
  lastStatus?: "success" | "error" | "running";
  description?: string;
}
interface CronExecInfo {
  id: string; jobId: string; jobName: string;
  startedAt: number; finishedAt?: number; durationMs?: number;
  status: "running" | "success" | "error";
  prompt: string; output?: string; error?: string;
}

function fmtTime(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function CronTab() {
  const workspaces = useWorkspaceStore(s => s.workspaces);
  const wsName = (wsId?: string) => workspaces.find(w => w.id === wsId)?.name || wsId || "默认";
  const [jobs, setJobs] = useState<CronJobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<CronJobInfo | null>(null);
  const [history, setHistory] = useState<CronExecInfo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/cron/jobs").then(r => r.json()).then(d => {
      setJobs(d.jobs || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const loadHistory = async (jobId: string) => {
    const res = await fetch(`/api/cron/jobs/${encodeURIComponent(jobId)}/history`);
    const d = await res.json();
    setHistory(d.executions || []);
  };

  const handleAction = async (id: string, action: "pause" | "resume" | "run" | "delete") => {
    if (action === "delete") {
      if (!confirm("确定删除这个定时任务？")) return;
      await fetch(`/api/cron/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    } else if (action === "run") {
      setRunning(id);
      await fetch(`/api/cron/jobs/${encodeURIComponent(id)}/run`, { method: "POST" });
      setRunning(null);
    } else {
      await fetch(`/api/cron/jobs/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    }
    load();
    if (selectedJob?.id === id) loadHistory(id);
  };

  const handleSelect = (job: CronJobInfo) => {
    setSelectedJob(job);
    loadHistory(job.id);
  };

  if (selectedJob) {
    return (
      <div className="settings-cron">
        <div className="cron-detail-head">
          <button className="cron-back" onClick={() => setSelectedJob(null)}>← 返回</button>
          <span className="cron-detail-name">{selectedJob.name}</span>
          <span className={`cron-status-dot ${selectedJob.enabled ? "on" : "off"}`} />
          <span className="cron-detail-schedule">{selectedJob.schedule}</span>
        </div>
        <div className="cron-detail-meta">
          <span>类型: {selectedJob.type === "once" ? "一次性" : "循环"}</span>
          <span>已执行: {selectedJob.runCount} 次</span>
          <span>上次: {fmtTime(selectedJob.lastRun)}</span>
          <span>下次: {fmtTime(selectedJob.nextRun)}</span>
        </div>
        <div className="cron-detail-prompt">{selectedJob.prompt}</div>

        <div className="cron-section-title">执行历史</div>
        {history.length === 0 ? (
          <div className="settings-empty">暂无执行记录</div>
        ) : (
          <div className="cron-history-list">
            {history.map(e => (
              <div key={e.id} className={`cron-history-item status-${e.status}`}>
                <div className="cron-history-head">
                  <span className={`cron-status-dot ${e.status}`} />
                  <span className="cron-history-time">{fmtTime(e.startedAt)}</span>
                  {e.durationMs != null && <span className="cron-history-dur">{(e.durationMs / 1000).toFixed(1)}s</span>}
                </div>
                {e.output && <div className="cron-history-output">{e.output.slice(0, 300)}{e.output.length > 300 ? "…" : ""}</div>}
                {e.error && <div className="cron-history-error">{e.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="settings-cron">
      <div className="settings-section-title">
        定时任务
        {jobs.length > 0 && <span className="settings-count">{jobs.length}</span>}
      </div>
      <p className="settings-desc">
        定时任务独立于会话，到时间自动在后台执行。支持 cron 表达式和一次性提醒。
      </p>

      <button className="cron-add-btn" onClick={() => setShowCreate(!showCreate)}>+ 新建任务</button>

      {showCreate && (
        <CronCreateForm onCreate={() => { load(); setShowCreate(false); }} />
      )}

      {loading ? (
        <div className="settings-loading">加载中…</div>
      ) : jobs.length === 0 ? (
        <div className="settings-empty">还没有定时任务。也可以在对话中让 Agent 调用 cron_task 工具创建。</div>
      ) : (
        <div className="cron-job-list">
          {jobs.map(job => (
            <div key={job.id} className={`cron-job-card ${job.enabled ? "" : "disabled"}`}>
              <div className="cron-job-main" onClick={() => handleSelect(job)} style={{ cursor: "pointer" }}>
                <span className={`cron-status-dot ${job.enabled ? "on" : "off"}`} />
                <div className="cron-job-info">
                  <span className="cron-job-name">{job.name}</span>
                  <span className="cron-job-schedule">{job.schedule} · {job.type === "once" ? "一次性" : "循环"} · 📁 {wsName(job.workspaceId)}</span>
                </div>
                <div className="cron-job-stats">
                  <span className="cron-job-next">下次: {fmtTime(job.nextRun)}</span>
                  <span className="cron-job-count">已执行 {job.runCount} 次</span>
                  {job.lastStatus === "error" && <span className="cron-job-err">⚠</span>}
                </div>
              </div>
              <div className="cron-job-actions">
                <button onClick={() => handleAction(job.id, "run")} disabled={running === job.id} title="立即执行">
                  {running === job.id ? "⏳" : "▶"}
                </button>
                {job.enabled ? (
                  <button onClick={() => handleAction(job.id, "pause")} title="暂停">⏸</button>
                ) : (
                  <button onClick={() => handleAction(job.id, "resume")} title="恢复">▶</button>
                )}
                <button onClick={() => handleAction(job.id, "delete")} title="删除">🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CronCreateForm({ onCreate }: { onCreate: () => void }) {
  const workspaces = useWorkspaceStore(s => s.workspaces);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<"cron" | "once">("cron");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id || "default");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || !schedule.trim() || !prompt.trim()) {
      setError("名称、计划、提示词都必填");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/cron/jobs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), schedule: schedule.trim(), prompt: prompt.trim(), type, workspaceId }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error || "创建失败");
      else { setName(""); setSchedule(""); setPrompt(""); onCreate(); }
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  return (
    <div className="cron-create-form">
      <input className="settings-input" placeholder="任务名称" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
      <div className="cron-type-row">
        <button className={`cron-type-btn ${type === "cron" ? "active" : ""}`} onClick={() => setType("cron")}>循环</button>
        <button className={`cron-type-btn ${type === "once" ? "active" : ""}`} onClick={() => setType("once")}>一次性</button>
        <select className="cron-ws-select" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
          {workspaces.map(w => <option key={w.id} value={w.id}>📁 {w.name}</option>)}
        </select>
      </div>
      <input className="settings-input" placeholder="cron 表达式，如 */30 * * * *（每30分钟）或 0 9 * * 1-5（工作日9点）" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
      <textarea className="agent-edit-prompt" placeholder="任务触发时执行的提示词" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
      {error && <div className="ext-error">{error}</div>}
      <button className="settings-save-btn" onClick={handleCreate} disabled={saving}>{saving ? "创建中…" : "创建"}</button>
    </div>
  );
}
