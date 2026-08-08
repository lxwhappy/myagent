// ============================================================
// agent-teams.ts — Agent 团队持久化（多 Agent 编排）
//
// 存储：~/.myagent/agent-teams.json（数组）
// 一个团队包含多个已有 Agent 预设成员，按顺序编排执行。
// 团队本身不是 Agent，而是一个编排方案：
//   - 用户发送消息后，按 pipeline 顺序依次执行各成员 Agent
//   - 每个成员的输出作为下一个成员的上下文输入
//   - 典型用法：开发Agent写代码 → 测试Agent检查 → 审查Agent总结
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { PATHS, AGENT_DIR } from "./paths.js";

export interface TeamMember {
  agentId: string;       // 引用 AgentConfig.id
  role: string;          // 角色名（如 "开发"、"测试审查"）
  instructions?: string; // 该步骤的额外指令（追加到 agent 的 systemPrompt 之后）
}

/** 团队编排模式 */
export type TeamMode = "pipeline" | "supervisor" | "evaluator";

export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  icon: string;
  mode: TeamMode;          // 编排模式（默认 pipeline）
  members: TeamMember[];   // 有序成员列表
  maxRetries?: number;     // evaluator 模式：最大重试次数（默认 2）
  createdAt: number;
  updatedAt: number;
}

let loaded = false;
let teams: AgentTeam[] = [];

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  await mkdir(AGENT_DIR, { recursive: true });
  if (existsSync(PATHS.agentTeams)) {
    try {
      teams = JSON.parse(await readFile(PATHS.agentTeams, "utf-8"));
    } catch {
      teams = [];
    }
  }
}

async function persist() {
  await writeFile(PATHS.agentTeams, JSON.stringify(teams, null, 2), "utf-8");
}

export const agentTeamStore = {
  async list(): Promise<AgentTeam[]> {
    await ensureLoaded();
    return teams.map(({ ...t }) => t);
  },

  async get(id: string): Promise<AgentTeam | undefined> {
    await ensureLoaded();
    return teams.find(t => t.id === id);
  },

  async create(input: {
    name: string;
    description?: string;
    icon?: string;
    mode?: TeamMode;
    members?: TeamMember[];
    maxRetries?: number;
  }): Promise<AgentTeam> {
    await ensureLoaded();
    const now = Date.now();
    const team: AgentTeam = {
      id: randomUUID(),
      name: (input.name || "新团队").slice(0, 30),
      description: (input.description || "").slice(0, 200),
      icon: input.icon || "👥",
      mode: input.mode || "pipeline",
      members: input.members || [],
      maxRetries: input.maxRetries,
      createdAt: now,
      updatedAt: now,
    };
    teams.push(team);
    await persist();
    console.log(`[agent-teams] created ${team.id.slice(0, 8)} (${team.name}, mode=${team.mode}, ${team.members.length} members)`);
    return team;
  },

  async update(id: string, patch: Partial<Pick<AgentTeam, "name" | "description" | "icon" | "mode" | "members" | "maxRetries">>): Promise<AgentTeam | undefined> {
    await ensureLoaded();
    const team = teams.find(t => t.id === id);
    if (!team) return undefined;
    if (patch.name !== undefined) team.name = patch.name.slice(0, 30);
    if (patch.description !== undefined) team.description = patch.description.slice(0, 200);
    if (patch.icon !== undefined) team.icon = patch.icon;
    if (patch.mode !== undefined) team.mode = patch.mode;
    if (patch.members !== undefined) team.members = patch.members;
    if (patch.maxRetries !== undefined) team.maxRetries = patch.maxRetries;
    team.updatedAt = Date.now();
    await persist();
    return team;
  },

  async remove(id: string): Promise<boolean> {
    await ensureLoaded();
    const idx = teams.findIndex(t => t.id === id);
    if (idx < 0) return false;
    teams.splice(idx, 1);
    await persist();
    return true;
  },
};
