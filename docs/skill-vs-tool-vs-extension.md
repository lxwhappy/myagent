# Skill vs Tool vs Extension 对比指南

> 在 pi agent 中，Skill、Tool 和 Extension 是三个不同抽象层次的概念。理解它们的区别对正确实现功能至关重要。

---

## 📊 快速对比表

| 维度 | Skill (技能) | Tool (工具) | Extension (扩展) |
|------|-------------|------------|-----------------|
| **本质** | 给 Agent 的指导文档 | Agent 可调用的函数 | 系统级功能扩展 |
| **形式** | Markdown 文件 | TypeScript 函数 | TypeScript 模块 |
| **权限** | 无，纯文本 | 中，可执行代码 | 高，完整系统访问 |
| **触发** | Agent 自动/手动 `/skill:name` | Agent 通过函数调用 | 事件驱动/命令触发 |
| **持久化** | 文件系统 | 无（每次执行新建） | 可持久化状态 |
| **适用场景** | 工作流指导、最佳实践 | 具体操作、API 调用 | 系统拦截、UI 定制 |

---

## 🎯 三层架构图

```
┌─────────────────────────────────────────────────────┐
│                  Extension (扩展层)                  │
│  - 系统级功能                                       │
│  - 事件拦截 (tool_call, session_start...)           │
│  - 自定义工具注册                                  │
│  - UI 组件定制                                     │
│  - 命令注册 (/mycommand)                           │
└─────────────────────────────────────────────────────┘
                            │
                            ├─► 注册 Tool
                            │
┌─────────────────────────────────────────────────────┐
│                   Tool (工具层)                     │
│  - 具体可执行功能                                   │
│  - 参数化输入/输出                                  │
│  - 被 Agent 调用                                   │
│  - 单一职责                                        │
└─────────────────────────────────────────────────────┘
                            │
                            │ 被 Agent 调用
                            │
┌─────────────────────────────────────────────────────┐
│                   Skill (技能层)                    │
│  - 工作流指导                                       │
│  - 最佳实践                                        │
│  - 引用 Tool 的方式                                │
│  - Agent 如何使用工具的说明书                      │
└─────────────────────────────────────────────────────┘
```

---

## 📘 Skill (技能)

### 定义
给 Agent 的指导性文档，告诉 Agent "如何做某件事"。

### 特点
- **纯文本**：Markdown 格式
- **无代码执行**：只是说明书
- **渐进式加载**：描述在系统提示中，完整内容按需加载
- **可组合**：一个 Skill 可以引用其他 Skill/Tool

### 适用场景
✅ **适合用 Skill 的场景：**

1. **复杂工作流指导**
   ```
   # email-composer Skill
   ## Steps
   1. 分析邮件内容，识别语气和目的
   2. 确定收件人和抄送人
   3. 草拟正文（使用 [email-template-tool]）
   4. 检查礼貌用语和格式
   5. 预览给用户确认
   ```

2. **最佳实践/规则**
   ```
   # code-review Skill
   ## What to Check
   - 代码风格是否符合团队规范
   - 是否有潜在安全问题
   - 是否有性能问题
   ```

3. **领域知识**
   ```
   # react-patterns Skill
   ## Common Patterns
   - 使用 React.memo 优化组件
   - 避免 useEffect 依赖陷阱
   ```

4. **工具使用说明**
   ```
   # git-workflow Skill
   ## Commands
   - git status
   - git add .
   - git commit -m "..."
   ```

❌ **不适合用 Skill 的场景：**
- 需要调用外部 API
- 需要文件系统操作
- 需要复杂逻辑计算

### 示例

```markdown
---
name: email-composer
description: Compose professional emails with proper tone and structure
---

# Email Composer

Use this skill when the user asks to write, reply to, or draft an email.

## Setup

No setup required.

## Steps

1. **Understand Context**
   - Read the incoming email (if replying)
   - Identify the recipient and relationship
   - Determine the email's purpose

2. **Choose Tone**
   - Formal: for clients, executives
   - Professional: for colleagues, partners
   - Friendly: for internal team

3. **Draft Content**
   - Use the `email-template` tool to generate a draft
   - Include a clear subject line
   - Start with appropriate greeting
   - Keep paragraphs short (2-3 sentences)

4. **Review and Polish**
   - Check for typos and grammar
   - Ensure clarity and conciseness
   - Verify all points are addressed

5. **Present to User**
   - Show the draft
   - Ask for approval or edits

## Templates

See [templates/professional-email.md](templates/professional-email.md) for examples.

## Common Mistakes to Avoid

- Don't start with "I am writing to tell you that..."
- Don't use overly casual language with external parties
- Don't forget a clear call-to-action if needed
```

