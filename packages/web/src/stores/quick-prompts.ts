// stores/quick-prompts.ts — 快捷指令前端状态管理
//
// 首次加载从后端拉取，CRUD 操作同步到后端。
// InputBar 订阅 prompts 用于浮层展示，QuickPromptManager 用于增删改。

import { create } from "zustand";

export interface QuickPrompt {
  id: string;
  icon: string;
  label: string;
  text: string;
  order: number;
}

export interface QuickPromptState {
  prompts: QuickPrompt[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (icon: string, label: string, text: string) => Promise<void>;
  update: (id: string, patch: { icon?: string; label?: string; text?: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useQuickPromptStore = create<QuickPromptState>((set, get) => ({
  prompts: [],
  loaded: false,

  load: async () => {
    try {
      const res = await fetch("/api/quick-prompts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ prompts: data.prompts || [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  add: async (icon, label, text) => {
    const res = await fetch("/api/quick-prompts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icon, label, text }),
    });
    if (!res.ok) throw new Error(`保存失败 (HTTP ${res.status})`);
    const data = await res.json();
    if (data.prompt) set({ prompts: [...get().prompts, data.prompt] });
  },

  update: async (id, patch) => {
    const res = await fetch(`/api/quick-prompts/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`保存失败 (HTTP ${res.status})`);
    const data = await res.json();
    if (data.prompt) {
      set({ prompts: get().prompts.map(p => p.id === id ? data.prompt : p) });
    }
  },

  remove: async (id) => {
    const res = await fetch(`/api/quick-prompts/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`删除失败 (HTTP ${res.status})`);
    set({ prompts: get().prompts.filter(p => p.id !== id) });
  },
}));
