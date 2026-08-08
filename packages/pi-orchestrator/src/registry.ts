// src/registry.ts — 模式注册表
//
// 统一管理内置模式和自定义模式。
// 自定义模式从 ~/.myagent/orchestration-modes.json 加载。
//
// 依赖反转：注册表本身不直接读写文件系统。
// server 端通过 setCustomModes() 注入自定义模式列表，
// 前端通过 getAvailableModes() + 远程 API 获取完整列表。

import type { OrchestrationMode } from "./types.ts";
import { BUILTIN_MODES } from "./builtin-modes.ts";

/** 内置模式 Map（id → mode） */
const builtinMap = new Map<string, OrchestrationMode>(
  BUILTIN_MODES.map(m => [m.id, m]),
);

/** 自定义模式 Map（id → mode）— 由 server 端注入 */
let customMap = new Map<string, OrchestrationMode>();

/** 设置自定义模式列表（server 端启动时调用） */
export function setCustomModes(modes: OrchestrationMode[]) {
  customMap = new Map(modes.map(m => [m.id, m]));
}

/** 获取所有可用模式（内置 + 自定义） */
export function getAvailableModes(): OrchestrationMode[] {
  return [...builtinMap.values(), ...customMap.values()];
}

/** 按 ID 获取模式 */
export function getMode(id: string): OrchestrationMode | undefined {
  return builtinMap.get(id) ?? customMap.get(id);
}

/** 判断是否内置模式 */
export function isBuiltInMode(id: string): boolean {
  return builtinMap.has(id);
}

/** 获取内置模式列表 */
export function getBuiltinModes(): OrchestrationMode[] {
  return [...builtinMap.values()];
}

/** 获取自定义模式列表 */
export function getCustomModes(): OrchestrationMode[] {
  return [...customMap.values()];
}
