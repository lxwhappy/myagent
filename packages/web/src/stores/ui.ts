// stores/ui.ts — 轻量 UI 状态（跨组件通信，不持久化）
//
// 用于 TaskSummaryCard 点击文件 → 跳转左侧变更面板

import { create } from "zustand";

interface UIState {
  /** 侧栏切换到文件 tab（App 层订阅，触发 setSidebarTab("files")） */
  gotoFilesTab: number;          // 自增计数器，变化即触发跳转
  /** 变更子 tab 里高亮哪个文件路径 */
  highlightFilePath: string | null;
  /** 打开文件预览的请求（App 层订阅执行 openFile） */
  openFileRequest: { path: string; ts: number } | null;

  /** 请求跳到侧栏文件 tab + 变更面板，可选打开文件预览 */
  gotoChangesPanel: (filePath?: string, openPreview?: boolean) => void;
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
}));
