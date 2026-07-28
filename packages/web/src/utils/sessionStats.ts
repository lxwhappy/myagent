// utils/sessionStats.ts — 从消息列表中聚合会话工具统计

import type { Message, ToolExecution } from "../stores/chat";

export type ToolCategory = "edit" | "run" | "read" | "search" | "other";

export interface FileChange {
  path: string;
  name: string;
  edits: number;
  lastStatus: "done" | "error" | "running";
  source?: "main" | "subagent";   // 文件变更来源：主会话 or 子 agent
}

export interface ErrorDetail {
  tool: string;
  message: string;
}

export interface SessionStats {
  totalActions: number;
  edits: number;
  commands: number;
  reads: number;
  searches: number;
  others: number;
  errors: number;
  errorDetails: ErrorDetail[];
  filesChanged: FileChange[];
}

const EDIT_PATTERNS = /write|edit|patch|create|insert|str_replace|apply_diff|multi_edit|replace/i;
const RUN_PATTERNS = /bash|exec|terminal|shell|run|command|subprocess/i;
const READ_PATTERNS = /read|get|cat|view|show|inspect/i;
const SEARCH_PATTERNS = /search|grep|find|glob|list_dir|list_files/i;

export function categorizeTool(toolName: string): ToolCategory {
  const n = toolName.toLowerCase();
  if (EDIT_PATTERNS.test(n)) return "edit";
  if (RUN_PATTERNS.test(n)) return "run";
  if (SEARCH_PATTERNS.test(n)) return "search";
  if (READ_PATTERNS.test(n)) return "read";
  return "other";
}

/** 从工具 input 中提取文件路径 */
export function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const keys = ["file_path", "path", "filePath", "file", "filename", "fileName"];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** 从 tool input 中提取命令（用于检测命令中的文件路径） */
export function extractCommand(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const keys = ["command", "cmd", "script"];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** 从命令中猜测涉及的文件路径（如 `cat src/foo.ts` → src/foo.ts） */
function guessPathFromCommand(cmd: string): string | null {
  // 匹配看起来像文件路径的参数
  const match = cmd.match(/\b([\w./-]+\.\w{1,10})\b/);
  return match ? match[1] : null;
}

/** 从工具输出中提取错误消息（截取第一行有意义的内容） */
function extractErrorMessage(output: unknown): string {
  if (!output) return "";
  let text: string;
  // SDK 校验错误是 { content: [{ type: "text", text: "..." }] } 结构
  if (typeof output === "object") {
    const o = output as Record<string, unknown>;
    const content = o.content;
    if (Array.isArray(content)) {
      const first = content[0];
      if (first && typeof first === "object" && typeof (first as any).text === "string") {
        text = (first as any).text;
      } else {
        text = JSON.stringify(output);
      }
    } else if (typeof o.text === "string") {
      text = o.text;
    } else if (typeof o.error === "string") {
      text = o.error;
    } else if (typeof o.message === "string") {
      text = o.message;
    } else {
      text = JSON.stringify(output);
    }
  } else {
    text = String(output);
  }
  const firstLine = text.trim().split("\n")[0];
  return firstLine.length > 150 ? firstLine.slice(0, 150) + "…" : firstLine;
}

/** 聚合单条消息的工具统计 */
export function aggregateTools(tools: ToolExecution[]): {
  edits: number;
  commands: number;
  reads: number;
  searches: number;
  others: number;
  errors: number;
  errorDetails: ErrorDetail[];
  filesChanged: Map<string, FileChange>;
} {
  const filesMap = new Map<string, FileChange>();
  let edits = 0, commands = 0, reads = 0, searches = 0, others = 0, errors = 0;
  const errorDetails: ErrorDetail[] = [];

  for (const t of tools) {
    const cat = categorizeTool(t.tool);
    switch (cat) {
      case "edit": edits++; break;
      case "run": commands++; break;
      case "read": reads++; break;
      case "search": searches++; break;
      default: others++; break;
    }
    if (t.status === "error") {
      errors++;
      const msg = extractErrorMessage(t.output) || t.tool;
      errorDetails.push({ tool: t.tool, message: msg });
    }

    // 收集文件变更
    if (cat === "edit") {
      const path = extractFilePath(t.input);
      if (path) addFileChange(filesMap, path, t.status);
    }
    // 命令里也可能操作文件（如 `echo > foo.txt` 或 `cat foo.ts`）
    if (cat === "run") {
      const cmd = extractCommand(t.input);
      if (cmd) {
        const path = guessPathFromCommand(cmd);
        if (path && /\b(write|edit|create|cat|echo|>\s*|tee)\b/.test(cmd)) {
          addFileChange(filesMap, path, t.status);
        }
      }
    }
  }

  return { edits, commands, reads, searches, others, errors, errorDetails, filesChanged: filesMap };
}

function addFileChange(map: Map<string, FileChange>, path: string, status: ToolExecution["status"]) {
  const name = path.split("/").pop() || path;
  const existing = map.get(path);
  if (existing) {
    existing.edits++;
    existing.lastStatus = status;
  } else {
    map.set(path, { path, name, edits: 1, lastStatus: status });
  }
}

/** 聚合整个会话的统计（含子 agent 产出的文件） */
export function getSessionStats(messages: Message[], subagents?: { messages?: Message[] }[]): SessionStats {
  const filesMap = new Map<string, FileChange>();
  let edits = 0, commands = 0, reads = 0, searches = 0, others = 0, errors = 0;
  const errorDetails: ErrorDetail[] = [];

  // 收集所有需要统计的消息：主会话 + 各子 agent
  const allMessageSets: { msgs: Message[]; source: "main" | "subagent" }[] = [
    { msgs: messages, source: "main" },
  ];
  if (subagents) {
    for (const sub of subagents) {
      if (sub.messages?.length) allMessageSets.push({ msgs: sub.messages, source: "subagent" });
    }
  }

  for (const { msgs, source } of allMessageSets) {
    for (const msg of msgs) {
      if (!msg.tools) continue;
      const agg = aggregateTools(msg.tools);
      edits += agg.edits;
      commands += agg.commands;
      reads += agg.reads;
      searches += agg.searches;
      others += agg.others;
      errors += agg.errors;
      errorDetails.push(...agg.errorDetails);
      for (const [path, fc] of agg.filesChanged) {
        const existing = filesMap.get(path);
        if (existing) {
          existing.edits += fc.edits;
          existing.lastStatus = fc.lastStatus;
          // 同一文件被多源修改时，保留来源信息（子 agent 优先，更有区分度）
          if (source === "subagent") existing.source = "subagent";
        } else {
          filesMap.set(path, { ...fc, source });
        }
      }
    }
  }

  return {
    totalActions: edits + commands + reads + searches + others,
    edits,
    commands,
    reads,
    searches,
    others,
    errors,
    errorDetails,
    filesChanged: Array.from(filesMap.values()),
  };
}

/** 获取单条 assistant 消息的统计（用于摘要卡） */
export function getMessageStats(msg: Message): SessionStats | null {
  if (!msg.tools || msg.tools.length === 0) return null;
  const agg = aggregateTools(msg.tools);
  return {
    totalActions: msg.tools.length,
    edits: agg.edits,
    commands: agg.commands,
    reads: agg.reads,
    searches: agg.searches,
    others: agg.others,
    errors: agg.errors,
    errorDetails: agg.errorDetails,
    filesChanged: Array.from(agg.filesChanged.values()),
  };
}
