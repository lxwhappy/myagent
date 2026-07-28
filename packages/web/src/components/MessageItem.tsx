// components/MessageItem.tsx — 时间线风格消息渲染
// 设计原则：过程（思考/工具/子agent）和正文在同一条流里按顺序排列，
// 过程用低调样式（小字、浅色、可折叠），正文正常渲染。
// 主会话和子 agent 视图共用同一套渲染，样式完全一致。

import { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Message, ToolExecution, SubagentState } from "../stores/chat";
import { MermaidBlock } from "./MermaidBlock";
import { ErrorBoundary } from "./ErrorBoundary";
import { getMessageStats } from "../utils/sessionStats";
import { TaskSummaryCard } from "./TaskSummaryCard";
import { Icon } from "./Icon";

function MessageItemInner({ msg, subagents, onOpenSub }: { msg: Message; subagents?: SubagentState[]; onOpenSub?: (subId: string) => void }) {
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

        {/* ── 时间线：按发生顺序渲染过程 + 正文 ── */}
        {/* 1. 思考过程（如果有） */}
        {msg.thinking && msg.thinking.trim() && (
          <ThinkingBlock thinking={msg.thinking} streaming={msg.isStreaming} />
        )}

        {/* 2. 工具调用（逐个按顺序显示，delegate_task 特殊渲染为子 agent 卡片） */}
        {msg.tools?.map(tool => {
          if (tool.tool === "delegate_task") {
            // delegate_task：找对应的子 agent 数据，渲染成可跳转卡片
            const sub = subagents?.[subagents.length - 1]; // 最新一个子 agent
            return sub ? (
              <SubagentBlock key={tool.toolCallId} tool={tool} sub={sub} onOpen={() => onOpenSub?.(sub.subId)} />
            ) : (
              <ToolBlock key={tool.toolCallId} tool={tool} />
            );
          }
          return <ToolBlock key={tool.toolCallId} tool={tool} />;
        })}

        {/* 3. 等待指示器（流式开始但还没有任何内容） */}
        {msg.isStreaming && !msg.content && !(msg.thinking && msg.thinking.trim()) && !(msg.tools && msg.tools.length) && (
          <div className="typing-indicator">
            <span /><span /><span />
          </div>
        )}

        {/* 4. 正文（Markdown 渲染） */}
        {msg.content && (
          <div className="msg-content">
            {msg.isStreaming ? (
              <>
                <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                <span className="stream-cursor" />
              </>
            ) : (
              <ErrorBoundary fallback={<div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre: ({ children }) => <>{children}</>,
                    code({ node, className, children, ...props }: any) {
                      const match = /language-(\w+)/.exec(className || "");
                      const lang = match?.[1];
                      const raw = String(children).replace(/\n$/, "");
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
                      if (match) return <CodeBlock language={lang!} value={raw} />;
                      if (raw.includes("\n")) return <CodeBlock language="text" value={raw} />;
                      return <code className={className} {...props}>{children}</code>;
                    },
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </ErrorBoundary>
            )}
          </div>
        )}

        {/* 任务摘要卡 */}
        {stats && !msg.isStreaming && (
          <TaskSummaryCard stats={stats} />
        )}
      </div>
    </div>
  );
}

// ── 思考过程块：低调样式，默认折叠详情 ──
function ThinkingBlock({ thinking, streaming }: { thinking: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tl-item tl-thinking${open ? " open" : ""}${streaming ? " streaming" : ""}`}>
      <button className="tl-header" onClick={() => setOpen(!open)}>
        <span className="tl-icon">{streaming ? "💭" : "💭"}</span>
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
          {running ? "🤖" : errored ? "✕" : "✓"}
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
  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{language}</span>
        <button type="button" className="code-copy" onClick={copy}>
          <Icon name={copied ? "i-check" : "i-copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        PreTag="div"
        customStyle={{ margin: 0, background: "var(--code-bg)" }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

// ── helpers ──
function fmtIO(v: unknown, max = 0): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return max && s.length > max ? s.slice(0, max) + "\n…" : s;
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
