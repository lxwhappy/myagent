// hooks/usePushToTalk.ts — 按住空格键说话，松开转文字
//
// 交互：输入框未聚焦 / 失焦时按住 Space 开始录音 → 松开把识别结果追加进输入框。
// 默认使用浏览器原生 Web Speech API（SpeechRecognition）做实时转写。
// 同时启动 MediaRecorder 录音，为将来接入后端 Whisper 方案预留。
//
// 注意事项：
// - 空格监听只在「输入框未聚焦」时生效，避免和正常打字空格冲突。
// - 中文输入法（composition）期间禁用，防止误触发。
// - 浏览器不支持时静默降级（isSupported === false）。

import { useRef, useState, useEffect, useCallback } from "react";

// ── Web Speech API 类型（TS 没有内置，补一下最小声明）──
interface SpeechRecognitionAlternative { transcript: string; confidence: number; }
interface SpeechRecognitionResult {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
  length: number;
}
interface SpeechRecognitionResultList { length: number; [index: number]: SpeechRecognitionResult; }
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event { error: string; message?: string; }
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) ?? null;
}

// 检测是否支持录音
function mediaRecorderSupported(): boolean {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function"
    && typeof (window as any).MediaRecorder !== "undefined";
}

export interface PushToTalkOptions {
  /** 语言代码，默认跟随浏览器 */
  lang?: string;
  /** 转写结果的回调（追加到外部输入框） */
  onTranscript: (text: string, isFinal: boolean) => void;
}

export interface PushToTalkApi {
  isSupported: boolean;
  isRecording: boolean;
  /** 当前实时识别的中间文本（用于 UI 预览） */
  interimText: string;
  /** 手动开始（除空格外的按钮触发） */
  start: () => void;
  /** 手动结束 */
  stop: () => void;
}

export function usePushToTalk(opts: PushToTalkOptions): PushToTalkApi {
  const { lang, onTranscript } = opts;
  const SpeechCtor = useRef(getSpeechRecognitionCtor());
  const isSupported = !!(SpeechCtor.current && mediaRecorderSupported());

  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");

  // refs（不触发渲染）
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  const langRef = useRef(lang);
  const recordingRef = useRef(false); // 同步标记，避免 keyup 重复触发

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // ── 开始录音 ──
  const start = useCallback(async () => {
    if (!isSupported || recordingRef.current) return;
    const Ctor = SpeechCtor.current;
    if (!Ctor) return;

    recordingRef.current = true;
    setInterimText("");
    chunksRef.current = [];

    // 1) 启动语音识别
    try {
      const rec = new Ctor();
      rec.lang = langRef.current || navigator.language || "zh-CN";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (e: SpeechRecognitionEvent) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const transcript = res[0]?.transcript ?? "";
          if (res.isFinal) {
            const trimmed = transcript.trim();
            if (trimmed) onTranscriptRef.current(trimmed, true);
          } else {
            interim += transcript;
          }
        }
        setInterimText(interim);
      };
      rec.onerror = (e: SpeechRecognitionErrorEvent) => {
        // no-speech / aborted 都是正常结束，不报错
        if (e.error !== "no-speech" && e.error !== "aborted") {
          console.warn("[push-to-talk] speech error:", e.error);
        }
      };
      rec.onend = () => {
        // 识别自动结束（超时等），若仍在录音中则重启以保持连续识别
        if (recordingRef.current) {
          try { rec.start(); } catch {}
        }
      };
      rec.start();
      recognitionRef.current = rec;
    } catch (err) {
      console.warn("[push-to-talk] SpeechRecognition start failed:", err);
    }

    // 2) 启动麦克风录音（预留 Whisper 后端用）
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      mediaRecorderRef.current = mr;
    } catch (err) {
      console.warn("[push-to-talk] microphone access failed:", err);
      // 录音失败不阻塞识别（识别有自己音频源）
    }

    setIsRecording(true);
  }, [isSupported]);

  // ── 结束录音 ──
  const stop = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;

    // 停止识别：先移除 onend 重启逻辑再 stop
    const rec = recognitionRef.current;
    if (rec) {
      rec.onend = null;
      try { rec.stop(); } catch {}
      recognitionRef.current = null;
    }

    // 停止录音器
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      try { mr.stop(); } catch {}
    }
    mediaRecorderRef.current = null;

    // 关闭麦克风
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
    setInterimText("");
  }, []);

  // ── 全局空格键监听（push-to-talk）──
  useEffect(() => {
    if (!isSupported) return;

    const isTypingTarget = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      // 输入框/文本域聚焦时不拦截空格
      return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // 只响应 Space
      if (e.code !== "Space" && e.key !== " ") return;
      // 输入法组合中
      if ((e as any).isComposing || e.keyCode === 229) return;
      // 有修饰键
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // 正在输入框里打字 → 让空格正常输入
      if (isTypingTarget(e.target)) return;
      // 已经在录音 → 忽略重复 keydown
      if (recordingRef.current || e.repeat) { e.preventDefault(); return; }

      e.preventDefault();
      start();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (isTypingTarget(e.target)) return;
      if (!recordingRef.current) return;
      e.preventDefault();
      stop();
    };

    // 失焦时强制停止（防止切走窗口时录音挂起）
    const onBlur = () => { if (recordingRef.current) stop(); };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [isSupported, start, stop]);

  // 卸载清理
  useEffect(() => {
    return () => {
      recordingRef.current = false;
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
    };
  }, []);

  return { isSupported, isRecording, interimText, start, stop };
}
