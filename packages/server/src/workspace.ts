import type { FastifyInstance } from "fastify";
import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, relative, extname, basename } from "path";
import { randomUUID } from "crypto";
import { chatSessionStore } from "./chat-sessions.js";
import { PATHS, AGENT_DIR, OLD_AGENT_DIR } from "./paths.js";

// ── 工作空间存储（内存 + 磁盘持久化） ──
interface Workspace {
  id: string;
  name: string;
  path: string;
}

const workspaces = new Map<string, Workspace>();

const HOME = process.env.HOME || process.env.USERPROFILE || "/";
const WS_FILE = PATHS.workspaces;

// 启动时从磁盘恢复（同步阻塞，确保路由注册前数据就绪）
async function persistWorkspaces() {
  try {
    await mkdir(AGENT_DIR, { recursive: true });
    await writeFile(WS_FILE, JSON.stringify([...workspaces.values()], null, 2), "utf-8");
  } catch (e: any) {
    console.error("[workspace] persist failed:", e.message);
  }
}

async function loadWorkspaces() {
  if (!existsSync(WS_FILE)) return;
  try {
    const list: Workspace[] = JSON.parse(await readFile(WS_FILE, "utf-8"));
    for (const ws of list) workspaces.set(ws.id, ws);
    console.log(`[workspace] restored ${workspaces.size} workspace(s) from disk`);
  } catch (e: any) {
    console.error("[workspace] load failed:", e.message);
  }
}
await loadWorkspaces();

const IGNORE = ["node_modules",".git","dist",".DS_Store",".next",".cache","__pycache__",".pnpm",".turbo","coverage","target","build",".gradle",".idea",".vscode","out","bin"];
const MAX_SIZE = 512 * 1024;

const EXT_LANG: Record<string,string> = {
  ".ts":"typescript",".tsx":"typescript",".js":"javascript",".jsx":"javascript",
  ".json":"json",".css":"css",".html":"html",".md":"markdown",".py":"python",
  ".go":"go",".rs":"rust",".java":"java",".sh":"bash",".yml":"yaml",".yaml":"yaml",
  ".toml":"toml",".sql":"sql",".xml":"xml",".vue":"vue",".svelte":"svelte",
  ".svg":"svg",
};

// 预览文件服务的 Content-Type 映射（相对路径资源自动解析需要）
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};
// 预览路由允许的最大单文件（比代码预览宽松，覆盖大 HTML 应用）
const PREVIEW_MAX_SIZE = 5 * 1024 * 1024;

function getWs(id: string): Workspace | undefined {
  return workspaces.get(id);
}

