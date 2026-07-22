// ============================================================
// hooks/useSessions.ts — 会话管理 Hook
// ============================================================

import { useCallback } from "react";
import { useWorkspaceStore, type ChatSession } from "../stores/workspace";

export function useSessions() {
  const store = useWorkspaceStore();

  const loadSessions = useCallback(async (wsId: string) => {
    const res = await fetch(`/api/workspaces/${wsId}/sessions`);
    const data = await res.json();
    store.setSessions(wsId, data.sessions || []);
  }, []);

  const createSession = useCallback(async (wsId: string): Promise<ChatSession> => {
    const res = await fetch(`/api/workspaces/${wsId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    store.addSession(wsId, data);
    store.setActiveSession(data.id);
    return data;
  }, []);

  const updateSessionTitle = useCallback(async (id: string, title: string) => {
    store.updateSession(id, { title });
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }, []);

  const deleteSession = useCallback(async (wsId: string, id: string) => {
    store.removeSession(wsId, id);
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  }, []);

  return {
    sessionsByWs: store.sessionsByWs,
    activeSessionId: store.activeSessionId,
    expandedWs: store.expandedWs,
    loadSessions,
    createSession,
    updateSessionTitle,
    deleteSession,
  };
}
