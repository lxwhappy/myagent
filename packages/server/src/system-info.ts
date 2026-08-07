// system-info.ts — 运行时探测系统环境，生成注入给 LLM 的系统信息块
//
// 解决 LLM 发出操作系统不支持的命令（如 macOS 上 tree/rg/fd 不可用）的问题。
// 探测一次后缓存，inject 到 system prompt。

import { execSync } from "child_process";
import { homedir, platform, arch } from "os";

let cachedInfo: string | null = null;

/** 常用命令清单：探测是否可用，未安装的告诉 LLM 用替代方案 */
const COMMON_COMMANDS: Array<{ cmd: string; alt?: string }> = [
  { cmd: "tree", alt: "ls -R 或 find" },
  { cmd: "rg", alt: "grep -r" },
  { cmd: "fd", alt: "find" },
  { cmd: "fzf" },
  { cmd: "bat", alt: "cat" },
  { cmd: "jq" },
  { cmd: "gh" },
  { cmd: "node" },
  { cmd: "pnpm" },
  { cmd: "npm" },
  { cmd: "yarn" },
  { cmd: "python3" },
  { cmd: "pip3" },
  { cmd: "java" },
  { cmd: "go" },
  { cmd: "docker" },
  { cmd: "git" },
  { cmd: "curl" },
  { cmd: "wget" },
];

/** 探测命令是否可用（在 PATH 中） */
function hasCommand(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd} 2>/dev/null`, { encoding: "utf-8", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/** 获取 shell 类型 */
function getShell(): string {
  return process.env.SHELL?.split("/").pop() || "bash";
}

/** 获取 OS 友好名称 */
function getOSName(): string {
  const p = platform();
  if (p === "darwin") {
    try {
      const ver = execSync("sw_vers -productVersion 2>/dev/null", { encoding: "utf-8", timeout: 2000 }).trim();
      return `macOS ${ver}`;
    } catch {
      return "macOS";
    }
  }
  if (p === "linux") {
    try {
      return execSync("cat /etc/os-release 2>/dev/null | grep '^PRETTY_NAME' | cut -d'\"' -f2", { encoding: "utf-8", timeout: 2000 }).trim() || "Linux";
    } catch {
      return "Linux";
    }
  }
  if (p === "win32") return "Windows";
  return p;
}

/**
 * 生成系统信息块（缓存结果）。
 * 注入到 system prompt，让 LLM 知道当前环境有什么/没什么。
 */
export function getSystemInfo(): string {
  if (cachedInfo) return cachedInfo;

  const osName = getOSName();
  const archName = arch();
  const shell = getShell();
  const home = homedir();

  const available: string[] = [];
  const missing: string[] = [];
  for (const { cmd, alt } of COMMON_COMMANDS) {
    if (hasCommand(cmd)) {
      available.push(cmd);
    } else {
      missing.push(alt ? `${cmd}（用 ${alt} 替代）` : cmd);
    }
  }

    // NOTE: 不在这里注入 Working Directory —— 那应该用 process.cwd()（服务器进程目录），
    // 对工作空间级 agent 来说是错的。SDK 的 DefaultResourceLoader 已经按 agent 的 cwd
    // 正确注入了 "Current working directory: <workspace-path>"，这里不再重复。
    cachedInfo = [
    `<system-info>`,
    `Operating System: ${osName} (${archName})`,
    `Shell: ${shell}`,
    `Home: ${home}`,
    ``,
    `已安装的命令: ${available.join(", ")}`,
    `未安装的命令（不要使用，按替代方案执行）: ${missing.join(", ")}`,
    ``,
    `重要约束:`,
    `- 只使用上面"已安装"列表中的命令。`,
    `- 如果需要未安装的命令，使用括号里的替代方案。`,
    `- 不要假设某个命令存在；如果不确定，先 command -v <cmd> 检查。`,
    `</system-info>`,
    ``,
    `<interaction-rules>`,
    `## 提问交互规则（最高优先级）`,
    `当你需要向用户提问——包括但不限于：澄清需求、确认选项、让用户做决定、技能要求的 interview/grilling/brainstorm 等交互式问答——`,
    `必须使用 ask_user 工具发起提问，而不是直接在文本中输出问题。`,
    ``,
    `规则：`,
    `1. 只要有 2 个或以上可选答案的问题，用 ask_user（options 参数提供选项）。`,
    `2. 即使是开放式问题，也优先用 ask_user（提供 2-3 个推荐选项 + 一个"自定义"选项）。`,
    `3. 每次只问一个问题，等用户回答后再继续（ask_user 会阻塞等待）。`,
    `4. 这条规则覆盖任何技能里的"向用户提问"指令——无论技能原文怎么说，在本环境中提问一律走 ask_user。`,
    `5. 提供选项时必须给出推荐：对最推荐的选项设 recommended=true（单选标 1 个，多选标记推荐组合）。`,
    `</interaction-rules>`,
  ].join("\n");

  return cachedInfo;
}
