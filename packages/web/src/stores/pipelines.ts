// stores/pipelines.ts — 流水线状态管理
//
// 列表从后端 /api/pipelines 拉取；运行时 SSE 事件（pipeline_flow_*）更新实时步骤状态。

import { create } from "zustand";
import type { Message } from "./chat";

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
  /** 路线A：DAG 编辑层（有 dag 时以 dag 为真源，steps 由后端编译产出） */
  dag?: PipelineDag;
  maxParallel: number;
  budget?: { maxLLMCalls: number };
  timeoutMs?: number;
  createdAt: number;
  updatedAt: number;
}

/** DAG 数据模型（对齐 server dag-model.ts） */
export interface DagNodeShape {
  id: string;
  type: "trigger" | "agent" | "decision" | "loop" | "delay";
  label: string;
  loopOf?: string;
  exitOf?: string;
  [k: string]: unknown;
}

export interface DagFlowEdge {
  id: string;
  source: string;
  target: string;
  branchValue?: string;
  isDefault?: boolean;
}

export interface PipelineDag {
  positions: Record<string, { x: number; y: number }>;
  nodes: DagNodeShape[];
  edges: DagFlowEdge[];
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

  // 步骤钻入（subagent 过程视图）
  /** 当前钻入的 subId（pipeline run 内某个 step 的子 agent） */
  activeSubId: string | null;
  /** subId → 子 agent 执行过程（messages 由 subagent_event 归约） */
  subagents: Record<string, PipelineSubagent>;
  /** run 切换时清空钻入缓存 */
  resetSubagents: () => void;
  setActiveSubId: (subId: string | null) => void;
  /** SSE subagent_start/subagent_end（chatSessionId = pipeline:<runId> 命名空间） */
  applySubStart: (runId: string, payload: { subId: string; goal: string }) => void;
  applySubEnd: (runId: string, payload: { subId: string; summary?: string; error?: string; tokens?: number; durationMs?: number; sdkSessionFile?: string }) => void;
  /** SSE subagent_event（thinking/工具/消息流，归约为 Message[]） */
  applySubEvent: (runId: string, subId: string, event: any) => void;
}

/** pipeline 步骤的子 agent 状态（对齐 chat.SubagentState 的渲染字段） */
export interface PipelineSubagent {
  subId: string;
  goal: string;
  status: "running" | "done" | "error";
  messages: Message[];
  tokens?: number;
  durationMs?: number;
  summary?: string;
  error?: string;
  sdkSessionFile?: string;
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

  // ── 步骤钻入（subagent 过程视图）──
  activeSubId: null,
  subagents: {},

  resetSubagents: () => set({ activeSubId: null, subagents: {} }),
  setActiveSubId: (subId) => set({ activeSubId: subId }),

  applySubStart: (runId, payload) => {
    const { activeRunId } = get();
    if (activeRunId !== runId || !payload?.subId) return;
    const { subagents } = get();
    if (subagents[payload.subId]) return; // 幂等
    set({
      subagents: {
        ...subagents,
        [payload.subId]: { subId: payload.subId, goal: payload.goal || "", status: "running", messages: [] },
      },
    });
  },

  applySubEnd: (runId, payload) => {
    const { activeRunId, subagents } = get();
    if (activeRunId !== runId || !payload?.subId) return;
    const cur = subagents[payload.subId];
    if (!cur) return;
    set({
      subagents: {
        ...subagents,
        [payload.subId]: {
          ...cur,
          status: payload.error ? "error" : "done",
          summary: payload.summary,
          tokens: payload.tokens,
          durationMs: payload.durationMs,
          error: payload.error,
          sdkSessionFile: payload.sdkSessionFile,
        },
      },
    });
  },

  applySubEvent: (runId, subId, event) => {
    const { activeRunId, subagents } = get();
    if (activeRunId !== runId || !subId) return;
    const cur = subagents[subId];
    if (!cur || !event?.type) return;
    const msgs = [...cur.messages];
    const last = () => msgs[msgs.length - 1];
    switch (event.type) {
      case "agent_start":
        msgs.push({ id: `psub-${subId}-${msgs.length}`, role: "assistant", content: "", isStreaming: true, thinking: "", tools: [] });
        break;
      case "message_update": {
        if (!event.delta) break;
        const l = last();
        if (l?.role === "assistant" && l.isStreaming) msgs[msgs.length - 1] = { ...l, content: l.content + event.delta };
        break;
      }
      case "thinking_delta": {
        if (!event.delta) break;
        const l = last();
        if (l?.role === "assistant") msgs[msgs.length - 1] = { ...l, thinking: (l.thinking || "") + event.delta };
        break;
      }
      case "message_end": {
        if (!event.usage) break;
        const l = last();
        if (l?.role === "assistant") {
          let thinking = (l.thinking || "").trim();
          if (!thinking && l.tools?.length) thinking = (l.tools[l.tools.length - 1].precedingThinking || "").trim();
          msgs[msgs.length - 1] = {
            ...l,
            debugEvents: [...(l.debugEvents || []), {
              type: "llm", model: event.model, usage: event.usage,
              durationMs: event.debug?.llmDurationMs, firstTokenMs: event.debug?.firstTokenMs,
              startTs: event.debug?.startTs, endTs: event.debug?.endTs,
              thinking: thinking || undefined,
            }],
          };
        }
        break;
      }
      case "tool_execution_start": {
        const l = last();
        if (l?.role === "assistant") {
          const ct = (l.thinking || "").trim();
          msgs[msgs.length - 1] = {
            ...l, thinking: "",
            tools: [...(l.tools || []), { toolCallId: event.toolCallId, tool: event.tool, input: event.input, status: "running", precedingThinking: ct || undefined, startTs: event.debug?.startTs ?? Date.now() }],
          };
        }
        break;
      }
      case "tool_execution_end": {
        const l = last();
        if (l?.role === "assistant" && l.tools) {
          msgs[msgs.length - 1] = {
            ...l,
            tools: l.tools.map(t => t.toolCallId === event.toolCallId
              ? { ...t, output: event.result, isError: event.isError, status: event.isError ? "error" : "done", durationMs: event.debug?.durationMs, startTs: event.debug?.startTs ?? t.startTs }
              : t),
          };
        }
        break;
      }
      case "agent_end": {
        const l = last();
        if (l?.role === "assistant" && l.isStreaming) msgs[msgs.length - 1] = { ...l, isStreaming: false };
        break;
      }
    }
    set({ subagents: { ...subagents, [subId]: { ...cur, messages: msgs } } });
  },
}));
