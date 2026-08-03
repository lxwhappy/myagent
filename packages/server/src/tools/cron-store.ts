// cron-store.ts — 定时任务持久化 + Cron 实例管理 + 执行历史
//
// 宿主级调度器：独立于 agent session。
// 任务触发时创建临时 agent session 执行，结果存入历史记录。
// 持久化：~/.pi/agent/myagent-cron.json (任务) + myagent-cron-history.json (历史)

import { Cron } from "croner";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { PATHS, AGENT_DIR } from "../paths.js";

// ── 类型定义 ──

export interface CronJob {
  id: string;
  name: string;
  schedule: string;          // cron 表达式（5段）或相对时间（+10m）
  prompt: string;
  cwd: string;               // 工作目录（创建临时 session 时用）
  workspaceId: string;       // 所属工作空间（触发时创建的会话归属到此项目）
  agentId?: string;          // 可选：绑定的 Agent 预设
  enabled: boolean;
  type: "cron" | "once";
  description?: string;
  lastRun?: number;
  nextRun?: number;
  lastStatus?: "success" | "error" | "running";
  runCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CronExecution {
  id: string;
  jobId: string;
  jobName: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: "running" | "success" | "error";
  prompt: string;
  output?: string;           // agent 执行结果摘要（截断）
  error?: string;
}

interface CronStoreData {
  jobs: CronJob[];
  version: number;
}

interface HistoryStoreData {
  executions: CronExecution[];
  version: number;
}

/** 触发回调：创建临时 session 执行 prompt，返回结果文本 */
export type FireFn = (job: CronJob) => Promise<{ output?: string; error?: string }>;

// ── 持久化路径 ──

const HOME = process.env.HOME || process.env.USERPROFILE || "/";
const JOBS_FILE = PATHS.cronJobs;
const HISTORY_FILE = PATHS.cronHistory;
const MAX_HISTORY_PER_JOB = 50;  // 每个任务最多保留 50 条历史
const MAX_OUTPUT_LEN = 2000;     // 输出摘要截断长度

// ── 内存状态 ──

let store: CronStoreData = { jobs: [], version: 1 };
let historyStore: HistoryStoreData = { executions: [], version: 1 };
let loaded = false;
const cronInstances = new Map<string, Cron>();
let fireFn: FireFn | null = null;

// ── 持久化方法 ──

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  await mkdir(AGENT_DIR, { recursive: true });
  try {
    if (existsSync(JOBS_FILE)) store = JSON.parse(await readFile(JOBS_FILE, "utf-8"));
  } catch { store = { jobs: [], version: 1 }; }
  try {
    if (existsSync(HISTORY_FILE)) historyStore = JSON.parse(await readFile(HISTORY_FILE, "utf-8"));
  } catch { historyStore = { executions: [], version: 1 }; }
}

