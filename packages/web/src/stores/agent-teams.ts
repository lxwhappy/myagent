// stores/agent-teams.ts — Agent 团队状态管理
//
// 列表从后端 /api/agent-teams 拉取。
// 团队是一组已有 Agent 预设的有序编排方案。

import { create } from "zustand";

export interface TeamMember {
  agentId: string;
  role: string;
  instructions?: string;
}

export type TeamMode = "pipeline" | "supervisor" | "evaluator";

export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  icon: string;
  mode: TeamMode;
  members: TeamMember[];
  maxRetries?: number;
  createdAt: number;
  updatedAt: number;
}

export const useAgentTeamsStore = create<{
  teams: AgentTeam[];
  loaded: boolean;

  load: () => Promise<void>;
  getById: (id: string) => AgentTeam | undefined;
  create: (input: { name: string; description?: string; icon?: string; mode?: TeamMode; members?: TeamMember[]; maxRetries?: number }) => Promise<AgentTeam | null>;
  update: (id: string, patch: Partial<Pick<AgentTeam, "name" | "description" | "icon" | "mode" | "members" | "maxRetries">>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}>((set, get) => ({
  teams: [],
  loaded: false,

  load: async () => {
    try {
      const res = await fetch("/api/agent-teams");
      const data = await res.json();
      set({ teams: data.teams || [], loaded: true });
    } catch (e) {
      console.error("[agent-teams] load failed:", e);
      set({ loaded: true });
    }
  },

  getById: (id) => get().teams.find(t => t.id === id),

  create: async (input) => {
    try {
      const res = await fetch("/api/agent-teams", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) { console.error("[agent-teams] create failed:", data.error); return null; }
      set(s => ({ teams: [...s.teams, data.team] }));
      return data.team as AgentTeam;
    } catch (e) {
      console.error("[agent-teams] create failed:", e);
      return null;
    }
  },

  update: async (id, patch) => {
    try {
      const res = await fetch(`/api/agent-teams/${encodeURIComponent(id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) { console.error("[agent-teams] update failed:", data.error); return false; }
      set(s => ({ teams: s.teams.map(t => t.id === id ? data.team : t) }));
      return true;
    } catch (e) {
      console.error("[agent-teams] update failed:", e);
      return false;
    }
  },

  remove: async (id) => {
    try {
      const res = await fetch(`/api/agent-teams/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); console.error("[agent-teams] remove failed:", d.error); return false; }
      set(s => ({ teams: s.teams.filter(t => t.id !== id) }));
      return true;
    } catch (e) {
      console.error("[agent-teams] remove failed:", e);
      return false;
    }
  },
}));
