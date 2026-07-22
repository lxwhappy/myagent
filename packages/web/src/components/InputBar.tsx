// components/InputBar.tsx — 输入框 + 历史导航(↑↓) + 斜线 Skills 选择器

import { useRef, useState, useEffect, useMemo, type KeyboardEvent } from "react";
import { useChat } from "../hooks/useChat";
import { useChatStore, type SkillInfo } from "../stores/chat";

const MAX_HEIGHT = 200;
const HISTORY_KEY = "myagent_input_history";
const MAX_HISTORY = 50;

// ── 输入历史管理（localStorage 持久化）──
function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(items: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch {}
}

function addToHistory(text: string) {
  const items = loadHistory();
  // 去重：如果最后一条相同就不加
  if (items[0] === text) return;
  // 移除已有的相同条目
  const filtered = items.filter(t => t !== text);
  filtered.unshift(text);
  const trimmed = filtered.slice(0, MAX_HISTORY);
  saveHistory(trimmed);
}

export function InputBar() {
  const { sendMessage, abort, isGenerating, connected, skills } = useChat();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // ── 历史导航状态 ──
  const historyRef = useRef<string[]>(loadHistory());
  const histIndexRef = useRef<number>(-1); // -1 = 不在浏览历史模式
  const draftRef = useRef<string>(""); // 浏览历史前的草稿

  // ── Skills 选择器状态 ──
  const [skillPicker, setSkillPicker] = useState<{
    visible: boolean;
    query: string;     // / 后面的搜索词
    startIndex: number; // / 在文本中的位置
    activeIndex: number; // 高亮项
  }>({ visible: false, query: "", startIndex: 0, activeIndex: 0 });

  const handleSend = () => {
    if (!text.trim() || isGenerating) return;
    addToHistory(text.trim());
    historyRef.current = loadHistory();
    histIndexRef.current = -1;
    sendMessage(text);
    setText("");
    setSkillPicker({ visible: false, query: "", startIndex: 0, activeIndex: 0 });
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${next}px`;
  };

  // ── Skills 筛选 ──
  const filteredSkills = useMemo(() => {
    if (!skillPicker.visible) return [];
    const q = skillPicker.query.toLowerCase();
    const all = skills as SkillInfo[];
    if (!all) return [];
    const matched = q
      ? all.filter(s => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
      : all;
    return matched.slice(0, 8); // 最多显示 8 个
  }, [skillPicker.visible, skillPicker.query, skills]);

  // ── 检测 / 触发 skills 选择器 ──
  const checkSlashTrigger = (value: string, cursorPos: number) => {
    // 找到 cursor 前面最近的 / 且 / 前面是行首或空格
    const before = value.slice(0, cursorPos);
    const slashMatch = before.match(/(?:^|\s)\/(\S*)$/);
    if (slashMatch) {
      const slashIndex = before.lastIndexOf("/"); // 精确找到那个 /
      setSkillPicker({
        visible: true,
        query: slashMatch[1],
        startIndex: slashIndex,
        activeIndex: 0,
      });
    } else {
      if (skillPicker.visible) setSkillPicker(prev => ({ ...prev, visible: false }));
    }
  };

  // ── 插入选中的 skill ──
  const insertSkill = (skill: SkillInfo) => {
    const before = text.slice(0, skillPicker.startIndex);
    const after = text.slice(skillPicker.startIndex + 1 + skillPicker.query.length);
    // 插入格式：/skill-name + 空格
    const insertion = `/${skill.name} `;
    const newText = before + insertion + after;
    setText(newText);
    setSkillPicker({ visible: false, query: "", startIndex: 0, activeIndex: 0 });

    // 聚焦并移动光标到末尾
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      const pos = before.length + insertion.length;
      el.focus();
      el.setSelectionRange(pos, pos);
      autoGrow();
    });
  };

  // ── 键盘处理 ──
  const handleKey = (e: KeyboardEvent) => {
    // 中文输入法组合中不处理
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    // ── Skills 选择器激活时优先处理 ──
    if (skillPicker.visible && filteredSkills.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSkillPicker(prev => ({ ...prev, activeIndex: (prev.activeIndex + 1) % filteredSkills.length }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSkillPicker(prev => ({ ...prev, activeIndex: (prev.activeIndex - 1 + filteredSkills.length) % filteredSkills.length }));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertSkill(filteredSkills[skillPicker.activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSkillPicker({ visible: false, query: "", startIndex: 0, activeIndex: 0 });
        return;
      }
    }

    // ── 历史导航（↑↓），仅当 skills 选择器未激活时 ──
    if (e.key === "ArrowUp" && !e.shiftKey) {
      const history = historyRef.current;
      if (history.length === 0) return;
      const el = taRef.current;
      if (!el) return;

      // 仅在光标位于最顶行时触发历史
      const cursorAtStart = el.selectionStart === 0 && el.selectionEnd === 0;
      // 或者 scrollHeight === clientHeight（单行）时总是触发
      const singleLine = el.scrollHeight <= el.clientHeight;

      if (cursorAtStart || singleLine) {
        e.preventDefault();
        // 第一次按↑：保存当前草稿，跳到最新
        if (histIndexRef.current === -1) {
          draftRef.current = text;
          histIndexRef.current = 0;
        } else if (histIndexRef.current < history.length - 1) {
          histIndexRef.current++;
        } else {
          return; // 已到最老
        }
        const item = history[histIndexRef.current];
        setText(item);
        requestAnimationFrame(() => {
          el.setSelectionRange(item.length, item.length);
          autoGrow();
        });
        return;
      }
    }

    if (e.key === "ArrowDown" && !e.shiftKey) {
      const el = taRef.current;
      if (!el) return;
      if (histIndexRef.current === -1) return; // 不在历史模式

      const fullHeight = el.scrollHeight > el.clientHeight;
      // 多行时，仅光标在最后一行才触发
      if (fullHeight) {
        // 简单判断：光标在末尾附近
        if (el.selectionStart < text.length - 1) return;
      }

      e.preventDefault();
      const history = historyRef.current;
      if (histIndexRef.current > 0) {
        histIndexRef.current--;
        const item = history[histIndexRef.current];
        setText(item);
        requestAnimationFrame(() => {
          el.setSelectionRange(item.length, item.length);
          autoGrow();
        });
      } else {
        // 回到草稿
        histIndexRef.current = -1;
        setText(draftRef.current);
        requestAnimationFrame(() => {
          const len = draftRef.current.length;
          el.setSelectionRange(len, len);
          autoGrow();
        });
      }
      return;
    }

    // ── Enter 发送 ──
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // 其他按键退出历史模式
    if (histIndexRef.current !== -1 && e.key.length === 1) {
      histIndexRef.current = -1;
    }
  };

  // ── 输入变化时检查 / 触发 ──
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    autoGrow();
    // 退出历史浏览
    if (histIndexRef.current !== -1) {
      histIndexRef.current = -1;
    }
    // 检查 / 触发
    const cursorPos = e.target.selectionStart ?? val.length;
    checkSlashTrigger(val, cursorPos);
  };

  // ── 点击外部关闭 skills 选择器 ──
  useEffect(() => {
    if (!skillPicker.visible) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setSkillPicker({ visible: false, query: "", startIndex: 0, activeIndex: 0 });
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [skillPicker.visible]);

  // 当 filteredSkills 变化时重置 activeIndex
  useEffect(() => {
    if (skillPicker.visible) {
      setSkillPicker(prev => ({ ...prev, activeIndex: 0 }));
    }
  }, [skillPicker.query]);

  return (
    <div className="input-bar">
      <div className="input-wrap" ref={wrapRef}>
        <textarea
          ref={taRef}
          className="input-textarea"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKey}
          placeholder={connected ? "给 MyAgent 发消息…  (↑ 历史记录, / 引用 Skills)" : "正在连接…"}
          disabled={!connected}
          rows={1}
        />

        {/* Skills 选择器弹出层 */}
        {skillPicker.visible && filteredSkills.length > 0 && (
          <div className="skill-picker">
            <div className="skill-picker-header">
              <span className="skill-picker-title">Skills</span>
              <span className="skill-picker-count">{filteredSkills.length}</span>
            </div>
            {filteredSkills.map((skill, i) => (
              <button
                key={skill.name}
                className={`skill-picker-item ${i === skillPicker.activeIndex ? "skill-picker-active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); insertSkill(skill); }}
                onMouseEnter={() => setSkillPicker(prev => ({ ...prev, activeIndex: i }))}
              >
                <span className="skill-picker-icon">⚡</span>
                <div className="skill-picker-text">
                  <span className="skill-picker-name">{skill.name}</span>
                  {skill.description && (
                    <span className="skill-picker-desc">{skill.description}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Skills 选择器空结果 */}
        {skillPicker.visible && filteredSkills.length === 0 && (
          <div className="skill-picker">
            <div className="skill-picker-empty">没有匹配的 Skill</div>
          </div>
        )}

        {isGenerating ? (
          <button
            className="input-abort"
            onClick={abort}
            type="button"
            aria-label="停止"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            className="input-send"
            onClick={handleSend}
            disabled={!text.trim() || !connected}
            type="button"
            aria-label="发送"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
