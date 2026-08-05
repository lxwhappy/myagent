// components/MessageItem.tsx — 时间线风格消息渲染
// 设计原则：过程（思考/工具/子agent）和正文在同一条流里按顺序排列，
// 过程用低调样式（小字、浅色、可折叠），正文正常渲染。
// 主会话和子 agent 视图共用同一套渲染，样式完全一致。

import { useState, useRef, useEffect, memo, Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock as CodeHighlight } from "./CodeBlock";
import type { Message, ToolExecution, SubagentState, SystemNotice, DebugLLMEvent } from "../stores/chat";
import { MermaidBlock } from "./MermaidBlock";
import { ErrorBoundary } from "./ErrorBoundary";
import { getMessageStats } from "../utils/sessionStats";
import { TaskSummaryCard } from "./TaskSummaryCard";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { useDebugStore } from "../stores/debug";

function MessageItemInner({ msg, subagents, onOpenSub, retryStatus, isLastAssistant, onRegenerate }: { msg: Message; subagents?: SubagentState[]; onOpenSub?: (subId: string) => void; retryStatus?: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string } | null; isLastAssistant?: boolean; onRegenerate?: () => void }) {
  const debugEnabled = useDebugStore(s => s.enabled);
  // 系统通知（压缩等）— 非对话内容，渲染为特殊卡片
  if (msg.role === "system" && msg.systemNotice) {
    return <SystemNoticeCard notice={msg.systemNotice} />;
  }

  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="msg msg-user">
        <div className="msg-body">
          {msg.images && msg.images.length > 0 && (
            <div className="msg-images">
              {msg.images.map((img, i) => (
                <img
                  key={i}
                  src={img.previewUrl || `data:${img.mimeType};base64,${img.data}`}
                  alt={`图片 ${i + 1}`}
                  className="msg-image-thumb"
                />
              ))}
            </div>
          )}
          {msg.content && (
            <div className="msg-content" style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
          )}
        </div>
      </div>
    );
  }

  const stats = msg.tools && msg.tools.length > 0 ? getMessageStats(msg) : null;

  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar">
        <Icon name="i-bot" size={18} />
      </div>
      <div className="msg-body">
        <div className="msg-author">MyAgent</div>

        {/* ── 过程区：统一折叠/展开 + 总用时 ── */}
        <ProcessSection msg={msg} subagents={subagents} onOpenSub={onOpenSub} />

        {/* 统一生成状态指示器（重试/等待/初始三合一，同时只显示一个） */}
        <GeneratingStatus msg={msg} retryStatus={retryStatus} />

        {/* 4. 正文（Markdown 渲染） */ }
        {msg.content && (
          <div className="msg-content">
            <ErrorBoundary
              key={msg.isStreaming ? Math.floor(msg.content.length / 50) : "final"}
              fallback={<div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre({ children }: any) {
                    // block code（围栏代码块）：从子 <code> 提取原始文本 + 语言，按行数选择渲染方式
                    const codeEl: any = Array.isArray(children) ? children[0] : children;
                    if (!codeEl?.props) return <>{children}</>;
                    const className = codeEl.props.className || "";
                    const match = /language-(\w+)/.exec(className);
                    const lang = match?.[1];
                      const raw = String(codeEl.props.children ?? "").replace(/\n$/, "");
                      if (lang === "mermaid") {
                        return (
                          <ErrorBoundary
                            fallback={
                              <div className="mermaid-error">
                                <div className="mermaid-error-title">⚠️ 流程图渲染失败</div>
                                <pre className="mermaid-error-code">{raw}</pre>
                              </div>
                            }
                          >
                            <MermaidBlock chart={raw} />
                          </ErrorBoundary>
                        );
                      }
                      // shell 命令（bash/sh/zsh 等）：轻量命令块，无语言标签无深色框
                      const isShell = ["bash", "sh", "shell", "zsh", "fish"].includes(lang ?? "");
                      if (isShell) return <CommandBlock value={raw} />;
                      // 多行代码：完整 CodeBlock（带语言标签 + Copy）
                      if (raw.includes("\n")) return <CodeBlock language={lang ?? "text"} value={raw} />;
                      // 单行代码：轻量独占一行，无标题栏无 Copy
                      return <code className="code-line">{raw}</code>;
                    },
                    code({ className, children, ...props }: any) {
                      // 仅处理 inline code（`foo`），block code 由 pre 组件处理
                      return <code className={className} {...props}>{children}</code>;
                    },
                  }}
                >
                  {msg.isStreaming
                    // 流式时：如果有未闭合的代码围栏（奇数个```），补一个临时闭合标记让 Markdown 正确渲染
                    ? (() => {
                        const fenceCount = (msg.content.match(/```/g) || []).length;
                        return fenceCount % 2 === 1 ? msg.content + "\n```" : msg.content;
                      })()
                    : msg.content}
                </ReactMarkdown>
              </ErrorBoundary>
              {msg.isStreaming && <span className="stream-cursor" />}
          </div>
        )}

        {/* 任务摘要卡 */}
        {stats && !msg.isStreaming && (
          <TaskSummaryCard stats={stats} />
        )}

        {/* Debug 时间线：每步耗时 + token 明细 */}
        {debugEnabled && !msg.isStreaming && (
          <DebugTimeline msg={msg} />
        )}

        {/* 重新生成按钮（仅最后一条 AI 回复显示） */}
        {isLastAssistant && onRegenerate && (
          <button className="msg-regenerate-btn" onClick={onRegenerate} title="重新生成">
            🔄 重新生成
          </button>
        )}
      </div>
    </div>
  );
}