async function persistJobs() {
  await mkdir(AGENT_DIR, { recursive: true });
  await writeFile(JOBS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

async function persistHistory() {
  await mkdir(AGENT_DIR, { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(historyStore, null, 2), "utf-8");
}

// ── 历史记录 ──

function addExecution(exec: CronExecution) {
  historyStore.executions.unshift(exec); // 最新的在前
  // 每个任务只保留 MAX_HISTORY_PER_JOB 条
  const byJob = new Map<string, number>();
  const filtered: CronExecution[] = [];
  for (const e of historyStore.executions) {
    const count = (byJob.get(e.jobId) ?? 0) + 1;
    byJob.set(e.jobId, count);
    if (count <= MAX_HISTORY_PER_JOB) filtered.push(e);
  }
  historyStore.executions = filtered;
}

function updateExecution(id: string, patch: Partial<CronExecution>) {
  const exec = historyStore.executions.find(e => e.id === id);
  if (exec) Object.assign(exec, patch);
}

// ── Cron 实例管理 ──

export function setFireFn(fn: FireFn) {
  fireFn = fn;
}

function scheduleJob(job: CronJob) {
  unscheduleJob(job.id);

  const fn = async () => {
    console.log(`[cron] 触发: ${job.name} (${job.id})`);
    job.lastRun = Date.now();
    job.lastStatus = "running";

    // 记录执行历史
    const execId = randomUUID();
    const exec: CronExecution = {
      id: execId, jobId: job.id, jobName: job.name,
      startedAt: Date.now(), status: "running", prompt: job.prompt,
    };
    addExecution(exec);
    persistHistory();

    // 执行
    let output: string | undefined;
    let error: string | undefined;
    if (fireFn) {
      try {
        const result = await fireFn(job);
        output = result.output?.slice(0, MAX_OUTPUT_LEN);
        error = result.error;
      } catch (err: any) {
        error = err?.message || String(err);
      }
    }

    // 更新历史
    const finishedAt = Date.now();
    const status = error ? "error" : "success";
    updateExecution(execId, {
      finishedAt, durationMs: finishedAt - exec.startedAt,
      status, output, error,
    });
    persistHistory();

    // 更新 job 状态
    job.runCount++;
    job.lastStatus = status;

    // 一次性任务执行后禁用
    if (job.type === "once") {
      job.enabled = false;
      unscheduleJob(job.id);
    } else {
      const cron = cronInstances.get(job.id);
      if (cron) job.nextRun = cron.nextRun()?.getTime();
    }
    persistJobs();
    console.log(`[cron] 完成: ${job.name} (${status}, ${finishedAt - exec.startedAt}ms)`);
  };

  try {
    const cron = new Cron(job.schedule, fn);
    cronInstances.set(job.id, cron);
    job.nextRun = cron.nextRun()?.getTime();
  } catch (err: any) {
    console.error(`[cron] 无效的表达式 "${job.schedule}": ${err.message}`);
  }
}

function unscheduleJob(jobId: string) {
  const cron = cronInstances.get(jobId);
  if (cron) { cron.stop(); cronInstances.delete(jobId); }
}

// ── 启动恢复 ──

export async function restoreAllJobs() {
  await ensureLoaded();
  for (const job of store.jobs) {
    if (job.enabled) scheduleJob(job);
  }
  console.log(`[cron] 恢复 ${cronInstances.size} 个定时任务`);
}

// ── 公共 API ──

export const cronStore = {
  async list(): Promise<CronJob[]> {
    await ensureLoaded();
    return store.jobs.map(({ ...j }) => j);
  },

  async get(id: string): Promise<CronJob | undefined> {
    await ensureLoaded();
    return store.jobs.find(j => j.id === id);
  },

  async create(input: {
    name: string;
    schedule: string;
    prompt: string;
    cwd: string;
    workspaceId: string;
    agentId?: string;
    type?: "cron" | "once";
    description?: string;
  }): Promise<CronJob> {
    await ensureLoaded();
    // 重名检查：防止重复创建同名任务
    const existing = store.jobs.find(j => j.name === input.name);
    if (existing) {
      throw new Error(`已存在同名任务「${input.name}」（ID: ${existing.id}）。请先删除或改名。`);
    }
    const now = Date.now();
    const job: CronJob = {
      id: randomUUID(),
      name: input.name.slice(0, 50),
      schedule: input.schedule,
      prompt: input.prompt,
      cwd: input.cwd,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      type: input.type || "cron",
      description: input.description,
      enabled: true,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    store.jobs.push(job);
    await persistJobs();
    scheduleJob(job);
    await persistJobs();
    console.log(`[cron] 创建: ${job.name} (${job.id})`);
    return job;
  },

  async remove(id: string): Promise<boolean> {
    await ensureLoaded();
    const idx = store.jobs.findIndex(j => j.id === id);
    if (idx < 0) return false;
    unscheduleJob(id);
    store.jobs.splice(idx, 1);
    await persistJobs();
    return true;
  },

  async pause(id: string): Promise<CronJob | undefined> {
    await ensureLoaded();
    const job = store.jobs.find(j => j.id === id);
    if (!job) return undefined;
    job.enabled = false;
    job.updatedAt = Date.now();
    unscheduleJob(id);
    await persistJobs();
    return job;
  },

  async resume(id: string): Promise<CronJob | undefined> {
    await ensureLoaded();
    const job = store.jobs.find(j => j.id === id);
    if (!job) return undefined;
    job.enabled = true;
    job.updatedAt = Date.now();
    scheduleJob(job);
    await persistJobs();
    return job;
  },

  async runOnce(id: string): Promise<{ output?: string; error?: string } | undefined> {
    await ensureLoaded();
    const job = store.jobs.find(j => j.id === id);
    if (!job) return undefined;
    console.log(`[cron] 手动触发: ${job.name}`);
    if (fireFn) {
      return await fireFn(job);
    }
    return {};
  },

  async getHistory(jobId: string, limit = 20): Promise<CronExecution[]> {
    await ensureLoaded();
    return historyStore.executions
      .filter(e => e.jobId === jobId)
      .slice(0, limit);
  },

  async getAllHistory(limit = 50): Promise<CronExecution[]> {
    await ensureLoaded();
    return historyStore.executions.slice(0, limit);
  },

  stopAll() {
    for (const cron of cronInstances.values()) cron.stop();
    cronInstances.clear();
  },
};
