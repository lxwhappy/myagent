// ============================================================
// quick-prompts.ts — 快捷指令持久化（用户可增删改）
//
// 存储：~/.myagent/quick-prompts.json
// 首次启动写入内置默认指令，之后文件为唯一真相源，全部可改可删。
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { PATHS, AGENT_DIR } from "./paths.js";

export interface QuickPrompt {
  id: string;
  icon: string;   // emoji
  label: string;  // 显示名称
  text: string;   // 插入到输入框的提示文本
  order: number;  // 排序
}

const FILE = PATHS.quickPrompts;

// 内置默认指令（首次启动写入，之后用户可随意改删）
const DEFAULTS: QuickPrompt[] = [
  { id: "builtin-analyze",  icon: "📁", label: "分析项目", text: "帮我分析一下当前项目的结构和技术栈，总结主要模块和它们的职责", order: 0 },
  { id: "builtin-debug",    icon: "🐛", label: "调试代码", text: "帮我看看这个报错是什么原因，给出修复方案：", order: 1 },
  { id: "builtin-search",   icon: "🔍", label: "联网搜索", text: "帮我搜索一下 ", order: 2 },
  { id: "builtin-review",   icon: "📝", label: "代码审查", text: "帮我审查这段代码，指出潜在问题和优化建议：", order: 3 },
  { id: "builtin-test",     icon: "🧪", label: "写测试",   text: "帮我为这个函数写单元测试：", order: 4 },
  { id: "builtin-explain",  icon: "📖", label: "解释概念", text: "帮我解释一下 ", order: 5 },
  { id: "builtin-refactor", icon: "🔄", label: "重构",     text: "帮我重构这段代码，提高可读性和可维护性：", order: 6 },
  { id: "builtin-perf",     icon: "🚀", label: "性能优化", text: "帮我分析这段代码的性能瓶颈，并给出优化方案：", order: 7 },
];

let loaded = false;
let prompts: QuickPrompt[] = [];

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  await mkdir(AGENT_DIR, { recursive: true });
  if (existsSync(FILE)) {
    try {
      prompts = JSON.parse(await readFile(FILE, "utf-8"));
    } catch {
      prompts = [];
    }
  }
  // 首次启动：写入默认指令
  if (prompts.length === 0) {
    prompts = DEFAULTS.map(p => ({ ...p }));
    await persist();
  }
}

async function persist() {
  await writeFile(FILE, JSON.stringify(prompts, null, 2), "utf-8");
}

export const quickPromptStore = {
  async list(): Promise<QuickPrompt[]> {
    await ensureLoaded();
    return prompts.map(({ ...p }) => p).sort((a, b) => a.order - b.order);
  },

  async create(input: { icon: string; label: string; text: string }): Promise<QuickPrompt> {
    await ensureLoaded();
    const order = prompts.length > 0 ? Math.max(...prompts.map(p => p.order)) + 1 : 0;
    const prompt: QuickPrompt = {
      id: randomUUID(),
      icon: input.icon || "⚡",
      label: (input.label || "新指令").slice(0, 20),
      text: input.text || "",
      order,
    };
    prompts.push(prompt);
    await persist();
    return prompt;
  },

  async update(id: string, patch: Partial<Pick<QuickPrompt, "icon" | "label" | "text">>): Promise<QuickPrompt | undefined> {
    await ensureLoaded();
    const p = prompts.find(x => x.id === id);
    if (!p) return undefined;
    if (patch.icon !== undefined) p.icon = patch.icon;
    if (patch.label !== undefined) p.label = patch.label.slice(0, 20);
    if (patch.text !== undefined) p.text = patch.text;
    await persist();
    return p;
  },

  async remove(id: string): Promise<boolean> {
    await ensureLoaded();
    const idx = prompts.findIndex(x => x.id === id);
    if (idx < 0) return false;
    prompts.splice(idx, 1);
    await persist();
    return true;
  },
};