---

## 🔧 Tool (工具)

### 定义
Agent 可以调用的具体函数，执行特定操作。

### 特点
- **可执行**：TypeScript/JavaScript 代码
- **参数化**：定义输入参数和输出格式
- **单一职责**：一个 Tool 做一件事
- **可测试**：单元测试友好

### 适用场景
✅ **适合用 Tool 的场景：**

1. **API 调用**
   ```typescript
   {
     name: "send_email",
     description: "Send an email via SMTP",
     parameters: {
       to: "string",
       subject: "string",
       body: "string"
     }
   }
   ```

2. **文件操作**
   ```typescript
   {
     name: "parse_pdf",
     description: "Extract text from PDF file",
     parameters: {
       filePath: "string"
     }
   }
   ```

3. **数据查询**
   ```typescript
   {
     name: "search_calendar",
     description: "Find available time slots",
     parameters: {
       attendees: ["string"],
       duration: "number"
     }
   }
   ```

4. **计算/转换**
   ```typescript
   {
     name: "convert_currency",
     description: "Convert currency",
     parameters: {
       amount: "number",
       from: "string",
       to: "string"
     }
   }
   ```

❌ **不适合用 Tool 的场景：**
- 需要持久化状态（用 Extension）
- 需要拦截其他 Tool（用 Extension）
- 需要修改系统行为（用 Extension）

### 示例

