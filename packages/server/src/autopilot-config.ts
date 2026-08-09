// autopilot-config.ts — Autopilot 阶段提示词模板持久化
//
// 默认提示词外置为 JSON 文件（~/.myagent/autopilot-config.json），
// 用户可在前端设置页查看和修改。
//
// 模板变量（运行时插值）：
//   {{task}}         — 用户原始任务
//   {{analysis}}     — 分析阶段产出（plan/execute 阶段可用）
//   {{plan}}          — 规划阶段产出（execute 阶段可用）
//   {{result}}        — 执行阶段产出（verify/repair 阶段可用）
//   {{issues}}        — 验证发现的问题列表（repair 阶段可用）
//   {{blackboard}}    — 前序所有阶段的产出摘要

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { PATHS, AGENT_DIR } from "./paths.js";

export interface AutopilotPhaseConfig {
  /** 阶段标识 */
  phase: "analyze" | "plan" | "execute" | "verify" | "repair";
  /** 阶段显示名称 */
  label: string;
  /** 阶段图标 */
  icon: string;
  /** 阶段描述（给用户看） */
  description: string;
  /** 提示词模板（含 {{变量}} 占位符） */
  promptTemplate: string;
}

export interface AutopilotConfig {
  /** 最大修复循环次数 */
  maxRepairLoops: number;
  /** 单阶段超时（毫秒） */
  phaseTimeoutMs: number;
  /** 各阶段提示词 */
  phases: AutopilotPhaseConfig[];
}

/** 默认配置（首次启动时写入文件） */
const DEFAULT_CONFIG: AutopilotConfig = {
  maxRepairLoops: 3,
  phaseTimeoutMs: 300_000,
  phases: [
    {
      phase: "analyze",
      label: "分析",
      icon: "🔍",
      description: "理解任务、识别技术约束和风险",
      promptTemplate: `[Autopilot · 分析阶段] 你是一个技术分析师。
分析以下任务，输出：
1. 任务理解：这个任务要做什么
2. 技术约束：涉及哪些技术栈、有哪些限制
3. 风险点：可能的坑和注意事项

任务：{{task}}{{blackboard}}

输出简洁，不要写代码。`,
    },
    {
      phase: "plan",
      label: "规划",
      icon: "📋",
      description: "拆分任务为可执行的步骤",
      promptTemplate: `[Autopilot · 规划阶段] 你是一个技术架构师。
基于分析结果，制定执行计划：
1. 拆分为 2-5 个具体的执行步骤
2. 每个步骤说明做什么、预期产出
3. 标注步骤间的依赖关系

{{analysis}}

任务：{{task}}{{blackboard}}

输出步骤化计划，不要写代码。`,
    },
    {
      phase: "execute",
      label: "执行",
      icon: "⚙️",
      description: "按计划写代码、做修改",
      promptTemplate: `[Autopilot · 执行阶段] 你是一个资深工程师。
按照计划执行任务，直接写代码/做修改。

{{plan}}

{{issues}}

任务：{{task}}{{blackboard}}

直接执行，给出完整的代码和修改。`,
    },
    {
      phase: "verify",
      label: "验证",
      icon: "✅",
      description: "审查执行结果，判定 PASS/FAIL",
      promptTemplate: `[Autopilot · 验证阶段] 你是一个严格的 QA 工程师。
审查执行结果，判断是否达标。

审查标准：
1. 功能完整性：是否完成了所有要求
2. 正确性：逻辑是否正确
3. 代码质量：是否有明显问题

执行结果：
{{result}}

任务：{{task}}

输出格式：
- 判定：PASS 或 FAIL
- 如果 FAIL，列出具体问题（每条一行，以 "问题:" 开头）
- 如果 PASS，简要说明通过的理由`,
    },
    {
      phase: "repair",
      label: "修复",
      icon: "🔧",
      description: "针对验证问题逐条修复",
      promptTemplate: `[Autopilot · 修复阶段] 你是一个资深工程师。
针对验证发现的问题逐条修复。

问题列表：
{{issues}}

当前结果：
{{result}}

任务：{{task}}{{blackboard}}

逐条修复，给出完整的修复代码。`,
    },
  ],
};

let loaded: AutopilotConfig | null = null;

async function ensureLoaded(): Promise<AutopilotConfig> {
  if (loaded) return loaded;

  if (existsSync(PATHS.autopilotConfig)) {
    try {
      const raw = await readFile(PATHS.autopilotConfig, "utf-8");
      const parsed: AutopilotConfig = JSON.parse(raw);
      // 兼容性：确保所有阶段都存在
      for (const def of DEFAULT_CONFIG.phases) {
        if (!parsed.phases.find(p => p.phase === def.phase)) {
          parsed.phases.push(def);
        }
      }
      loaded = parsed;
      return loaded;
    } catch {
      // 文件损坏，用默认值
    }
  }

  // 首次：写默认配置
  loaded = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AutopilotConfig;
  await mkdir(AGENT_DIR, { recursive: true }).catch(() => {});
  await writeFile(PATHS.autopilotConfig, JSON.stringify(loaded, null, 2), "utf-8");
  return loaded!;
}

export const autopilotConfigStore = {
  async get(): Promise<AutopilotConfig> {
    return ensureLoaded();
  },

  async update(patch: Partial<AutopilotConfig>): Promise<AutopilotConfig> {
    const cfg = await ensureLoaded();
    if (patch.maxRepairLoops != null) cfg.maxRepairLoops = patch.maxRepairLoops;
    if (patch.phaseTimeoutMs != null) cfg.phaseTimeoutMs = patch.phaseTimeoutMs;
    if (patch.phases) cfg.phases = patch.phases;
    await writeFile(PATHS.autopilotConfig, JSON.stringify(cfg, null, 2), "utf-8");
    return cfg;
  },
};
