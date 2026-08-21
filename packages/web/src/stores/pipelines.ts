// stores/pipelines.ts — 流水线状态管理
//
// 列表从后端 /api/pipelines 拉取；运行时 SSE 事件（pipeline_flow_*）更新实时步骤状态。

import { create } from "zustand";

// ── 类型（与 server pipeline-defs/run-store 对齐） ──

export interface Predicate {
  kind: "verdict-eq";
  stepId: string;
  value: string;
}

export interface VerdictSpec {
  type: "pass-fail" | "route";
  routes?: string[];
  command?: { cmd: string; passWhen: string; failWhen?: string; timeoutMs?: number };
  promptHint?: string;
}

export interface AgentStep {
  type: "agent";
  id: string;
  name: string;
  agentId?: string;
  skills?: string[];
  role: string;
  instructions?: string;
  inputsFrom: "all" | string[];
  verdict?: VerdictSpec;
  retry?: { maxRetries: number };
  artifacts?: string[];
  needsUserInput?: boolean;
}

export interface ParallelStep { type: "parallel"; id: string; steps: StepNode[]; }
export interface ConditionalStep {
  type: "conditional"; id: string;
  branches: { predicate: Predicate; steps: StepNode[] }[];
  default?: StepNode[];
}
export interface LoopStep {
  type: "loop"; id: string; loopType: "dowhile" | "dountil";
  exitWhen: Predicate; maxIterations: number; steps: StepNode[];
}
export interface ForeachStep {
  type: "foreach"; id: string; fromStepId: string;
  source: "artifact" | "output"; path?: string; itemKey?: string;
  concurrency?: number; steps: StepNode[];
}
export interface SleepStep { type: "sleep"; id: string; durationMs: number; }

export type StepNode = AgentStep | ParallelStep | ConditionalStep | LoopStep | ForeachStep | SleepStep;

export interface PipelineDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  steps: StepNode[];
  maxParallel: number;
  budget?: { maxLLMCalls: number };
  timeoutMs?: number;
  createdAt: number;
  updatedAt: number;
}

export interface RunStep {
  stepId: string;
  instanceKey?: string;
  attempt: number;
  iteration: number;
  status: "pending" | "running" | "success" | "error" | "skipped" | "waiting_input";
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  inputDigest?: string;
  output?: string;
  verdict?: string;
  verdictSource?: "command" | "llm";
  subId?: string;
  error?: string;
  warnings?: string[];
}

export interface PipelineRun {
  runId: string;
  pipelineId: string;
  status: "running" | "waiting_input" | "success" | "failed" | "aborted";
  abortReason?: string;
  input: string;
  steps: RunStep[];
  startedAt: number;
  endedAt?: number;
  usage: { llmCalls: number };
  stats?: { total: number; success: number; failed: number; skipped: number };
}

export interface RunIndexEntry {
  runId: string;
  pipelineId: string;
  pipelineName: string;
  status: string;
  trigger: string;
  startedAt: number;
  endedAt?: number;
  llmCalls?: number;
}

interface PipelinesState {
  pipelines: PipelineDef[];
  loaded: boolean;
  loadError: string | null;
  load: () => Promise<void>;

  // 运行视图
  activeRun: PipelineRun | null;
  activeRunId: string | null;
  runHistory: RunIndexEntry[];
  loadRun: (runId: string) => Promise<void>;
  loadRunHistory: (pipelineId?: string) => Promise<void>;
  clearActiveRun: () => void;
  /** SSE pipeline_flow_update 事件到达时合并 step 状态 */
  applyStepUpdate: (runId: string, step: RunStep) => void;
}

export const usePipelinesStore = create<PipelinesState>((set, get) => ({
  pipelines: [],
  loaded: false,
  loadError: null,

  load: async () => {
    try {
      const res = await fetch("/api/pipelines");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      set({ pipelines: data.pipelines || [], loaded: true, loadError: null });
    } catch (e) {
      console.error("[pipelines] load failed:", e);
      set({ loaded: true, loadError: e instanceof Error ? e.message : String(e) });
    }
  },

  activeRun: null,
  activeRunId: null,
  runHistory: [],

  loadRun: async (runId) => {
    try {
      const res = await fetch(`/api/pipeline-runs/${encodeURIComponent(runId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      set({ activeRun: data.run, activeRunId: runId });
    } catch (e) {
      console.error("[pipelines] loadRun failed:", e);
    }
  },

  loadRunHistory: async (pipelineId) => {
    try {
      const url = pipelineId
        ? `/api/pipelines/${encodeURIComponent(pipelineId)}/runs`
        : "/api/pipeline-runs";
      const res = await fetch(url);
      const data = await res.json();
      set({ runHistory: data.runs || [] });
    } catch (e) {
      console.error("[pipelines] loadRunHistory failed:", e);
    }
  },

  clearActiveRun: () => set({ activeRun: null, activeRunId: null }),

  applyStepUpdate: (runId, step) => {
    const { activeRun, activeRunId } = get();
    if (!activeRun || activeRunId !== runId) return;
    // 替换或追加该 step（以 stepId+instanceKey+attempt+iteration 定位）
    const idx = activeRun.steps.findIndex((s) =>
      s.stepId === step.stepId && s.instanceKey === step.instanceKey
      && s.attempt === step.attempt && s.iteration === step.iteration);
    const steps = idx >= 0
      ? activeRun.steps.map((s, i) => (i === idx ? step : s))
      : [...activeRun.steps, step];
    set({ activeRun: { ...activeRun, steps } });
  },
}));
