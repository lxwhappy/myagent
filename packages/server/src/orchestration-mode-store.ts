// ============================================================
// orchestration-mode-store.ts — 自定义编排模式持久化
//
// 存储：~/.myagent/orchestration-modes.json（数组）
// 内置模式（8种）在 pi-orchestrator 包里定义，不持久化。
// 这里只存用户自定义的模式。
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { PATHS, AGENT_DIR } from "./paths.js";
import { setCustomModes, getCustomModes } from "@myagent/pi-orchestrator";
import type { OrchestrationMode } from "@myagent/pi-orchestrator";

let loaded = false;
let modes: OrchestrationMode[] = [];

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  await mkdir(AGENT_DIR, { recursive: true });
  if (existsSync(PATHS.orchestrationModes)) {
    try {
      modes = JSON.parse(await readFile(PATHS.orchestrationModes, "utf-8"));
      // 同步到注册表
      setCustomModes(modes);
    } catch {
      modes = [];
    }
  }
}

async function persist() {
  await writeFile(PATHS.orchestrationModes, JSON.stringify(modes, null, 2), "utf-8");
  // 同步到注册表
  setCustomModes(modes);
}

export const orchestrationModeStore = {
  async list(): Promise<OrchestrationMode[]> {
    await ensureLoaded();
    return modes.map(({ ...m }) => m);
  },

  async create(input: Omit<OrchestrationMode, "id" | "isBuiltIn">): Promise<OrchestrationMode> {
    await ensureLoaded();
    const mode: OrchestrationMode = {
      ...input,
      id: randomUUID(),
      isBuiltIn: false,
    };
    modes.push(mode);
    await persist();
    console.log(`[orchestration-modes] created ${mode.id.slice(0, 8)} (${mode.name}, topology=${mode.topology})`);
    return mode;
  },

  async update(id: string, patch: Partial<OrchestrationMode>): Promise<OrchestrationMode | undefined> {
    await ensureLoaded();
    const mode = modes.find(m => m.id === id);
    if (!mode) return undefined;
    Object.assign(mode, patch, { id: mode.id, isBuiltIn: false });
    await persist();
    return mode;
  },

  async remove(id: string): Promise<boolean> {
    await ensureLoaded();
    const idx = modes.findIndex(m => m.id === id);
    if (idx < 0) return false;
    modes.splice(idx, 1);
    await persist();
    return true;
  },
};
