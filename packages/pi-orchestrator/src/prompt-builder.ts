// src/prompt-builder.ts — prompt 模板变量插值引擎
//
// 把 OrchestrationMode.promptTemplate 里的 {{变量}} 替换为实际值。
// 支持简单变量和条件变量。

import type { OrchestrationMode, MemberInfo, PromptBuildContext } from "./types.ts";
import { assignNodeIds, type MemberWithNodeId } from "./graph-builder.ts";

/**
 * 构建 prompt：从模式模板 + 成员信息 + 用户消息生成最终编排指令
 */
export function buildPrompt(ctx: PromptBuildContext): string {
  const { mode, members, userMessage, optionValues } = ctx;

  // 为成员分配 nodeId（和 prompt 模板里的 [team:xxx-N] 标记对应）
  const membersWithIds = assignNodeIds(members, mode.topology);

  // 构建 members_list（带 nodeId 标记，让主 Agent 在 goal 里带上）
  const membersList = membersWithIds.map((m, i) => {
    const extra = m.instructions ? `\n     额外要求：${m.instructions}` : "";
    const nodeIdLine = mode.topology === "star" && i === 0
      ? `[${m.nodeId}] 主控`
      : `[${m.nodeId}]`;
    return `  ${i + 1}. ${nodeIdLine} ${m.icon} ${m.name}（${m.role}）${extra}`;
  }).join("\n");

  // 构建 member_N_xxx 变量
  const memberVars: Record<string, string> = {};
  membersWithIds.forEach((m, i) => {
    memberVars[`member_${i}_name`] = m.name;
    memberVars[`member_${i}_role`] = m.role;
    memberVars[`member_${i}_icon`] = m.icon;
    memberVars[`member_${i}_instructions`] = m.instructions ? `\n${m.role}额外要求：${m.instructions}\n` : "";
    // 特殊条件变量：member_N_nameexists_true / member_N_nameexists_false
    memberVars[`member_${i}_nameexists_true`] = members[i] ? "" : "";
    memberVars[`member_${i}_nameexists_false`] = members[i] ? "" : "";
  });

  // 成员总数相关变量
  const memberCountVars: Record<string, string> = {
    member_count: String(members.length),
    member_count_minus_1: String(Math.max(0, members.length - 1)),
    member_count_minus_2: String(Math.max(0, members.length - 2)),
  };

  // 选项变量
  const optionVars: Record<string, string> = {};
  for (const [key, val] of Object.entries(optionValues)) {
    optionVars[`options.${key}`] = String(val);
  }
  // 兼容直接 {{max_retries}} 写法
  if (optionValues.maxRetries != null) {
    optionVars.max_retries = String(optionValues.maxRetries);
  }
  if (optionValues.rounds != null) {
    optionVars.rounds = String(optionValues.rounds);
  }

  // 合并所有变量
  const vars: Record<string, string> = {
    user_message: userMessage,
    members_list: membersList,
    ...memberVars,
    ...memberCountVars,
    ...optionVars,
  };

  // 执行插值
  let result = mode.promptTemplate;

  // 特殊处理：{{member_2_nameexists_true}}A{{member_2_nameexists_false}}B
  // → 如果 member_2 存在则输出 A，否则输出 B
  // 这个在 evaluator 模板里用到
  const condRegex = /\{\{member_(\d+)_nameexists_(true|false)\}\}/g;
  // 先替换：把成对的条件标记处理掉
  result = result.replace(
    /\{\{member_(\d+)_nameexists_true\}\}(.*?)\{\{member_\1_nameexists_false\}\}(.*?)(?=\n|$)/g,
    (_, idx, truePart, falsePart) => {
      return members[parseInt(idx)] ? truePart : falsePart;
    },
  );
  // 清理残余的条件变量
  result = result.replace(condRegex, "");

  // 标准变量替换
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }

  // 清理未匹配的变量（避免 {{xxx}} 残留在 prompt 中）
  result = result.replace(/\{\{[^}]+\}\}/g, "");

  // ── 团队协调者强制声明 ──
  // 注入系统提示时，这段文字可能和用户消息分离（系统提示里是占位符，
  // 实际用户消息后续才到）。加一个明确的前置声明，确保 LLM 知道：
  // 它是团队协调者，必须通过 delegate_task 委派任务，不能自己干活。
  const enforcePrefix = [
    `【重要：你是团队协调者。以下用户的每一次请求，你都必须通过 delegate_task 工具委派给团队成员执行，绝不能自己直接动手（不调用 delegate_task 就直接写代码/读文件是严重错误）。】`,
    ``,
    result,
  ].join("\n");

  return enforcePrefix;
}

/**
 * 从 delegate_task 的 goal 文本中解析 nodeId 标记
 * 格式：[team:nodeId] 实际任务描述
 * @returns nodeId 或 null（无标记）
 */
export function parseNodeTag(goal: string): string | null {
  const match = goal.match(/^\[team:([^\]]+)\]/);
  return match ? match[1] : null;
}

/**
 * 获取模式的默认选项值
 */
export function getDefaultOptionValues(mode: OrchestrationMode): Record<string, string | number> {
  const vals: Record<string, string | number> = {};
  if (mode.options) {
    for (const opt of mode.options) {
      if (opt.default != null) vals[opt.key] = opt.default;
    }
  }
  return vals;
}
