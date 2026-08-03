// ============================================================
// chat-sessions.ts — 会话持久化管理（每会话独立文件）
//
// 存储布局（~/.pi/agent/sessions/）：
//   sessions/<id>.json  — 单个会话完整内容（含 messages）
//   sessions/index.json — 轻量元数据索引（id → {title, workspaceId, ...}）
//
// 相比旧的「全堆一个文件」方案：
//   - addMessage 只重写单个会话文件，不再全量重写所有会话
//   - listByWorkspace 只读轻量 index（无 messages），不扫所有文件
//   - 内存缓存：get 命中缓存不读磁盘
//
// 首次加载若检测到旧文件 myagent-chat-sessions.json，自动迁移。
// ============================================================

import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { PATHS, AGENT_DIR, OLD_PATHS } from "./paths.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  // ── 回放扩展字段（向后兼容：旧数据没有这些字段，读取时为 undefined）──
  thinking?: string;           // 思考过程
  tools?: any[];               // 工具调用记录（结构同前端 ToolExecution）
  skillsUsed?: any[];          // 该消息加载的 skills
  subagents?: SubagentSnapshot[];  // 该消息期间产生的子 agent 快照
  isStreaming?: boolean;       // 流式进行中标记（刷新后可恢复"生成中"状态）
}

/** 子 agent 持久化快照（存在对应 assistant 消息上，刷新后可钻入回放） */
export interface SubagentSnapshot {
  subId: string;
  goal: string;
  status: "running" | "done" | "error";
  toolCount: number;
  tokens?: number;
  durationMs?: number;
  summary?: string;
  error?: string;
  messages?: any[];   // 子 agent 完整执行过程
}

export interface ChatSession {
  id: string;
  workspaceId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  // 最近一次 agent_end 的 usage 快照，刷新后可恢复
  lastUsage?: unknown;
}

