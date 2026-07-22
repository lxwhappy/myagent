# MyAgent

基于 Pi Agent (earendil-works/pi) 的小而巧的 AI Agent + Web 端。

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置 API Key（以 Anthropic 为例）
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# 3. 启动（server + web 并行）
pnpm dev

# 或分开启动
pnpm dev:server   # → localhost:3000
pnpm dev:web      # → localhost:5180
```

打开 http://localhost:5180 开始对话。

## 架构

```
浏览器 (React)  ←WebSocket→  Node.js 后端 (Fastify)  ←SDK→  Pi Agent
                                  │
                          createAgentSession()
                          ├─ prompt()        → 发送消息
                          ├─ steer()         → 生成中追加
                          ├─ abort()         → 中止
                          ├─ setModel()      → 切换模型
                          └─ compact()       → 压缩上下文
```

## 项目结构

```
packages/
  server/          Node.js 后端
    src/
      index.ts           Fastify 入口
      ws-gateway.ts      WebSocket 网关（路由前端指令）
      session-manager.ts Agent Session 生命周期管理
      event-bridge.ts    Agent 事件 → WS 消息桥接
      config.ts          配置
  web/             React 前端
    src/
      App.tsx
      hooks/useWebSocket.ts   WS 客户端
      stores/chat.ts          Zustand 状态（事件驱动）
      components/
        ChatPanel.tsx         对话面板
        InputBar.tsx          输入栏（发送/steering/abort）
        ToolExecution.tsx     工具执行展示
        ThinkingPanel.tsx     推理过程
        StatusBar.tsx         状态栏
```

## 二次开发指引

### 添加自定义工具

在 server/src/session-manager.ts 的 createAgentSession 中添加：

```typescript
import { defineTool } from "@earendil-works/pi-coding-agent";

const myTool = defineTool({
  name: "my_tool",
  description: "描述...",
  parameters: { type: "object", properties: { ... } },
  execute: async (args) => { ... },
});

createAgentSession({ customTools: [myTool] });
```

### 切换 LLM

```bash
# OpenAI
export OPENAI_API_KEY=sk-...
LLM_PROVIDER=openai LLM_MODEL=gpt-4o pnpm dev:server

# Ollama (本地)
LLM_PROVIDER=ollama LLM_MODEL=llama3.2 pnpm dev:server

# Google
export GOOGLE_API_KEY=...
LLM_PROVIDER=google LLM_MODEL=gemini-2.0-flash pnpm dev:server
```

### 添加 Skills

```bash
mkdir -p ~/.pi/agent/skills
# 放入 SKILL.md 文件，Agent 自动加载
```
