// hooks/useAudio.ts — 完成提示音
//
// agent_end 时播放一声短促的"叮"。
// 浏览器 autoplay 策略要求从用户手势中解锁 AudioContext。

const SOUND_ENABLED_KEY = "myagent_sound_enabled";
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
    catch { return null; }
  }
  return audioCtx;
}

// 生成一声短促的"叮"（两个正弦波叠加 + 指数衰减包络）
function playDing() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = "sine";
  osc1.frequency.value = 880;  // A5
  osc2.type = "sine";
  osc2.frequency.value = 1320; // E6（五度音）

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.4);
  osc2.stop(now + 0.4);
}

export function useAudio() {
  const enabled = localStorage.getItem(SOUND_ENABLED_KEY) !== "false"; // 默认开启

  const toggleSound = () => {
    const newVal = !enabled;
    localStorage.setItem(SOUND_ENABLED_KEY, String(newVal));
    if (newVal) {
      // 解锁 AudioContext 并播放一声确认
      getCtx()?.resume();
      playDing();
    }
  };

  const unlockAudio = () => {
    // 从用户手势中解锁 AudioContext
    getCtx()?.resume();
  };

  const playCompletion = () => {
    if (localStorage.getItem(SOUND_ENABLED_KEY) === "false") return;
    playDing();
  };

  return { soundEnabled: enabled, toggleSound, unlockAudio, playCompletion };
}

// 独立导出：供非 hook 上下文（如 useChat 的事件处理器）调用
export function playCompletionSound(): void {
  if (localStorage.getItem(SOUND_ENABLED_KEY) === "false") return;
  playDing();
}
