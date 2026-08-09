// autopilot-runner.ts — 全自动执行引擎
//
// 分阶段自主执行：分析 → 规划 → 执行 → 验证 →（修复循环）
// 每个阶段用独立的子 Agent 执行，不阻塞主会话。
// 阶段间通过共享黑板传递上下文，验证不通过则回退到执行阶段。
//
// 设计原则：
// 1. 复用 subagent-runner 的隔离执行能力（不注入 delegate_task，防递归）
// 2. 每阶段都是一次独立 LLM 调用，通过 SSE 事件驱动前端进度
// 3. 黑板（sharedContext）在各阶段间传递，实现信息共享
// 4. 硬上限保护：maxPhases + 单阶段超时，不会死循环

import { createAgentSession, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { config } from "./config.js";
import { emit } from "./event-bus.js";
import { AGENT_DIR } from "./paths.js";
import { autopilotConfigStore } from "./autopilot-config.js";

const DEFAULT_PHASE_TIMEOUT_MS = 300_000; // 默认单阶段 5 分钟（执行阶段要写代码、调工具）

// 从配置读取超时和循环次数
async function getConfig(): Promise<{ maxLoops: number; phaseTimeoutMs: number }> {
  const cfg = await autopilotConfigStore.get();
  return { maxLoops: cfg.maxRepairLoops, phaseTimeoutMs: cfg.phaseTimeoutMs || DEFAULT_PHASE_TIMEOUT_MS };
}

export type AutopilotPhase = "analyze" | "plan" | "execute" | "verify" | "repair" | "done" | "error";

export interface AutopilotState {
  phase: AutopilotPhase;
  task: string;
  round: number;
  analysis?: string;
  plan?: string;
  result?: string;
  verification?: string;
  issues?: string[];
  blackboard: string[]; // 共享黑板：各阶段的产出
  startedAt: number;
  error?: string;
}

// 活跃 autopilot 追踪（可中止）
const activeAutopilots = new Map<string, AbortController>();

/** 中止指定会话的 autopilot */
export function abortAutopilot(chatSessionId: string) {
  const ctrl = activeAutopilots.get(chatSessionId);
  if (ctrl) {
    ctrl.abort();
    activeAutopilots.delete(chatSessionId);
  }
}

/** 从配置模板插值生成阶段提示词 */
async function buildPhasePrompt(phase: AutopilotPhase, state: AutopilotState): Promise<string> {
  const cfg = await autopilotConfigStore.get();
  const phaseCfg = cfg.phases.find(p => p.phase === phase);
  if (!phaseCfg) return "";

  const blackboardCtx = state.blackboard.length > 0
    ? `\n\n--- 前序阶段产出 ---\n${state.blackboard.map((b, i) => `[阶段${i + 1}] ${b}`).join("\n\n")}`
    : "";

  const issuesText = state.issues && state.issues.length > 0
    ? `上一轮验证发现的问题（必须修复）：\n${state.issues.map((iss, i) => `${i + 1}. ${iss}`).join("\n")}`
    : "";

  let result = phaseCfg.promptTemplate;
  result = result.replaceAll("{{task}}", state.task);
  result = result.replaceAll("{{blackboard}}", blackboardCtx);
  result = result.replaceAll("{{analysis}}", state.analysis ? `分析结果：\n${state.analysis}` : "");
  result = result.replaceAll("{{plan}}", state.plan ? `执行计划：\n${state.plan}` : "");
  result = result.replaceAll("{{result}}", state.result || "(无)");
  result = result.replaceAll("{{issues}}", issuesText);
  return result;
}

/** 运行单个阶段（创建临时子 Agent，跑完即销毁） */
async function runPhase(
  phase: AutopilotPhase,
  state: AutopilotState,
  agentId: string | undefined,
  cwd: string,
  signal: AbortSignal,
  chatSessionId: string,
  phaseTimeoutMs: number,
): Promise<string> {
  const provider = config.defaultProvider;
  const modelId = config.defaultModel;
  const model = getModel(provider, modelId);
  if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);

  const loader = new DefaultResourceLoader({ cwd, agentDir: AGENT_DIR });
  await loader.reload();

  const { session } = await createAgentSession({
    model,
    cwd,
    resourceLoader: loader,
    thinkingLevel: "off",
    customTools: [],
  });

  // 累积输出 + 实时流式通知前端
  let output = "";
  const unsub = session.subscribe((event: any) => {
    if (event.type === "message_update") {
      const ae = event.assistantMessageEvent;
      if (ae?.type === "text_delta" && typeof ae.delta === "string") {
        output += ae.delta;
        // 实时流式发给前端（节流：每 50 字符发一次）
        if (output.length % 50 < ae.delta.length) {
          emit({
            type: "autopilot_stream",
            chatSessionId,
            payload: { phase, snippet: output.slice(-200) },
            ts: Date.now(),
          });
        }
      }
    }
  });

  const prompt = await buildPhasePrompt(phase, state);
  console.log(`[autopilot] ${phase} 开始 (${prompt.length} 字符)`);

  try {
    // 超时 + abort 竞速
    const timeoutPromise = new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error("phase_timeout")), phaseTimeoutMs);
      t.unref?.();
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
    });

    await Promise.race([session.prompt(prompt), timeoutPromise]);
    console.log(`[autopilot] ${phase} 完成 (${output.length} 字符)`);
    return output.trim();
  } finally {
    unsub();
    try { await session.abort(); } catch {}
  }
}

