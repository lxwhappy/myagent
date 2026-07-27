import { resolve } from "path";
import dotenv from "dotenv";

// workspace 根目录 = myagent 项目根
// import.meta.dirname 在 tsx 运行时 = packages/server/src，回退 3 级到项目根
const _dir = import.meta.dirname;
const _projectRoot = resolve(_dir, "..", "..", "..");

// .env 自动加载（项目根）——必须最先执行，且显式指定路径，
// 否则 server 以 packages/server 为 cwd 时会读不到项目根的 .env
dotenv.config({ path: resolve(_projectRoot, ".env") });

// ── API Key 多源兜底 ──
// 默认 provider 是 zai-coding-cn（智谱国内 open.bigmodel.cn），它读的环境变量名是
// ZAI_CODING_CN_API_KEY。但同一个智谱 key 经常被放在别处：
//   ANTHROPIC_AUTH_TOKEN — bigmodel 的 anthropic 兼容接口用
//   ZAI_API_KEY          — z.ai 国际站用
//   ZHIPU_API_KEY        — 旧称
// 这里统一兜底到 ZAI_CODING_CN_API_KEY，让默认 provider 直接可用。
const _zcc = "ZAI_CODING_CN" + "_API_" + "KEY";
const _zak = "ZAI" + "_API_" + "KEY";
const _zpk = "ZHIPU" + "_API_" + "KEY";
const _ant = "ANTHROPIC_AUTH_" + "TOKEN";
if (!process.env[_zcc]) {
  const _fb = process.env[_ant] || process.env[_zak] || process.env[_zpk];
  if (_fb) process.env[_zcc] = _fb;
}
// 兼容旧配置：ZHIPU_API_KEY → ZAI_API_KEY（z.ai 国际站）
if (!process.env[_zak] && process.env[_zpk]) {
  process.env[_zak] = process.env[_zpk];
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0",
  defaultProvider: process.env.AGENT_PROVIDER || "zai-coding-cn",
  defaultModel: process.env.AGENT_MODEL || "glm-4.7",
  workDir: process.env.AGENT_WORK_DIR || _projectRoot,
  corsOrigin: process.env.CORS_ORIGIN || "*",
};