// ── 统一生成状态指示器 ──
// 状态优先级：重试 > 等待超时(>5s静默) > 初始等待(无内容)
// 同一时刻只渲染一个，避免多个 spinner 同时出现
function GeneratingStatus({ msg, retryStatus }: { msg: Message; retryStatus?: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string } | null }) {
  const [elapsed, setElapsed] = useState(0);
  const lastActivityRef = useRef(Date.now());

  // 每当 content/thinking/tools 变化 → 重置静默计时
  const activityKey = `${msg.content?.length ?? 0}:${msg.thinking?.length ?? 0}:${msg.tools?.length ?? 0}`;
  useEffect(() => {
    lastActivityRef.current = Date.now();
    setElapsed(0);
  }, [activityKey]);

  // 流式中每秒 tick
  useEffect(() => {
    if (!msg.isStreaming) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - lastActivityRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [msg.isStreaming]);

  if (!msg.isStreaming) return null;

  const hasContent = !!(msg.content || (msg.thinking?.trim()) || (msg.tools?.length));

  // 1. API 重试中
  if (retryStatus) {
    return (
      <div className="retry-indicator">
        <span className="retry-icon">⟳</span>
        <span className="retry-text">API 重试中（第 {retryStatus.attempt}/{retryStatus.maxAttempts} 次）…</span>
        <span className="retry-error" title={retryStatus.errorMessage}>{retryStatus.errorMessage.slice(0, 60)}</span>
      </div>
    );
  }

  // 2. 已有内容但静默 >5s → 显示等待计时
  if (hasContent && elapsed >= 5) {
    return (
      <div className="gen-waiting">
        <Spinner size={12} />
        <span>等待响应中… {elapsed}s</span>
      </div>
    );
  }

  // 3. 初始等待（还没有任何内容）
  if (!hasContent) {
    return (
      <div className="typing-indicator">
        <span /><span /><span />
      </div>
    );
  }

  return null;
}

// ── 过程区：统一折叠/展开，显示总用时 + 步骤数 ──
function ProcessSection({ msg, subagents, onOpenSub }: { msg: Message; subagents?: SubagentState[]; onOpenSub?: (subId: string) => void }) {
  const [open, setOpen] = useState(false);
  const tools = msg.tools || [];
  const llmEvents = msg.debugEvents || [];
  const hasInterleaved = tools.some(t => t.precedingThinking?.trim());
  const hasThinking = !!(msg.thinking && msg.thinking.trim()) || hasInterleaved;
  const hasTools = tools.length > 0;
  const hasContent = hasThinking || hasTools;

  // 步骤数：与 DebugTimeline 统一口径 = LLM 调用数 + 工具数
  // （有 debugEvents 时用它；旧消息没有则回退到工具数+思考段）
  const stepCount = llmEvents.length > 0
    ? llmEvents.length + tools.length
    : tools.length + (hasInterleaved ? tools.filter(t => t.precedingThinking?.trim()).length : (msg.thinking && msg.thinking.trim() ? 1 : 0));

  // 总用时：与 DebugTimeline 统一口径 = LLM 耗时 + 工具耗时累加
  // （有 debugEvents/durationMs 时用它；旧消息没有则回退到墙钟跨度）
  const hasAccurateMs = llmEvents.some(e => e.durationMs != null) || tools.some(t => t.durationMs != null);
  const totalMs = hasAccurateMs
    ? llmEvents.reduce((s, e) => s + (e.durationMs ?? 0), 0) + tools.reduce((s, t) => s + (t.durationMs ?? 0), 0)
    : (() => {
        const allStarts: number[] = [], allEnds: number[] = [];
        for (const e of llmEvents) { if (e.startTs) allStarts.push(e.startTs); if (e.endTs) allEnds.push(e.endTs); }
        for (const t of tools) { if (t.startTs) { allStarts.push(t.startTs); if (t.durationMs) allEnds.push(t.startTs + t.durationMs); } }
        const earliest = allStarts.length ? Math.min(...allStarts) : 0;
        const latest = allEnds.length ? Math.max(...allEnds) : 0;
        return msg.isStreaming ? (earliest ? Date.now() - earliest : 0) : (earliest && latest ? latest - earliest : 0);
    })();

  const fmtMs = (ms: number) => ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
  if (!hasContent) return null;

  return (
    <div className={`process-section${open ? " open" : ""}`}>
      <button className="process-header" onClick={() => setOpen(!open)}>
        <Icon name="i-activity" size={13} />
        <span className="process-label">过程</span>
        <span className="process-summary">{stepCount} 步</span>
        {totalMs > 0 && <span className="process-time">{fmtMs(totalMs)}</span>}
        <Icon name="i-chevron" size={12} className={`tl-chevron${open ? "" : " collapsed"}`} />
      </button>
      {open && (
        <div className="process-body">
          {!hasInterleaved && msg.thinking && msg.thinking.trim() && (
            <ThinkingBlock thinking={msg.thinking} streaming={msg.isStreaming} />
          )}
          {tools.map(tool => {
            // read SKILL.md → 渲染为技能加载块
            const skillName = detectSkillRead(tool);
            return (
            <Fragment key={tool.toolCallId}>
              {hasInterleaved && tool.precedingThinking?.trim() && (
                <ThinkingBlock thinking={tool.precedingThinking} />
              )}
              {tool.tool === "delegate_task" ? (
                (() => {
                  const sub = subagents?.[subagents.length - 1];
                  return sub ? (
                    <SubagentBlock tool={tool} sub={sub} onOpen={() => onOpenSub?.(sub.subId)} />
                  ) : (
                    <ToolBlock tool={tool} />
                  );
                })()
              ) : skillName ? (
                <SkillBlock tool={tool} skillName={skillName} />
              ) : (
                <ToolBlock tool={tool} />
              )}
            </Fragment>
            );
          })}
          {hasInterleaved && msg.thinking && msg.thinking.trim() && (
            <ThinkingBlock thinking={msg.thinking} streaming={msg.isStreaming} />
          )}
        </div>
      )}
    </div>
  );
}

// ── 思考过程块：低调样式，默认折叠详情 ──
function ThinkingBlock({ thinking, streaming }: { thinking: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tl-item tl-thinking${open ? " open" : ""}${streaming ? " streaming" : ""}`}>
      <button className="tl-header" onClick={() => setOpen(!open)}>
        <span className="tl-icon"><Icon name="i-lightbulb" size={13} /></span>
        <span className="tl-label">思考过程</span>
        <span className="tl-status">{streaming ? "思考中…" : `${Math.ceil(thinking.length / 4)} tok`}</span>
        <Icon name="i-chevron" size={12} className={`tl-chevron${open ? "" : " collapsed"}`} />
      </button>
      {open && (
        <div className="tl-detail">
          <pre className="tl-text">{thinking}</pre>
        </div>
      )}
    </div>
  );
}

// ── 技能加载块：读 SKILL.md 时渲染为醒目的技能步骤 ──
function SkillBlock({ tool, skillName }: { tool: ToolExecution; skillName: string }) {
  const [open, setOpen] = useState(false);
  const running = tool.status === "running";
  const outputText = tool.output != null ? fmtIO(tool.output, 2000) : "";
  return (
    <div className={`tl-item tl-skill${open ? " open" : ""} tl-${tool.status}`}>
      <button className="tl-header" onClick={() => setOpen(!open)}>
        <span className="tl-icon">{running ? <Spinner size={13} /> : "⚡"}</span>
        <span className="tl-label">加载技能</span>
        <span className="tl-summary">{skillName}</span>
        <span className="tl-status">{running ? "加载中…" : ""}</span>
        <Icon name="i-chevron" size={12} className={`tl-chevron${open ? "" : " collapsed"}`} />
      </button>
      {open && outputText && (
        <div className="tl-detail">
          <div className="tl-section">
            <div className="tl-section-label">SKILL.md</div>
            <pre className="tl-code"><code>{outputText}</code></pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 工具调用块：低调样式，默认折叠详情 ──
function ToolBlock({ tool }: { tool: ToolExecution }) {
  const [open, setOpen] = useState(false);
  const running = tool.status === "running";
  const errored = tool.status === "error";
  const summary = extractToolSummary(tool);
  const inputText = tool.input != null ? fmtIO(tool.input) : "";
  const outputText = tool.output != null ? fmtIO(tool.output, 2000) : "";

  return (
    <div className={`tl-item tl-tool${open ? " open" : ""} tl-${tool.status}`}>
      <button className="tl-header" onClick={() => setOpen(!open)}>
        <span className="tl-icon">
          {running ? "⚙" : errored ? "✕" : "✓"}
        </span>
        <span className="tl-label">{tool.tool}</span>
        <span className="tl-summary" title={summary}>{summary}</span>
        <span className="tl-status">
          {running ? "执行中" : errored ? "出错" : ""}
        </span>
        <Icon name="i-chevron" size={12} className={`tl-chevron${open ? "" : " collapsed"}`} />
      </button>
      {open && (
        <div className="tl-detail">
          {tool.input != null && (
            <div className="tl-section">
              <div className="tl-section-label">input</div>
              <pre className="tl-code"><code>{inputText}</code></pre>
            </div>
          )}
          {tool.output != null && (
            <div className="tl-section">
              <div className="tl-section-label">output</div>
              <pre className="tl-code"><code>{outputText}</code></pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 子 agent 卡片：和工具卡片同款式，但点击可跳转到子 agent 视图 ──
function SubagentBlock({ tool, sub, onOpen }: { tool: ToolExecution; sub: SubagentState; onOpen: () => void }) {
  const running = sub.status === "running";
  const errored = sub.status === "error";
  const summary = sub.goal || extractToolSummary(tool);
  return (
    <div className={`tl-item tl-subagent tl-${sub.status}`}>
      <button className="tl-header tl-clickable" onClick={onOpen}>
        <span className="tl-icon">
          {running ? <Spinner size={13} /> : errored ? <Icon name="i-x" size={13} /> : <Icon name="i-check" size={13} />}
        </span>
        <span className="tl-label">子 Agent</span>
        <span className="tl-summary" title={summary}>{summary}</span>
        <span className="tl-status">
          {running ? (sub.currentTool ? `${sub.currentTool}…` : "思考中…") :
           !running && sub.durationMs ? `${(sub.durationMs / 1000).toFixed(1)}s` : ""}
        </span>
        <span className="tl-enter">详情 →</span>
      </button>
      {!running && sub.summary && (
        <div className="tl-sub-summary">{sub.summary.slice(0, 200)}{sub.summary.length > 200 ? "…" : ""}</div>
      )}
      {errored && sub.error && (
        <div className="tl-sub-error">{sub.error}</div>
      )}
    </div>
  );
}

// ── 命令块（shell）：浅底轻量，无语言标签，仅 Copy ──
function CommandBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div className="cmd-block">
      <pre className="cmd-pre"><code>{value}</code></pre>
      <button type="button" className="cmd-copy" onClick={copy} title="复制">
        <Icon name={copied ? "i-check" : "i-copy"} size={13} />
      </button>
    </div>
  );
}

// ── 代码块 ──
function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  // text/plain 语言（文本流程图、ASCII art 等）跳过 SyntaxHighlighter，
  // 用纯 <pre> 渲染——高亮器会拆分 token 破坏空格对齐，纯文本必须原样保留。
  const isPlainText = language === "text" || language === "plain" || language === "plaintext";

  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{language}</span>
        <button type="button" className="code-copy" onClick={copy}>
          <Icon name={copied ? "i-check" : "i-copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {isPlainText ? (
        <pre className="code-plain">
          <code>{value}</code>
        </pre>
      ) : (
        <CodeHighlight
          language={language}
          content={value}
          customStyle={{ margin: 0, background: "var(--code-bg)" }}
        />
      )}
    </div>
  );
}

// ── helpers ──
function fmtIO(v: unknown, max = 0): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return max && s.length > max ? s.slice(0, max) + "\n…" : s;
}

/** 检测一个工具调用是否在读取 SKILL.md，返回技能名或 undefined */
function detectSkillRead(tool: ToolExecution): string | undefined {
  if (tool.tool !== "read") return undefined;
  const input = tool.input;
  let filePath = "";
  if (typeof input === "string") filePath = input;
  else if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    filePath = String(o.file_path ?? o.path ?? o.filePath ?? o.file ?? "");
  }
  const m = filePath.match(/\/([^/]+)\/SKILL\.md$/i);
  return m ? m[1] : undefined;
}

function extractToolSummary(tool: ToolExecution): string {
  const input = tool.input;
  if (!input || typeof input !== "object") {
    return typeof input === "string" ? truncate(input, 60) : "";
  }
  const o = input as Record<string, unknown>;
  const cmd = pick(o, ["command", "cmd", "script"]);
  const path = pick(o, ["file_path", "path", "filePath", "file", "filename"]);
  const goal = pick(o, ["goal"]);
  const pattern = pick(o, ["pattern", "query", "regex", "q", "search"]);
  if (goal) return truncate(String(goal), 60);
  if (cmd) return truncate(String(cmd), 60);
  if (path) return truncate(String(path), 60);
  if (pattern) return `"${truncate(String(pattern), 40)}"`;
  const firstStr = Object.values(o).find(v => typeof v === "string");
  return firstStr ? truncate(String(firstStr), 60) : "";
}

function pick<T>(o: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    if (o[k] != null && o[k] !== "") return o[k] as T;
  }
  return undefined;
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\n/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

export const MessageItem = memo(MessageItemInner);

// ── 系统通知卡片（上下文压缩等） ──
function SystemNoticeCard({ notice }: { notice: SystemNotice }) {
  const toK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  if (notice.type === "compaction") {
    const reasonMap: Record<string, string> = {
      "approaching_context_window": "上下文窗口即将达上限",
      "context_window_exceeded": "上下文窗口超出限制",
      "user_requested": "用户手动触发",
    };
    const reasonText = notice.reason ? (reasonMap[notice.reason] || notice.reason) : "自动触发";

    return (
      <div className="sys-notice compaction">
        <div className="sys-notice-header">
          <span className="sys-notice-icon">⚡</span>
          <span className="sys-notice-title">上下文压缩</span>
          <span className="sys-notice-reason">{reasonText}</span>
        </div>
        <div className="sys-notice-body">
          {notice.tokensBefore != null && notice.tokensAfter != null && (
            <>
              <span className="sys-notice-tokens before">
                {toK(notice.tokensBefore)}
              </span>
              <span className="sys-notice-arrow">→</span>
              <span className="sys-notice-tokens after">
                {toK(notice.tokensAfter)}
              </span>
              {notice.savedPercent != null && (
                <span className="sys-notice-saved">
                  节省 {notice.savedPercent}%
                </span>
              )}
            </>
          )}
          {notice.aborted && <span className="sys-notice-aborted">已中止</span>}
        </div>
      </div>
    );
  }

  return null;
}

// ── Debug 时间线：按执行顺序展示 agent 回合内每一步做了什么 ──
function DebugTimeline({ msg }: { msg: Message }) {
  const [open, setOpen] = useState(false);
  const llmEvents = msg.debugEvents || [];
  const tools = msg.tools || [];

  if (llmEvents.length === 0 && tools.length === 0) return null;

  const toMs = (ms?: number) => ms != null ? (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`) : "—";
  const toTok = (n?: number) => n != null ? (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)) : "0";

  // 重建统一时间线：LLM 和工具交替（LLM₁ → tool₁ → LLM₂ → tool₂ → … → LLMₙ最终回复）
  const timeline: Array<
    { kind: "llm"; idx: number; evt: DebugLLMEvent; isFinal: boolean; prevBody: string | null } |
    { kind: "tool"; idx: number; tool: ToolExecution }
  > = [];
  {
    let li = 0, ti = 0;
    let prevLlmBody: string | null = null;
    while (li < llmEvents.length || ti < tools.length) {
      if (li < llmEvents.length) {
        const curBody = llmEvents[li].rawRequest?.body ?? null;
        timeline.push({ kind: "llm", idx: li, evt: llmEvents[li], isFinal: li === llmEvents.length - 1 && ti >= tools.length, prevBody: prevLlmBody });
        prevLlmBody = curBody;
        li++;
      }
      if (ti < tools.length) {
        timeline.push({ kind: "tool", idx: ti, tool: tools[ti] });
        ti++;
      }
    }
  }

  // 汇总
  const totalMs = llmEvents.reduce((s, e) => s + (e.durationMs ?? 0), 0)
    + tools.reduce((s, t) => s + (t.durationMs ?? 0), 0);
  const totalInput = llmEvents.reduce((s, e) => s + (e.usage?.input ?? 0), 0);
  const totalOutput = llmEvents.reduce((s, e) => s + (e.usage?.output ?? 0), 0);
  const totalCost = llmEvents.reduce((s, e) => s + (e.usage?.cost?.total ?? 0), 0);

  return (
    <div className={`debug-tl${open ? " open" : ""}`}>
      <button className="debug-tl-header" onClick={() => setOpen(!open)}>
        <span className="debug-tl-icon">🔬</span>
        <span className="debug-tl-label">内部过程</span>
        <span className="debug-tl-summary">
          {timeline.length} 步 · {toMs(totalMs)}
          {totalCost > 0 && ` · $${totalCost.toFixed(4)}`}
        </span>
        <Icon name="i-chevron" size={12} className={`tl-chevron${open ? "" : " collapsed"}`} />
      </button>
      {open && (
        <div className="debug-tl-body">
          {/* 汇总 */}
          <div className="debug-tl-totals">
            <span className="debug-total-item" title="输入 token">↑{toTok(totalInput)}</span>
            <span className="debug-total-item" title="输出 token">↓{toTok(totalOutput)}</span>
            {totalCost > 0 && <span className="debug-total-item" title="费用">${totalCost.toFixed(4)}</span>}
          </div>

          {/* 统一时间线 */}
          <div className="debug-timeline">
            {timeline.map((item, i) => item.kind === "llm" ? (
              <DebugLLMRow key={`tl-${i}`} evt={item.evt} stepNum={i + 1} isFinal={item.isFinal} prevBody={item.prevBody} />
            ) : (
              <DebugToolRow key={`tl-${i}`} tool={item.tool} stepNum={i + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 时间线节点：LLM 调用 ──
const ROLE_META: Record<string, { label: string; icon: string; cls: string }> = {
  system: { label: "系统提示词", icon: "⚙️", cls: "sys" },
  user: { label: "用户消息", icon: "👤", cls: "user" },
  assistant: { label: "助手回复", icon: "🤖", cls: "asst" },
  tool: { label: "工具结果", icon: "🔧", cls: "tool" },
};

function extractMsgContent(msg: any): string {
  if (msg.content != null && typeof msg.content === "string") return msg.content;
  if (msg.tool_calls) {
    return msg.tool_calls.map((tc: any) => {
      const fn = tc.function || {};
      return `${fn.name || "?"}(${fn.arguments || ""})`;
    }).join("\n");
  }
  if (Array.isArray(msg.content)) return JSON.stringify(msg.content, null, 2);
  return JSON.stringify(msg, null, 2);
}

function DebugLLMRow({ evt, stepNum, isFinal, prevBody }: { evt: DebugLLMEvent; stepNum: number; isFinal: boolean; prevBody?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [rawView, setRawView] = useState<null | "delta" | "full" | "response">(null);
  const toMs = (ms?: number) => ms != null ? (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`) : "—";
  const toTok = (n?: number) => n != null ? (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)) : "0";
  const fmtTime = (ts?: number) => ts ? new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, minute: "2-digit", second: "2-digit" }) : "";
  const hasThinking = !!evt.thinking?.trim();
  const hasRaw = !!evt.rawRequest?.url;

  // 美化 JSON body（如果是合法 JSON）
  const fmtJson = (s?: string | null) => {
    if (!s) return "";
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  };

  // 从请求 body 中提取 messages 数组
  const parseMessages = (body?: string | null): any[] => {
    if (!body) return [];
    try { return JSON.parse(body)?.messages || []; } catch { return []; }
  };

  const currMsgs = hasRaw ? parseMessages(evt.rawRequest!.body) : [];
  const prevMsgs = parseMessages(prevBody);

  // 计算 delta：找到与上次请求的公共前缀，公共前缀之后的就是新增内容
  let commonLen = 0;
  for (let i = 0; i < Math.min(prevMsgs.length, currMsgs.length); i++) {
    if (JSON.stringify(prevMsgs[i]) === JSON.stringify(currMsgs[i])) commonLen = i + 1;
    else break;
  }
  const deltaMsgs = currMsgs.slice(commonLen);
  const isFirst = prevMsgs.length === 0;

  return (
    <div className="dbg-step dbg-step-llm">
      <div className="dbg-dot dbg-dot-llm" />
      <div className="dbg-step-content">
        <div className="dbg-step-head">
          <span className="dbg-step-num">#{stepNum}</span>
          <span className="dbg-step-icon">🧠</span>
          <span className="dbg-step-title">{isFinal ? "生成回复" : "思考决策"}</span>
          {evt.model && <span className="dbg-step-tag">{evt.model}</span>}
          {evt.startTs && <span className="dbg-step-time" title={`开始 ${fmtTime(evt.startTs)}${evt.endTs ? ` → 结束 ${fmtTime(evt.endTs)}` : ""}`}>🕐 {fmtTime(evt.startTs)}</span>}
          {hasThinking && <button className="dbg-expand-btn" onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "思考"}</button>}
          {hasRaw && <button className="dbg-expand-btn" onClick={() => setRawView(rawView === null ? "delta" : null)}>{rawView === null ? "提示词增量" : "收起"}</button>}
        </div>
        <div className="dbg-step-detail">
          {!isFinal && <span className="dbg-step-desc">模型分析任务，决定下一步操作</span>}
          {isFinal && <span className="dbg-step-desc">模型生成最终文本回复</span>}
        </div>
        {expanded && hasThinking && (
          <div className="dbg-step-io">
            <div className="dbg-io-section">
              <div className="dbg-io-label">思考过程</div>
              <pre className="dbg-io-code">{evt.thinking}</pre>
            </div>
          </div>
        )}
        {rawView && hasRaw && (
          <div className="dbg-step-io">
            <div className="dbg-raw-tabs">
              <button className={`dbg-raw-tab${rawView === "delta" ? " active" : ""}`} onClick={() => setRawView("delta")}>
                {isFirst ? `初始上下文 (${currMsgs.length})` : `本次新增 (${deltaMsgs.length})`}
              </button>
              <button className={`dbg-raw-tab${rawView === "full" ? " active" : ""}`} onClick={() => setRawView("full")}>完整请求</button>
              {evt.rawResponse?.body && (
                <button className={`dbg-raw-tab${rawView === "response" ? " active" : ""}`} onClick={() => setRawView("response")}>
                  响应{evt.rawResponse.body.includes("截断") ? " · 截断" : ""}
                </button>
              )}
            </div>
            {rawView === "delta" && (
              deltaMsgs.length === 0 ? (
                <div className="dbg-delta-empty">无新增（与上次请求相同）</div>
              ) : (
                <div className="dbg-delta-list">
                  {deltaMsgs.map((m, i) => {
                    const meta = ROLE_META[m.role] || { label: m.role, icon: "📝", cls: "other" };
                    return (
                      <div key={i} className={`dbg-delta-msg role-${meta.cls}`}>
                        <div className="dbg-delta-head">
                          <span className="dbg-delta-icon">{meta.icon}</span>
                          <span className="dbg-delta-role">{meta.label}</span>
                        </div>
                        <pre className="dbg-delta-body">{extractMsgContent(m)}</pre>
                      </div>
                    );
                  })}
                </div>
              )
            )}
            {rawView === "full" && (
              <>
                <div className="dbg-io-section">
                  <div className="dbg-io-label">请求 URL</div>
                  <pre className="dbg-io-code dbg-io-url">{evt.rawRequest!.method} {evt.rawRequest!.url}</pre>
                </div>
                {evt.rawRequest!.body && (
                  <div className="dbg-io-section">
                    <div className="dbg-io-label">请求 Body</div>
                    <pre className="dbg-io-code">{fmtJson(evt.rawRequest!.body)}</pre>
                  </div>
                )}
              </>
            )}
            {rawView === "response" && evt.rawResponse?.body && (
              <div className="dbg-io-section">
                <div className="dbg-io-label">响应 Body（SSE 流汇总）</div>
                <pre className="dbg-io-code">{fmtJson(evt.rawResponse.body)}</pre>
              </div>
            )}
          </div>
        )}
        <div className="dbg-step-metrics">
          {evt.firstTokenMs != null && <span className="dbg-metric" title="首 token 延迟">⏱ 首token {toMs(evt.firstTokenMs)}</span>}
          <span className="dbg-metric" title="本次调用总耗时">⏳ {toMs(evt.durationMs)}</span>
          {evt.usage && (
            <>
              <span className="dbg-metric dbg-metric-tok" title="Token 用量">
                ↑{toTok(evt.usage.input)} ↓{toTok(evt.usage.output)}
              </span>
              {evt.usage.cacheRead > 0 && <span className="dbg-metric" title="缓存命中">🗄 {toTok(evt.usage.cacheRead)}</span>}
              {evt.usage.reasoning != null && evt.usage.reasoning > 0 && <span className="dbg-metric" title="思考 token">💭 {toTok(evt.usage.reasoning)}</span>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 时间线节点：工具调用 ──
function DebugToolRow({ tool, stepNum }: { tool: ToolExecution; stepNum: number }) {
  const [expanded, setExpanded] = useState(false);
  const toMs = (ms?: number) => ms != null ? (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`) : "—";
  const fmtTime = (ts?: number) => ts ? new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, minute: "2-digit", second: "2-digit" }) : "";
  const summary = extractToolSummary(tool);
  const inputText = tool.input != null ? fmtIO(tool.input) : "";
  const outputText = tool.output != null ? fmtIO(tool.output, 3000) : "";

  return (
    <div className={`dbg-step dbg-step-tool${tool.isError ? " errored" : ""}`}>
      <div className={`dbg-dot ${tool.isError ? "dbg-dot-err" : "dbg-dot-tool"}`} />
      <div className="dbg-step-content">
        <div className="dbg-step-head">
          <span className="dbg-step-num">#{stepNum}</span>
          <span className="dbg-step-icon">{tool.isError ? "❌" : "⚡"}</span>
          <span className="dbg-step-title">{tool.tool}</span>
          {summary && <span className="dbg-step-summary" title={summary}>{summary}</span>}
          {tool.startTs && <span className="dbg-step-time" title={`执行时间 ${fmtTime(tool.startTs)}`}>🕐 {fmtTime(tool.startTs)}</span>}
          <span className="dbg-metric" title="执行耗时">⏳ {toMs(tool.durationMs)}</span>
          <button className="dbg-expand-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起" : "详情"}
          </button>
        </div>
        {expanded && (
          <div className="dbg-step-io">
            {inputText && (
              <div className="dbg-io-section">
                <div className="dbg-io-label">输入</div>
                <pre className="dbg-io-code">{inputText}</pre>
              </div>
            )}
            {outputText && (
              <div className="dbg-io-section">
                <div className="dbg-io-label">{tool.isError ? "错误" : "输出"}</div>
                <pre className="dbg-io-code">{outputText}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
