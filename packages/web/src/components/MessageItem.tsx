// components/MessageItem.tsx — Codex IDE 风格：无边框行内工具摘要

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Message, ToolExecution, SkillUsage } from "../stores/chat";
import { MermaidBlock } from "./MermaidBlock";
import { getMessageStats } from "../utils/sessionStats";
import { TaskSummaryCard } from "./TaskSummaryCard";

export function MessageItem({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const stats = !isUser && msg.tools && msg.tools.length > 0 ? getMessageStats(msg) : null;

  if (isUser) {
    return (
      <div className="msg msg-user">
        <div className="msg-user-body">{msg.content}</div>
      </div>
    );
  }

  return (
    <div className="msg msg-assistant">
      {/* 思考过程 — 无边框可展开行 */}
      {msg.thinking && msg.thinking.trim() && (
        <ThinkingRow thinking={msg.thinking} streaming={msg.isStreaming} />
      )}

      {/* Skill 加载 — 每个一行，闪电图标 */}
      {msg.skillsUsed && msg.skillsUsed.length > 0 && (
        <div className="msg-skills">
          {msg.skillsUsed.map(sk => (
            <SkillRow key={sk.name} skill={sk} streaming={msg.isStreaming} />
          ))}
        </div>
      )}

      {/* 工具调用 — 每个一行，无边框 */}
      {msg.tools && msg.tools.length > 0 && (
        <div className="msg-tools">
          {msg.tools.map(t => (
            <ToolRow key={t.toolCallId} tool={t} />
          ))}
        </div>
      )}

      {/* 等待指示器：流式开始但还没有任何内容（首字符延迟期间） */}
      {msg.isStreaming && !msg.content && !(msg.thinking && msg.thinking.trim()) && !(msg.tools && msg.tools.length) && (
        <div className="msg-thinking-dots">
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          <span className="thinking-dot" />
        </div>
      )}

      {/* 消息正文 */}
      <div className="msg-body">
        <ReactMarkdown
          components={{
            code({ node, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || "");
              const lang = match?.[1];
              if (lang === "mermaid") {
                return <MermaidBlock chart={String(children).replace(/\n$/, "")} />;
              }
              if (match) {
                return (
                  <SyntaxHighlighter style={oneDark} language={lang} PreTag="div">
                    {String(children).replace(/\n$/, "")}
                  </SyntaxHighlighter>
                );
              }
              return <code className={className} {...props}>{children}</code>;
            },
          }}
        >
          {msg.content || ""}
        </ReactMarkdown>
        {msg.isStreaming && <span className="stream-cursor" />}
      </div>

      {/* 任务摘要卡 — 仅在有工具调用且流结束后显示 */}
      {stats && !msg.isStreaming && (
        <TaskSummaryCard stats={stats} />
      )}
    </div>
  );
}

// ── 工具行：图标 + 动词摘要，点击展开看详情（无边框）──
function ToolRow({ tool }: { tool: ToolExecution }) {
  const [open, setOpen] = useState(false);
  const summary = extractToolSummary(tool);
  const running = tool.status === "running";
  const errored = tool.status === "error";

  return (
    <div className={`tool-row${running ? " tool-running" : ""}${errored ? " tool-error" : ""}`}>
      <button className="tool-row-head" onClick={() => setOpen(!open)}>
        <span className="tool-ico">
          {running ? (
            <svg className="ico-spinner" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" opacity="0.25" />
              <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          ) : errored ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className="tool-summary-text">
          <span className="tool-verb-text">{verbForTool(tool.tool)}</span>
          {summary && <span className="tool-arg"> {summary}</span>}
        </span>
        {open && <span className="tool-exp">▾</span>}
      </button>
      {open && (
        <div className="tool-row-body">
          {tool.input != null && (
            <div className="tool-io-block">
              <div className="tool-io-label">input</div>
              <pre className="tool-io">{fmtIO(tool.input)}</pre>
            </div>
          )}
          {tool.output != null && (
            <div className="tool-io-block">
              <div className="tool-io-label">output</div>
              <pre className="tool-io">{fmtIO(tool.output, 2000)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 思考行：SVG spinner + "thinking"，点击展开 ──
function ThinkingRow({ thinking, streaming }: { thinking: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-row tool-thinking">
      <button className="tool-row-head" onClick={() => setOpen(!open)}>
        <span className="tool-ico">
          {streaming ? (
            <svg className="ico-spinner" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" opacity="0.25" />
              <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className="tool-summary-text">
          <span className="tool-verb-text">thinking</span>
        </span>
        {open && <span className="tool-exp">▾</span>}
      </button>
      {open && <pre className="tool-row-thinking-body">{thinking}</pre>}
    </div>
  );
}

// ── Skill 加载行：闪电图标 + skill 名称 ──
function SkillRow({ skill, streaming }: { skill: SkillUsage; streaming?: boolean }) {
  return (
    <div className="skill-row">
      <span className="skill-row-ico">
        {streaming ? (
          <svg className="ico-spinner" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" opacity="0.25" />
            <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M7 1L3 7H6L5 11L9 5H6L7 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15" />
          </svg>
        )}
      </span>
      <span className="skill-row-text">
        加载 Skill <strong>{skill.name}</strong>
      </span>
      {!streaming && (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ color: "var(--success)" }}>
          <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
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
  if (n.includes("bash") || n.includes("exec") || n.includes("terminal") || n.includes("shell") || n.includes("run")) return "ran";
  if (n.includes("read") || n.includes("get") || n.includes("cat") || n.includes("view")) return "read";
  if (n.includes("write") || n.includes("edit") || n.includes("patch") || n.includes("create")) return "edited";
  if (n.includes("search") || n.includes("grep") || n.includes("find") || n.includes("glob")) return "searched";
  if (n.startsWith("mcp__")) return "called";
  return "used";
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
