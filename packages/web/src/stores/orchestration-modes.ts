// stores/orchestration-modes.ts — 编排模式状态管理
//
// 从后端 /api/orchestration-modes 拉取所有模式（内置 8 种 + 自定义）
// 团队编辑器渲染模式选择卡片时使用。

import { create } from "zustand";

export type GraphTopology = "linear" | "star" | "fanout" | "ring" | "dag";
export type LayoutDirection = "LR" | "TB";

export interface ModeOption {
  key: string;
  label: string;
  type: "number" | "select" | "text";
  default?: string | number;
  options?: string[];
  min?: number;
  max?: number;
}

export interface OrchestrationMode {
  id: string;
  name: string;
  icon: string;
  description: string;
  detail?: string;
  isBuiltIn: boolean;
  minMembers: number;
  maxMembers?: number;
  topology: GraphTopology;
  layout: LayoutDirection;
  promptTemplate: string;
  options?: ModeOption[];
}

export const useOrchestrationModesStore = create<{
  modes: OrchestrationMode[];
  loaded: boolean;

  load: () => Promise<void>;
  getById: (id: string) => OrchestrationMode | undefined;
  create: (input: Partial<OrchestrationMode>) => Promise<OrchestrationMode | null>;
  update: (id: string, patch: Partial<OrchestrationMode>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}>((set, get) => ({
  modes: [],
  loaded: false,

  load: async () => {
    try {
      const res = await fetch("/api/orchestration-modes");
      const data = await res.json();
      set({ modes: data.modes || [], loaded: true });
    } catch (e) {
      console.error("[orchestration-modes] load failed:", e);
      set({ loaded: true });
    }
  },

  getById: (id) => get().modes.find(m => m.id === id),

  create: async (input) => {
    try {
      const res = await fetch("/api/orchestration-modes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) { console.error("[orchestration-modes] create failed:", data.error); return null; }
      set(s => ({ modes: [...s.modes, data.mode] }));
      return data.mode as OrchestrationMode;
    } catch (e) {
      console.error("[orchestration-modes] create failed:", e);
      return null;
    }
  },

  update: async (id, patch) => {
    try {
      const res = await fetch(`/api/orchestration-modes/${encodeURIComponent(id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) { console.error("[orchestration-modes] update failed:", data.error); return false; }
      set(s => ({ modes: s.modes.map(m => m.id === id ? data.mode : m) }));
      return true;
    } catch (e) {
      console.error("[orchestration-modes] update failed:", e);
      return false;
    }
  },

  remove: async (id) => {
    try {
      const res = await fetch(`/api/orchestration-modes/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); console.error("[orchestration-modes] remove failed:", d.error); return false; }
      set(s => ({ modes: s.modes.filter(m => m.id !== id) }));
      return true;
    } catch (e) {
      console.error("[orchestration-modes] remove failed:", e);
      return false;
    }
  },
}));
