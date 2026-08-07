import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { InputBar } from "./components/InputBar";
import { SidebarFileTree, FilePreviewPane } from "./components/WorkspaceDrawer";
import { DirBrowser } from "./components/DirBrowser";
import { Icon } from "./components/Icon";
import { useChat } from "./hooks/useChat";
import { useChatStore } from "./stores/chat";
import { useWorkspaceStore, type ChatSession } from "./stores/workspace";
import { useAgentsStore } from "./stores/agents";
import { useSessions } from "./hooks/useSessions";
import { sseClient } from "./services/sse-client";
import { SettingsPanel } from "./components/SettingsPanel";
import { useThemeStore } from "./stores/theme";
import { useUIStore } from "./stores/ui";

export default function App() {
  const { createChatSession, sendMessage, abort, loadSession, usage, modelInfo, subToken, subDurationMs, subStatus } = useChat();
  const wsStore = useWorkspaceStore();
  const sessions = useSessions();
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const [sidebarTab, setSidebarTab] = useState<"sessions" | "files">("sessions");
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const wsDropdownRef = useRef<HTMLDivElement>(null);
  // Git 分支选择器
  const [gitBranches, setGitBranches] = useState<{ isRepo: boolean; current: string | null; branches: string[] } | null>(null);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  // Worktree 创建对话框
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);
  const [worktreeCreating, setWorktreeCreating] = useState(false);
  const { mode: themeMode, resolved: themeResolved, toggle: toggleTheme } = useThemeStore();

  // 订阅 UI store：TaskSummaryCard 点击文件 → 切换到侧栏文件 tab
  const gotoFilesTab = useUIStore(s => s.gotoFilesTab);
  const openFileRequest = useUIStore(s => s.openFileRequest);
  useEffect(() => {
    if (gotoFilesTab > 0) setSidebarTab("files");
  }, [gotoFilesTab]);
  useEffect(() => {
    if (openFileRequest) {
      const wsId = useWorkspaceStore.getState().activeId;
      if (wsId) {
        // 内联 openFile：fetch 文件内容 → 设置 currentFile + 打开 drawer
        fetch(`/api/workspace/${wsId}/file?path=${encodeURIComponent(openFileRequest.path)}`)
          .then(r => r.json())
          .then(data => {
            useWorkspaceStore.getState().setCurrentFile(data);
            useWorkspaceStore.getState().setDrawerOpen(true);
          })
          .catch(() => {});
      }
    }
  }, [openFileRequest]);

  useEffect(() => {
    (window as any).__wsStore = useWorkspaceStore;
    (window as any).__chatStore = useChatStore;
  }, []);

  useEffect(() => {
    fetch("/api/workspaces").then(r => r.json()).then(async (d) => {
      const wss = d.workspaces || [];
      wsStore.setWorkspaces(wss);
      if (wss.length > 0 && !useWorkspaceStore.getState().activeId) {
        // 恢复上次选中的工作空间，没有则用第一个
        const savedWsId = localStorage.getItem("myagent:activeWsId");
        const target = wss.find((w: { id: string }) => w.id === savedWsId) ?? wss[0];
        wsStore.setActive(target.id);
        await sessions.loadSessions(target.id);
        const wsSessions = useWorkspaceStore.getState().sessionsByWs[target.id] || [];
        if (wsSessions.length > 0) {
          const recent = wsSessions[0];
          wsStore.setActiveSession(recent.id);
          loadSession(recent.id, recent.id);
        } else {
          const chatSession = await sessions.createSession(target.id);
          createChatSession(chatSession.id, target.path);
        }
      }
    }).catch(e => console.error("Failed to load workspaces:", e));

    // 加载 Agent 预设列表
    useAgentsStore.getState().load().catch(e => console.error("Failed to load agents:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectWorkspace = async (wsId: string) => {
    // 用 getState() 读取最新 state，不用闭包中的 wsStore（可能 stale）
    const curWsStore = useWorkspaceStore.getState();
    const ws = curWsStore.workspaces.find(w => w.id === wsId);
    curWsStore.setActive(wsId);
    localStorage.setItem("myagent:activeWsId", wsId);
    await sessions.loadSessions(wsId);
    const wsSessions = useWorkspaceStore.getState().sessionsByWs[wsId] || [];
    if (wsSessions.length > 0) {
      const recent = wsSessions[0];
      curWsStore.setActiveSession(recent.id);
      // 销毁旧 agent，用新 cwd 重建
      await sseClient.destroyAgent(recent.id);
      useChatStore.getState().setAgentCreated(recent.id, []);
      loadSession(recent.id, recent.id, ws?.path);
    } else {
      const chatSession = await sessions.createSession(wsId);
      createChatSession(chatSession.id, ws?.path);
    }
  };

  const handleNewSession = async () => {
    const curWsStore = useWorkspaceStore.getState();
    if (!curWsStore.activeId) {
      setShowDirBrowser(true);
      return;
    }
    const chatSession = await sessions.createSession(curWsStore.activeId);
    const ws = curWsStore.workspaces.find(w => w.id === curWsStore.activeId);
    createChatSession(chatSession.id, ws?.path);
    if (!(window as any).__chatToAppSession) (window as any).__chatToAppSession = {};
    (window as any).__chatToAppSession[chatSession.id] = chatSession.id;
  };

  const handleSelectSession = (session: ChatSession) => {
    wsStore.setActiveSession(session.id);
    loadSession(session.id, session.id);
  };

  // 下载当前会话的原始 JSON（后端存储的完整数据：messages/thinking/tools/subagents 等）
  const downloadCurrentSession = async () => {
    const sid = useChatStore.getState().activeChatSessionId;
    if (!sid) return;
    // 请求后端拿完整会话 JSON
    const res = await fetch(`/api/sessions/${sid}`);
    if (!res.ok) return;
    const data = await res.json();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const title = data.title || "session";
    a.href = url;
    a.download = `${title}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAsMarkdown = async () => {
    const sid = useChatStore.getState().activeChatSessionId;
    if (!sid) return;
    const res = await fetch(`/api/sessions/${sid}`);
    if (!res.ok) return;
    const data = await res.json();
    const title = data.title || "对话记录";
    const date = new Date(data.createdAt).toLocaleString("zh-CN");
    let md = `# ${title}\n\n> 导出时间：${new Date().toLocaleString("zh-CN")}\n> 创建时间：${date}\n\n---\n\n`;
    for (const msg of (data.messages || [])) {
      if (msg.role === "user") {
        md += `## 🧑 用户\n\n${msg.content}\n\n`;
      } else if (msg.role === "assistant") {
        md += `## 🤖 ${"MyAgent"}\n\n`;
        if (msg.thinking) md += `<details><summary>💭 思考过程</summary>\n\n${msg.thinking}\n\n</details>\n\n`;
        if (msg.tools && msg.tools.length > 0) {
          md += `<details><summary>🔧 工具调用 (${msg.tools.length})</summary>\n\n`;
          for (const t of msg.tools) {
            md += `- **${t.name || t.toolName || "tool"}**`;
            if (t.duration) md += ` (${(t.duration / 1000).toFixed(1)}s)`;
            md += `\n`;
          }
          md += `\n</details>\n\n`;
        }
        md += `${msg.content}\n\n`;
      }
      md += `---\n\n`;
    }
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteSession = async (e: React.MouseEvent, wsId: string, sid: string) => {
    e.stopPropagation();
    await sessions.deleteSession(wsId, sid);
    sseClient.destroyAgent(sid);
  };

  const handleTogglePin = async (wsId: string, sid: string) => {
    // 先乐观更新本地状态
    const wsStore = useWorkspaceStore.getState();
    const sessions = wsStore.sessionsByWs[wsId] || [];
    const updated = sessions.map(s => s.id === sid ? { ...s, pinned: !s.pinned } : s);
    // 重新排序：pinned 在前
    updated.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
    wsStore.setSessions(wsId, updated);
    // 后端持久化
    await fetch(`/api/sessions/${sid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
  };

  const handleSelectDir = async (path: string, name: string) => {
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      wsStore.addWorkspace(data);
      await selectWorkspace(data.id);
      setShowDirBrowser(false);
    } catch (e: any) { alert(e.message); }
  };

  const handlersRef = useRef({ handleNewSession, wsStore, showDirBrowser, setShowDirBrowser, setShowSettings });
  handlersRef.current = { handleNewSession, wsStore, showDirBrowser, setShowDirBrowser, setShowSettings };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current;
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (h.showDirBrowser) {
        if (key === "escape") { e.preventDefault(); h.setShowDirBrowser(false); }
        return;
      }
      if (key === "escape") return;
      if (isMod) {
        if (e.shiftKey && key === "w") { e.preventDefault(); h.wsStore.toggleDrawer(); }
        else if (!e.shiftKey && key === "n") { e.preventDefault(); h.handleNewSession(); }
        else if (!e.shiftKey && key === "b") { e.preventDefault(); h.wsStore.toggleSidebar(); }
        else if (!e.shiftKey && key === ",") { e.preventDefault(); h.setShowSettings(true); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!wsDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target as Node)) {
        setWsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [wsDropdownOpen]);

  const handleSwitchWs = async (wsId: string) => {
    await selectWorkspace(wsId);
    setWsDropdownOpen(false);
  };

  const activeWs = wsStore.workspaces.find(w => w.id === wsStore.activeId);

  // ── Git 分支：工作空间切换时加载分支列表 ──
  const loadGitBranches = async (wsId: string) => {
    try {
      const res = await fetch(`/api/workspace/${wsId}/git/branches`);
      const data = await res.json();
      if (res.ok) setGitBranches(data);
    } catch { /* ignore */ }
  };
  useEffect(() => {
    setGitBranches(null);
    setBranchDropdownOpen(false);
    if (wsStore.activeId) loadGitBranches(wsStore.activeId);
  }, [wsStore.activeId]);

  // 分支切换
  const handleCheckout = async (branch: string) => {
    if (!activeWs || branchSwitching) return;
    setBranchSwitching(true);
    try {
      const res = await fetch(`/api/workspace/${activeWs.id}/git/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch }),
      });
      if (res.ok) {
        setGitBranches(prev => prev ? { ...prev, current: branch } : prev);
        window.location.reload();
      } else {
        const data = await res.json();
        const errMsg = data.error || "未知错误";
        // 分支已在 worktree 中检出 → 切换到对应的 worktree 工作空间
        if (errMsg.includes("already checked out at")) {
          const match = errMsg.match(/at '([^']+)'/);
          const wtPath = match?.[1];
          if (wtPath) {
            // 找到该路径对应的工作空间
            const wtWs = wsStore.workspaces.find(w => w.path === wtPath);
            if (wtWs) {
              await selectWorkspace(wtWs.id);
              setBranchDropdownOpen(false);
              return;
            }
            // 路径存在但未注册为工作空间 → 自动注册
            const addRes = await fetch("/api/workspaces", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: wtPath }),
            });
            if (addRes.ok) {
              const newWs = await addRes.json();
              const wsRes = await fetch("/api/workspaces");
              const wsData = await wsRes.json();
              wsStore.setWorkspaces(wsData.workspaces || []);
              await selectWorkspace(newWs.id);
              setBranchDropdownOpen(false);
              return;
            }
          }
        }
        alert(`切换失败：${errMsg}`);
      }
    } catch (e: any) {
      alert(`切换失败：${e.message}`);
    } finally {
      setBranchSwitching(false);
    }
  };

  // 创建 worktree 并自动切换
  const handleCreateWorktree = async (opts: { branch?: string; newBranch?: string }) => {
    if (!activeWs || worktreeCreating) return;
    setWorktreeCreating(true);
    try {
      // 路径：主仓库同级目录，命名 项目名-分支名
      const branchName = opts.newBranch || opts.branch || "worktree";
      const dirName = `${activeWs.name.split(":")[0]}-${branchName.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      const parentDir = activeWs.path.split("/").slice(0, -1).join("/");
      const targetPath = `${parentDir}/${dirName}`;

      const res = await fetch(`/api/workspace/${activeWs.id}/git/worktree`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...opts, path: targetPath }),
      });
      if (res.ok) {
        const data = await res.json();
        // 刷新工作空间列表
        const wsRes = await fetch("/api/workspaces");
        const wsData = await wsRes.json();
        wsStore.setWorkspaces(wsData.workspaces || []);
        // 切换到新 worktree 工作空间
        if (data.workspace?.id) {
          await selectWorkspace(data.workspace.id);
        }
        setShowWorktreeDialog(false);
        setBranchDropdownOpen(false);
      } else {
        const data = await res.json();
        alert(`创建 Worktree 失败：${data.error || "未知错误"}`);
      }
    } catch (e: any) {
      alert(`创建 Worktree 失败：${e.message}`);
    } finally {
      setWorktreeCreating(false);
    }
  };

  // 分支下拉点击外部关闭
  useEffect(() => {
    if (!branchDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchDropdownOpen]);

  return (
    <div
      className={`app ${wsStore.sidebarCollapsed ? "sidebar-hidden" : ""}`}
      style={wsStore.sidebarCollapsed ? undefined : { gridTemplateColumns: `${wsStore.sidebarWidth}px 1fr` }}
    >
      {/* ===== Sidebar (4-zone) ===== */}
      <aside className="sidebar">
        {/* Zone 1: Header — WS Switcher Dropdown + New + Collapse */}
        <div className="sb-header" ref={wsDropdownRef}>
          <div className="ws-switcher" onClick={() => setWsDropdownOpen(v => !v)}>
            <div className="ws-switcher-brand">M</div>
            <div className="ws-switcher-info">
              <span className="ws-switcher-name">{activeWs?.name ?? "选择工作空间"}</span>
            </div>
            <span className={`ws-switcher-chevron ${wsDropdownOpen ? "open" : ""}`}>
              <Icon name="i-chevron" size={14} />
            </span>
          </div>

          {/* 工作空间下拉菜单 */}
          {wsDropdownOpen && (
            <div className="ws-dropdown show">
              {wsStore.workspaces.map(w => (
                <div
                  key={w.id}
                  className={`ws-dropdown-item ${w.id === wsStore.activeId ? "active" : ""}`}
                  onClick={() => handleSwitchWs(w.id)}
                >
                  <Icon name="i-folder" size={16} className="ws-dropdown-icon" />
                  <span className="ws-dropdown-name">{w.name}</span>
                  {w.id === wsStore.activeId && <Icon name="i-check" size={14} className="ws-dropdown-check" />}
                </div>
              ))}
              <div className="ws-dropdown-divider" />
              {activeWs && (
                <div
                  className="ws-dropdown-action"
                  onClick={() => {
                    setWsDropdownOpen(false);
                    fetch(`/api/workspace/${encodeURIComponent(activeWs.id)}/open`, { method: "POST" });
                  }}
                >
                  <Icon name="i-folder" size={16} />
                  <span>在 Finder 中打开</span>
                </div>
              )}
              <div
                className="ws-dropdown-action"
                onClick={() => { setWsDropdownOpen(false); setShowDirBrowser(true); }}
              >
                <Icon name="i-plus" size={16} />
                <span>打开工作空间…</span>
              </div>
            </div>
          )}

          <button className="sb-header-btn accent" onClick={handleNewSession} title="新建会话 (⌘N)">
            <Icon name="i-plus" size={18} />
          </button>
          <button className="sb-header-btn" onClick={() => wsStore.toggleSidebar()} title="收起侧栏 (⌘B)">
            <Icon name="i-sidebar-collapse" size={16} />
          </button>
        </div>

        {/* Zone 2: Nav — Tab(会话/文件) + 搜索 */}
        <nav className="sb-nav">
          <div className={`sb-tab ${sidebarTab === "sessions" ? "active" : ""}`} onClick={() => setSidebarTab("sessions")}>
            <Icon name="i-message" size={15} />
            <span>会话</span>
            {(() => {
              const count = wsStore.activeId ? (wsStore.sessionsByWs[wsStore.activeId] || []).length : 0;
              return count > 0 ? <span className="sb-tab-count">{count}</span> : null;
            })()}
          </div>
          <div className={`sb-tab ${sidebarTab === "files" ? "active" : ""}`} onClick={() => setSidebarTab("files")}>
            <Icon name="i-folder" size={15} />
            <span>文件</span>
          </div>
          <button className="sb-search-btn" title="搜索 (⌘K)" onClick={() => setSidebarTab("sessions")}>
            <Icon name="i-search" size={15} />
          </button>
        </nav>

        {/* Zone 3: Content */}
        {sidebarTab === "sessions" ? (
          <div className="session-list">
            {wsStore.workspaces.length === 0 ? (
              <div className="ws-empty-hint" onClick={() => setShowDirBrowser(true)}>
                点击添加你的第一个项目
              </div>
            ) : !activeWs ? (
              <div className="ws-empty-hint" onClick={() => setWsDropdownOpen(true)}>
                点击顶部选择工作空间
              </div>
            ) : (() => {
              const wsSessions = wsStore.sessionsByWs[activeWs.id] || [];
              return wsSessions.length > 0 ? (
                <SessionList
                  sessions={wsSessions}
                  activeSessionId={wsStore.activeSessionId}
                  onSelect={handleSelectSession}
                  onDelete={(e, sid) => handleDeleteSession(e, activeWs.id, sid)}
                  onTogglePin={(sid) => handleTogglePin(activeWs.id, sid)}
                />
              ) : (
                <div className="ws-no-sessions">暂无会话<br /><button className="sb-tab" style={{ marginTop: 8 }} onClick={handleNewSession}>+ 新建会话</button></div>
              );
            })()}
          </div>
        ) : (
          <SidebarFileTree onOpenFile={() => wsStore.setDrawerOpen(true)} />
        )}

        {/* Zone 4: Footer — Token + User */}
        <div className="sb-footer">
          <SidebarTokenRow usage={usage} modelInfo={modelInfo} subToken={subToken} subDurationMs={subDurationMs} subStatus={subStatus} />
          <div className="user-row">
            <div className="user-avatar" onClick={() => setShowSettings(true)}>鑫</div>
            <span className="user-name-sb" onClick={() => setShowSettings(true)}>小鑫</span>
            <span className="user-plan-tag">{modelInfo?.name ?? modelInfo?.model ?? "zai"}</span>
            <div className="user-row-actions">
              <button
                className="theme-toggle-btn"
                onClick={toggleTheme}
                title={themeMode === "auto" ? `跟随系统（当前：${themeResolved === "dark" ? "深色" : "浅色"}）— 点击切换` : (themeResolved === "dark" ? "深色模式" : "浅色模式")}
              >
                <Icon name={themeResolved === "dark" ? "i-sun" : "i-moon"} size={16} />
              </button>
              <button className="settings-toggle-btn" onClick={() => setShowSettings(true)} title="设置">
                <Icon name="i-settings" size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* sidebar 拖拽调宽手柄 */}
        <div
          className="sidebar-resize-handle"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = wsStore.sidebarWidth;
            const onMove = (ev: MouseEvent) => {
              wsStore.setSidebarWidth(startW + (ev.clientX - startX));
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
            };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }}
        />
      </aside>

      {/* ===== Main ===== */}
      <main className={`main ${wsStore.drawerOpen ? "preview-open" : ""}`}>
        {/* Chat Header — 在 main 里，不在 ChatPanel 里 */}
        <header className="chat-head">
          <button className="icon-btn sidebar-toggle" onClick={() => wsStore.toggleSidebar()} title="切换侧栏">
            <Icon name="i-menu" size={18} />
          </button>
          <div className="chat-title-group">
            <h1 className="chat-title" title={activeWs?.path ?? undefined}>{activeWs?.name ?? "MyAgent"}</h1>
            {/* Git 分支选择器 */}
            {gitBranches?.isRepo && gitBranches.current && (
              <div className="branch-selector" ref={branchDropdownRef}>
                <button
                  className="branch-selector-btn"
                  onClick={() => setBranchDropdownOpen(v => !v)}
                  type="button"
                  title={`当前分支：${gitBranches.current}`}
                >
                  <Icon name="i-git-branch" size={13} />
                  <span className="branch-selector-name">{gitBranches.current}</span>
                  <Icon name="i-chevron" size={11} className={`branch-selector-chevron ${branchDropdownOpen ? "open" : ""}`} />
                </button>
                {branchDropdownOpen && (
                  <div className="branch-dropdown show">
                    <div className="branch-dropdown-header">
                      <span>分支</span>
                      <span className="branch-dropdown-count">{gitBranches.branches.length}</span>
                    </div>
                    <div className="branch-dropdown-list">
                      {gitBranches.branches.map(b => (
                        <button
                          key={b}
                          className={`branch-dropdown-item ${b === gitBranches.current ? "active" : ""}`}
                          onClick={() => b !== gitBranches.current && handleCheckout(b)}
                          type="button"
                          disabled={branchSwitching || b === gitBranches.current}
                        >
                          <span className="branch-dropdown-item-name">{b}</span>
                          {b === gitBranches.current && <Icon name="i-check" size={13} className="branch-dropdown-item-check" />}
                        </button>
                      ))}
                    </div>
                    <div className="branch-dropdown-divider" />
                    <button
                      className="branch-dropdown-action"
                      onClick={() => { setBranchDropdownOpen(false); setShowWorktreeDialog(true); }}
                      type="button"
                    >
                      <Icon name="i-git-branch" size={13} />
                      <span>在新 Worktree 中打开…</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="chat-head-actions">
            {activeWs && (
              <button
                className="icon-btn chat-open-finder-btn"
                onClick={() => fetch(`/api/workspace/${encodeURIComponent(activeWs.id)}/open`, { method: "POST" })}
                title={`在 Finder 中打开「${activeWs.name}」`}
              >
                <Icon name="i-folder" size={16} />
              </button>
            )}
            <div className="download-menu-wrapper" ref={(el) => { downloadMenuRef.current = el; }}>
              <button
                className="icon-btn chat-download-btn"
                onClick={() => setDownloadMenuOpen(!downloadMenuOpen)}
                title="下载"
                disabled={!useChatStore.getState().activeChatSessionId}
              >
                <Icon name="i-download" size={16} />
              </button>
              {downloadMenuOpen && (
                <DownloadMenu
                  sessionId={useChatStore.getState().activeChatSessionId}
                  onDownloadJson={downloadCurrentSession}
                  onDownloadMarkdown={downloadAsMarkdown}
                  onClose={() => setDownloadMenuOpen(false)}
                />
              )}
            </div>
          </div>
        </header>
        {/* Main Body: chat + preview as flex siblings */}
        <div className="main-body">
          <div className="chat-pane">
            <ChatPanel />
            <InputBar />
          </div>

        {/* 右侧预览面板（flex 子元素，可拖拽调宽） */}
        {wsStore.drawerOpen && (
          <div className="preview-pane-wrap" style={{ width: wsStore.previewWidth }}>
            <div
              className="preview-resize-handle"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = wsStore.previewWidth;
                const onMove = (ev: MouseEvent) => {
                  const delta = startX - ev.clientX;
                  wsStore.setPreviewWidth(startW + delta);
                };
                const onUp = () => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                };
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            />
            <FilePreviewPane />
          </div>
        )}
        </div>
      </main>

      {showDirBrowser && (
        <DirBrowser onSelect={handleSelectDir} onCancel={() => setShowDirBrowser(false)} />
      )}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onSwitchWorkspace={handleSwitchWs}
          onAddWorkspace={() => setShowDirBrowser(true)}
        />
      )}
      {showWorktreeDialog && activeWs && gitBranches && (
        <WorktreeDialog
          branches={gitBranches.branches}
          currentBranch={gitBranches.current}
          wsName={activeWs.name}
          wsPath={activeWs.path}
          creating={worktreeCreating}
          onCreate={handleCreateWorktree}
          onClose={() => setShowWorktreeDialog(false)}
        />
      )}
    </div>
  );
}

// ── Worktree 创建对话框 ──
function WorktreeDialog({ branches, currentBranch, wsName, wsPath, creating, onCreate, onClose }: {
  branches: string[];
  currentBranch: string | null;
  wsName: string;
  wsPath: string;
  creating: boolean;
  onCreate: (opts: { branch?: string; newBranch?: string }) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [selectedBranch, setSelectedBranch] = useState(currentBranch || branches[0] || "");
  const [newBranchName, setNewBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState(currentBranch || branches[0] || "");

  // 预览路径
  const branchName = mode === "new" ? (newBranchName || "new-branch") : selectedBranch;
  const dirName = `${wsName.split(":")[0]}-${branchName.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  const parentDir = wsPath.split("/").slice(0, -1).join("/");
  const previewPath = `${parentDir}/${dirName}`;

  const canSubmit = mode === "existing" ? !!selectedBranch : !!newBranchName.trim();

  const handleSubmit = () => {
    if (!canSubmit || creating) return;
    if (mode === "new") {
      onCreate({ newBranch: newBranchName.trim(), branch: baseBranch });
    } else {
      onCreate({ branch: selectedBranch });
    }
  };

  return (
    <div className="wt-dialog-overlay" onClick={onClose}>
      <div className="wt-dialog" onClick={e => e.stopPropagation()}>
        <div className="wt-dialog-header">
          <span className="wt-dialog-title">
            <Icon name="i-git-branch" size={16} />
            新建 Worktree
          </span>
          <button className="wt-dialog-close" onClick={onClose} type="button">
            <Icon name="i-x" size={16} />
          </button>
        </div>
        <div className="wt-dialog-body">
          {/* 模式切换 */}
          <div className="wt-mode-tabs">
            <button
              className={`wt-mode-tab ${mode === "new" ? "active" : ""}`}
              onClick={() => setMode("new")}
              type="button"
            >新分支</button>
            <button
              className={`wt-mode-tab ${mode === "existing" ? "active" : ""}`}
              onClick={() => setMode("existing")}
              type="button"
            >现有分支</button>
          </div>

          {mode === "new" ? (
            <>
              <div className="wt-field">
                <label className="wt-field-label">新分支名</label>
                <input
                  className="wt-field-input"
                  type="text"
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  placeholder="例如：feature/login"
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && handleSubmit()}
                />
              </div>
              <div className="wt-field">
                <label className="wt-field-label">基于分支</label>
                <select
                  className="wt-field-select"
                  value={baseBranch}
                  onChange={e => setBaseBranch(e.target.value)}
                >
                  {branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div className="wt-field">
              <label className="wt-field-label">选择分支</label>
              <select
                className="wt-field-select"
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
              >
                {branches.map(b => <option key={b} value={b}>{b}{b === currentBranch ? " (当前)" : ""}</option>)}
              </select>
            </div>
          )}

          {/* 路径预览 */}
          <div className="wt-path-preview">
            <Icon name="i-folder" size={13} />
            <span className="wt-path-text" title={previewPath}>{previewPath}</span>
          </div>
        </div>
        <div className="wt-dialog-footer">
          <button className="wt-btn-cancel" onClick={onClose} type="button" disabled={creating}>取消</button>
          <button className="wt-btn-create" onClick={handleSubmit} type="button" disabled={!canSubmit || creating}>
            {creating ? "创建中…" : "创建并切换"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Session List (grouped by date) ──
function SessionList({ sessions, activeSessionId, onSelect, onDelete, onTogglePin }: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (s: ChatSession) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const groups = groupSessionsByDate(sessions);
  return (
    <>
      {groups.map(group => (
        <div key={group.label} className="session-group">
          <div className="session-group-label">{group.label}</div>
          {group.items.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              isActive={activeSessionId === s.id}
              onSelect={onSelect}
              onDelete={onDelete}
              onTogglePin={onTogglePin}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function SessionRow({ session, isActive, onSelect, onDelete, onTogglePin }: {
  session: ChatSession;
  isActive: boolean;
  onSelect: (s: ChatSession) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const isGenerating = useChatStore(s => s.sessions[session.id]?.isGenerating ?? false);
  return (
    <div
      className={`session-item ${isActive ? "active" : ""} ${isGenerating ? "generating" : ""} ${session.pinned ? "pinned" : ""}`}
      onClick={() => onSelect(session)}
    >
      <span className={`session-status ${isGenerating ? "generating" : isActive ? "active" : ""}`} />
      {session.pinned && <span className="session-pin-icon">📌</span>}
      <span className="session-title">{session.title}</span>
      <span className="session-meta">
        <span className="session-time">
          {new Date(session.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
        </span>
      </span>
      <button
        className="session-pin-btn"
        onClick={(e) => { e.stopPropagation(); onTogglePin(session.id); }}
        title={session.pinned ? "取消置顶" : "置顶"}
      >
        {session.pinned ? "📌" : "📍"}
      </button>
      <button
        className="session-delete-btn"
        onClick={(e) => { e.stopPropagation(); onDelete(e, session.id); }}
        title="删除会话"
      >
        <Icon name="i-trash" size={13} />
      </button>
    </div>
  );
}

// ── Sidebar Token Row ──
function SidebarTokenRow({ usage, modelInfo, subToken, subDurationMs, subStatus }: {
  usage: {
    stats: { tokens: { input: number; output: number; total: number }; cost: number; toolCalls: number } | null;
    context: { tokens: number | null; contextWindow: number; percent: number | null } | null;
  } | null;
  modelInfo: { provider: string; model: string; name: string; contextWindow: number } | null;
  subToken?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | null;
  subDurationMs?: number | null;
  subStatus?: string | null;
}) {
  const toK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  // ── 钻入子 agent 视图：显示子 agent 独立 token 统计 ──
  if (subToken) {
    const dur = subDurationMs ? `${(subDurationMs / 1000).toFixed(1)}s` : null;
    return (
      <div className="token-detail-row" title={`子 Agent ${subStatus ?? ""} ${dur ?? ""}`.trim()}>
        <div className="token-detail-ctx">
          <span className="tds-sub-label">🤖 子Agent</span>
          {dur && <span className="tds-sub-dur">{dur}</span>}
        </div>
        <div className="token-detail-stats">
          <span className="tds-item">↑{toK(subToken.input)}</span>
          <span className="tds-item">↓{toK(subToken.output)}</span>
          <span className="tds-item tds-total">Σ{toK(subToken.total)}</span>
        </div>
      </div>
    );
  }

  // ── 主会话视图 ──
  const ctx = usage?.context;
  const pct = ctx?.percent ?? 0;
  const tier = pct >= 80 ? "danger" : pct >= 50 ? "warn" : "ok";
  const tokens = usage?.stats?.tokens;

  return (
    <div className="token-detail-row" title={modelInfo ? `${modelInfo.provider}/${modelInfo.model}` : undefined}>
      <div className="token-detail-ctx">
        <div className="token-bar-mini">
          <div className={`token-bar-mini-fill ${tier}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className="token-detail-ctx-text">
          {ctx?.tokens != null ? toK(ctx.tokens) : "—"}<span className="tds-sep">/</span>{ctx?.contextWindow ? toK(ctx.contextWindow) : "?"}
        </span>
      </div>
      {tokens ? (
        <div className="token-detail-stats">
          <span className="tds-item">↑{toK(tokens.input)}</span>
          <span className="tds-item">↓{toK(tokens.output)}</span>
          <span className="tds-item tds-total">Σ{toK(tokens.total)}</span>
        </div>
      ) : (
        <div className="token-detail-stats"><span className="tds-empty">无用量</span></div>
      )}
    </div>
  );
}

function groupSessionsByDate(sessions: ChatSession[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;
  const groups: Array<{ label: string; items: ChatSession[] }> = [
    { label: "今天", items: [] }, { label: "昨天", items: [] },
    { label: "7天内", items: [] }, { label: "更早", items: [] },
  ];
  for (const s of sessions) {
    if (s.updatedAt >= today) groups[0].items.push(s);
    else if (s.updatedAt >= yesterday) groups[1].items.push(s);
    else if (s.updatedAt >= weekAgo) groups[2].items.push(s);
    else groups[3].items.push(s);
  }
  return groups.filter(g => g.items.length > 0);
}

// ── 下载菜单：会话 JSON + Agent 原始 jsonl 日志列表 ──

function DownloadMenu({ sessionId, onDownloadJson, onDownloadMarkdown, onClose }: {
  sessionId: string | null;
  onDownloadJson: () => void;
  onDownloadMarkdown: () => void;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<{ name: string; size: number; mtime: string }[] | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/sessions/${sessionId}/agent-logs`)
      .then(r => r.json())
      .then(d => setLogs(d.logs || []))
      .catch(() => setLogs([]));
  }, [sessionId]);

  const downloadLog = (filename: string) => {
    if (!sessionId) return;
    // 直接用浏览器导航触发下载（后端设置了 Content-Disposition）
    window.open(`/api/sessions/${sessionId}/agent-logs/${encodeURIComponent(filename)}`, "_blank");
  };

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <>
      <div className="download-menu-overlay" onClick={onClose} />
      <div className="download-menu">
        <button className="download-menu-item" onClick={() => { onDownloadJson(); onClose(); }}>
          <span className="dm-icon">📄</span>
          <div className="dm-text">
            <div className="dm-title">会话记录 (JSON)</div>
            <div className="dm-desc">含思考/工具/子Agent，可直接导入</div>
          </div>
        </button>
        <button className="download-menu-item" onClick={() => { onDownloadMarkdown(); onClose(); }}>
          <span className="dm-icon">📝</span>
          <div className="dm-text">
            <div className="dm-title">导出为 Markdown</div>
            <div className="dm-desc">干净的可读文档，适合分享和归档</div>
          </div>
        </button>
        <div className="download-menu-divider" />
        <div className="download-menu-label">Agent 原始日志 (JSONL)</div>
        {logs === null ? (
          <div className="download-menu-loading">加载中…</div>
        ) : logs.length === 0 ? (
          <div className="download-menu-empty">暂无日志文件</div>
        ) : (
          <div className="download-menu-logs">
            {logs.map(log => (
              <button
                key={log.name}
                className="download-menu-item download-menu-log"
                onClick={() => downloadLog(log.name)}
                title={log.name}
              >
                <span className="dm-icon">📋</span>
                <div className="dm-text">
                  <div className="dm-title">{log.name.slice(0, 30)}…</div>
                  <div className="dm-desc">{fmtSize(log.size)} · {fmtTime(log.mtime)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
