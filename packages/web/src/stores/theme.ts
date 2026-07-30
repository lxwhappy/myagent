// stores/theme.ts — 深色/浅色主题状态
//
// 三态模式：light | dark | auto（跟随系统 prefers-color-scheme）
// localStorage 持久化用户选择，auto 模式实时响应系统主题变化。

import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "auto";

const STORAGE_KEY = "myagent-theme";

/** 解析实际生效的主题（auto → 系统当前值） */
function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

/** 将主题应用到 <html data-theme="..."> */
function applyTheme(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme);
}

/** 从 localStorage 读取已保存的 mode */
function loadMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (saved === "light" || saved === "dark" || saved === "auto") return saved;
  } catch {}
  return "auto";
}

interface ThemeState {
  mode: ThemeMode;         // 用户选择的模式
  resolved: "light" | "dark"; // 实际生效的主题
  setMode: (mode: ThemeMode) => void;
  /** 在 light ↔ dark 之间切换（auto 模式下基于当前 resolved 状态） */
  toggle: () => void;
}

const initialMode = loadMode();
const initialResolved = resolveTheme(initialMode);
applyTheme(initialResolved);

// 监听系统主题变化（仅在 auto 模式下生效）
if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const { mode } = useThemeStore.getState();
    if (mode === "auto") {
      const resolved = resolveTheme("auto");
      applyTheme(resolved);
      useThemeStore.setState({ resolved });
    }
  });
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  resolved: initialResolved,
  setMode: (mode) => {
    const resolved = resolveTheme(mode);
    applyTheme(resolved);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
    set({ mode, resolved });
  },
  toggle: () => {
    const current = get().resolved;
    get().setMode(current === "dark" ? "light" : "dark");
  },
}));
