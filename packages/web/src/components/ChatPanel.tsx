// components/ChatPanel.tsx — 消息列表 + 空状态 (PiAgent Design System)
// chat-head 和 ModelTokenBar 已移到 App.tsx，此组件只负责 .messages 容器

import { useEffect, useRef, useState } from "react";
import { useChat } from "../hooks/useChat";
import { MessageItem } from "./MessageItem";
import { Icon } from "./Icon";
import { TodoPanel } from "./TodoPanel";

const SUGGESTIONS: Array<{ text: string; icon: string }> = [
  { text: "帮我看看当前目录有什么文件", icon: "i-folder" },
  { text: "查一下北京天气", icon: "i-globe" },
  { text: "现在几点了？", icon: "i-clock" },
  { text: "用终端运行一个命令", icon: "i-terminal" },
];

export function ChatPanel() {
  const { messages, connected, skills, skillsNotified: storeNotified, activeSkill, sendMessage } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [dismissedSkills, setDismissedSkills] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const showSkills = skills.length > 0 && !dismissedSkills && !storeNotified;

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
      <div ref={bottomRef} />
      </div>
    </div>
  );
}
