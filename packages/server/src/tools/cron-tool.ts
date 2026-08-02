// cron-tool.ts — 定时任务管理工具
//
// 提供给 LLM 调用的工具。任务不绑定会话，触发时创建临时 session 执行。

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { cronStore } from "./cron-store.js";
import { config } from "../config.js";
import { getAgentCwd, getAgentWorkspaceId } from "../agent-registry.js";

export function createCronTool(chatSessionId: string): ToolDefinition {
  return {
    name: "cron_task",
    label: "CRON",
    description:
      "管理定时任务（cron）。任务独立于当前会话，触发时在后台自动执行。" +
      "action=create：创建新任务（需提供 name/schedule/prompt）。" +
      "action=list：列出所有任务。" +
      "action=pause/resume：暂停/恢复。" +
      "action=remove：删除。" +
      "action=run：手动触发一次。" +
      "schedule 用标准 cron 表达式（5段：分 时 日 月 周），如 '0 9 * * 1-5'=工作日9点，'*/30 * * * *'=每30分钟。",
    promptSnippet: "- cron_task: 定时任务管理（创建提醒/循环任务/定时执行，独立于会话）",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作：create | list | pause | resume | remove | run",
        },
        name: {
          type: "string",
          description: "任务名称（create 时必填）",
        },
        schedule: {
          type: "string",
          description: "cron 表达式，5段格式：分 时 日 月 周。如 '0 9 * * *'=每天9点，'*/5 * * * *'=每5分钟，'0 */2 * * *'=每2小时",
        },
        prompt: {
          type: "string",
          description: "任务触发时要执行的提示词（create 时必填）",
        },
        type: {
          type: "string",
          description: "任务类型：cron（循环，默认）或 once（一次性，执行后自动禁用）",
        },
        jobId: {
          type: "string",
          description: "任务ID（pause/resume/remove/run 时使用）",
        },
        description: {
          type: "string",
          description: "任务备注说明（可选）",
        },
      },
      required: ["action"],
    },

    async execute(_toolCallId: string, params: any) {
      const action = params?.action;
      if (!action) return errResult("缺少 action 参数", "❌ 缺少参数");

      try {
        switch (action) {
          case "create": {
            if (!params.name || !params.schedule || !params.prompt) {
              return errResult("create 需要 name, schedule, prompt 参数", "❌ 参数不完整");
            }
            const job = await cronStore.create({
              name: params.name,
              schedule: params.schedule,
              prompt: params.prompt,
              cwd: getAgentCwd(chatSessionId) ?? config.workDir,
              workspaceId: getAgentWorkspaceId(chatSessionId) ?? "default",
              type: params.type === "once" ? "once" : "cron",
              description: params.description,
            });
            const nextRun = job.nextRun
              ? new Date(job.nextRun).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
              : "未知";
            const text = `✅ 定时任务已创建\n` +
              `  名称: ${job.name}\n` +
              `  ID: ${job.id}\n` +
              `  计划: ${job.schedule} (${job.type === "once" ? "一次性" : "循环"})\n` +
              `  下次执行: ${nextRun}\n` +
              `  提示词: ${job.prompt.slice(0, 60)}${job.prompt.length > 60 ? "…" : ""}`;
            return okResult(text, `✅ 创建: ${job.name}`);
          }

          case "list": {
            const jobs = await cronStore.list();
            if (jobs.length === 0) return okResult("当前没有定时任务。用 action=create 创建一个。", "📋 无任务");
            const lines = jobs.map((j, i) => {
              const next = j.nextRun
                ? new Date(j.nextRun).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                : "未调度";
              const status = j.enabled ? "✅" : "⏸️";
              return `${i + 1}. ${status} ${j.name} [${j.id.slice(0, 8)}]\n` +
                `   计划: ${j.schedule} (${j.type})\n` +
                `   下次: ${next} | 已执行 ${j.runCount} 次\n` +
                `   提示: ${j.prompt.slice(0, 50)}${j.prompt.length > 50 ? "…" : ""}`;
            });
            return okResult(`共 ${jobs.length} 个定时任务：\n\n${lines.join("\n\n")}`, `📋 ${jobs.length} 个任务`);
          }

          case "pause": {
            const job = await cronStore.pause(params.jobId);
            if (!job) return errResult(`未找到任务: ${params.jobId}`, "❌ 未找到");
            return okResult(`⏸️ 已暂停: ${job.name}`, `⏸️ 暂停: ${job.name}`);
          }

          case "resume": {
            const job = await cronStore.resume(params.jobId);
            if (!job) return errResult(`未找到任务: ${params.jobId}`, "❌ 未找到");
            return okResult(`▶️ 已恢复: ${job.name}`, `▶️ 恢复: ${job.name}`);
          }

          case "remove": {
            const ok = await cronStore.remove(params.jobId);
            if (!ok) return errResult(`未找到任务: ${params.jobId}`, "❌ 未找到");
            return okResult(`🗑️ 已删除: ${params.jobId}`, `🗑️ 删除`);
          }

          case "run": {
            const result = await cronStore.runOnce(params.jobId);
            if (!result) return errResult(`未找到任务: ${params.jobId}`, "❌ 未找到");
            const text = result.error
              ? `🔔 触发失败: ${result.error}`
              : `🔔 执行结果:\n${result.output || "(无输出)"}`;
            return okResult(text, `🔔 触发`);
          }

          default:
            return errResult(`未知 action: ${action}`, "❌ 未知操作");
        }
      } catch (err: any) {
        return errResult(`操作失败: ${err?.message || String(err)}`, "❌ 异常");
      }
    },
  };
}

function okResult(text: string, summary: string) {
  return { content: [{ type: "text" as const, text }], details: { toolName: "cron_task", summary }, output: text, summary };
}
function errResult(text: string, summary: string) {
  return { content: [{ type: "text" as const, text }], details: { toolName: "cron_task", summary }, output: text, summary };
}
