// components/ChatPanel.tsx — 多会话 + thinking + skills 通知 (Codex 风格精简 header)

import { useEffect, useRef, useState } from "react";
import { useChat } from "../hooks/useChat";
import { useWorkspaceStore } from "../stores/workspace";
import { MessageItem } from "./MessageItem";

export function ChatPanel() {
  const { messages, connected, skills, skillsNotified: storeNotified, modelInfo, usage } = useChat();
  const wsStore = useWorkspaceStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [dismissedSkills, setDismissedSkills] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const activeWs = wsStore.workspaces.find(w => w.id === wsStore.activeId);
  const showSkills = skills.length > 0 && !dismissedSkills && !storeNotified;

  const handleExport = () => {
    if (messages.length === 0) return;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    // 查找当前会话标题
    let title = "未命名会话";
    if (wsStore.activeSessionId) {
      for (const wsId of Object.keys(wsStore.sessionsByWs)) {
        const sess = wsStore.sessionsByWs[wsId].find(s => s.id === wsStore.activeSessionId);
        if (sess) { title = sess.title || title; break; }
      }
    }

    const lines: string[] = [];
    lines.push("# MyAgent 对话记录");
    lines.push(`日期: ${dateStr}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    for (const msg of messages) {
      if (msg.role === "user") {
        lines.push("## 🧑 用户");
        lines.push(msg.content || "");
        lines.push("");
        continue;
      }

      lines.push("## 🤖 Assistant");

      // 思考过程
      if (msg.thinking && msg.thinking.trim()) {
        lines.push("");
        lines.push("> 💭 思考过程:");
        for (const tl of msg.thinking.split("\n")) lines.push(`> ${tl}`);
      }

      // 回复正文
      if (msg.content && msg.content.trim()) {
        lines.push("");
        lines.push(msg.content);
      }

      // 工具调用
      if (msg.tools && msg.tools.length > 0) {
        for (const t of msg.tools) {
          lines.push("");
          lines.push(`🔧 工具: ${t.tool}`);
          if (t.input != null) {
            const inputStr = typeof t.input === "string" ? t.input : JSON.stringify(t.input, null, 2);
            lines.push("输入:");
            lines.push("```");
            inputStr.split("\n").forEach(l => lines.push(l));
            lines.push("```");
          }
          if (t.output != null) {
            const outputStr = typeof t.output === "string" ? t.output : JSON.stringify(t.output, null, 2);
            lines.push("输出:");
            lines.push("```");
            outputStr.split("\n").forEach(l => lines.push(l));
            lines.push("```");
          }
        }
      }

      lines.push("");
    }

    const md = lines.join("\n");
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名会话";
    const filename = `myagent-${safeTitle}-${dateStr}.md`;

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-header-left">
          {/* 连接状态：仅一个小圆点，无文字 */}
          <div className="status" title={connected ? "已连接" : "连接中..."}>
            <span className={`dot ${connected ? "dot-on" : "dot-off"}`} />
          </div>
          {/* 工作空间徽标；无工作空间时显示文字 logo */}
          {activeWs ? (
            <span className="ws-badge">{activeWs.name}</span>
          ) : (
            <span className="chat-logo">MyAgent</span>
          )}
        </div>
        <div className="chat-header-right">
          {/* 模型名徽标（如果有 modelInfo） */}
          {modelInfo && (
            <span className="ws-badge" title={`${modelInfo.provider}/${modelInfo.model}`}>
              {modelInfo.name}
            </span>
          )}
          {activeWs && (
            <>
              <button
                className="panel-toggle-btn"
                onClick={handleExport}
                disabled={messages.length === 0}
                title="导出对话为 Markdown"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="3" y1="13" x2="13" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
              <button
                className={`panel-toggle-btn ${wsStore.drawerOpen ? "active" : ""}`}
                onClick={() => wsStore.toggleDrawer()}
                title={wsStore.drawerOpen ? "收起面板" : "展开面板"}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <line x1="11" y1="3" x2="11" y2="13" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 模型 + Token 用量细状态栏：紧贴 header 下方 */}
      <ModelTokenBar modelInfo={modelInfo} usage={usage} />

      <div className="chat-messages" style={{ padding: "16px", gap: "10px" }}>
        {/* Skills 加载通知 */}
        {showSkills && (
          <div className="skills-notice">
            <div className="skills-notice-content">
              <span className="skills-notice-icon">✨</span>
              <div className="skills-notice-text">
                <strong>{skills.length} 个 Skills 已加载</strong>
                <div className="skills-notice-list">
                  {skills.slice(0, 5).map(s => (
                    <span key={s.name} className="skill-chip">{s.name}</span>
                  ))}
                  {skills.length > 5 && <span className="skill-chip">+{skills.length - 5}</span>}
                </div>
              </div>
              <button className="skills-dismiss" onClick={() => setDismissedSkills(true)}>✕</button>
            </div>
          </div>
        )}

        {messages.length === 0 && !showSkills && (
          <div className="chat-empty">
            <p>你好，有什么可以帮你的？</p>
            <p>试试这些：</p>
            <ul>
              <li>帮我看看当前目录有什么文件</li>
              <li>查一下北京天气</li>
              <li>现在几点了？</li>
            </ul>
          </div>
        )}
        {messages.map(msg => (
          <MessageItem key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── 模型 + Token 用量细状态栏（模型名已移至 header 右侧，此处仅保留 token 用量）──
function ModelTokenBar({ modelInfo, usage }: {
  modelInfo: { provider: string; model: string; name: string; contextWindow: number } | null;
  usage: {
    stats: { tokens: { input: number; output: number; total: number }; cost: number; toolCalls: number } | null;
    context: { tokens: number | null; contextWindow: number; percent: number | null } | null;
  } | null;
}) {
  if (!usage) return null;

  const ctx = usage.context;
  const ctxPercent = ctx?.percent ?? 0;
  const ctxTokens = ctx?.tokens;
  const ctxWindow = ctx?.contextWindow ?? modelInfo?.contextWindow ?? 0;
  const barClass = ctxPercent >= 80 ? "high" : ctxPercent >= 50 ? "mid" : "low";

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  return (
    <div className="model-token-bar">
      {usage.stats && (
        <div className="token-info">
          <span className="token-stats">
            输入 <strong>{fmt(usage.stats.tokens.input)}</strong> · 输出 <strong>{fmt(usage.stats.tokens.output)}</strong>
          </span>
          {ctxWindow > 0 && (
            <>
              <div className="token-bar-container" title={`上下文 ${ctxTokens ? fmt(ctxTokens) : "?"} / ${fmt(ctxWindow)} tokens`}>
                <div className={`token-bar-fill ${barClass}`} style={{ width: `${Math.min(ctxPercent, 100)}%` }} />
              </div>
              <span className="token-stats">
                {ctxTokens != null ? `${fmt(ctxTokens)}` : "?"} / {fmt(ctxWindow)} ({ctxPercent.toFixed(1)}%)
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
