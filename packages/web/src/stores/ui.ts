// stores/ui.ts — 轻量 UI 状态（跨组件通信，不持久化）
//
// 用于 TaskSummaryCard 点击文件 → 跳转左侧变更面板
// 以及全局设置页面的打开/关闭 + 分区导航

import { create } from "zustand";

/** 设置页面的分区（左侧导航项） */
export type SettingsSection =
  | "models" | "agents" | "teams" | "appearance"
  | "skills" | "extensions" | "mcp" | "cron"
  | "workspace" | "debug";

interface UIState {
  /** 侧栏切换到文件 tab（App 层订阅，触发 setSidebarTab("files")） */
  gotoFilesTab: number;          // 自增计数器，变化即触发跳转
  /** 变更子 tab 里高亮哪个文件路径 */
  highlightFilePath: string | null;
  /** 打开文件预览的请求（App 层订阅执行 openFile） */
  openFileRequest: { path: string; ts: number } | null;

  /** 请求跳到侧栏文件 tab + 变更面板，可选打开文件预览 */
  gotoChangesPanel: (filePath?: string, openPreview?: boolean) => void;

  /** 设置页面状态：null=关闭，{section}=打开并定位到某个分区 */
  settingsView: { section: SettingsSection } | null;
  /** 打开设置页面，可指定初始分区（默认 models） */
  openSettings: (section?: SettingsSection) => void;
  /** 关闭设置页面 */
  closeSettings: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  gotoFilesTab: 0,
  highlightFilePath: null,
  openFileRequest: null,

  gotoChangesPanel: (filePath, openPreview) => set((s) => ({
    gotoFilesTab: s.gotoFilesTab + 1,
    highlightFilePath: filePath ?? null,
    openFileRequest: openPreview && filePath ? { path: filePath, ts: Date.now() } : s.openFileRequest,
  })),

  settingsView: null,
  openSettings: (section = "models") => set({ settingsView: { section } }),
  closeSettings: () => set({ settingsView: null }),
}));
