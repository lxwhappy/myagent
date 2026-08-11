# MyAgent 代码审查报告

> 审查时间：2026-08-07
> 分支：v1.0
> 范围：packages/server/src/ + packages/web/src/

---

## 🔴 高优先级

### 1. 流式输出时全树重渲染

- **文件**: `packages/web/src/hooks/useChat.ts` 第 152 行
- **问题**: `const store = useChatStore()` 不带 selector，订阅了整个 store（含所有会话的全部消息）。`useChat()` 在 `App.tsx` 被调用，流式输出时 `appendDelta` 每帧触发 store 更新 → App.tsx 整棵树重渲染（侧栏、git 分支选择器、文件树等 1191 行 JSX 全部重算）。
- **修复**: 用精确 selector 只订阅需要的字段：
  ```ts
  const activeChatSessionId = useChatStore(s => s.activeChatSessionId);
  const connected = useChatStore(s => s.connected);
  const activeSession = useChatStore(s =>
    activeChatSessionId ? s.sessions[activeChatSessionId] : undefined
  );
  ```
- **影响**: 流式打字时明显卡顿，尤其长会话。

### 2. window 全局可变状态滥用（21 处）

- **文件**: `useChat.ts`（~13 处）、`App.tsx`（第 67-68、132-133 行）、`InputBar.tsx`（第 248 行）
- **问题**: 通过 `(window as any).__wsStore` 和 `__chatToAppSession` 在模块间传递状态，全部绕过类型系统。`__chatToAppSession` 是挂在 window 上的 Map，无类型定义、无清理（会话删除后映射残留）、依赖初始化顺序。
- **修复**:
  1. 直接用 `useWorkspaceStore.getState()` 替换所有 `(window as any).__wsStore`
  2. 把 `__chatToAppSession` 提取为模块级 Map 或并入 chat store
  3. 删除 App.tsx 的 debug 全局挂载

### 3. 会话缓存无界增长 + 并发写竞争

- **文件**: `packages/server/src/chat-sessions.ts` 第 83 行（缓存）、第 149-162 行（writeSession）
- **问题**:
  1. `cache = new Map()` 只增不减，长时间运行内存只涨不降，无 LRU 淘汰
  2. `writeSession` 先 `cache.set` 再 `await writeFile`，流式存盘与 `addMessage` 并发时可能写丢消息或写入半更新状态，无锁/无版本号
- **修复**:
  1. 给 cache 加 LRU 上限（如 50 个），evict 时回写磁盘
  2. 对同一 session 的写操作串行化（per-session Promise 链），或写时深拷贝快照

---

## 🟡 中优先级

### 4. 大量裸 catch 吞错误（27 处）

- **文件**: 全后端，典型如 `sse-gateway.ts`（第 41、47、136、198、208 行）、`event-bridge.ts`（第 36 行）、`agent-registry.ts`（第 293、399、410、469、480、493 行）、`chat-sessions.ts`（第 98、143、329 行）、`event-bus.ts`（第 18 行）
- **问题**: `catch {}` 和 `.catch(() => {})` 完全静默，排查问题时无任何线索
- **修复**: 至少 `catch (e) { console.error(...) }`，区分预期可忽略错误（ECONNRESET）和意外错误

### 5. autopilot abort 监听器累积不清理

- **文件**: `packages/server/src/autopilot-runner.ts` 第 134 行
- **问题**: `runPhase` 每次调用都 `signal.addEventListener("abort", ...)` 但从不 `removeEventListener`，一个 autopilot 运行会堆叠 5-15 个监听器
- **修复**:
  ```ts
  const onAbort = () => { clearTimeout(t); reject(new Error("aborted")); };
  signal.addEventListener("abort", onAbort, { once: true });
  // finally:
  signal.removeEventListener("abort", onAbort);
  ```

### 6. autopilot 忽略会话配置的 Agent/模型

- **文件**: `packages/server/src/autopilot-runner.ts` 第 90-91、177 行
- **问题**: 所有阶段硬编码 `config.defaultProvider`/`config.defaultModel`，用户切换了 Agent 预设或模型，跑 autopilot 时却用全局默认模型
- **修复**: 从 `getAgent(chatSessionId)` 读取当前会话的 provider/model/agentConfig

### 7. chat store 手写深拷贝冗长（676 行）

