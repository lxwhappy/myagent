// components/MessageItem.tsx — PiAgent Design System 风格消息渲染

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Message, ToolExecution, SkillUsage } from "../stores/chat";
import { MermaidBlock } from "./MermaidBlock";
import { ErrorBoundary } from "./ErrorBoundary";
import { getMessageStats } from "../utils/sessionStats";
import { TaskSummaryCard } from "./TaskSummaryCard";
import { Icon } from "./Icon";

export function MessageItem({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const stats = !isUser && msg.tools && msg.tools.length > 0 ? getMessageStats(msg) : null;

  if (isUser) {
    return (
      <div className="msg msg-user">
        <div className="msg-body">
          <div className="msg-content" style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar">
        <Icon name="i-bot" size={18} />
      </div>
      <div className="msg-body">
        <div className="msg-author">MyAgent</div>

        {/* 思考过程 — 可展开卡片 */}
        {msg.thinking && msg.thinking.trim() && (
          <ThinkingCard thinking={msg.thinking} streaming={msg.isStreaming} />
        )}

        {/* Skill 加载 */}
        {msg.skillsUsed && msg.skillsUsed.length > 0 && (
          <>
            {msg.skillsUsed.map(sk => (
              <SkillItem key={sk.name} skill={sk} streaming={msg.isStreaming} />
            ))}
          </>
        )}

        {/* 工具调用 */}
        {msg.tools && msg.tools.length > 0 && (
          <>
            {msg.tools.map(t => (
              <ToolCallCard key={t.toolCallId} tool={t} />
            ))}
          </>
        )}

        {/* 等待指示器：流式开始但还没有任何内容（首字符延迟期间） */}
        {msg.isStreaming && !msg.content && !(msg.thinking && msg.thinking.trim()) && !(msg.tools && msg.tools.length) && (
          <div className="typing-indicator">
            <span />
            <span />
            <span />
          </div>
        )}

        {/* 消息正文 */}
        {msg.content && (
          <div className="msg-content">
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
                  // 有语言标签 → 带高亮的代码块
                  if (match) {
                    return <CodeBlock language={lang!} value={raw} />;
                  }
                  // 无语言标签但含换行 → 纯文本代码块（不用深色背景）
                  if (raw.includes("\n")) {
                    return <CodeBlock language="text" value={raw} />;
                  }
                  // 单行 → 行内 code
                  return <code className={className} {...props}>{children}</code>;
                },
              }}
            >
              {msg.content}
            </ReactMarkdown>
            </ErrorBoundary>
            {msg.isStreaming && <span className="stream-cursor" />}
          </div>
        )}

        {/* 任务摘要卡 — 仅在有工具调用且流结束后显示 */}
        {stats && !msg.isStreaming && (
          <TaskSummaryCard stats={stats} />
        )}
      </div>
    </div>
  );
}

// ── 代码块：DS .code-block + .code-header + 复制按钮 ──
function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
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

// ── 通用复制按钮 ──
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button type="button" className="tool-copy-btn" onClick={copy} title="复制">
      <Icon name={copied ? "i-check" : "i-copy"} size={12} />
      {label && <span>{copied ? "已复制" : label}</span>}
    </button>
  );
}

