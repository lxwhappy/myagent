// ============================================================
// chat-sessions.ts — 会话持久化管理
//
// 每个 ChatSession 绑定到一个 Workspace。
// 存储在 ~/.pi/agent/myagent-chat-sessions.json
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  workspaceId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const SESSIONS_FILE = join(
  process.env.HOME || process.env.USERPROFILE || "/",
  ".pi",
  "agent",
  "myagent-chat-sessions.json",
);

let sessions: ChatSession[] = [];
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(SESSIONS_FILE)) {
      const raw = await readFile(SESSIONS_FILE, "utf-8");
      sessions = JSON.parse(raw).sessions || [];
    }
  } catch {
    sessions = [];
  }
}

async function persist() {
  const dir = join(SESSIONS_FILE, "..");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify({ sessions }, null, 2));
}

export const chatSessionStore = {
  async listByWorkspace(workspaceId: string): Promise<ChatSession[]> {
    await ensureLoaded();
    return sessions
      .filter((s) => s.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async get(id: string): Promise<ChatSession | undefined> {
    await ensureLoaded();
    return sessions.find((s) => s.id === id);
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
    sessions.push(session);
    await persist();
    return session;
  },

  async updateTitle(id: string, title: string) {
    await ensureLoaded();
    const s = sessions.find((s) => s.id === id);
    if (s) {
      s.title = title.slice(0, 40);
      await persist();
    }
  },

  async addMessage(id: string, role: "user" | "assistant", content: string): Promise<ChatMessage> {
    await ensureLoaded();
    const s = sessions.find((s) => s.id === id);
    const msg: ChatMessage = {
      id: randomUUID(),
      role,
      content,
      timestamp: Date.now(),
    };
    if (s) {
      s.messages.push(msg);
      s.updatedAt = Date.now();
      await persist();
    }
    return msg;
  },

  async touch(id: string) {
    await ensureLoaded();
    const s = sessions.find((s) => s.id === id);
    if (s) {
      s.updatedAt = Date.now();
      await persist();
    }
  },

  async remove(id: string) {
    await ensureLoaded();
    sessions = sessions.filter((s) => s.id !== id);
    await persist();
  },
};
