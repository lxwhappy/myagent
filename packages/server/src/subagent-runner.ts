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
      lastActivity = Date.now(); // 任何事件都更新活动时间
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

    const abortController = new AbortController();
    let timedOutBy: "hard" | "idle" | null = null;

    // 硬超时定时器
    const hardTimer = setTimeout(() => {
      timedOutBy = "hard";
      abortController.abort();
    }, HARD_TIMEOUT_MS);

    // 空闲检测定时器：每 10 秒检查一次，如果超过 IDLE_TIMEOUT_MS 没活动就 abort
    const idleChecker = setInterval(() => {
      const idle = Date.now() - lastActivity;
      if (idle > IDLE_TIMEOUT_MS) {
        console.log(`[subagent] ${subId.slice(-4)} 空闲 ${Math.round(idle / 1000)}s，判定卡死，abort`);
        timedOutBy = "idle";
        abortController.abort();
      }
    }, 10_000);

    try {
      // session.prompt() 不直接接受 AbortSignal，但我们可以在 abort 时主动调 session.abort()
      // 用一个竞速：prompt 完成 vs abort 信号
      const promptDone = session.prompt(fullPrompt).then(() => true);
      const aborted = new Promise<false>((resolve) => {
        abortController.signal.addEventListener("abort", () => {
          session.abort().catch(() => {});
          resolve(false);
        });
      });

      const completed = await Promise.race([promptDone, aborted]);
      clearTimeout(hardTimer);
      clearInterval(idleChecker);

      if (!completed) {
        // 被 abort（硬超时或空闲超时）
        const reason = timedOutBy === "idle"
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
      clearTimeout(hardTimer);
      clearInterval(idleChecker);
      throw err;
    }

    // ── 成功：收集结果 ──
    promptPhase = "collect";
    const stats = session.getSessionStats();
    const result: SubagentResult = {
      summary: textBuf.trim() || "(子 agent 未产生文本输出)",
      tokens: stats.tokens,
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
    try { unsub?.(); } catch {}
  }
};
