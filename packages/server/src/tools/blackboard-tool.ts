// tools/blackboard-tool.ts — 团队共享黑板工具
//
// 在团队执行期间注入主 Agent，让多个 delegate_task 子 agent 间共享信息。
//
// 设计原理：
// - 主 Agent 调用 write_blackboard 写入阶段性产出
// - 后续 delegate_task 的 context 里可以引用黑板内容
// - 黑板是会话隔离的，不同团队执行互不干扰
// - 通过 SSE 事件驱动前端展示（可选）
//
// 这比 send_message（异步消息传递）更简单可靠：
// - 不需要子 agent 是事件驱动的
// - 不需要消息队列
// - 共享状态模型（LangGraph 风格），适合同进程场景

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { emit } from "../event-bus.js";

// key: chatSessionId → entries[]
const boards = new Map<string, Array<{ author: string; content: string; ts: number }>>();

/** 获取黑板内容（给 team-executor 注入 context 用） */
export function getBlackboard(chatSessionId: string): string {
  const entries = boards.get(chatSessionId);
  if (!entries || entries.length === 0) return "";
  return entries.map((e, i) => `[${e.author}] ${e.content}`).join("\n\n");
}

/** 写入黑板 */
export function writeBlackboard(chatSessionId: string, author: string, content: string) {
  let entries = boards.get(chatSessionId);
  if (!entries) { entries = []; boards.set(chatSessionId, entries); }
  entries.push({ author, content, ts: Date.now() });
  emit({
    type: "blackboard_update",
    chatSessionId,
    payload: { author, content: content.slice(0, 200), total: entries.length },
    ts: Date.now(),
  });
}

/** 清空黑板（团队执行结束后调用） */
export function clearBlackboard(chatSessionId: string) {
  boards.delete(chatSessionId);
}

/** 创建黑板工具对（read + write），注入主 Agent */
export function createBlackboardTools(chatSessionId: string): ToolDefinition[] {
  return [
    {
      name: "write_blackboard",
      label: "BOARD",
      description:
        "向团队共享黑板写入信息。团队中后续的 delegate_task 子 agent 可以通过 read_blackboard 读取。" +
        "在团队协作中，每个步骤完成后应把关键产出写入黑板，让后续步骤能看到。" +
        "author 是你的角色名（如'开发'、'审查'），content 是你要共享的信息摘要。",
      promptSnippet: "- write_blackboard: 团队协作时写入共享信息，让后续步骤能看到你的产出",
      parameters: {
        type: "object",
        properties: {
          author: {
            type: "string",
            description: "写入者角色名（如'开发'、'审查'、'测试'）",
          },
          content: {
            type: "string",
            description: "要共享的信息摘要。简洁明了，包含关键产出/发现/问题。",
          },
        },
        required: ["author", "content"],
      },
      async execute(_toolCallId: string, params: any) {
        const { author, content } = params;
        if (!author || !content) {
          return {
            content: [{ type: "text" as const, text: "需要 author 和 content 参数" }],
            output: "参数缺失", summary: "❌ 黑板写入失败",
          };
        }
        writeBlackboard(chatSessionId, author, content);
        const entries = boards.get(chatSessionId) ?? [];
        const text = `已写入黑板（共 ${entries.length} 条）。后续步骤可通过 read_blackboard 查看。`;
        return {
          content: [{ type: "text" as const, text }],
          output: text, summary: `📝 ${author} 写入黑板`,
        };
      },
    },
    {
      name: "read_blackboard",
      label: "BOARD",
      description:
        "读取团队共享黑板的所有内容。在执行 delegate_task 之前读取，了解前序步骤的产出和发现。",
      promptSnippet: "- read_blackboard: 读取团队共享信息，了解前序步骤的产出",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute() {
        const text = getBlackboard(chatSessionId) || "(黑板为空)";
        return {
          content: [{ type: "text" as const, text }],
          output: text, summary: "📖 读取黑板",
        };
      },
    },
  ];
}
