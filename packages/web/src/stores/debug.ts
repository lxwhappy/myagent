// stores/debug.ts — Debug 模式开关
//
// localStorage 持久化，设置面板里切换。
// 开启后对话区显示详细的内部过程时间线（每步耗时、token 明细、原始事件）。

import { create } from "zustand";

const STORAGE_KEY = "myagent-debug";

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

interface DebugState {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
}

export const useDebugStore = create<DebugState>((set, get) => ({
  enabled: loadEnabled(),
  toggle: () => {
    const next = !get().enabled;
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
    set({ enabled: next });
  },
  setEnabled: (v) => {
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch {}
    set({ enabled: v });
  },
}));
