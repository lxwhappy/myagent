// stores/agents.ts — Agent 配置（角色预设）状态管理
//
// 列表从后端 /api/agents 拉取；当前选中的 agentId 持久化到 localStorage。
// 新建会话 / 切换会话时用 activeAgentId 决定使用哪个 Agent。

import { create } from "zustand";

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  icon: string;
  model?: string;
  disabledTools?: string[];
  enabledMcpServers?: string[];
  isBuiltIn?: boolean;
  createdAt: number;
  updatedAt: number;
}

const ACTIVE_KEY = "myagent:activeAgentId";

export const useAgentsStore = create<{
  agents: AgentConfig[];
  activeAgentId: string;
  loaded: boolean;

  load: () => Promise<void>;
  setActive: (id: string) => void;
  getById: (id: string) => AgentConfig | undefined;
  getActive: () => AgentConfig;
  create: (input: { name: string; description?: string; systemPrompt?: string; icon?: string; model?: string }) => Promise<AgentConfig | null>;
  update: (id: string, patch: Partial<Pick<AgentConfig, "name" | "description" | "systemPrompt" | "icon" | "model" | "disabledTools" | "enabledMcpServers">>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}>((set, get) => ({
  agents: [],
  activeAgentId: (() => { try { return localStorage.getItem(ACTIVE_KEY) || "default"; } catch { return "default"; } })(),
  loaded: false,

  load: async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      const agents: AgentConfig[] = data.agents || [];
      // 校验持久化的 activeAgentId 仍存在，否则回退默认
      const active = get().activeAgentId;
      const exists = agents.some(a => a.id === active);
      if (!exists && agents.length > 0) {
        get().setActive(agents[0].id);
      }
      set({ agents, loaded: true });
    } catch (e) {
      console.error("[agents] load failed:", e);
      set({ loaded: true });
    }
  },

  setActive: (id) => {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch {}
    set({ activeAgentId: id });
  },

  getById: (id) => get().agents.find(a => a.id === id),
  getActive: () => {
    const { agents, activeAgentId } = get();
    return agents.find(a => a.id === activeAgentId) || agents[0] || { id: "default", name: "MyAgent", description: "", systemPrompt: "", icon: "🤖", createdAt: 0, updatedAt: 0 };
  },

  create: async (input) => {
    try {
      const res = await fetch("/api/agents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) { console.error("[agents] create failed:", data.error); return null; }
      set(s => ({ agents: [...s.agents, data.agent] }));
      return data.agent as AgentConfig;
    } catch (e) {
      console.error("[agents] create failed:", e);
      return null;
    }
  },

  update: async (id, patch) => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) { console.error("[agents] update failed:", data.error); return false; }
      set(s => ({ agents: s.agents.map(a => a.id === id ? data.agent : a) }));
      return true;
    } catch (e) {
      console.error("[agents] update failed:", e);
      return false;
    }
  },

  remove: async (id) => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); console.error("[agents] remove failed:", d.error); return false; }
      set(s => {
        const agents = s.agents.filter(a => a.id !== id);
        // 删的是当前选中项 → 回退默认
        const needFallback = s.activeAgentId === id;
        if (needFallback) {
          const fallback = agents[0]?.id || "default";
          try { localStorage.setItem(ACTIVE_KEY, fallback); } catch {}
          return { agents, activeAgentId: fallback };
        }
        return { agents };
      });
      return true;
    } catch (e) {
      console.error("[agents] remove failed:", e);
      return false;
    }
  },
}));