// ── 工具调用卡片：DS .tool-call / .tool-call-header / .tool-call-body ──
function ToolCallCard({ tool }: { tool: ToolExecution }) {
  const [open, setOpen] = useState(false);
  const summary = extractToolSummary(tool);
  const running = tool.status === "running";
  const errored = tool.status === "error";
  const verb = verbForTool(tool.tool);

  const statusClass = errored ? "error" : running ? "running" : "done";
  const statusText = errored ? "出错" : running ? "执行中" : "完成";
  const iconName = running ? "i-tool" : errored ? "i-x" : "i-check";

  const inputText = tool.input != null ? fmtIO(tool.input) : "";
  const outputText = tool.output != null ? fmtIO(tool.output, 2000) : "";

  return (
    <div className={`tool-call${open ? " expanded" : ""}`}>
      <button type="button" className="tool-call-header" onClick={() => setOpen(!open)}>
        <span className="tool-icon-box">
          <Icon name="i-tool" size={14} />
        </span>
        <span className="tool-label">{tool.tool}</span>
        <span className="tool-spacer" />
        <span className={`tool-status-pill ${statusClass}`}>{statusText}</span>
        <Icon name="i-chevron" size={14} className="tool-chevron" />
      </button>
      <div className="tool-call-body">
        <div className="tool-section">
          {tool.input != null && (
            <>
              <div className="tool-section-label">
                input
                <CopyButton text={inputText} />
              </div>
              <pre className="tool-code"><code>{inputText}</code></pre>
            </>
          )}
          {tool.output != null && (
            <>
              <div className="tool-section-label">
                output
                <CopyButton text={outputText} />
              </div>
              <pre className="tool-code"><code>{outputText}</code></pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 思考卡片：复用 .tool-call 结构 ──
function ThinkingCard({ thinking, streaming }: { thinking: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool-call${open ? " expanded" : ""}`}>
      <button type="button" className="tool-call-header" onClick={() => setOpen(!open)}>
        <span className="tool-icon-box">
          <Icon name="i-tool" size={14} />
        </span>
        <span className="tool-name">思考过程</span>
        <span className="tool-spacer" />
        <span className={`tool-status-pill ${streaming ? "running" : "done"}`}>
          {streaming ? "思考中" : "完成"}
        </span>
        <Icon name="i-chevron" size={14} className="tool-chevron" />
      </button>
      <div className="tool-call-body">
        <div className="tool-section">
          <div className="tool-section-label">
            内容
            <CopyButton text={thinking} />
          </div>
          <pre className="tool-code"><code>{thinking}</code></pre>
        </div>
      </div>
    </div>
  );
}

// ── Skill 加载项：DS .skill-item ──
function SkillItem({ skill, streaming }: { skill: SkillUsage; streaming?: boolean }) {
  return (
    <div className="skill-item">
      <div className="skill-icon">
        <Icon name={streaming ? "i-zap" : "i-check"} size={18} />
      </div>
      <div className="skill-info">
        <div className="skill-name">{skill.name}</div>
        <div className="skill-desc">{streaming ? "加载中…" : "已加载"}</div>
      </div>
    </div>
  );
}

// ── helpers ──

function fmtIO(v: unknown, max = 0): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return max && s.length > max ? s.slice(0, max) + "\n…" : s;
}

function verbForTool(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("bash") || n.includes("exec") || n.includes("terminal") || n.includes("shell") || n.includes("run")) return "已执行";
  if (n.includes("read") || n.includes("get") || n.includes("cat") || n.includes("view")) return "已读取";
  if (n.includes("write") || n.includes("edit") || n.includes("patch") || n.includes("create")) return "已编辑";
  if (n.includes("search") || n.includes("grep") || n.includes("find") || n.includes("glob")) return "已搜索";
  if (n.startsWith("mcp__")) return "已调用";
  return "已使用";
}

function extractToolSummary(tool: ToolExecution): string {
  const input = tool.input;
  if (!input || typeof input !== "object") {
    return typeof input === "string" ? truncate(input, 80) : tool.tool;
  }
  const o = input as Record<string, unknown>;
  const cmd = pick(o, ["command", "cmd", "script"]);
  const path = pick(o, ["file_path", "path", "filePath", "file", "filename"]);
  const pattern = pick(o, ["pattern", "query", "regex", "q", "search"]);
  const url = pick(o, ["url", "uri", "endpoint"]);

  if (cmd) return truncate(String(cmd), 100);
  if (path) return truncate(String(path), 80);
  if (pattern) return `"${truncate(String(pattern), 60)}"`;
  if (url) return truncate(String(url), 80);
  const firstStr = Object.values(o).find(v => typeof v === "string");
  return firstStr ? truncate(String(firstStr), 60) : tool.tool;
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
