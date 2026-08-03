// ============================================================
// paths.ts — MyAgent 集中路径管理
//
// 所有持久化路径的唯一来源。改这里就改全局。
//
// 目录结构（~/.myagent/）：
//   ~/.myagent/
//   ├── settings.json       ← 模型/Provider 设置（SDK SettingsManager 读这个）
//   ├── mcp.json            ← MCP server 配置
//   ├── skills/             ← Skills（SDK DefaultResourceLoader 读这个）
//   ├── sessions/           ← Pi SDK 原生 jsonl 日志（SDK 写这个）
//   ├── chat-sessions/      ← MyAgent 聊天会话（每会话独立文件 + index.json）
//   ├── agents.json         ← Agent 预设（角色管理）
//   ├── workspaces.json     ← 工作空间列表
//   ├── todos.json          ← Todo 列表存储
//   ├── cron-jobs.json      ← 定时任务
//   └── cron-history.json   ← 定时任务执行历史
//
// agentDir 是传给 Pi SDK 的根目录，SDK 会从这里找 skills/sessions/settings。
// ============================================================

import { join } from "path";

const HOME = process.env.HOME || process.env.USERPROFILE || "/";

/** MyAgent 数据根目录（也是 Pi SDK 的 agentDir） */
export const AGENT_DIR = join(HOME, ".myagent");

// ── 配置文件 ──
export const PATHS = {
  /** SDK SettingsManager 读写的设置文件 */
  settings: join(AGENT_DIR, "settings.json"),
  /** MCP server 配置 */
  mcp: join(AGENT_DIR, "mcp.json"),
  /** Agent 预设（角色管理） */
  agents: join(AGENT_DIR, "agents.json"),
  /** 工作空间列表 */
  workspaces: join(AGENT_DIR, "workspaces.json"),
  /** Todo 列表（按 chatSessionId 隔离） */
  todos: join(AGENT_DIR, "todos.json"),

  // ── 定时任务 ──
  cronJobs: join(AGENT_DIR, "cron-jobs.json"),
  cronHistory: join(AGENT_DIR, "cron-history.json"),

  // ── 目录 ──
  /** MyAgent 聊天会话目录（每会话独立文件） */
  chatSessionsDir: join(AGENT_DIR, "chat-sessions"),
  /** 聊天会话索引文件 */
  chatSessionsIndex: join(AGENT_DIR, "chat-sessions", "index.json"),
  /** Skills 目录（SDK 从这里加载） */
  skillsDir: join(AGENT_DIR, "skills"),
  /** Pi SDK 原生 session 日志目录 */
  agentLogsDir: join(AGENT_DIR, "sessions"),
} as const;

// ── 旧路径（~/.pi/agent/，用于自动迁移） ──
export const OLD_AGENT_DIR = join(HOME, ".pi", "agent");

export const OLD_PATHS = {
  agents: join(OLD_AGENT_DIR, "myagent-agents.json"),
  workspaces: join(OLD_AGENT_DIR, "myagent-workspaces.json"),
  todos: join(OLD_AGENT_DIR, "myagent-todos.json"),
  cronJobs: join(OLD_AGENT_DIR, "myagent-cron.json"),
  cronHistory: join(OLD_AGENT_DIR, "myagent-cron-history.json"),
  settings: join(OLD_AGENT_DIR, "settings.json"),
  mcp: join(OLD_AGENT_DIR, "mcp.json"),
  chatSessionsDir: join(OLD_AGENT_DIR, "myagent-sessions"),
  oldChatSessions: join(OLD_AGENT_DIR, "myagent-chat-sessions.json"),
  skillsDir: join(OLD_AGENT_DIR, "skills"),
  agentLogsDir: join(OLD_AGENT_DIR, "sessions"),
} as const;
