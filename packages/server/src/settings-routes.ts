// ============================================================
// settings-routes.ts — MCP / Models / Skills 管理 API
// ============================================================

import type { FastifyInstance } from "fastify";
import { getModels, getProviders, getModel } from "@earendil-works/pi-ai/compat";
import { config } from "./config.js";
import { mcpManager } from "./mcp-manager.js";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { todoStore } from "./tools/index.js";

export function setupSettingsRoutes(app: FastifyInstance) {
  // ── 模型列表 ──
  app.get("/api/models", async () => {
    const providers = getProviders();
    const result = providers.map((p: string) => {
      const models = getModels(p).map((m: any) => ({
        id: m.id,
        name: m.name,
        reasoning: m.reasoning,
        contextWindow: m.contextWindow,
        input: m.input,
      }));
      return { provider: p, models };
    });
    return {
      current: { provider: config.defaultProvider, model: config.defaultModel },
      providers: result,
    };
  });

  // ── 设置默认模型（改 config + 写入持久化文件） ──
  app.post("/api/models/default", async (req: any, _reply) => {
    const { provider, model } = req.body || {};
    if (!provider || !model) {
      return { ok: false, error: "provider and model required" };
    }
    // 校验模型存在
    const m = getModel(provider, model);
    if (!m) {
      return { ok: false, error: `Model not found: ${provider}/${model}` };
    }
    // 更新运行时 config
    config.defaultProvider = provider;
    config.defaultModel = model;
    // 持久化到 ~/.pi/agent/settings.json
    try {
      const { resolve } = await import("path");
      const { readFileSync, writeFileSync, existsSync } = await import("fs");
      const settingsPath = resolve(process.env.HOME || "~", ".pi/agent/settings.json");
      let settings: any = {};
      if (existsSync(settingsPath)) {
        try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch {}
      }
      settings.defaultProvider = provider;
      settings.defaultModel = model;
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    } catch (e: any) {
      console.error("[settings] persist model error:", e.message);
    }
    return { ok: true, current: { provider, model, name: m.name } };
  });

  // ── Skills 列表（从 resource loader 加载） ──
  app.get("/api/skills", async () => {
    try {
      const cwd = config.workDir;
      const agentDir = process.env.HOME + "/.pi/agent";
      const loader = new DefaultResourceLoader({ cwd, agentDir });
      await loader.reload();
      const result = loader.getSkills();
      return {
        skills: result.skills.map((s: any) => ({
          name: s.name,
          description: s.description,
          filePath: s.filePath,
          baseDir: s.baseDir,
          disableModelInvocation: s.disableModelInvocation,
        })),
        diagnostics: result.diagnostics?.map((d: any) => ({ level: d.level, message: d.message, path: d.path })) || [],
      };
    } catch (e: any) {
      return { skills: [], error: e.message };
    }
  });

  // ── 上传 Skill（接收 base64 内容 + 名称，保存到 ~/.pi/agent/skills/<name>/SKILL.md） ──
  app.post("/api/skills/upload", async (req: any, _reply) => {
    const { name, content } = req.body || {};
    if (!name || typeof name !== "string") {
      return { ok: false, error: "name required" };
    }
    if (!content || typeof content !== "string") {
      return { ok: false, error: "content required" };
    }
    // 安全：名称只允许字母数字、连字符、下划线
    const safeName = name.trim().replace(/[^a-zA-Z0-9_\-]/g, "-");
    if (!safeName) return { ok: false, error: "invalid skill name" };

    try {
      const { resolve, join } = await import("path");
      const { mkdirSync, writeFileSync, existsSync } = await import("fs");
      const skillsDir = resolve(process.env.HOME || "~", ".pi/agent/skills", safeName);
      if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });
      const skillPath = join(skillsDir, "SKILL.md");
      writeFileSync(skillPath, content, "utf-8");
      console.log(`[skills] uploaded: ${safeName} → ${skillPath}`);
      return { ok: true, skill: { name: safeName, filePath: skillPath } };
    } catch (e: any) {
      console.error("[skills] upload error:", e.message);
      return { ok: false, error: e.message };
    }
  });

  // ── 删除 Skill ──
  app.delete("/api/skills/:name", async (req: any, _reply) => {
    const { name } = req.params;
    const safeName = (name || "").replace(/[^a-zA-Z0-9_\-]/g, "-");
    if (!safeName) return { ok: false, error: "invalid name" };

    try {
      const { resolve } = await import("path");
      const { rmSync, existsSync } = await import("fs");
      const skillDir = resolve(process.env.HOME || "~", ".pi/agent/skills", safeName);
      if (!existsSync(skillDir)) return { ok: false, error: "skill not found" };
      rmSync(skillDir, { recursive: true, force: true });
      console.log(`[skills] deleted: ${safeName}`);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── MCP: server 列表 + 状态 ──
  app.get("/api/mcp/servers", async () => {
    return { servers: mcpManager.getStatus() };
  });

  // ── MCP: 所有可用 tools ──
  app.get("/api/mcp/tools", async () => {
    return { tools: mcpManager.listTools() };
  });

  // ── MCP: 按 server 名获取 tools ──
  app.get("/api/mcp/tools/:serverName", async (req: any) => {
    const { serverName } = req.params;
    const allTools = mcpManager.listTools();
    const tools = allTools.filter(t => t.server === serverName);
    return { server: serverName, tools };
  });

  // ── MCP: 重载配置并重连 ──
  app.post("/api/mcp/reload", async () => {
    const result = await mcpManager.reload();
    return result;
  });

  // ── MCP: 获取配置文件内容 ──
  app.get("/api/mcp/config", async () => {
    return mcpManager.readConfig();
  });

  // ── MCP: 更新配置文件（整体替换） ──
  app.post("/api/mcp/config", async (req: any, _reply) => {
    const cfg = req.body;
    if (!cfg || typeof cfg !== "object" || !cfg.mcpServers) {
      return { ok: false, error: "body must be { mcpServers: {...} }" };
    }
    mcpManager.writeConfig(cfg);
    return { ok: true };
  });

  // ── TODO: 获取会话的 todo 列表 ──
  app.get("/api/todos/:chatSessionId", async (req: any) => {
    const { chatSessionId } = req.params;
    const todos = await todoStore.list(chatSessionId);
    return { todos };
  });

  // ── TODO: 添加任务 ──
  app.post("/api/todos/:chatSessionId", async (req: any) => {
    const { chatSessionId } = req.params;
    const { content, priority } = req.body || {};
    if (!content) return { ok: false, error: "content required" };
    const item = await todoStore.add(chatSessionId, content, priority || "medium");
    return { ok: true, todo: item };
  });

  // ── TODO: 更新任务 ──
  app.patch("/api/todos/:chatSessionId/:id", async (req: any) => {
    const { chatSessionId, id } = req.params;
    const updated = await todoStore.update(chatSessionId, id, req.body || {});
    if (!updated) return { ok: false, error: "todo not found" };
    return { ok: true, todo: updated };
  });

  // ── TODO: 删除任务 ──
  app.delete("/api/todos/:chatSessionId/:id", async (req: any) => {
    const { chatSessionId, id } = req.params;
    const ok = await todoStore.remove(chatSessionId, id);
    return { ok };
  });

  // ── TODO: 清空 ──
  app.delete("/api/todos/:chatSessionId", async (req: any) => {
    const { chatSessionId } = req.params;
    await todoStore.clear(chatSessionId);
    return { ok: true };
  });
}
