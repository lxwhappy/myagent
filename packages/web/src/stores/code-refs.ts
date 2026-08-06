// stores/code-refs.ts — 代码引用片段 + 整文件引用（跨组件传递）
//
// 用途：
// 1. 右侧文件预览面板选中若干行代码 → 代码片段引用（snippet）
// 2. 左侧文件目录树点击"+"按钮 → 整文件引用（fullFile）
// 输入框（InputBar）订阅它，显示为 chip，发送时拼进消息文本。

import { create } from "zustand";

export interface CodeRef {
  id: string;
  filePath: string;      // 工作空间相对路径
  fileName: string;      // 文件名，用于 chip 显示
  language: string;      // 代码语言，用于围栏渲染
  startLine: number;     // 起始行号（1-based）
  endLine: number;       // 结束行号（1-based，含）
  content: string;       // 代码原文
  fullFile?: boolean;    // 整文件引用标记（chip 显示"全文"而非行号）
}

interface CodeRefState {
  refs: CodeRef[];
  /** 添加一个引用片段（不去重，由调用方判断） */
  add: (ref: Omit<CodeRef, "id">) => void;
  /** 按 id 删除 */
  remove: (id: string) => void;
  /** 清空全部（发送后调用） */
  clear: () => void;
}

export const useCodeRefStore = create<CodeRefState>((set) => ({
  refs: [],
  add: (ref) =>
    set((s) => ({
      refs: [...s.refs, { ...ref, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }],
    })),
  remove: (id) => set((s) => ({ refs: s.refs.filter((r) => r.id !== id) })),
  clear: () => set({ refs: [] }),
}));

/** 把引用列表格式化为拼接到用户消息末尾的文本（markdown 围栏） */
export function formatCodeRefs(refs: CodeRef[]): string {
  if (!refs.length) return "";
  return refs
    .map((r) => {
      if (r.fullFile) {
        // 整文件引用：标注"全文"
        return `\n\n> 📎 文件 \`${r.filePath}\`（全文${r.startLine > 1 ? `，从 L${r.startLine}` : ""}）\n\n\`\`\`${r.language}\n${r.content}\n\`\`\``;
      }
      const range = r.startLine === r.endLine ? `L${r.startLine}` : `L${r.startLine}-${r.endLine}`;
      return `\n\n> 📎 引用自 \`${r.filePath}:${range}\`\n\n\`\`\`${r.language}\n${r.content}\n\`\`\``;
    })
    .join("");
}