// index 条目：不含 messages 的轻量元数据，用于列表查询
interface SessionMeta {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

const HOME = process.env.HOME || process.env.USERPROFILE || "/";
// 独立目录，避免和 pi-coding-agent 的 sessions/ 冲突
const SESSIONS_DIR = PATHS.chatSessionsDir;
const INDEX_FILE = PATHS.chatSessionsIndex;
const OLD_FILE = OLD_PATHS.oldChatSessions;

let loaded = false;
// 元数据索引（全量常驻内存，极小：每会话 ~100B）
let index: Record<string, SessionMeta> = {};
// 完整会话缓存（按需加载，命中缓存不读磁盘）
const cache = new Map<string, ChatSession>();

function sessionFile(id: string): string {
  return join(SESSIONS_DIR, `${id}.json`);
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  await mkdir(SESSIONS_DIR, { recursive: true });

  // 读 index
  if (existsSync(INDEX_FILE)) {
    try {
      index = JSON.parse(await readFile(INDEX_FILE, "utf-8"));
    } catch {
      index = {};
    }
  }

  // 首次迁移：旧的单文件数据 → 每会话独立文件
  if (Object.keys(index).length === 0 && existsSync(OLD_FILE)) {
    await migrateOldFormat();
  }
}

// 把旧的 myagent-chat-sessions.json 拆成每会话独立文件 + 建 index
async function migrateOldFormat() {
  try {
    const raw = JSON.parse(await readFile(OLD_FILE, "utf-8"));
    const sessions: ChatSession[] = raw.sessions || [];
    for (const s of sessions) {
      await writeFile(sessionFile(s.id), JSON.stringify(s, null, 2), "utf-8");
      index[s.id] = {
        id: s.id,
        workspaceId: s.workspaceId,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    }
    await persistIndex();
    console.log(`[chat-sessions] migrated ${sessions.length} session(s) to per-file storage`);
  } catch (e: any) {
    console.error("[chat-sessions] migration error:", e.message);
  }
}

async function persistIndex() {
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

// 读取单个会话（优先缓存）
async function loadSession(id: string): Promise<ChatSession | undefined> {
  const cached = cache.get(id);
  if (cached) return cached;
  try {
    const s: ChatSession = JSON.parse(await readFile(sessionFile(id), "utf-8"));
    cache.set(id, s);
    return s;
  } catch {
    return undefined;
  }
}

// 写单个会话文件 + 更新缓存 + 同步 index 元数据
async function writeSession(s: ChatSession, updateIndex = true) {
  cache.set(s.id, s);
  await writeFile(sessionFile(s.id), JSON.stringify(s, null, 2), "utf-8");
  if (updateIndex) {
    index[s.id] = {
      id: s.id,
      workspaceId: s.workspaceId,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
    await persistIndex();
  }
}

export const chatSessionStore = {
  // 列表查询：只读轻量 index，不碰 messages，不读会话文件
  async listByWorkspace(workspaceId: string): Promise<ChatSession[]> {
    await ensureLoaded();
    return Object.values(index)
      .filter((m) => m.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((m) => ({
        id: m.id,
        workspaceId: m.workspaceId,
        title: m.title,
        messages: [], // 列表不返回消息，按需 get(id) 加载
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      }));
  },

  async get(id: string): Promise<ChatSession | undefined> {
    await ensureLoaded();
    return loadSession(id);
  },

  async create(workspaceId: string, title?: string): Promise<ChatSession> {
    await ensureLoaded();
    const now = Date.now();
    const session: ChatSession = {
      id: randomUUID(),
      workspaceId,
      title: title || "新会话",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await writeSession(session);
    console.log(`[chat-sessions] created ${session.id.slice(0, 8)} (ws=${workspaceId})`);
    return session;
  },

  async updateTitle(id: string, title: string) {
    await ensureLoaded();
    const s = await loadSession(id);
    if (!s) return;
    s.title = title.slice(0, 40);
    s.updatedAt = Date.now();
    await writeSession(s);
  },

  // 只重写单个会话文件，不再全量重写所有会话
  // 简单消息：只存 content（向后兼容，user 消息用）
  async addMessage(id: string, role: "user" | "assistant", content: string): Promise<ChatMessage> {
    await ensureLoaded();
    const s = await loadSession(id);
    const msg: ChatMessage = {
      id: randomUUID(),
      role,
      content,
      timestamp: Date.now(),
    };
    if (s) {
      s.messages.push(msg);
      s.updatedAt = Date.now();
      await writeSession(s);
    }
    return msg;
  },

  // 富消息：存 thinking + tools + skillsUsed + subagents（assistant 回合用，支持刷新回放）
  // 按 id 去重：如果 persistStreamingState 已存过同 id 的流式消息，更新而非追加。
  async addRichMessage(id: string, msg: Partial<ChatMessage> & { role: "user" | "assistant"; content: string }): Promise<ChatMessage> {
    await ensureLoaded();
    const s = await loadSession(id);
    const full: ChatMessage = {
      id: msg.id || randomUUID(),
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp ?? Date.now(),
      thinking: msg.thinking || undefined,
      tools: msg.tools,
      skillsUsed: msg.skillsUsed,
      subagents: msg.subagents,
    };
    if (s) {
      const idx = s.messages.findIndex(m => m.id === full.id);
      if (idx >= 0) {
        // 已存在（流式存盘已写入）→ 更新，清除 isStreaming 标记
        s.messages[idx] = { ...full, isStreaming: undefined };
      } else {
        s.messages.push(full);
      }
      s.updatedAt = Date.now();
      await writeSession(s);
    }
    return full;
  },

  // Upsert：按 msg.id 更新或追加。流式过程中 debounce 存盘用（刷新后恢复生成中状态）。
  // 如果消息已存在 → 更新所有字段；不存在 → 追加。
  async upsertMessage(id: string, msg: Partial<ChatMessage> & { id: string; role: "user" | "assistant" }): Promise<ChatMessage> {
    await ensureLoaded();
    const s = await loadSession(id);
    const full: ChatMessage = {
      id: msg.id,
      role: msg.role,
      content: msg.content ?? "",
      timestamp: msg.timestamp ?? Date.now(),
      thinking: msg.thinking || undefined,
      tools: msg.tools,
      skillsUsed: msg.skillsUsed,
      subagents: msg.subagents,
      isStreaming: msg.isStreaming,
    };
    if (s) {
      const idx = s.messages.findIndex(m => m.id === msg.id);
      if (idx >= 0) {
        s.messages[idx] = { ...s.messages[idx], ...full, timestamp: Date.now() };
      } else {
        s.messages.push(full);
      }
      s.updatedAt = Date.now();
      await writeSession(s);
    }
    return full;
  },

  async touch(id: string) {
    await ensureLoaded();
    const s = await loadSession(id);
    if (!s) return;
    s.updatedAt = Date.now();
    await writeSession(s);
  },

  // 存最近一次 usage 快照（agent_end 时调用），刷新后可恢复
  async setUsage(id: string, usage: unknown) {
    await ensureLoaded();
    const s = await loadSession(id);
    if (!s) return;
    s.lastUsage = usage;
    await writeSession(s, false); // 不更新 index（元数据没变）
  },

  async remove(id: string) {
    await ensureLoaded();
    delete index[id];
    cache.delete(id);
    await persistIndex();
    try {
      await rm(sessionFile(id), { force: true });
    } catch {}
  },
};
