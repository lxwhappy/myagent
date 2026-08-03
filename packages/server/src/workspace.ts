import type { FastifyInstance } from "fastify";
import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, relative, extname, basename } from "path";
import { randomUUID } from "crypto";
import { chatSessionStore } from "./chat-sessions.js";
import { PATHS, AGENT_DIR } from "./paths.js";

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

const IGNORE = ["node_modules",".git","dist",".DS_Store",".next",".cache","__pycache__",".pnpm",".turbo","coverage"];
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
      if (depth > 5 || results.length > 100) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (IGNORE.includes(e.name)) continue;
          const full = join(dir, e.name);
          if (e.name.toLowerCase().includes(term)) {
            const rel = relative(ws.path, full);
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
    const body = req.body as { title?: string };
    if (body?.title) {
      await chatSessionStore.updateTitle(id, body.title);
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

  // ── Agent 原始 jsonl 日志（pi-coding-agent 产出的完整 session 记录）──
  // jsonl 存储在 ~/.pi/agent/sessions/<cwd编码>/ 目录下

  // 列出当前会话工作空间下的所有 jsonl 日志文件
  app.get("/api/sessions/:id/agent-logs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await chatSessionStore.get(id);
    if (!session) return reply.code(404).send({ error: "Session not found" });

    // 找到工作空间路径（从 workspaceId 查）
    const ws = workspaces.get(session.workspaceId);
    if (!ws) return { logs: [] };

    // 编码 cwd → 目录名
    const encoded = ws.path.replace(/\//g, "-").replace(/^-+|-+$/g, "");
    const dir = join(PATHS.agentLogsDir, `--${encoded}--`);
    if (!existsSync(dir)) return { logs: [] };

    try {
      const files = await readdir(dir);
      const logs = [];
      for (const f of files.filter(f => f.endsWith(".jsonl"))) {
        const s = await stat(join(dir, f));
        logs.push({ name: f, size: s.size, mtime: s.mtime.toISOString() });
      }
      // 按修改时间倒序
      logs.sort((a, b) => b.mtime.localeCompare(a.mtime));
      return { logs, dir };
    } catch {
      return { logs: [] };
    }
  });

  // 下载单个 jsonl 日志文件
  app.get("/api/sessions/:id/agent-logs/:filename", async (req, reply) => {
    const { id, filename } = req.params as { id: string; filename: string };
    // 安全校验：文件名只能是 .jsonl，不含路径分隔符
    if (!filename.endsWith(".jsonl") || filename.includes("/") || filename.includes("..")) {
      return reply.code(400).send({ error: "Invalid filename" });
    }
    const session = await chatSessionStore.get(id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    const ws = workspaces.get(session.workspaceId);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });

    const encoded = ws.path.replace(/\//g, "-").replace(/^-+|-+$/g, "");
    const filepath = join(PATHS.agentLogsDir, `--${encoded}--`, filename);
    if (!existsSync(filepath)) return reply.code(404).send({ error: "Log file not found" });

    const content = await readFile(filepath, "utf-8");
    reply.header("Content-Type", "application/jsonl;charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return content;
  });
}