```typescript
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const sendEmailTool: ToolDefinition = {
  name: "send_email",
  label: "Send Email",
  description: "Send an email via SMTP or Gmail API",

  parameters: Type.Object({
    to: Type.Array(Type.String({ description: "Recipient email addresses" })),
    cc: Type.Optional(Type.Array(Type.String({ description: "CC recipients" }))),
    subject: Type.String({ description: "Email subject line" }),
    body: Type.String({ description: "Email body content" }),
    format: Type.Optional(Type.Enum(["html", "text"], { default: "text" })),
  }),

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // 验证邮箱格式
    for (const email of params.to) {
      if (!isValidEmail(email)) {
        throw new Error(`Invalid email address: ${email}`);
      }
    }

    // 发送邮件
    try {
      const result = await emailService.send({
        to: params.to,
        cc: params.cc,
        subject: params.subject,
        body: params.body,
        format: params.format,
      });

      return {
        content: [{ type: "text", text: `Email sent successfully to ${params.to.join(", ")}` }],
        details: { messageId: result.messageId },
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to send email: ${error.message}` }],
        details: { error: error.message },
      };
    }
  },
};
```

---

## 🔌 Extension (扩展)

### 定义
系统级功能扩展，可以拦截事件、注册工具、定制 UI、管理状态。

### 特点
- **完整系统访问**：可以修改 pi 的行为
- **事件驱动**：订阅生命周期事件
- **状态持久化**：可以保存状态到会话
- **UI 定制**：自定义命令、面板、组件
- **权限控制**：拦截和批准操作

### 适用场景
✅ **适合用 Extension 的场景：**

1. **权限拦截**
   ```typescript
   pi.on("tool_call", async (event, ctx) => {
     if (event.toolName === "bash" && isDangerous(event.input)) {
       const approved = await ctx.ui.confirm("Confirm deletion?", "Details...");
       if (!approved) return { block: true, reason: "User denied" };
     }
   });
   ```

2. **状态管理**
   ```typescript
   export default function (pi: ExtensionAPI) {
     let todoList: TodoItem[] = [];

     pi.registerTool({
       name: "add_todo",
       async execute(toolCallId, params, signal, onUpdate, ctx) {
         todoList.push(params);
         pi.appendEntry({ type: "todo-list", items: todoList });
       }
     });
   }
   ```

3. **UI 定制**
   ```typescript
   pi.registerCommand("mypanel", {
     description: "Open custom panel",
     handler: async (args, ctx) => {
       ctx.ui.custom({
         type: "todo-panel",
         items: todoList,
      });
     }
   });
   ```

4. **外部集成**
   ```typescript
   pi.on("session_start", async (_event, ctx) => {
     // 启动文件监听
     const watcher = chokidar.watch(process.cwd());
     watcher.on("change", (path) => {
       ctx.ui.notify(`File changed: ${path}`, "info");
     });
   });
   ```

5. **自定义压缩逻辑**
   ```typescript
   pi.on("compaction", async (event, ctx) => {
     // 自定义摘要生成
     const customSummary = await generateCustomSummary(event.messages);
     return { summary: customSummary };
   });
   ```

❌ **不适合用 Extension 的场景：**
- 简单的一次性操作（用 Tool）
- 只需给 Agent 的指导（用 Skill）

### 示例

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function emailExtension(pi: ExtensionAPI) {
  // ── 状态管理 ──
  let emailQueue: EmailDraft[] = [];
  let sentEmails: SentEmail[] = [];

  // ── 注册 Tool ──
  pi.registerTool({
    name: "draft_email",
    label: "Draft Email",
    description: "Create an email draft (queued, not sent)",
    parameters: Type.Object({
      to: Type.Array(Type.String()),
      subject: Type.String(),
      body: Type.String(),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const draft: EmailDraft = {
        id: randomUUID(),
        ...params,
        createdAt: Date.now(),
      };
      emailQueue.push(draft);
      ctx.ui.notify(`Email draft queued (${emailQueue.length} pending)`, "info");
      return {
        content: [{ type: "text", text: `Draft created. Use /send-queued to send all drafts.` }],
        details: { draftId: draft.id, queueSize: emailQueue.length },
      };
    },
  });

  // ── 注册命令 ──
  pi.registerCommand("send-queued", {
    description: "Send all queued email drafts",
    handler: async (args, ctx) => {
      if (emailQueue.length === 0) {
        ctx.ui.notify("No emails in queue", "warning");
        return;
      }

      for (const draft of emailQueue) {
        try {
          await emailService.send(draft);
          sentEmails.push({ ...draft, sentAt: Date.now() });
        } catch (error) {
          ctx.ui.notify(`Failed to send to ${draft.to.join(", ")}: ${error.message}`, "error");
        }
      }

      emailQueue = [];
      pi.appendEntry({ type: "email-queue-sent", count: sentEmails.length });
      ctx.ui.notify(`Sent ${sentEmails.length} emails`, "success");
    },
  });

  // ── 事件拦截 ──
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "send_email" && !event.input.approved) {
      // 所有发送邮件都需要确认
      const confirmed = await ctx.ui.confirm(
        "Send Email?",
        `To: ${event.input.to.join(", ")}\nSubject: ${event.input.subject}`
      );
      if (!confirmed) {
        return { block: true, reason: "User cancelled" };
      }
    }
  });

  // ── 持久化状态 ──
  pi.on("session_start", async (_event, ctx) => {
    // 从会话历史恢复状态
    const lastEntry = ctx.session.lastEntry;
    if (lastEntry?.type === "email-queue-sent") {
      sentEmails = lastEntry.sentEmails || [];
    }
  });

  // ── 自定义 UI ──
  pi.registerCommand("email-dashboard", {
    description: "Show email dashboard",
    handler: async (args, ctx) => {
      ctx.ui.custom({
        type: "email-dashboard",
        queue: emailQueue,
        sent: sentEmails,
      });
    },
  });
}
```

---

## 🎮 实战示例：邮件助理功能分解

### 场景：邮件助理

让我们用"邮件助理"这个功能，展示如何使用 Skill、Tool 和 Extension 协同工作。

---

### Step 1: 实现 Tool - 底层功能

```typescript
// packages/server/src/tools/email.ts

export const emailTools = {
  sendEmail: {
    name: "send_email",
    description: "Send an email",
    parameters: { /* ... */ },
    async execute(/* ... */) { /* ... */ }
  },

  draftEmail: {
    name: "draft_email",
    description: "Create an email draft",
    parameters: { /* ... */ },
    async execute(/* ... */) { /* ... */ }
  },

  searchEmails: {
    name: "search_emails",
    description: "Search through email history",
    parameters: { /* ... */ },
    async execute(/* ... */) { /* ... */ }
  },

  classifyEmail: {
    name: "classify_email",
    description: "Classify email priority and category",
    parameters: { /* ... */ },
    async execute(/* ... */) { /* ... */ }
  }
};
```

