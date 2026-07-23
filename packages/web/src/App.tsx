import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { InputBar } from "./components/InputBar";
import { Splitter } from "./components/Splitter";
import { WorkspaceDrawer } from "./components/WorkspaceDrawer";
import { DirBrowser } from "./components/DirBrowser";
import { useChat } from "./hooks/useChat";
import { useChatStore } from "./stores/chat";
import { useWorkspaceStore, type ChatSession } from "./stores/workspace";
import { useSessions } from "./hooks/useSessions";
import { sseClient } from "./services/sse-client";
import { SettingsPanel } from "./components/SettingsPanel";
import "./styles.css";

export default function App() {
  const { createChatSession, sendMessage, abort, loadSession } = useChat();
  const wsStore = useWorkspaceStore();
  const sessions = useSessions();
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    // 暴露 store 的 getState 方法到 window，让 useChat 能实时访问
    (window as any).__wsStore = useWorkspaceStore;
    (window as any).__chatStore = useChatStore;
  }, []);

  useEffect(() => {
    fetch("/api/workspaces").then(r => r.json()).then(async (d) => {
      const wss = d.workspaces || [];
      wsStore.setWorkspaces(wss);
      // 首次打开：自动选中第一个工作空间 + 加载/创建会话
      if (wss.length > 0 && !useWorkspaceStore.getState().activeId) {
        const first = wss[0];
        wsStore.setActive(first.id);
        wsStore.toggleWsExpanded(first.id);
        // 加载该工作空间的会话列表
        await sessions.loadSessions(first.id);
        const wsSessions = useWorkspaceStore.getState().sessionsByWs[first.id] || [];
        if (wsSessions.length > 0) {
          // 选中最近的会话
          const recent = wsSessions[0];
          wsStore.setActiveSession(recent.id);
          loadSession(recent.id, recent.id);
        } else {
          // 没有会话则自动创建一个
          const chatSession = await sessions.createSession(first.id);
          createChatSession(chatSession.id, first.path);
        }
      }
    }).catch(e => console.error("Failed to load workspaces:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectWorkspace = async (wsId: string) => {
    wsStore.setActive(wsId);
    const ws = wsStore.workspaces.find(w => w.id === wsId);
    await sessions.loadSessions(wsId);
    wsStore.toggleWsExpanded(wsId);
  };

  // 新会话：在工作空间下创建
  const handleNewSession = async () => {
    if (!wsStore.activeId) {
      alert("请先选择一个工作空间");
      return;
    }
    const chatSession = await sessions.createSession(wsStore.activeId);
    // chatSession.id 作为 chatSessionId，同时作为后端 agent 的标识
    const ws = wsStore.workspaces.find(w => w.id === wsStore.activeId);
    createChatSession(chatSession.id, ws?.path);

    // 映射关系
    if (!(window as any).__chatToAppSession) (window as any).__chatToAppSession = {};
    (window as any).__chatToAppSession[chatSession.id] = chatSession.id;
  };

  const handleSelectSession = (session: ChatSession) => {
    wsStore.setActiveSession(session.id);
    loadSession(session.id, session.id);
  };

  const handleDeleteSession = async (e: React.MouseEvent, wsId: string, sid: string) => {
    e.stopPropagation();
    await sessions.deleteSession(wsId, sid);
    sseClient.destroyAgent(sid);
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

  // 用 ref 持有最新的函数/状态，避免 stale closure
  const handlersRef = useRef({ handleNewSession, wsStore, showDirBrowser, setShowDirBrowser });
  handlersRef.current = { handleNewSession, wsStore, showDirBrowser, setShowDirBrowser };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current;
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // 有弹窗打开时，只有 Escape 生效（关闭弹窗），其他快捷键不触发
      if (h.showDirBrowser) {
        if (key === "escape") {
          e.preventDefault();
          h.setShowDirBrowser(false);
        }
        return;
      }

      // Escape 无弹窗时不处理
      if (key === "escape") return;

      // Cmd/Ctrl 组合键为全局快捷键，即便焦点在 input/textarea 也生效
      if (isMod) {
        if (e.shiftKey && key === "w") {
          e.preventDefault();
          h.wsStore.toggleDrawer();
        } else if (!e.shiftKey && key === "n") {
          e.preventDefault();
          h.handleNewSession();
        } else if (!e.shiftKey && key === "b") {
          e.preventDefault();
          h.wsStore.toggleSidebar();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app">
      {wsStore.sidebarCollapsed ? (
        <div className="sidebar-collapsed">
          <button className="sidebar-icon-btn" onClick={() => wsStore.toggleSidebar()} title="展开侧栏">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      ) : (
        <div className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-brand">MyAgent</span>
            <button className="sidebar-icon-btn" onClick={() => wsStore.toggleSidebar()} title="收起侧栏">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          <button className="btn-new-session" onClick={handleNewSession}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            新会话
          </button>

          <div className="sidebar-nav">
            <button className="nav-btn" onClick={() => setShowDirBrowser(true)}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M2 4C2 3.45 2.45 3 3 3H6L7.5 4.5H13C13.55 4.5 14 4.95 14 5.5V12C14 12.55 13.55 13 13 13H3C2.45 13 2 12.55 2 12V4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              </svg>
              添加项目
            </button>
            <button className="nav-btn" onClick={() => setShowSettings(true)}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M8 5.5C6.62 5.5 5.5 6.62 5.5 8C5.5 9.38 6.62 10.5 8 10.5C9.38 10.5 10.5 9.38 10.5 8C10.5 6.62 9.38 5.5 8 5.5Z" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M12.5 8C12.5 7.76 12.48 7.53 12.44 7.3L13.45 6.51L12.45 4.78L11.23 5.24C10.9 4.94 10.52 4.7 10.1 4.54L9.9 3.25H7.9L7.7 4.54C7.28 4.7 6.9 4.94 6.57 5.24L5.35 4.78L4.35 6.51L5.36 7.3C5.32 7.53 5.3 7.76 5.3 8C5.3 8.24 5.32 8.47 5.36 8.7L4.35 9.49L5.35 11.22L6.57 10.76C6.9 11.06 7.28 11.3 7.7 11.46L7.9 12.75H9.9L10.1 11.46C10.52 11.3 10.9 11.06 11.23 10.76L12.45 11.22L13.45 9.49L12.44 8.7C12.48 8.47 12.5 8.24 12.5 8Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
              </svg>
              设置
            </button>
          </div>

          <div className="ws-list">
            <div className="ws-list-header">
              <span className="ws-list-title">工作空间</span>
              <button className="ws-list-add-btn" onClick={() => setShowDirBrowser(true)} title="添加项目">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 3V11M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {wsStore.workspaces.length === 0 && (
              <div className="ws-empty-hint" onClick={() => setShowDirBrowser(true)}>
                点击 + 添加你的第一个项目
              </div>
            )}

            {wsStore.workspaces.map(w => {
              const isExpanded = wsStore.expandedWs.has(w.id);
              const isActive = wsStore.activeId === w.id;
              const wsSessions = wsStore.sessionsByWs[w.id] || [];
              return (
                <div key={w.id} className="ws-group">
                  <div
                    className={`ws-group-header ${isActive ? "ws-group-active" : ""}`}
                    onClick={() => isActive ? wsStore.toggleWsExpanded(w.id) : selectWorkspace(w.id)}
                  >
                    <span className="ws-chevron">{isExpanded ? "▾" : "▸"}</span>
                    <span className="ws-group-icon">📁</span>
                    <span className="ws-group-name">{w.name}</span>
                  </div>
                  {isExpanded && wsSessions.length > 0 && (
                    <SessionList
                      sessions={wsSessions}
                      activeSessionId={wsStore.activeSessionId}
                      onSelect={handleSelectSession}
                      onDelete={(e, sid) => handleDeleteSession(e, w.id, sid)}
                    />
                  )}
                  {isExpanded && wsSessions.length === 0 && (
                    <div className="ws-no-sessions">暂无会话</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="sidebar-info">
            <p>MyAgent v0.8</p>
          </div>
        </div>
      )}

      <div className="main">
        <ChatPanel />
        <InputBar />
      </div>

      {wsStore.drawerOpen && (
        <Splitter onResize={delta => wsStore.setPreviewWidth(wsStore.previewWidth - delta)} />
      )}
      {wsStore.drawerOpen && <WorkspaceDrawer />}
      {showDirBrowser && (
        <DirBrowser onSelect={handleSelectDir} onCancel={() => setShowDirBrowser(false)} />
      )}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function SessionList({ sessions, activeSessionId, onSelect, onDelete }: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (s: ChatSession) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}) {
  const groups = groupSessionsByDate(sessions);
  return (
    <div className="session-list">
      {groups.map(group => (
        <div key={group.label}>
          <div className="session-group-label">{group.label}</div>
          {group.items.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              isActive={activeSessionId === s.id}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SessionRow({ session, isActive, onSelect, onDelete }: {
  session: ChatSession;
  isActive: boolean;
  onSelect: (s: ChatSession) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}) {
  // 订阅该会话的 isGenerating 状态（响应式：状态变化时本行重新渲染）
  const isGenerating = useChatStore(s => s.sessions[session.id]?.isGenerating ?? false);
  return (
    <div
      className={`session-item ${isActive ? "session-item-active" : ""}`}
      onClick={() => onSelect(session)}
    >
      <span className="session-icon">💬</span>
      <span className="session-title">{session.title}</span>
      {isGenerating && <span className="session-spinner" />}
      <button className="session-delete-btn" onClick={(e) => onDelete(e, session.id)} title="删除">✕</button>
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
