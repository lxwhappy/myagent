// sessionMap.ts — chatSessionId → appSessionId 映射
//
// 替代之前挂在 window.__chatToAppSession 上的全局可变对象。
// 大部分场景下两个 ID 相同，仅在 loadSession 恢复历史会话时可能不同。

const map = new Map<string, string>();

export function setSessionMapping(chatSessionId: string, appSessionId: string): void {
  map.set(chatSessionId, appSessionId);
}

export function getAppSessionId(chatSessionId: string): string | undefined {
  return map.get(chatSessionId);
}

export function deleteSessionMapping(chatSessionId: string): void {
  map.delete(chatSessionId);
}
