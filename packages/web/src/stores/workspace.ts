import { create } from "zustand";

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
  previewWidth: number;
  treeWidth: number;
  searchQuery: string;

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
  setPreviewWidth: (w: number) => void;
  setTreeWidth: (w: number) => void;
  setSearchQuery: (q: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeId: null,
  sessionsByWs: {},
  activeSessionId: null,
  expandedWs: new Set(),
  drawerOpen: false,
  sidebarCollapsed: false,
  previewWidth: 280,
  treeWidth: 220,
  searchQuery: "",

  setWorkspaces: (ws) => set({ workspaces: ws }),
  addWorkspace: (ws) => set((s) => ({ workspaces: [...s.workspaces.filter(w => w.id !== ws.id), ws] })),
  removeWorkspace: (id) => set((s) => ({
    workspaces: s.workspaces.filter(w => w.id !== id),
    activeId: s.activeId === id ? null : s.activeId,
  })),
  setActive: (id) => set((s) => ({
    activeId: id,
    drawerOpen: id ? true : false,
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
  setPreviewWidth: (w) => set({ previewWidth: Math.max(100, Math.min(900, w)) }),
  setTreeWidth: (w) => set({ treeWidth: Math.max(140, Math.min(500, w)) }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}));