---

### Step 2: 实现 Extension - 系统增强

```typescript
// packages/pi-email-extension/index.ts

export default function (pi: ExtensionAPI) {
  // ── 1. 注册邮件 Tool（来自 Step 1）──
  Object.values(emailTools).forEach(tool => pi.registerTool(tool));

  // ── 2. 邮件队列状态 ──
  let emailQueue: Email[] = [];

  // ── 3. 安全拦截 ──
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "send_email") {
      const email = event.input;
      if (isPersonalEmail(email.to)) {
        const approved = await ctx.ui.confirm(
          "Send to personal address?",
          `This will be sent to ${email.to}`
        );
        if (!approved) return { block: true, reason: "Personal email blocked" };
      }
    }
  });

  // ── 4. 命令 ──
  pi.registerCommand("email-stats", {
    description: "Show email statistics",
    handler: async (args, ctx) => {
      const stats = await getEmailStats();
      ctx.ui.notify(`Emails sent today: ${stats.count}`, "info");
      return stats;
    }
  });

  // ── 5. 持久化 ──
  pi.on("session_end", async (_event, ctx) => {
    if (emailQueue.length > 0) {
      pi.appendEntry({ type: "unsent-emails", emails: emailQueue });
    }
  });
}
```

---

### Step 3: 实现 Skill - 工作流指导

```markdown
---
name: email-assistant
description: Help users manage emails: compose, classify, summarize, and respond
---

# Email Assistant

Use this skill when the user asks about emails, whether writing, analyzing, or managing them.

## Core Capabilities

This skill uses the following tools:
- `send_email` - Send emails
- `draft_email` - Create drafts
- `search_emails` - Search email history
- `classify_email` - Categorize emails

## Common Workflows

### Composing a New Email

1. Understand the email's purpose (request, update, apology, etc.)
2. Identify the recipient and relationship (client, colleague, boss)
3. Choose appropriate tone:
   - **Formal**: Clients, executives, external partners
   - **Professional**: Colleagues, partners
   - **Friendly**: Internal team, close colleagues
4. Use `draft_email` to create initial draft
5. Review for:
   - Clarity
   - Correct tone
   - Complete information
   - Call-to-action if needed
6. Ask user for approval before using `send_email`

### Replying to an Email

1. Read the original email carefully
2. Identify key points and action items
3. Classify the email urgency using `classify_email`
4. Draft response that addresses all points
5. If the email contains a request, confirm what will be done and when

### Summarizing Emails

1. Use `search_emails` to find relevant emails
2. Extract key information:
   - **Sender**: Who sent it
   - **Subject**: What it's about
   - **Action Items**: What needs to be done
   - **Deadline**: When it's due
3. Present summary in structured format:
   ```
   📬 From: [sender]
   📋 Subject: [subject]
   🔴 Urgency: [high/medium/low]
   ✅ Action Items:
      - [ ] [item 1]
      - [ ] [item 2]
   ```

### Email Classification

Use `classify_email` to automatically categorize:
- **Priority**: urgent, normal, low
- **Category**: work, personal, spam, newsletter
- **Action Required**: yes/no

## Email Templates

See [templates/](templates/) for common email patterns:
- `project-update.md`
- `apology.md`
- `request.md`
- `meeting-invite.md`

## Best Practices

1. **Subject Lines**
   - Be specific and concise
   - Include action if needed: "Action Required: ..."
   - Avoid vague subjects like "Question"

2. **Structure**
   - Start with purpose
   - Use bullet points for lists
   - End with clear next steps

3. **Tone**
   - Match the recipient's expected tone
   - Err on the side of being too formal
   - Avoid slang with external parties

## Common Mistakes to Avoid

- ❌ Don't use "I am writing to tell you that..."
- ❌ Don't be overly casual with clients
- ❌ Don't forget to include a call-to-action
- ❌ Don't send without proofreading
- ❌ Don't reply-all unless necessary

## Security Reminders

- Always verify recipient addresses
- Check for sensitive information
- Use `draft_email` first for important emails
- Review queued emails with `/send-queued`
```