/** 发送阶段进度事件 */
function emitPhaseEvent(chatSessionId: string, state: AutopilotState) {
  emit({
    type: "autopilot_phase",
    chatSessionId,
    payload: {
      phase: state.phase,
      round: state.round,
      task: state.task,
      analysis: state.analysis,
      plan: state.plan,
      result: state.result?.slice(0, 500),
      verification: state.verification,
      issues: state.issues,
      error: state.error,
    },
    ts: Date.now(),
  });
}

/**
 * 主入口：启动 autopilot
 * @param chatSessionId 关联的聊天会话（SSE 事件发到这里）
 * @param task 用户任务描述
 * @param cwd 工作目录
 * @param agentId 可选 Agent 预设（目前未使用，预留）
 */
export async function runAutopilot(
  chatSessionId: string,
  task: string,
  cwd: string,
  agentId?: string,
): Promise<AutopilotState> {
  const state: AutopilotState = {
    phase: "analyze",
    task,
    round: 0,
    blackboard: [],
    startedAt: Date.now(),
  };

  const abortController = new AbortController();
  activeAutopilots.set(chatSessionId, abortController);

  try {
    // 阶段 1: 分析
    state.phase = "analyze";
    emitPhaseEvent(chatSessionId, state);
    const { phaseTimeoutMs: timeout1 } = await getConfig();
    state.analysis = await runPhase("analyze", state, agentId, cwd, abortController.signal, chatSessionId, timeout1);
    state.blackboard.push(`分析：${state.analysis}`);
    emitPhaseEvent(chatSessionId, state);

    // 阶段 2: 规划
    state.phase = "plan";
    emitPhaseEvent(chatSessionId, state);
    state.plan = await runPhase("plan", state, agentId, cwd, abortController.signal, chatSessionId, timeout1);
    state.blackboard.push(`计划：${state.plan}`);
    emitPhaseEvent(chatSessionId, state);

    // 阶段 3-4: 执行 → 验证（可能多轮）
    const { maxLoops, phaseTimeoutMs } = await getConfig();
    for (state.round = 1; state.round <= maxLoops; state.round++) {
      // 执行
      state.phase = "execute";
      emitPhaseEvent(chatSessionId, state);
      state.result = await runPhase("execute", state, agentId, cwd, abortController.signal, chatSessionId, phaseTimeoutMs);
      state.blackboard.push(`第${state.round}轮执行：${state.result.slice(0, 800)}`);
      emitPhaseEvent(chatSessionId, state);

      // 验证
      state.phase = "verify";
      emitPhaseEvent(chatSessionId, state);
      state.verification = await runPhase("verify", state, agentId, cwd, abortController.signal, chatSessionId, phaseTimeoutMs);
      emitPhaseEvent(chatSessionId, state);

      // 检查验证结果
      if (state.verification.toUpperCase().includes("PASS")) {
        // 通过！
        state.phase = "done";
        state.issues = [];
        emitPhaseEvent(chatSessionId, state);
        console.log(`[autopilot] 任务完成（${state.round} 轮）`);
        return state;
      }

      // 未通过 — 解析问题
      state.issues = state.verification
        .split("\n")
        .filter((line: string) => line.trim().startsWith("问题:"))
        .map((line: string) => line.replace(/^.*问题:\s*/, "").trim());

      if (state.issues.length === 0) {
        // 评估者没按格式输出问题，直接用整个验证文本
        state.issues = [state.verification.slice(0, 200)];
      }

      // 如果还有修复轮次，进入修复阶段
      if (state.round < maxLoops) {
        state.phase = "repair";
        emitPhaseEvent(chatSessionId, state);
        const repaired = await runPhase("repair", state, agentId, cwd, abortController.signal, chatSessionId, phaseTimeoutMs);
        state.result = repaired;
        state.blackboard.push(`第${state.round}轮修复：${repaired.slice(0, 800)}`);
        emitPhaseEvent(chatSessionId, state);
      }
    }

    // 达到上限仍未通过
    state.phase = "done";
    emitPhaseEvent(chatSessionId, state);
    console.log(`[autopilot] 达到修复上限(${maxLoops})，输出当前结果`);
    return state;

  } catch (err: any) {
    state.phase = "error";
    state.error = err?.message || String(err);
    emitPhaseEvent(chatSessionId, state);
    console.error(`[autopilot] 错误: ${state.error}`);
    return state;
  } finally {
    activeAutopilots.delete(chatSessionId);
  }
}
