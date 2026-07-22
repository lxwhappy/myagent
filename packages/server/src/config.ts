const _zak = "ZAI" + "_API_" + "KEY";
const _zpk = "ZHIPU" + "_API_" + "KEY";
if (!process.env[_zak] && process.env[_zpk]) {
  process.env[_zak] = process.env[_zpk];
}

import { resolve } from "path";

// workspace 根目录 = myagent 项目根
// import.meta.dirname 在 tsx 运行时 = packages/server/src
// 需要回退 3 级到项目根
const _dir = import.meta.dirname;
const _projectRoot = resolve(_dir, "..", "..", "..");

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0",
  defaultProvider: process.env.AGENT_PROVIDER || "zai",
  defaultModel: process.env.AGENT_MODEL || "glm-4.7",
  workDir: process.env.AGENT_WORK_DIR || _projectRoot,
  corsOrigin: process.env.CORS_ORIGIN || "*",
};