---

## 📋 决策指南：我应该用什么？

### 问题清单

回答这些问题来决定使用什么：

```
1. 我的功能是否需要...
   ├─ 修改 pi 的行为？ → Extension
   ├─ 拦截其他 Tool 的调用？ → Extension
   ├─ 持久化状态到会话？ → Extension
   └─ 只是执行特定操作？ → Tool 或 Skill

2. 我是否需要...
   ├─ 调用外部 API？ → Tool
   ├─ 执行文件系统操作？ → Tool
   ├─ 复杂的计算逻辑？ → Tool
   └─ 只是指导 Agent 如何做事？ → Skill

3. 我的功能是否...
   ├─ 是单一操作（如"发送邮件"）？ → Tool
   ├─ 是复杂流程（如"处理一天的邮件"）？ → Skill
   ├─ 需要用户交互/确认？ → Extension
   └─ 需要自定义 UI？ → Extension
```

---

### 决策矩阵

| 需求 | Skill | Tool | Extension |
|------|-------|------|-----------|
| 调用外部 API | ❌ | ✅ | ✅ |
| 文件系统操作 | ❌ | ✅ | ✅ |
| 复杂工作流指导 | ✅ | ❌ | ❌ |
| 拦截其他 Tool | ❌ | ❌ | ✅ |
| 状态持久化 | ❌ | ❌ | ✅ |
| 自定义 UI | ❌ | ❌ | ✅ |
| 参数化输入输出 | ❌ | ✅ | ✅ |
| 渐进式加载 | ✅ | ❌ | ❌ |
| 事件监听 | ❌ | ❌ | ✅ |
| 命令注册 | ❌ | ❌ | ✅ |
| 可读性强 | ✅ | ❌ | ❌ |
| 易于测试 | ❌ | ✅ | ✅ |

---

## 🔄 典型组合模式

### 模式 1: Extension 注册 Tool + Skill 指导使用

```
Extension: pi-email-extension
  ├─ 注册 Tool: send_email
  ├─ 注册 Tool: draft_email
  ├─ 拦截: 所有发送需确认
  └─ 命令: /email-stats

Skill: email-assistant
  └─ 指导 Agent 如何使用这些 Tool
      └─ 工作流: 分析 → 草稿 → 审核 → 发送
```

### 模式 2: Extension 管理状态 + Tool 操作 + Skill 组织流程

```
Extension: pi-todo-extension
  ├─ 状态: todoList[]
  ├─ Tool: add_todo
  ├─ Tool: complete_todo
  └─ 命令: /todo-dashboard

Skill: task-management
  └─ 指导:
      ├── 如何分解任务
      ├── 如何设置优先级
      └── 如何使用 todo 工具
```

### 模式 3: Extension 处理集成 + Tool 执行操作

```
Extension: pi-calendar-extension
  ├─ 连接: Google Calendar API
  ├─ Tool: search_calendar
  ├─ Tool: create_event
  └─ 命令: /schedule-meeting

Skill: meeting-scheduler
  └─ 指导:
      ├── 分析参会人日历
      ├── 找共同空闲时间
      ├── 生成会议邀请
      └── 设置提醒
```

---

## 🎯 针对办公场景的推荐方案

### 邮箱助理

| 功能 | 实现 | 理由 |
|------|------|------|
| 邮件发送/接收 | **Tool** | API 调用 |
| 邮件分类 | **Tool** | 逻辑计算 |
| 邮件摘要 | **Tool** | 文本处理 |
| 邮件起草指导 | **Skill** | 工作流指导 |
| 邮件确认拦截 | **Extension** | 安全控制 |
| 邮件队列管理 | **Extension** | 状态持久化 |
| 统计面板 | **Extension** | 自定义 UI |

**推荐组合：**
```
Extension: pi-email-extension
  └─ 注册所有邮件 Tool
  └─ 邮件队列管理
  └─ 安全拦截

Tool: send_email, draft_email, search_emails, classify_email

Skill: email-composer, email-classifier, email-summarizer
```

---

### 日程管理

