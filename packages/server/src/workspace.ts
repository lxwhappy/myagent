
import type { FastifyInstance } from "fastify";
import { readdir, readFile, stat } from "fs/promises";
import { join, resolve, relative, extname, basename } from "path";
import { randomUUID } from "crypto";
import { chatSessionStore } from "./chat-sessions.js";

// ── 工作空间存储（内存） ──
interface Workspace {
  id: string;
  name: string;
  path: string;
}

const workspaces = new Map<string, Workspace>();

const IGNORE = ["node_modules",".git","dist",".DS_Store",".next",".cache","__pycache__",".pnpm",".turbo","coverage"];
const MAX_SIZE = 512 * 1024;

const EXT_LANG: Record<string,string> = {
  ".ts":"typescript",".tsx":"typescript",".js":"javascript",".jsx":"javascript",
  ".json":"json",".css":"css",".html":"html",".md":"markdown",".py":"python",
  ".go":"go",".rs":"rust",".java":"java",".sh":"bash",".yml":"yaml",".yaml":"yaml",
  ".toml":"toml",".sql":"sql",".xml":"xml",".vue":"vue",".svelte":"svelte",
};

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
    console.log(`[workspace] added: ${name} (${absPath})`);
    return ws;
  });

  // ── 删除工作空间 ──
  app.delete("/api/workspaces/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!workspaces.has(id)) return reply.code(404).send({ error: "Not found" });
    workspaces.delete(id);
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

  // 向会话添加消息
  app.post("/api/sessions/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { role: "user" | "assistant"; content: string };
    if (!body.role || !body.content) return reply.code(400).send({ error: "role and content required" });
    const msg = await chatSessionStore.addMessage(id, body.role, body.content);
    return msg;
  });

  // 删除会话
  app.delete("/api/sessions/:id", async (req) => {
    const { id } = req.params as { id: string };
    await chatSessionStore.remove(id);
    return { ok: true };
  });
}
