// components/InputBar.tsx — 输入框 + 历史导航(↑↓) + Skills 选择器 + Draft 持久化 + 图片上传
// (PiAgent Design System)

import { useRef, useState, useEffect, useMemo, useCallback, type KeyboardEvent } from "react";
import { useChat } from "../hooks/useChat";
import { useChatStore, type SkillInfo } from "../stores/chat";
import { getDraft, setDraft, clearDraft } from "../lib/draft-store";
import { Icon } from "./Icon";

const MAX_HEIGHT = 200;
const HISTORY_KEY = "myagent_input_history";
const MAX_HISTORY = 50;

export interface AttachedImage {
  data: string;    // base64 (no prefix)
  mimeType: string;
  previewUrl: string;
}

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
  if (items[0] === text) return;
  const filtered = items.filter(t => t !== text);
  filtered.unshift(text);
  saveHistory(filtered.slice(0, MAX_HISTORY));
}

function imageToBase64(file: File): Promise<AttachedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function InputBar() {
  const { sendMessage, abort, isGenerating, connected, skills, activeChatSessionId } = useChat();
  const thinkingEnabled = useChatStore(s => s.thinkingEnabled);
  const toggleThinking = useChatStore(s => s.toggleThinking);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Draft 持久化：会话切换时恢复草稿 ──
  const draftKey = activeChatSessionId ?? "__default";
  const [text, setText] = useState(() => getDraft(draftKey));
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  // 会话切换时加载对应 draft
  useEffect(() => {
    setText(getDraft(draftKey));
    setAttachedImages([]);
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.style.height = "auto";
        const next = Math.min(taRef.current.scrollHeight, MAX_HEIGHT);
        taRef.current.style.height = `${next}px`;
      }
    });
  }, [draftKey]);

  // 输入变化时自动保存 draft
  useEffect(() => {
    setDraft(draftKey, text);
  }, [draftKey, text]);

  // ── 历史导航状态 ──
  const historyRef = useRef<string[]>(loadHistory());
  const histIndexRef = useRef<number>(-1);
  const draftBeforeHistRef = useRef<string>("");

  // ── Skills 选择器状态 ──
  const [skillPicker, setSkillPicker] = useState<{
    visible: boolean;
    query: string;
    startIndex: number;
    activeIndex: number;
  }>({ visible: false, query: "", startIndex: 0, activeIndex: 0 });

  // ── 图片处理 ──
  const processImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newImages = await Promise.all(imageFiles.map(imageToBase64));
    setAttachedImages(prev => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages(prev => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed && removed.previewUrl.startsWith("blob:")) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }, []);

  // ── 粘贴图片 ──
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      processImageFiles(files);
    }
  }, [processImageFiles]);

  // ── 拖拽图片 ──
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    processImageFiles(files);
  }, [processImageFiles]);

  const handleSend = () => {
    if ((!text.trim() && attachedImages.length === 0) || isGenerating) return;
    addToHistory(text.trim());
    historyRef.current = loadHistory();
    histIndexRef.current = -1;
    // 发送时附带图片
    const images = attachedImages.length > 0
      ? attachedImages.map(img => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }))
      : undefined;
    sendMessage(text, images);
    // 清理
    setText("");
    clearDraft(draftKey);
    attachedImages.forEach(img => { if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl); });
    setAttachedImages([]);
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
    return matched.slice(0, 8);
  }, [skillPicker.visible, skillPicker.query, skills]);

  const checkSlashTrigger = (value: string, cursorPos: number) => {
    const before = value.slice(0, cursorPos);
    const slashMatch = before.match(/(?:^|\s)\/(\S*)$/);
    if (slashMatch) {
      const slashIndex = before.lastIndexOf("/");
      setSkillPicker({ visible: true, query: slashMatch[1], startIndex: slashIndex, activeIndex: 0 });
    } else {
      if (skillPicker.visible) setSkillPicker(prev => ({ ...prev, visible: false }));
    }
  };

  const insertSkill = (skill: SkillInfo) => {
    const before = text.slice(0, skillPicker.startIndex);
    const after = text.slice(skillPicker.startIndex + 1 + skillPicker.query.length);
    const insertion = `/${skill.name} `;
    const newText = before + insertion + after;
    setText(newText);
    setSkillPicker({ visible: false, query: "", startIndex: 0, activeIndex: 0 });
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
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (skillPicker.visible && filteredSkills.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSkillPicker(prev => ({ ...prev, activeIndex: (prev.activeIndex + 1) % filteredSkills.length })); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSkillPicker(prev => ({ ...prev, activeIndex: (prev.activeIndex - 1 + filteredSkills.length) % filteredSkills.length })); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertSkill(filteredSkills[skillPicker.activeIndex]); return; }
      if (e.key === "Escape") { e.preventDefault(); setSkillPicker({ visible: false, query: "", startIndex: 0, activeIndex: 0 }); return; }
    }

    if (e.key === "ArrowUp" && !e.shiftKey) {
      const history = historyRef.current;
      if (history.length === 0) return;
      const el = taRef.current;
      if (!el) return;
      const cursorAtStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const singleLine = el.scrollHeight <= el.clientHeight;
      if (cursorAtStart || singleLine) {
        e.preventDefault();
        if (histIndexRef.current === -1) { draftBeforeHistRef.current = text; histIndexRef.current = 0; }
        else if (histIndexRef.current < history.length - 1) histIndexRef.current++;
        else return;
        const item = history[histIndexRef.current];
        setText(item);
        requestAnimationFrame(() => { el.setSelectionRange(item.length, item.length); autoGrow(); });
        return;
      }
    }

    if (e.key === "ArrowDown" && !e.shiftKey) {
      const el = taRef.current;
      if (!el) return;
      if (histIndexRef.current === -1) return;
      const fullHeight = el.scrollHeight > el.clientHeight;
      if (fullHeight && el.selectionStart < text.length - 1) return;
      e.preventDefault();
      const history = historyRef.current;
      if (histIndexRef.current > 0) {
        histIndexRef.current--;
        const item = history[histIndexRef.current];
        setText(item);
        requestAnimationFrame(() => { el.setSelectionRange(item.length, item.length); autoGrow(); });
      } else {
        histIndexRef.current = -1;
        setText(draftBeforeHistRef.current);
        requestAnimationFrame(() => { el.setSelectionRange(draftBeforeHistRef.current.length, draftBeforeHistRef.current.length); autoGrow(); });
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); return; }
    if (histIndexRef.current !== -1 && e.key.length === 1) histIndexRef.current = -1;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    autoGrow();
    if (histIndexRef.current !== -1) histIndexRef.current = -1;
    const cursorPos = e.target.selectionStart ?? val.length;
    checkSlashTrigger(val, cursorPos);
  };

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

  useEffect(() => {
    if (skillPicker.visible) setSkillPicker(prev => ({ ...prev, activeIndex: 0 }));
  }, [skillPicker.query]);

  // 组件卸载时清理图片 preview URLs
  useEffect(() => {
    return () => { attachedImages.forEach(img => { if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl); }); };
  }, []);

  const canSend = (text.trim().length > 0 || attachedImages.length > 0) && connected && !isGenerating;

  return (
    <div className="input-bar">
      <div
        className={`input-wrapper${isDragging ? " input-dragging" : ""}`}
        ref={wrapRef}
        style={isDragging ? { borderColor: "var(--accent)" } : undefined}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* 图片预览栏 */}
        {attachedImages.length > 0 && (
          <div className="attachments">
            {attachedImages.map((img, i) => (
              <div key={i} className="attach-chip" style={{ padding: "2px", background: "transparent" }}>
                <img src={img.previewUrl} alt="" style={{ width: 36, height: 36, borderRadius: "var(--radius-sm)", objectFit: "cover" }} />
                <button
                  className="attach-remove"
                  onClick={() => removeImage(i)}
                  type="button"
                  aria-label="移除图片"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--danger)" }}
                >
                  <Icon name="i-x" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="input-row">
          {/* 附件按钮 */}
          <button
            className="input-attach"
            onClick={() => fileInputRef.current?.click()}
            type="button"
            aria-label="添加图片"
            title="添加图片"
          >
            <Icon name="i-paperclip" size={18} />
          </button>

          <textarea
            ref={taRef}
            className="input"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            placeholder={connected ? "给 MyAgent 发消息…" : "正在连接…"}
            disabled={!connected}
            rows={1}
          />

          {/* 拖拽提示 */}
          {isDragging && (
            <div className="input-drag-overlay">
              <span>松开以添加图片</span>
            </div>
          )}

          {/* 思考开关 */}
          <button
            className={`input-thinking${thinkingEnabled ? " active" : ""}`}
            onClick={toggleThinking}
            type="button"
            aria-label="切换思考模式"
            title={thinkingEnabled ? "思考已开启（点击关闭）" : "思考已关闭（点击开启，模型会先思考再回答）"}
          >
            🧠
          </button>

          {/* 发送 / 停止 */}
          {isGenerating ? (
            <button
              className="btn-send"
              onClick={abort}
              type="button"
              aria-label="停止"
              title="停止生成"
              style={{ background: "var(--danger)", color: "#fff" }}
            >
              <Icon name="i-x" size={16} />
            </button>
          ) : (
            <button
              className="btn-send"
              onClick={handleSend}
              disabled={!canSend}
              type="button"
              aria-label="发送"
              title="发送"
            >
              <Icon name="i-send" size={16} />
            </button>
          )}
        </div>

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
                  {skill.description && <span className="skill-picker-desc">{skill.description}</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        {skillPicker.visible && filteredSkills.length === 0 && (
          <div className="skill-picker">
            <div className="skill-picker-empty">没有匹配的 Skill</div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) processImageFiles(Array.from(e.target.files)); e.target.value = ""; }}
        />
      </div>

      {/* 键盘快捷键提示行 */}
      <div className="input-hint">
        <span>
          <kbd>Enter</kbd> 发送
        </span>
        <span>
          <kbd>Shift</kbd> + <kbd>Enter</kbd> 换行
        </span>
        <span>
          <kbd>↑</kbd> / <kbd>↓</kbd> 历史
        </span>
        <span>
          <kbd>/</kbd> 选择 Skill
        </span>
      </div>
    </div>
  );
}
