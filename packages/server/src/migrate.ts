// ============================================================
// migrate.ts — 一次性数据迁移：~/.pi/agent/ → ~/.myagent/
//
// 首次启动时检测旧路径的数据，自动搬到新路径。
// 迁移完成后在 ~/.myagent/.migrated 写标记，不重复迁移。
// ============================================================

import { existsSync, renameSync, mkdirSync, copyFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { PATHS, AGENT_DIR, OLD_PATHS, OLD_AGENT_DIR } from "./paths.js";

const MIGRATION_FLAG = join(AGENT_DIR, ".migrated");

/**
 * 执行一次性迁移。幂等——已迁移过就跳过。
 * 同步执行，在 server 路由注册前调用。
 */
export function migrateIfNeeded(): void {
  // 已迁移过
  if (existsSync(MIGRATION_FLAG)) return;

  // 旧目录不存在，无需迁移
  if (!existsSync(OLD_AGENT_DIR)) {
    mkdirSync(AGENT_DIR, { recursive: true });
    writeFileSync(MIGRATION_FLAG, new Date().toISOString());
    return;
  }

  // 检测旧目录下是否有 MyAgent 的数据（任何一个就触发迁移）
  const hasMyAgentData =
    existsSync(OLD_PATHS.agents) ||
    existsSync(OLD_PATHS.workspaces) ||
    existsSync(OLD_PATHS.todos) ||
    existsSync(OLD_PATHS.cronJobs) ||
    existsSync(OLD_PATHS.cronHistory) ||
    existsSync(OLD_PATHS.settings) ||
    existsSync(OLD_PATHS.mcp) ||
    existsSync(OLD_PATHS.chatSessionsDir) ||
    existsSync(OLD_PATHS.skillsDir);

  if (!hasMyAgentData) {
    mkdirSync(AGENT_DIR, { recursive: true });
    writeFileSync(MIGRATION_FLAG, new Date().toISOString());
    return;
  }

  console.log("[migrate] 检测到旧数据，开始迁移 ~/.pi/agent/ → ~/.myagent/");
  mkdirSync(AGENT_DIR, { recursive: true });

  let migrated = 0;
  let skipped = 0;

  // ── 单文件迁移（旧名 → 新名）──
  const fileMap: [string, string][] = [
    [OLD_PATHS.agents, PATHS.agents],
    [OLD_PATHS.workspaces, PATHS.workspaces],
    [OLD_PATHS.todos, PATHS.todos],
    [OLD_PATHS.cronJobs, PATHS.cronJobs],
    [OLD_PATHS.cronHistory, PATHS.cronHistory],
    [OLD_PATHS.settings, PATHS.settings],
    [OLD_PATHS.mcp, PATHS.mcp],
    [OLD_PATHS.oldChatSessions, join(AGENT_DIR, "myagent-chat-sessions.json")], // 旧格式文件原样搬，chat-sessions.ts 会自动转换
  ];

  for (const [oldPath, newPath] of fileMap) {
    if (existsSync(oldPath) && !existsSync(newPath)) {
      try {
        mkdirSync(dirname(newPath), { recursive: true });
        copyFileSync(oldPath, newPath);
        migrated++;
      } catch (e: any) {
        console.error(`[migrate] 文件迁移失败 ${oldPath} → ${newPath}: ${e.message}`);
        skipped++;
      }
    }
  }

  // ── 目录迁移（chat-sessions, skills, sessions日志）──
  const dirMap: [string, string][] = [
    [OLD_PATHS.chatSessionsDir, PATHS.chatSessionsDir],
    [OLD_PATHS.skillsDir, PATHS.skillsDir],
    [OLD_PATHS.agentLogsDir, PATHS.agentLogsDir],
  ];

  for (const [oldDir, newDir] of dirMap) {
    if (existsSync(oldDir) && !existsSync(newDir)) {
      try {
        mkdirSync(dirname(newDir), { recursive: true });
        copyDirSync(oldDir, newDir);
        migrated++;
      } catch (e: any) {
        console.error(`[migrate] 目录迁移失败 ${oldDir} → ${newDir}: ${e.message}`);
        skipped++;
      }
    }
  }

  writeFileSync(MIGRATION_FLAG, new Date().toISOString());
  console.log(`[migrate] 迁移完成：${migrated} 项成功, ${skipped} 项跳过。旧文件保留在 ~/.pi/agent/`);
}

/** 递归复制目录（用 copyFileSync 逐文件，避免 rename 跨设备问题） */
function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
