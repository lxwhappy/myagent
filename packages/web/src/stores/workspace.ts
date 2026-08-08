import { create } from "zustand";
import type { FileContent } from "../hooks/workspace-types";

export interface Workspace {
  id: string;
  name: string;
  path: string;
}

export interface ChatSession {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  // 每个工作空间的会话列表
  sessionsByWs: Record<string, ChatSession[]>;
  // 当前激活的会话
  activeSessionId: string | null;
  // 展开的工作空间（显示会话列表）
  expandedWs: Set<string>;

  drawerOpen: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  previewWidth: number;
  treeWidth: number;
  searchQuery: string;
  // 多 tab 模型：openFiles = 所有打开的文件 tab，activeFilePath = 当前激活的 tab
  openFiles: FileContent[];
  activeFilePath: string | null;
  // currentFile 始终等于 openFiles 中 path === activeFilePath 的文件（保持向后兼容）
  currentFile: FileContent | null;
  fileLoading: boolean;

  setWorkspaces: (ws: Workspace[]) => void;
  addWorkspace: (ws: Workspace) => void;
  removeWorkspace: (id: string) => void;
  setActive: (id: string | null) => void;
  setSessions: (wsId: string, sessions: ChatSession[]) => void;
  addSession: (wsId: string, session: ChatSession) => void;
  updateSession: (id: string, patch: Partial<ChatSession>) => void;
  removeSession: (wsId: string, id: string) => void;
  setActiveSession: (id: string | null) => void;
  toggleWsExpanded: (id: string) => void;
  toggleDrawer: () => void;
  setDrawerOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setPreviewWidth: (w: number) => void;
  setTreeWidth: (w: number) => void;
  setSearchQuery: (q: string) => void;
  // 多 tab 操作
  openFileInTab: (f: FileContent) => void;
  closeFileTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  closeAllTabs: () => void;
  // 向后兼容
  setCurrentFile: (f: FileContent | null) => void;
  setFileLoading: (v: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeId: null,
  sessionsByWs: {},
  activeSessionId: null,
  expandedWs: new Set(),
  drawerOpen: false,
  sidebarCollapsed: false,
  sidebarWidth: 264,
  previewWidth: 520,
  treeWidth: 220,
  searchQuery: "",
  openFiles: [],
  activeFilePath: null,
  currentFile: null,
  fileLoading: false,

  setWorkspaces: (ws) => set({ workspaces: ws }),
  addWorkspace: (ws) => set((s) => ({ workspaces: [...s.workspaces.filter(w => w.id !== ws.id), ws] })),
  removeWorkspace: (id) => set((s) => ({
    workspaces: s.workspaces.filter(w => w.id !== id),
    activeId: s.activeId === id ? null : s.activeId,
  })),
  setActive: (id) => set((s) => ({
    activeId: id,
    expandedWs: id ? new Set([...s.expandedWs, id]) : s.expandedWs,
  })),
  setSessions: (wsId, sessions) => set((s) => ({
    sessionsByWs: { ...s.sessionsByWs, [wsId]: sessions },
  })),
  addSession: (wsId, session) => set((s) => ({
    sessionsByWs: {
      ...s.sessionsByWs,
      [wsId]: [session, ...(s.sessionsByWs[wsId] || [])],
    },
  })),
  updateSession: (id, patch) => set((s) => {
    const updated = { ...s.sessionsByWs };
    for (const wsId of Object.keys(updated)) {
      updated[wsId] = updated[wsId].map(sess =>
        sess.id === id ? { ...sess, ...patch, updatedAt: Date.now() } : sess
      );
    }
    return { sessionsByWs: updated };
  }),
  removeSession: (wsId, id) => set((s) => ({
    sessionsByWs: {
      ...s.sessionsByWs,
      [wsId]: (s.sessionsByWs[wsId] || []).filter(sess => sess.id !== id),
    },
    activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
  })),
  setActiveSession: (id) => set({ activeSessionId: id }),
  toggleWsExpanded: (id) => set((s) => {
    const next = new Set(s.expandedWs);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { expandedWs: next };
  }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  setDrawerOpen: (v) => set({ drawerOpen: v }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setSidebarWidth: (w) => set({ sidebarWidth: Math.max(200, Math.min(500, w)) }),
  setPreviewWidth: (w) => set({ previewWidth: Math.max(100, Math.min(900, w)) }),
  setTreeWidth: (w) => set({ treeWidth: Math.max(140, Math.min(500, w)) }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  // ── 多 Tab 操作 ──
  openFileInTab: (f) => set((s) => {
    const exists = s.openFiles.some(t => t.path === f.path);
    return {
      openFiles: exists ? s.openFiles.map(t => t.path === f.path ? f : t) : [...s.openFiles, f],
      activeFilePath: f.path,
      currentFile: f,
    };
  }),

  closeFileTab: (path) => set((s) => {
    const idx = s.openFiles.findIndex(t => t.path === path);
    if (idx < 0) return {};
    const newTabs = s.openFiles.filter(t => t.path !== path);
    const wasActive = s.activeFilePath === path;
    let newActive = s.activeFilePath;
    let newCurrent = s.currentFile;
    if (wasActive) {
      if (newTabs.length === 0) {
        newActive = null;
        newCurrent = null;
      } else {
        const nextIdx = Math.min(idx, newTabs.length - 1);
        newActive = newTabs[nextIdx].path;
        newCurrent = newTabs[nextIdx];
      }
    }
    return { openFiles: newTabs, activeFilePath: newActive, currentFile: newCurrent };
  }),

  setActiveTab: (path) => set((s) => {
    const file = s.openFiles.find(t => t.path === path);
    return { activeFilePath: path, currentFile: file ?? null };
  }),

  closeAllTabs: () => set({ openFiles: [], activeFilePath: null, currentFile: null }),

  // 向后兼容
  setCurrentFile: (f) => set((s) => {
    if (!f) return { currentFile: null, activeFilePath: null };
    return { currentFile: f, activeFilePath: f.path };
  }),
  setFileLoading: (v) => set({ fileLoading: v }),
}));
