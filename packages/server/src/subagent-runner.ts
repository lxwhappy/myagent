// subagent-runner.ts — 子 agent 执行器
//
// 实现 SubagentSpawnFn：创建一个隔离的子 AgentSession，跑完子任务，
// 收集它的文本输出返回给主 agent。
//
// 关键设计：
// 1. 防递归：子 agent 的 customTools 留空，只用 createAgentSession 默认的内置编码工具
//    （read/bash/edit/write），不注入 delegate_task → 子 agent 无法再委派。
// 2. 事件隔离：子 agent 不绑 eventBridge，它的 agent_start/message/tool 事件不进 SSE
//    总线（否则会和主 agent 事件混在一起）。我们只提炼 subagent_start/progress/end
//    三种摘要事件 emit 给前端。
// 3. 健壮性：subscribe 累积输出 + agent_end 信号 + 超时兜底，finally 里必销毁子 agent。

import {
  createAgentSession,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { config } from "./config.js";
import { emit } from "./event-bus.js";
import type {
  SubagentSpawnFn,
  SubagentResult,
  SubagentProgressEvent,
} from "@myagent/pi-subagent-extension";

const DEFAULT_TIMEOUT_MS = 180_000; // 3 分钟兜底

// ── 活跃子 agent 追踪表 ──
// 按 parentSessionId 记录所有正在运行的子 agent 的 AbortController，
// 主 agent abort/destroy 时通过 abortSubagents() 连带终止。
const activeSubagents = new Map<string, Set<AbortController>>();

/** 终止指定父会话下所有活跃的子 agent（主 agent abort/destroy 时调用） */
export function abortSubagents(parentSessionId: string): number {
  const controllers = activeSubagents.get(parentSessionId);
  if (!controllers || controllers.size === 0) return 0;
  const count = controllers.size;
  for (const ctrl of controllers) {
    try { ctrl.abort(); } catch {}
  }
  controllers.clear();
  activeSubagents.delete(parentSessionId);
  if (count > 0) console.log(`[subagent] 父会话 ${parentSessionId.slice(0, 8)} abort，连带终止 ${count} 个子 agent`);
  return count;
}

/** 子 agent 执行器（实现 SubagentSpawnFn） */
export const runSubagent: SubagentSpawnFn = async (
  parentSessionId,
  goal,
  context,
  opts,
  onProgress,
) => {
  const subId = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = Date.now();
  const timeoutMs = opts.maxTurns ? opts.maxTurns * 60_000 : DEFAULT_TIMEOUT_MS;

  // ── 解析模型（默认与主 agent 相同）──
  const provider = opts.provider ?? config.defaultProvider;
  const modelId = opts.model ?? config.defaultModel;
  const model = getModel(provider, modelId);
  if (!model) {
    return { summary: "", error: `Model not found: ${provider}/${modelId}` };
  }

  const cwd = opts.cwd ?? config.workDir;
  const agentDir = process.env.HOME + "/.pi/agent";

  // 通知前端：子 agent 启动
  emit({
    type: "subagent_start",
    chatSessionId: parentSessionId,
    payload: { subId, goal, model: `${provider}/${modelId}` },
    ts: Date.now(),
  });

  let textBuf = "";
  let toolCalls = 0;
  let lastActivity = Date.now();   // 空闲检测：最后一次收到事件的时间
  let promptPhase = "init";         // 诊断：当前阶段
  let unsub: (() => void) | undefined;

  // 提前声明，确保 finally 块总能访问（即使异常发生在创建 session 之前）
  let abortController: AbortController | undefined;
  let controllers: Set<AbortController> | undefined;

  const IDLE_TIMEOUT_MS = 90_000;  // 90 秒无任何活动 → 判定卡死，提前 abort
  const HARD_TIMEOUT_MS = Math.max(timeoutMs, 600_000); // 硬上限 10 分钟

  try {
    // ── 创建子 agent ──
    promptPhase = "createSession";
    console.log(`[subagent] ${subId.slice(-4)} 创建子 agent (model=${provider}/${modelId}, cwd=${cwd})`);
    const loader = new DefaultResourceLoader({ cwd, agentDir });
    await loader.reload();

    const { session } = await createAgentSession({
      model,
      cwd,
      resourceLoader: loader,
      thinkingLevel: "off",
      // 防递归：customTools 留空。子 agent 只用默认内置工具(read/bash/edit/write)，
      // 没有 delegate_task，无法再委派。这样 agent 套娃深度恒为 1。
      customTools: [],
    });

    // ── 订阅子 agent 事件 ──
    // 完整事件流转发到前端（带 subId 归属），让用户能"钻入"查看子 agent 执行过程。
    const fwd = (ev: any) => emit({
      type: "subagent_event",
      chatSessionId: parentSessionId,
      payload: { subId, event: ev },
      ts: Date.now(),
    });

    unsub = session.subscribe((event: any) => {
      // 只对"真正有产出"的事件更新 lastActivity：
      // text_delta / thinking_delta / tool_execution_start / tool_execution_end
      // 不含 auto_retry_*（否则 API 重试会不断喂活空闲检测器，导致卡死检测失效）
      const isProductive =
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_end" ||
        (event.type === "message_update" && event.assistantMessageEvent);
      if (isProductive) lastActivity = Date.now();

      switch (event.type) {
        case "agent_start":
          fwd({ type: "agent_start" });
          break;
        case "agent_end":
          fwd({ type: "agent_end" });
          break;
        case "message_update": {
          const ae = event.assistantMessageEvent;
          if (ae?.type === "text_delta" && typeof ae.delta === "string") {
            textBuf += ae.delta;
            fwd({ type: "message_update", delta: ae.delta });
          } else if (ae?.type === "thinking_delta" && typeof ae.delta === "string") {
            fwd({ type: "thinking_delta", delta: ae.delta });
          }
          break;
        }
        case "tool_execution_start": {
          toolCalls++;
          const toolName = event.toolName;
          console.log(`[subagent] ${subId.slice(-4)} 工具调用 #${toolCalls}: ${toolName}`);
          fwd({ type: "tool_execution_start", toolCallId: event.toolCallId, tool: toolName, input: event.args });
          const pe: SubagentProgressEvent = {
            subId, parentSessionId, goal, phase: "tool", tool: toolName,
          };
          emit({ type: "subagent_progress", chatSessionId: parentSessionId, payload: pe, ts: Date.now() });
          onProgress(pe);
          break;
        }
        case "tool_execution_end":
          fwd({ type: "tool_execution_end", toolCallId: event.toolCallId, result: event.result, isError: event.isError });
          break;
      }
    });

    // ── 拼 prompt：引导子 agent 专注 + 简洁汇报 ──
    const sysHint =
      "[你是被委派的子 agent，独立执行一个子任务。专注完成目标，" +
      "完成后给出简洁、结构化的结果摘要。不需要客套。]";
    const fullPrompt = context
      ? `${sysHint}\n\n任务：${goal}\n\n背景：${context}`
      : `${sysHint}\n\n任务：${goal}`;

    // ── 跑子 agent ──
    // prompt() 内部会 await 到整个回合结束（含重试/压缩/续跑），
    // 所以不需要额外的 agentEnd 信号。用 AbortController + 超时控制。
    promptPhase = "prompt";
    console.log(`[subagent] ${subId.slice(-4)} 开始执行 prompt（${fullPrompt.length} 字符）`);

    abortController = new AbortController();
    let timedOutBy: "hard" | "idle" | null = null;

    // 注册到活跃子 agent 追踪表（主 agent abort 时可连带终止）
    controllers = activeSubagents.get(parentSessionId);
    if (!controllers) { controllers = new Set(); activeSubagents.set(parentSessionId, controllers); }
    controllers.add(abortController);

    // ── 硬超时：独立 Promise 直接参与 race，不依赖 abort 事件链 ──
    // （abort 事件监听器在某些场景下可能不可靠，用 setTimeout + Promise 最稳）
    const hardTimeoutPromise = new Promise<"hard">((resolve) => {
      const t = setTimeout(() => { timedOutBy = "hard"; resolve("hard"); }, HARD_TIMEOUT_MS);
      // 允许 unref 以避免阻止进程退出（race 结束后 Promise 自然失效）
      t.unref?.();
    });

    // ── 空闲检测：每 10 秒检查一次 ──
    // 注意：lastActivity 只在"真正有产出"的事件中更新（text_delta/tool_execution），
    // auto_retry 等内部事件不算活动（否则 API 重试会不断喂活空闲检测器）
    const idleTimeoutPromise = new Promise<"idle">((resolve) => {
      const checker = setInterval(() => {
        const idle = Date.now() - lastActivity;
        if (idle > IDLE_TIMEOUT_MS) {
          clearInterval(checker);
          timedOutBy = "idle";
          resolve("idle");
        }
      }, 10_000);
      checker.unref?.();
    });

    try {
      // 三方竞速：prompt 完成 vs 硬超时 vs 空闲超时
      const promptDone = session.prompt(fullPrompt).then(() => "done" as const);
      const winner = await Promise.race([promptDone, hardTimeoutPromise, idleTimeoutPromise]);

      // 清理定时器
      if (winner !== "hard") hardTimeoutPromise; // Promise 自行 GC
      // 终止子 agent（无论是否超时，prompt 可能还在后台跑）
      if (winner !== "done") {
        try { await session.abort(); } catch {}
      }

      if (winner !== "done") {
        // 被 abort（硬超时或空闲超时）
        const reason = winner === "idle"
          ? `子 agent 卡死（${Math.round(IDLE_TIMEOUT_MS / 1000)}s 无活动），已中止`
          : `子 agent 执行超时（${Math.round(HARD_TIMEOUT_MS / 1000)}s 硬上限）`;
        console.log(`[subagent] ${subId.slice(-4)} 超时中止: ${reason}`);
        const result: SubagentResult = {
          summary: textBuf.trim() || "(已中止，部分产出见上)",
          error: reason,
          toolCalls,
          durationMs: Date.now() - startedAt,
        };
        emit({ type: "subagent_end", chatSessionId: parentSessionId, payload: { subId, ...result }, ts: Date.now() });
        return result;
      }

      console.log(`[subagent] ${subId.slice(-4)} 执行完成，产出 ${textBuf.length} 字，${toolCalls} 次工具调用`);
    } catch (err: any) {
      throw err;
    } finally {
      abortController.abort(); // 确保追踪表清理
    }

    // ── 成功：收集结果 ──
    promptPhase = "collect";
    const stats = session.getSessionStats();
    const result: SubagentResult = {
      summary: textBuf.trim() || "(子 agent 未产生文本输出)",
      tokens: stats.tokens.total,
      tokenBreakdown: stats.tokens,
      toolCalls: stats.toolCalls ?? toolCalls,
      durationMs: Date.now() - startedAt,
    };

    emit({
      type: "subagent_end",
      chatSessionId: parentSessionId,
      payload: { subId, ...result },
      ts: Date.now(),
    });

    return result;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`[subagent] ${subId.slice(-4)} 异常 @${promptPhase}: ${errMsg}`);
    const result: SubagentResult = {
      summary: textBuf.trim() || "",
      error: errMsg,
      toolCalls,
      durationMs: Date.now() - startedAt,
    };
    emit({
      type: "subagent_end",
      chatSessionId: parentSessionId,
      payload: { subId, ...result },
      ts: Date.now(),
    });
    return result;
  } finally {
    // 从活跃子 agent 追踪表注销
    if (abortController && controllers) {
      controllers.delete(abortController);
      if (controllers.size === 0) activeSubagents.delete(parentSessionId);
    }
    try { unsub?.(); } catch {}
  }
};