| 功能 | 实现 | 理由 |
|------|------|------|
| 日历查询 | **Tool** | API 调用 |
| 会议创建 | **Tool** | API 调用 |
| 空闲时间查找 | **Tool** | 算法计算 |
| 会议安排流程 | **Skill** | 工作流 |
| 会议记录 | **Tool** | 文本处理 |
| 提醒管理 | **Extension** | Cron 集成 |

**推荐组合：**
```
Extension: pi-calendar-extension
  └─ Cron 任务（提醒）
  └─ 注册日历 Tool

Tool: search_calendar, create_event, find_free_slots

Skill: meeting-scheduler, meeting-notes
```

---

### 文档处理

| 功能 | 实现 | 理由 |
|------|------|------|
| PDF 解析 | **Tool** | 文件操作 |
| 文档摘要 | **Tool** | 文本处理 |
| 文档对比 | **Tool** | 算法计算 |
| 智能搜索 | **Tool** | 向量搜索 |
| 改写指导 | **Skill** | 工作流 |
| 文档历史追踪 | **Extension** | 状态管理 |

**推荐组合：**
```
Extension: pi-doc-extension
  └─ 向量数据库集成
  └─ 文档历史追踪

Tool: parse_pdf, summarize_doc, diff_docs, vector_search

Skill: document-summarizer, document-rewriter
```

---

### 任务管理

| 功能 | 实现 | 理由 |
|------|------|------|
| 创建任务 | **Tool** | 简单操作 |
| 任务状态 | **Extension** | 状态持久化 |
| 任务分解指导 | **Skill** | 工作流 |
| 看板 UI | **Extension** | 自定义 UI |
| 日报生成 | **Tool** | 文本生成 |
| 每日总结 | **Skill** | 工作流 |

**推荐组合：**
```
Extension: pi-todo-extension (已存在)
  └─ 扩展看板功能
  └─ 添加 Gantt 视图

Tool: create_task, update_task, generate_report

Skill: task-breakdown, daily-summary
```

---

### 数据分析

| 功能 | 实现 | 理由 |
|------|------|------|
| CSV 读取 | **Tool** | 文件操作 |
| 数据计算 | **Tool** | 算法 |
| 图表生成 | **Tool** | 输出生成 |
| 分析指导 | **Skill** | 工作流 |
| 数据问答 | **Tool** | 查询处理 |
| 仪表盘 UI | **Extension** | 自定义 UI |

**推荐组合：**
```
Extension: pi-data-extension
  └─ 仪表盘 UI
  └─ 数据库连接（可选）

Tool: read_csv, calculate_stats, generate_chart, data_qa

Skill: data-analyzer, report-generator
```

---

## 💡 最佳实践总结

### Skill 使用原则
1. ✅ 用于**指导** Agent 如何做事
2. ✅ 包含**工作流步骤**和**最佳实践**
3. ✅ 引用 Tool 告诉 Agent 何时使用哪个工具
4. ✅ 保持**可读性**，方便人类理解
5. ❌ 不要包含可执行代码
6. ❌ 不要直接调用 API

### Tool 使用原则
1. ✅ 单一职责，一个 Tool 做一件事
2. ✅ 明确定义输入参数和输出格式
3. ✅ 包含错误处理
4. ✅ 可独立测试
5. ❌ 不要包含状态（用 Extension）
6. ❌ 不要拦截其他 Tool

### Extension 使用原则
1. ✅ 用于**系统级**功能增强
2. ✅ 在合适的地方注册 Tool
3. ✅ 拦截事件时要有明确的理由
4. ✅ 状态管理要考虑持久化
5. ❌ 不要把简单操作做成 Extension
6. ❌ 避免过度拦截影响性能

---

## 📝 实施清单

### 开始新功能时

1. **功能拆分**
   - 哪些需要 Tool？
   - 哪些需要 Skill？
   - 哪些需要 Extension？

2. **优先实现**
   - 先实现 Tool（核心功能）
   - 再实现 Extension（系统集成）
   - 最后实现 Skill（使用指导）

3. **测试顺序**
   - 单元测试 Tool
   - 集成测试 Extension
   - 手动测试 Skill（Agent 表现）

4. **文档编写**
   - Tool: 参数说明、返回格式
   - Extension: 使用指南、配置项
   - Skill: 使用场景、示例

---

*文档生成时间：2025-08-10*
*版本：1.0*