- **文件**: `packages/web/src/stores/chat.ts`
- **问题**: 每个 action 手写 `{ sessions: { ...s.sessions, [id]: { ...sess, messages: [...sess.messages] } } }`，`appendDelta` 每帧创建新数组，流式 60fps 时 GC 压力大
- **修复**: 引入 zustand immer 中间件，代码量减半：
  ```ts
  export const useChatStore = create<ChatStore>(immer((set) => ({
    appendDelta: (id, delta) => set(s => {
      const sess = s.sessions[id]; if (!sess) return;
      const last = sess.messages[sess.messages.length-1];
      if (last?.role === "assistant" && last.isStreaming) last.content += delta;
    }),
  })));
  ```

### 8. MessageItem 流式时每 50 字重建 ReactMarkdown

- **文件**: `packages/web/src/components/MessageItem.tsx` 第 82 行
- **问题**: `key={msg.isStreaming ? Math.floor(msg.content.length / 50) : "final"}`，每 50 字符 ErrorBoundary 换 key → 子树卸载重建 → ReactMarkdown 对全量 content 重新解析
- **修复**: 流式时降级为纯文本 `<div style={{whiteSpace:"pre-wrap"}}>`，`isStreaming` 结束后再挂载 ReactMarkdown

### 9. 持久化每条消息全量重写 JSON

- **文件**: `packages/server/src/chat-sessions.ts` writeSession
- **问题**: 每条消息 `writeFile` 全量重写整个会话 JSON，长会话（几百条消息 + debugEvents）每次写几 MB
- **修复**: 改 append-only jsonl（每消息一行），或 debounced 批量写

### 10. sse-client onMessage 单 handler 覆盖式

- **文件**: `packages/web/src/services/sse-client.ts` 第 201-203 行
- **问题**: `onMessage(handler)` 直接 `this.handler = handler`，后注册的覆盖前者，任何组件再调 `onMessage` 就会静默截断事件流
- **修复**: 改为 `Set<MessageHandler>`，`onMessage` 返回取消订阅函数

---

## 🟢 低优先级

### 11. config.ts 字符串拼接混淆环境变量名

- **文件**: `packages/server/src/config.ts` 第 26-29 行
- **问题**: `"ZAI_CODING_CN" + "_API_" + "KEY"` 无实际作用，徒增阅读困惑
- **修复**: 直接写 `process.env.ZAI_CODING_CN_API_KEY`

### 12. agent-registry 大量 as any（13 处）

- **文件**: `packages/server/src/agent-registry.ts`
- **问题**: `(session as any).getAllTools?.()` 等绕过类型，SDK 升级后字段改名会静默失效
- **修复**: 为 SDK 的 getAllTools、systemPrompt、sourceInfo 等建本地类型声明

### 13. App.tsx 刷新工作空间列表重复 4 次

- **文件**: `packages/web/src/App.tsx` 第 332-334、369-371、423-425、469-471 行
- **问题**: `fetch("/api/workspaces")` + `wsStore.setWorkspaces()` 重复 4 次，且均无错误处理
- **修复**: 抽 `async function refreshWorkspaces()`

### 14. useChat.ts 子 agent 序列化逻辑重复

- **文件**: `packages/web/src/hooks/useChat.ts` 第 60-66 行 vs 第 782-794 行
- **问题**: 两处 subagent map 映射几乎逐字相同
- **修复**: 提取 `serializeSubagents(subs: SubagentState[])`

### 15. event-bus subscribe 返回类型标注不准

- **文件**: `packages/server/src/event-bus.ts` 第 22-25 行
- **问题**: 签名 `() => void` 实际返回 `boolean`（`Set.delete` 的返回值）
- **修复**: `return () => { listeners.delete(listener); };`

### 16. workspace.ts 搜索递归的裸 catch

- **文件**: `packages/server/src/workspace.ts` 第 339 行
- **问题**: `catch {}` 吞掉目录读取错误，截断检查在递归后才判断
- **修复**: 将 `results.length >= 100` 提前到循环开头 break；catch 记录 skipped 目录

---

## 架构设计建议

1. **chatSessionId 与 appSessionId 双 ID 体系**：`__chatToAppSession` 映射的存在说明存在两套 ID，从代码看两者几乎总是相同值。建议统一为单一 ID，消除整层映射。

2. **前端 store 拆分**：`chat.ts`（676 行）单个 store 管所有会话的所有状态。流式更新触发的大范围对象重建可考虑：(a) 按 session 拆分 store；(b) 把高频更新的 messages 与低频的 skills/usage 分离。

3. **后端会话持久化**：当前每条消息全量重写整个 JSON。建议改 append-only jsonl 或 debounced 批量写。