export function setupWorkspaceRoutes(app: FastifyInstance) {

  // ── 列出所有工作空间 ──
  app.get("/api/workspaces", async () => {
    return { workspaces: [...workspaces.values()].map(w => ({ id: w.id, name: w.name, path: w.path })) };
  });

  // ── 在系统文件管理器中打开工作空间目录 ──
  app.post("/api/workspace/:id/open", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });
    if (!existsSync(ws.path)) return reply.code(404).send({ error: "Path not found" });
    try {
      const { execFile } = await import("child_process");
      // macOS: open, Linux: xdg-open, Windows: explorer
      const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
      execFile(cmd, [ws.path], (err) => {
        if (err) console.error(`[workspace] open failed: ${err.message}`);
      });
      return { success: true };
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message ?? "Unknown" });
    }
  });

  // ── 添加工作空间（通过路径） ──
  app.post("/api/workspaces", async (req, reply) => {
    const body = req.body as { path?: string; name?: string };
    if (!body?.path) return reply.code(400).send({ error: "path required" });

    const absPath = resolve(body.path);
    try {
      const s = await stat(absPath);
      if (!s.isDirectory()) return reply.code(400).send({ error: "Not a directory" });
    } catch {
      return reply.code(404).send({ error: "Directory not found" });
    }

    // 去重：如果路径已存在，返回已有的
    for (const ws of workspaces.values()) {
      if (ws.path === absPath) return { ...ws };
    }

    const id = randomUUID();
    const name = body.name || basename(absPath);
    const ws: Workspace = { id, name, path: absPath };
    workspaces.set(id, ws);
    await persistWorkspaces();
    console.log(`[workspace] added: ${name} (${absPath})`);
    return ws;
  });

  // ── 删除工作空间 ──
  app.delete("/api/workspaces/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!workspaces.has(id)) return reply.code(404).send({ error: "Not found" });
    workspaces.delete(id);
    await persistWorkspaces();
    console.log(`[workspace] removed: ${id}`);
    return { ok: true };
  });

  // ── 列出工作空间内目录 ──
  app.get("/api/workspace/:id/list", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const query = req.query as { path?: string };
    const relPath = query.path ?? "";
    const absPath = resolve(ws.path, relPath);

    const rel = relative(ws.path, absPath);
    if (rel.startsWith("..")) return reply.code(403).send({ error: "Path outside workspace" });

    try {
      const entries = await readdir(absPath, { withFileTypes: true });
      const items = entries
        .filter(e => !IGNORE.includes(e.name))
        .filter(e => !e.name.startsWith("."))  // 过滤所有隐藏文件/目录
        .map(e => {
          const fullPath = join(absPath, e.name);
          const relFromRoot = relative(ws.path, fullPath);
          return {
            name: e.name,
            path: relFromRoot,
            type: e.isDirectory() ? "dir" : "file",
            ext: e.isFile() ? extname(e.name) : "",
          };
        });

      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { path: relPath, items };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── 读取文件 ──
  app.get("/api/workspace/:id/file", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const query = req.query as { path: string };
    const absPath = resolve(ws.path, query.path);
    const rel = relative(ws.path, absPath);
    if (rel.startsWith("..")) return reply.code(403).send({ error: "Path outside workspace" });

    try {
      const s = await stat(absPath);
      if (!s.isFile()) return reply.code(400).send({ error: "Not a file" });
      if (s.size > MAX_SIZE) return reply.code(413).send({ error: "File too large" });

      const content = await readFile(absPath, "utf-8");
      return {
        path: query.path,
        content,
        size: s.size,
        language: EXT_LANG[extname(absPath)] ?? "text",
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── 获取文件的 git diff（相对于 HEAD）──
  app.get("/api/workspace/:id/diff", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const query = req.query as { path: string };
    const absPath = resolve(ws.path, query.path);
    const rel = relative(ws.path, absPath);
    if (rel.startsWith("..")) return reply.code(403).send({ error: "Path outside workspace" });

    try {
      const { execFile } = await import("child_process");
      const execGit = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
        execFile("git", args, { cwd: ws.path, maxBuffer: 1024 * 1024 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });

      // 先检查是否在 git 仓库内
      try {
        await execGit(["rev-parse", "--is-inside-work-tree"]);
      } catch {
        return reply.code(404).send({ error: "Not a git repository" });
      }

      // 获取 unified diff
      let diff: string;
      const relGit = rel.replace(/\\/g, "/");
      try {
        // 尝试与 HEAD 比较（已提交的文件）
        diff = await execGit(["diff", "HEAD", "--", relGit]);
      } catch {
        // HEAD 不存在（新仓库）或文件未被跟踪 → 与空树比较
        try {
          diff = await execGit(["diff", "--no-index", "/dev/null", relGit]);
        } catch (err: any) {
          // git diff --no-index 在有差异时退出码为 1，stdout 仍然有 diff 内容
          diff = err.stdout || "";
        }
      }

      // 如果 diff 为空，可能是未暂存的新文件
      if (!diff.trim()) {
        try {
          diff = await execGit(["diff", "--no-index", "/dev/null", absPath]);
        } catch (err: any) {
          diff = err.stdout || "";
        }
      }

      return {
        path: query.path,
        diff: diff || null,
        hasChanges: !!diff.trim(),
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── 预览文件服务（原始文件 + 正确 Content-Type，支持相对路径资源解析）──
  // iframe 用真实 URL 加载 HTML 时，其中的 <link href="assets/x.css"> 等相对路径
  // 会被浏览器解析为 /api/workspace/:id/preview/<dir>/assets/x.css 自动加载。
  app.get("/api/workspace/:id/preview/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).type("text/plain").send("Workspace not found");

    const relPath = ((req.params as any)["*"] || "").replace(/^\//, "");
    if (!relPath) return reply.code(400).type("text/plain").send("path required");

    const absPath = resolve(ws.path, relPath);
    const rel = relative(ws.path, absPath);
    if (rel.startsWith("..")) return reply.code(403).type("text/plain").send("Path outside workspace");

    try {
      const s = await stat(absPath);
      if (!s.isFile()) return reply.code(404).type("text/plain").send("Not a file");
      if (s.size > PREVIEW_MAX_SIZE) return reply.code(413).type("text/plain").send("File too large");

      const buf = await readFile(absPath);
      const ct = CONTENT_TYPES[extname(absPath)] ?? "application/octet-stream";
      reply.type(ct).send(buf);
    } catch {
      return reply.code(404).type("text/plain").send("File not found");
    }
  });

  // ── 搜索文件（递归，按名称模糊匹配） ──
  app.get("/api/workspace/:id/search", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const query = req.query as { q: string };
    const term = query.q?.toLowerCase();
    if (!term) return { results: [] };

    const results: Array<{ name: string; path: string; type: string }> = [];
    const seen = new Set<string>();

    async function walk(dir: string, depth: number) {
      if (depth > 12 || results.length > 100) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (IGNORE.includes(e.name)) continue;
          const full = join(dir, e.name);
          if (e.name.toLowerCase().includes(term)) {
            const rel = relative(ws!.path, full);
            if (!seen.has(rel)) {
              seen.add(rel);
              results.push({ name: e.name, path: rel, type: e.isDirectory() ? "dir" : "file" });
            }
          }
          if (e.isDirectory() && results.length < 100) {
            await walk(full, depth + 1);
          }
        }
      } catch {}
    }

    await walk(ws.path, 0);
    return { results };
  });

  // ────────────────────────────────────────────────────
  // 文件系统浏览（用于目录选择器，可浏览任意路径）
  // ────────────────────────────────────────────────────

  // 获取 home 目录
  app.get("/api/fs/home", async () => {
    const home = process.env.HOME || process.env.USERPROFILE || "/";
    return { home };
  });

  // 浏览任意目录（只返回子目录，用于目录选择器）
  app.get("/api/fs/browse", async (req, reply) => {
    const query = req.query as { path?: string };
    const targetPath = query.path ?? (process.env.HOME || "/");

    try {
      const s = await stat(targetPath);
      if (!s.isDirectory()) {
        return reply.code(400).send({ error: "Not a directory" });
      }

      const entries = await readdir(targetPath, { withFileTypes: true });
      const dirs = entries
        .filter((e) => {
          if (!e.isDirectory()) return false;
          // 过滤隐藏目录和无关目录
          if (e.name.startsWith(".")) return false;
          if (IGNORE.includes(e.name)) return false;
          return true;
        })
        .map((e) => ({
          name: e.name,
          path: join(targetPath, e.name),
          type: "dir" as const,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      // 也包含隐藏目录（单独标记，方便用户需要时浏览）
      const hiddenDirs = entries
        .filter((e) => e.isDirectory() && e.name.startsWith(".") && e.name !== "." && e.name !== "..")
        .map((e) => ({
          name: e.name,
          path: join(targetPath, e.name),
          type: "dir" as const,
          hidden: true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        current: targetPath,
        parent: targetPath === "/" ? null : resolve(targetPath, ".."),
        dirs,
        hiddenDirs,
      };
    } catch (err: any) {
      if (err.code === "EACCES") {
        return reply.code(403).send({ error: "Permission denied" });
      }
      if (err.code === "ENOENT") {
        return reply.code(404).send({ error: "Directory not found" });
      }
      return reply.code(500).send({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────────
  // 会话管理 API
  // ────────────────────────────────────────────────────

  // 列出工作空间下的会话
  app.get("/api/workspaces/:wsId/sessions", async (req) => {
    const { wsId } = req.params as { wsId: string };
    const sessions = await chatSessionStore.listByWorkspace(wsId);
    return { sessions };
  });

  // 创建会话
  app.post("/api/workspaces/:wsId/sessions", async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    if (!workspaces.has(wsId)) return reply.code(404).send({ error: "Workspace not found" });
    const body = req.body as { title?: string };
    const session = await chatSessionStore.create(wsId, body?.title);
    return session;
  });

  // 更新会话标题
  app.patch("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { title?: string; pinned?: boolean };
    if (body?.title) {
      await chatSessionStore.updateTitle(id, body.title);
    } else if (body?.pinned !== undefined) {
      await chatSessionStore.togglePin(id);
    } else {
      await chatSessionStore.touch(id);
    }
    return { ok: true };
  });

  // 获取会话详情（含消息）
  app.get("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await chatSessionStore.get(id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    return session;
  });

  // 向会话添加消息（支持富消息：thinking/tools/skillsUsed/subagents）
  app.post("/api/sessions/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    if (!body.role) return reply.code(400).send({ error: "role required" });
    // 有富字段时用 addRichMessage，否则退回 addMessage（向后兼容）
    if (body.thinking !== undefined || body.tools || body.skillsUsed || body.subagents) {
      const msg = await chatSessionStore.addRichMessage(id, body);
      return msg;
    }
    if (!body.content) return reply.code(400).send({ error: "content required" });
    const msg = await chatSessionStore.addMessage(id, body.role, body.content);
    return msg;
  });

  // Upsert 消息（流式过程中 debounce 存盘用，刷新后恢复生成中状态）
  app.put("/api/sessions/:id/messages/upsert", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    if (!body.id || !body.role) return reply.code(400).send({ error: "id and role required" });
    const msg = await chatSessionStore.upsertMessage(id, body);
    return msg;
  });

  // 删除会话
  app.delete("/api/sessions/:id", async (req) => {
    const { id } = req.params as { id: string };
    await chatSessionStore.remove(id);
    return { ok: true };
  });

  // ── Agent 原始 jsonl 日志 ──
  // SDK 可能把 jsonl 写到 ~/.myagent/sessions/ 或 ~/.pi/agent/sessions/
  // 取决于 SDK 版本和 agentDir 解析。同时搜索两个路径确保兼容。

  /** 根据 ws.path 得到所有可能的 sessions 目录名（SDK 的 cwd 编码规则） */
  function getLogDirs(wsPath: string): string[] {
    const encoded = wsPath.replace(/\//g, "-").replace(/^-+|-+$/g, "");
    const safeName = `--${encoded}--`;
    return [
      join(PATHS.agentLogsDir, safeName),   // ~/.myagent/sessions/
      join(OLD_AGENT_DIR, "sessions", safeName),  // ~/.pi/agent/sessions/
    ];
  }

  app.get("/api/sessions/:id/agent-logs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await chatSessionStore.get(id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    const ws = workspaces.get(session.workspaceId);
    if (!ws) return { logs: [] };

    const dirs = getLogDirs(ws.path);
    const logs: { name: string; size: number; mtime: string }[] = [];
    const seen = new Set<string>();
    let foundDir: string | null = null;
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      foundDir = foundDir ?? dir;
      try {
        const files = await readdir(dir);
        for (const f of files.filter(f => f.endsWith(".jsonl"))) {
          if (seen.has(f)) continue;
          seen.add(f);
          const s = await stat(join(dir, f));
          logs.push({ name: f, size: s.size, mtime: s.mtime.toISOString() });
        }
      } catch {}
    }
    logs.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return { logs, dir: foundDir ?? dirs[0] };
  });

  app.get("/api/sessions/:id/agent-logs/:filename", async (req, reply) => {
    const { id, filename } = req.params as { id: string; filename: string };
    if (!filename.endsWith(".jsonl") || filename.includes("/") || filename.includes("..")) {
      return reply.code(400).send({ error: "Invalid filename" });
    }
    const session = await chatSessionStore.get(id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    const ws = workspaces.get(session.workspaceId);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const dirs = getLogDirs(ws.path);
    let filepath: string | null = null;
    for (const dir of dirs) {
      const p = join(dir, filename);
      if (existsSync(p)) { filepath = p; break; }
    }
    if (!filepath) return reply.code(404).send({ error: "Log file not found" });

    const content = await readFile(filepath, "utf-8");
    reply.header("Content-Type", "application/jsonl;charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return content;
  });

  // 打开日志所在目录（在 Finder 中 reveal）
  app.get("/api/sessions/:id/agent-logs-dir", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await chatSessionStore.get(id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    const ws = workspaces.get(session.workspaceId);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const dirs = getLogDirs(ws.path);
    let dir: string | null = null;
    for (const d of dirs) {
      if (existsSync(d)) { dir = d; break; }
    }
    if (!dir) dir = dirs[0];
    // 创建目录确保存在（首次打开时）
    try { await mkdir(dir, { recursive: true }); } catch {}

    const { exec } = await import("child_process");
    exec(`open "${dir}"`);
    return { success: true, dir };
  });

  // ── Git: 列出分支 ──
  app.get("/api/workspace/:id/git/branches", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });
    if (!existsSync(ws.path)) return reply.code(404).send({ error: "Path not found" });

    try {
      const { execFileSync } = await import("child_process");
      const run = (args: string[]) => execFileSync("git", args, {
        cwd: ws.path, encoding: "utf-8", timeout: 5000,
      }).trim();

      // 当前分支
      let current: string | null = null;
      try {
        current = run(["rev-parse", "--abbrev-ref", "HEAD"]);
      } catch { /* detached HEAD or not a repo */ }

      if (!current) return { isRepo: false, current: null, branches: [] };

      // 本地分支（* 标记当前分支）
      const raw = run(["branch", "--list", "--format=%(refname:short)"]);
      const branches = raw.split("\n").map(b => b.trim()).filter(Boolean);

      return { isRepo: true, current, branches };
    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      // 非 git 仓库 / git 未安装
      if (msg.includes("not a git repository") || msg.includes("ENOENT")) {
        return { isRepo: false, current: null, branches: [] };
      }
      return reply.code(500).send({ error: msg });
    }
  });

  // ── Git: 切换分支 ──
  app.post("/api/workspace/:id/git/checkout", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const body = req.body as { branch?: string };
    if (!body?.branch) return reply.code(400).send({ error: "branch required" });

    try {
      const { execFileSync } = await import("child_process");
      const output = execFileSync("git", ["checkout", body.branch], {
        cwd: ws.path, encoding: "utf-8", timeout: 10000,
      }).trim();
      console.log(`[git] ${ws.name}: checkout ${body.branch} — ${output.slice(0, 80)}`);
      return { success: true, branch: body.branch, message: output };
    } catch (e: any) {
      const stderr = e?.stderr?.trim() ?? e?.message ?? "Unknown error";
      console.error(`[git] ${ws.name}: checkout ${body.branch} failed — ${stderr.slice(0, 120)}`);
      return reply.code(400).send({ error: stderr });
    }
  });

  // ── Git: 列出 worktree ──
  app.get("/api/workspace/:id/git/worktrees", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    try {
      const { execFileSync } = await import("child_process");
      const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
        cwd: ws.path, encoding: "utf-8", timeout: 5000,
      }).trim();

      // 解析 porcelain 格式：worktree <path>\nHEAD <sha>\nbranch <ref>\n\n...
      const worktrees: Array<{ path: string; branch: string | null; head: string }> = [];
      let current: { path: string; branch: string | null; head: string } | null = null;
      for (const line of output.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (current) worktrees.push(current);
          current = { path: line.slice(9), branch: null, head: "" };
        } else if (line.startsWith("HEAD ") && current) {
          current.head = line.slice(5);
        } else if (line.startsWith("branch ") && current) {
          current.branch = line.slice(7).replace("refs/heads/", "");
        } else if (line === "" && current) {
          worktrees.push(current);
          current = null;
        }
      }
      if (current) worktrees.push(current);

      return { worktrees };
    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      if (msg.includes("not a git repository") || msg.includes("ENOENT")) {
        return { worktrees: [] };
      }
      return reply.code(500).send({ error: msg });
    }
  });

  // ── Git: 创建 worktree（新分支检出为独立目录）──
  app.post("/api/workspace/:id/git/worktree", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const body = req.body as { branch?: string; newBranch?: string; path?: string };
    if (!body?.branch && !body?.newBranch) {
      return reply.code(400).send({ error: "branch or newBranch required" });
    }
    if (!body?.path) {
      return reply.code(400).send({ error: "path required" });
    }

    const targetPath = resolve(body.path);
    // 安全校验：路径不能在原仓库目录内（避免嵌套）
    const rel = relative(ws.path, targetPath);
    if (rel && !rel.startsWith("..")) {
      return reply.code(400).send({ error: "Worktree 路径不能在主仓库目录内" });
    }

    try {
      const { execFileSync } = await import("child_process");
      const args = ["worktree", "add"];
      if (body.newBranch) {
        args.push("-b", body.newBranch, targetPath);
        if (body.branch) args.push(body.branch); // 基于 branch 创建新分支
      } else {
        args.push(targetPath, body.branch!); // 检出现有分支
      }
      const output = execFileSync("git", args, {
        cwd: ws.path, encoding: "utf-8", timeout: 30000,
      }).trim();
      console.log(`[git] ${ws.name}: worktree add → ${targetPath} (${body.newBranch || body.branch})`);

      // 自动注册为新工作空间
      const name = `${ws.name}:${body.newBranch || body.branch}`;
      const newWs: Workspace = { id: randomUUID(), name, path: targetPath };
      workspaces.set(newWs.id, newWs);
      await persistWorkspaces();

      return { success: true, workspace: newWs, message: output };
    } catch (e: any) {
      const stderr = e?.stderr?.trim() ?? e?.message ?? "Unknown error";
      console.error(`[git] ${ws.name}: worktree add failed — ${stderr.slice(0, 200)}`);
      return reply.code(400).send({ error: stderr });
    }
  });

  // ── Git: 删除 worktree ──
  app.delete("/api/workspace/:id/git/worktree", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = getWs(id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const body = req.body as { path?: string };
    if (!body?.path) return reply.code(400).send({ error: "path required" });

    try {
      const { execFileSync } = await import("child_process");
      const output = execFileSync("git", ["worktree", "remove", body.path, "--force"], {
        cwd: ws.path, encoding: "utf-8", timeout: 10000,
      }).trim();
      console.log(`[git] ${ws.name}: worktree remove ${body.path}`);

      // 如果被删除的 worktree 注册为了工作空间，一并移除
      for (const [wsId, w] of workspaces) {
        if (w.path === body.path) {
          workspaces.delete(wsId);
          await persistWorkspaces();
          break;
        }
      }

      return { success: true, message: output };
    } catch (e: any) {
      const stderr = e?.stderr?.trim() ?? e?.message ?? "Unknown error";
      console.error(`[git] ${ws.name}: worktree remove failed — ${stderr.slice(0, 200)}`);
      return reply.code(400).send({ error: stderr });
    }
  });
}
