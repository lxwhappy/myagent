// components/ChatPanel.tsx — 消息列表 + 空状态 (PiAgent Design System)
// chat-head 和 ModelTokenBar 已移到 App.tsx，此组件只负责 .messages 容器

import { useEffect, useRef, useState } from "react";
import { useChat } from "../hooks/useChat";
import { useChatStore } from "../stores/chat";
import { MessageItem } from "./MessageItem";
import { Icon } from "./Icon";
import { TodoPanel } from "./TodoPanel";
import { SubagentPanel } from "./SubagentPanel";

const SUGGESTIONS: Array<{ text: string; icon: string }> = [
  { text: "帮我看看当前目录有什么文件", icon: "i-folder" },
  { text: "查一下北京天气", icon: "i-globe" },
  { text: "现在几点了？", icon: "i-clock" },
  { text: "用终端运行一个命令", icon: "i-terminal" },
];

export function ChatPanel() {
  const { messages, connected, skills, skillsNotified: storeNotified, activeSkill, sendMessage } = useChat();
  // 子 agent 钻入视图
  const activeSubId = useChatStore(s => s.activeSubId);
  const setActiveSub = useChatStore(s => s.setActiveSub);
  const sid = useChatStore(s => s.activeChatSessionId);
  const activeSub = useChatStore(s => {
    if (!activeSubId || !sid) return undefined;
    return s.sessions[sid]?.subagents.find(sa => sa.subId === activeSubId);
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const [dismissedSkills, setDismissedSkills] = useState(false);

  // 主会话消息变化时滚动
  useEffect(() => {
    if (activeSubId) return; // 子 agent 视图有自己的滚动
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeSubId]);

  // 子 agent 消息变化时滚动
  const subMessages = activeSub?.messages;
  useEffect(() => {
    if (!activeSubId) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [subMessages, activeSubId]);

  const showSkills = skills.length > 0 && !dismissedSkills && !storeNotified;

  // ── 子 agent 钻入视图 ──
  if (activeSubId && activeSub) {
    const subMsgs = activeSub.messages || [];
    return (
      <div className="chat-panel-inner subagent-view">
        <div className="subagent-view-bar">
          <button className="subagent-back-btn" onClick={() => setActiveSub(null)}>
            <span className="subagent-back-arrow">←</span> 返回主会话
          </button>
          <div className="subagent-view-title">
            <span className="subagent-view-icon">
              {activeSub.status === "running" ? "🔄" : activeSub.status === "done" ? "✅" : "❌"}
            </span>
            <span className="subagent-view-goal">{activeSub.goal}</span>
          </div>
          <div className="subagent-view-status">
            {activeSub.status === "running" ? "执行中…" : activeSub.status === "done" ? "已完成" : "出错"}
          </div>
        </div>
        <div className="messages">
          {subMsgs.length === 0 && (
            <div className="empty-state" style={{ minHeight: 120 }}>
              <p style={{ color: "var(--muted)" }}>
                {activeSub.status === "running" ? "子 agent 正在启动…" : "暂无执行记录"}
              </p>
            </div>
          )}
          {subMsgs.map(msg => (
            <MessageItem key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    );
  }

  // ── 主会话视图（原有逻辑）──
  return (
    <div className="chat-panel-inner">
      {/* TODO 任务清单 — 固定在消息区上方，始终可见 */}
      <TodoPanel />

      <div className="messages">
        {/* Skills 加载通知 */}
      {showSkills && (
        <div className="msg-notice-wrap">
          <div className="skill-item" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="skill-icon"><Icon name="i-zap" size={18} /></div>
            <div className="skill-info">
              <div className="skill-name">{skills.length} 个 Skills 已加载</div>
              <div className="skill-desc">
                {skills.slice(0, 5).map(s => s.name).join(" · ")}
                {skills.length > 5 ? ` +${skills.length - 5}` : ""}
              </div>
            </div>
            <button className="icon-btn" onClick={() => setDismissedSkills(true)} aria-label="关闭通知" style={{ width: 28, height: 28 }}>
              <Icon name="i-x" size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Skill 实时使用通知 */}
      {activeSkill && (
        <div className="msg-notice-wrap">
          <div className="skill-item">
            <div className="skill-icon"><Icon name="i-zap" size={18} /></div>
            <div className="skill-info">
              <div className="skill-name">正在加载 Skill: {activeSkill.name}</div>
            </div>
          </div>
        </div>
      )}

      {/* 空状态 */}
      {messages.length === 0 && !showSkills && (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="i-bot" size={32} /></div>
          <h2>你好，有什么可以帮你的？</h2>
          <p>{connected ? "试试这些开始对话" : "正在连接…"}</p>
          <div className="suggestions">
            {SUGGESTIONS.map(s => (
              <button key={s.text} className="suggestion-card" onClick={() => sendMessage(s.text)} type="button">
                <div className="suggestion-icon"><Icon name={s.icon} size={16} /></div>
                <div className="suggestion-text">{s.text}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 消息列表 */}
      {messages.map(msg => (
        <MessageItem key={msg.id} msg={msg} />
      ))}

      {/* 子 agent 实时状态（delegate_task 委派的子任务）*/}
      <SubagentPanel />

      <div ref={bottomRef} />
      </div>
    </div>
  );
}
