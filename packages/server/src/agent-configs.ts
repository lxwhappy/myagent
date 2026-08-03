// ============================================================
// agent-configs.ts — Agent 配置持久化（角色预设管理）
//
// 存储：~/.pi/agent/myagent-agents.json（数组）
// 内置一个不可删除的「默认」Agent，其余用户自定义。
// 每个 Agent 的 systemPrompt 会在创建 agent session 时
// 通过 DefaultResourceLoader.appendSystemPromptOverride 追加到
// AGENTS.md 基础 prompt 之后。
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import { PATHS, AGENT_DIR } from "./paths.js";

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string; // 追加到 AGENTS.md 之后
  icon: string;         // emoji
  model?: string;       // 可选：覆盖默认模型
  disabledTools?: string[]; // 可选：禁用的工具名列表（默认空=全部启用）
  enabledMcpServers?: string[]; // 可选：启用的 MCP server 名列表（默认空=不启用任何 MCP）
  isBuiltIn?: boolean;  // 内置不可删
  createdAt: number;
  updatedAt: number;
}

const HOME = process.env.HOME || process.env.USERPROFILE || "/";
const FILE = PATHS.agents;

// 内置默认 Agent
const DEFAULT_AGENT: AgentConfig = {
  id: "default",
  name: "MyAgent",
  description: "默认通用助手",
  systemPrompt: "",
  icon: "🤖",
  isBuiltIn: true,
  createdAt: 0,
  updatedAt: 0,
};

let loaded = false;
let agents: AgentConfig[] = [];

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  await mkdir(AGENT_DIR, { recursive: true });
  if (existsSync(FILE)) {
    try {
      agents = JSON.parse(await readFile(FILE, "utf-8"));
    } catch {
      agents = [];
    }
  }
  // 确保默认 Agent 始终存在且在第一位
  agents = agents.filter(a => a.id !== "default");
  agents.unshift(DEFAULT_AGENT);
}

async function persist() {
  await writeFile(FILE, JSON.stringify(agents, null, 2), "utf-8");
}

export const agentConfigStore = {
  async list(): Promise<AgentConfig[]> {
    await ensureLoaded();
    return agents.map(({ ...a }) => a);
  },

  async get(id: string): Promise<AgentConfig | undefined> {
    await ensureLoaded();
    return agents.find(a => a.id === id);
  },

  async create(input: {
    name: string;
    description?: string;
    systemPrompt?: string;
    icon?: string;
    model?: string;
  }): Promise<AgentConfig> {
    await ensureLoaded();
    const now = Date.now();
    const agent: AgentConfig = {
      id: randomUUID(),
      name: (input.name || "新 Agent").slice(0, 30),
      description: (input.description || "").slice(0, 100),
      systemPrompt: input.systemPrompt || "",
      icon: input.icon || "🤖",
      model: input.model || undefined,
      createdAt: now,
      updatedAt: now,
    };
    agents.push(agent);
    await persist();
    console.log(`[agent-configs] created ${agent.id.slice(0, 8)} (${agent.name})`);
    return agent;
  },

  async update(id: string, patch: Partial<Pick<AgentConfig, "name" | "description" | "systemPrompt" | "icon" | "model" | "disabledTools" | "enabledMcpServers">>): Promise<AgentConfig | undefined> {
    await ensureLoaded();
    const agent = agents.find(a => a.id === id);
    if (!agent) return undefined;
    if (patch.name !== undefined) agent.name = patch.name.slice(0, 30);
    if (patch.description !== undefined) agent.description = patch.description.slice(0, 100);
    if (patch.systemPrompt !== undefined) agent.systemPrompt = patch.systemPrompt;
    if (patch.icon !== undefined) agent.icon = patch.icon;
    if (patch.model !== undefined) agent.model = patch.model || undefined;
    if (patch.disabledTools !== undefined) agent.disabledTools = patch.disabledTools.length > 0 ? patch.disabledTools : undefined;
    if (patch.enabledMcpServers !== undefined) agent.enabledMcpServers = patch.enabledMcpServers.length > 0 ? patch.enabledMcpServers : undefined;
    agent.updatedAt = Date.now();
    await persist();
    return agent;
  },

  async remove(id: string): Promise<boolean> {
    await ensureLoaded();
    const idx = agents.findIndex(a => a.id === id);
    if (idx < 0) return false;
    if (agents[idx].isBuiltIn) return false; // 内置不可删
    agents.splice(idx, 1);
    await persist();
    return true;
  },
};
