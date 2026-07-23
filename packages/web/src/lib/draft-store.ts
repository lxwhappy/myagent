// draft-store.ts — 每个会话的输入草稿持久化
//
// 切换会话时自动保存/恢复输入内容，不会丢失。

const PREFIX = "myagent_draft_";

export function getDraft(sessionId: string): string {
  try {
    return localStorage.getItem(PREFIX + sessionId) ?? "";
  } catch {
    return "";
  }
}

export function setDraft(sessionId: string, text: string): void {
  try {
    if (text.trim()) {
      localStorage.setItem(PREFIX + sessionId, text);
    } else {
      localStorage.removeItem(PREFIX + sessionId);
    }
  } catch {}
}

export function clearDraft(sessionId: string): void {
  try {
    localStorage.removeItem(PREFIX + sessionId);
  } catch {}
}
