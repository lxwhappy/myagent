// ============================================================
// run-store.ts — 流水线执行记录持久化
//
// 每次 run 一个 JSON 文件 + index.json 轻量索引。
// 增量落盘：每个 step 状态变更即原子写（tmp+rename），崩溃后 run 文件即断点现场。
// ============================================================

import { readFile, writeFile, mkdir, rename } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { PATHS } from "../paths.js";
import type { PipelineDef } from "./pipeline-defs.js";

export interface RunStep {
  stepId: string;                     // 树节点 id
  instanceKey?: string;               // foreach 分片："j-impl#task-2"
  attempt: number;                    // 重试计数（1 起）
  iteration: number;                  // loop 轮次（非循环 = 1）
  status: "pending" | "running" | "success" | "error" | "skipped" | "waiting_input";
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  inputDigest?: string;               // 实际收到的完整输入（前 4000 字）
  output?: string;                    // 子 Agent 最终输出（截 8000 字）
  verdict?: string;
  verdictSource?: "command" | "llm";
  subId?: string;
  error?: string;
  warnings?: string[];
}

export type RunStatus = "running" | "waiting_input" | "success" | "failed" | "aborted";
export type AbortReason = "user" | "budget" | "timeout" | "unclean";

export interface PipelineRun {
  runId: string;
  pipelineId: string;
  pipelineSnapshot: PipelineDef;
  trigger: { type: "manual" | "chat" | "backlog"; ref?: string };
  status: RunStatus;
  abortReason?: AbortReason;
  input: string;
  steps: RunStep[];
  startedAt: number;
  endedAt?: number;
  usage: { llmCalls: number };
  stats?: { total: number; success: number; failed: number; skipped: number };
  waitingFor?: { stepId: string; question: string; since: number };
}

export interface RunIndexEntry {
  runId: string;
  pipelineId: string;
  pipelineName: string;
  status: RunStatus;
  trigger: string;
  startedAt: number;
  endedAt?: number;
  llmCalls?: number;
}

// run 文件写互斥（同一 run 内序列化写盘）
const writeLocks = new Map<string, Promise<void>>();
async function withWriteLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(runId) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((r) => { release = r; });
  writeLocks.set(runId, done);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (writeLocks.get(runId) === done) writeLocks.delete(runId);
  }
}

function runFile(runId: string) {
  return join(PATHS.pipelineRunsDir, `${runId}.json`);
}

/** 原子写 JSON（tmp + rename） */
async function atomicWrite(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, file);
}

async function readIndex(): Promise<RunIndexEntry[]> {
  if (!existsSync(PATHS.pipelineRunsIndex)) return [];
  try {
    return JSON.parse(await readFile(PATHS.pipelineRunsIndex, "utf-8"));
  } catch {
    return [];
  }
}

async function writeIndex(entries: RunIndexEntry[]) {
  await mkdir(PATHS.pipelineRunsDir, { recursive: true });
  await atomicWrite(PATHS.pipelineRunsIndex, entries.slice(-500)); // 索引上限 500 条
}

export const runStore = {
  /** 创建 run（写文件 + 更新 index） */
  async create(run: PipelineRun): Promise<void> {
    await withWriteLock(run.runId, async () => {
      await mkdir(PATHS.pipelineRunsDir, { recursive: true });
      await atomicWrite(runFile(run.runId), run);
      const idx = await readIndex();
      idx.push({
        runId: run.runId,
        pipelineId: run.pipelineId,
        pipelineName: run.pipelineSnapshot.name,
        status: run.status,
        trigger: run.trigger.type,
        startedAt: run.startedAt,
      });
      await writeIndex(idx);
    });
  },

  /** 读 run（只读场景） */
  async get(runId: string): Promise<PipelineRun | null> {
    try {
      return JSON.parse(await readFile(runFile(runId), "utf-8"));
    } catch {
      return null;
    }
  },

  /** 变更持久化（step 变更 / 状态变更都走这里，带写锁） */
  async save(run: PipelineRun): Promise<void> {
    await withWriteLock(run.runId, async () => {
      await atomicWrite(runFile(run.runId), run);
    });
  },

  /** run 结束：更新状态 + 刷新 index 条目 */
  async finish(run: PipelineRun): Promise<void> {
    await withWriteLock(run.runId, async () => {
      await atomicWrite(runFile(run.runId), run);
      const idx = await readIndex();
      const i = idx.findIndex((e) => e.runId === run.runId);
      const entry: RunIndexEntry = {
        runId: run.runId,
        pipelineId: run.pipelineId,
        pipelineName: run.pipelineSnapshot.name,
        status: run.status,
        trigger: run.trigger.type,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        llmCalls: run.usage.llmCalls,
      };
      if (i >= 0) idx[i] = entry; else idx.push(entry);
      await writeIndex(idx);
    });
  },

  async listIndex(): Promise<RunIndexEntry[]> {
    const idx = await readIndex();
    return idx.sort((a, b) => b.startedAt - a.startedAt);
  },

  async listByPipeline(pipelineId: string): Promise<RunIndexEntry[]> {
    const idx = await readIndex();
    return idx.filter((e) => e.pipelineId === pipelineId).sort((a, b) => b.startedAt - a.startedAt);
  },

  /** 启动时扫描：上次异常退出留下的 running run 标记 unclean */
  async markUncleanRuns(): Promise<number> {
    if (!existsSync(PATHS.pipelineRunsDir)) return 0;
    const { readdir } = await import("fs/promises");
    const files = await readdir(PATHS.pipelineRunsDir).catch(() => [] as string[]);
    let marked = 0;
    for (const f of files) {
      if (!f.endsWith(".json") || f === "index.json") continue;
      try {
        const run: PipelineRun = JSON.parse(await readFile(join(PATHS.pipelineRunsDir, f), "utf-8"));
        if (run.status === "running" || run.status === "waiting_input") {
          run.status = "aborted";
          run.abortReason = "unclean";
          run.endedAt = Date.now();
          await atomicWrite(join(PATHS.pipelineRunsDir, f), run);
          const idx = await readIndex();
          const i = idx.findIndex((e) => e.runId === run.runId);
          if (i >= 0) { idx[i].status = "aborted"; idx[i].endedAt = run.endedAt; await writeIndex(idx); }
          marked++;
        }
      } catch { /* 跳过损坏文件 */ }
    }
    return marked;
  },
};
