// llm-interceptor.ts — 拦截 LLM API 的 fetch 请求，捕获请求/响应内容
//
// 通过 monkey-patch globalThis.fetch 实现。
// 只拦截 LLM 相关的 API 请求（chat/completions, /messages 等），
// 记录 URL、请求 body、响应 body（流式响应收集后汇总），
// 通过 event-bus 发 llm_raw 事件给前端。
//
// 响应 body 处理：流式 SSE 用 response.clone() + reader 收集所有 chunk，
// 完成后截断到 MAX_BODY_LEN 推给前端。不影响原始流消费。

import { emit } from "./event-bus.js";

const MAX_BODY_LEN = 50000; // 请求/响应 body 最大截取长度（足够看完整 messages 数组）

// 匹配 LLM API 的 URL 模式
const LLM_URL_PATTERNS = [
  /\/chat\/completions/,    // OpenAI / ZAI / 大多数 OpenAI 兼容 API
  /\/v1\/messages/,         // Anthropic
  /\/responses$/,            // OpenAI Responses API
];

let currentSessionId: string | null = null;
let enabled = false;
const originalFetch = globalThis.fetch;

export function setLlmInterceptorSession(id: string | null) {
  currentSessionId = id;
}

export function setLlmInterceptorEnabled(v: boolean) {
  // 只 patch 一次，enabled 控制是否实际捕获
  if (v && !enabled) {
    enabled = true;
    patchFetch();
  } else {
    enabled = v;
  }
}

function patchFetch() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isLlm = LLM_URL_PATTERNS.some(p => p.test(url));

    // 非 LLM 请求或未启用 → 直接放行
    if (!isLlm || !enabled || !currentSessionId) {
      return originalFetch(input, init);
    }

    const sid = currentSessionId;
    const reqStartTs = Date.now();

    // 捕获请求 body
    let reqBody: string | null = null;
    if (init?.body) {
      try {
        reqBody = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
        if (reqBody.length > MAX_BODY_LEN) reqBody = reqBody.slice(0, MAX_BODY_LEN) + "\n…(截断)";
      } catch {}
    }

    // 提取 method + 脱敏 headers（隐藏 API key）
    const method = init?.method || "GET";
    let sanitizedHeaders: Record<string, string> = {};
    if (init?.headers) {
      try {
        const h = init.headers as Record<string, string>;
        for (const [k, v] of Object.entries(h)) {
          if (/authorization|api.?key|bearer/i.test(k)) {
            sanitizedHeaders[k] = "***REDACTED***";
          } else {
            sanitizedHeaders[k] = v;
          }
        }
      } catch {}
    }

    // 发请求
    const response = await originalFetch(input, init);

    // 克隆响应（tee），异步收集流式 SSE chunks
    const cloned = response.clone();
    collectStreamBody(cloned, url, sid, reqStartTs, method, sanitizedHeaders, reqBody);

    return response;
  };
}

/** 异步收集响应 body（支持 SSE 流式），完成后 emit */
async function collectStreamBody(
  cloned: Response,
  url: string,
  sid: string,
  reqStartTs: number,
  method: string,
  reqHeaders: Record<string, string>,
  reqBody: string | null,
) {
  let chunks: string[] = [];
  let totalLen = 0;
  let truncated = false;

  try {
    const reader = cloned.body?.getReader();
    if (!reader) {
      // 无 body（不应该发生在 LLM API 上，但兜底）
      emitRawEvent(sid, url, method, reqHeaders, reqBody, null, reqStartTs);
      return;
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (!truncated) {
        if (totalLen + text.length > MAX_BODY_LEN) {
          chunks.push(text.slice(0, MAX_BODY_LEN - totalLen));
          totalLen = MAX_BODY_LEN;
          truncated = true;
        } else {
          chunks.push(text);
          totalLen += text.length;
        }
      }
    }

    const respBody = truncated
      ? chunks.join("") + "\n…(截断)"
      : chunks.join("");

    emitRawEvent(sid, url, method, reqHeaders, reqBody, respBody, reqStartTs);
  } catch (e: any) {
    // 收集失败不影响主流程
    emitRawEvent(sid, url, method, reqHeaders, reqBody, `[收集失败: ${e?.message}]`, reqStartTs);
  }
}

function emitRawEvent(
  sid: string,
  url: string,
  method: string,
  reqHeaders: Record<string, string>,
  reqBody: string | null,
  respBody: string | null,
  reqStartTs: number,
) {
  emit({
    type: "llm_raw",
    chatSessionId: sid,
    payload: {
      url,
      method,
      reqHeaders,
      reqBody,
      respBody,
      durationMs: Date.now() - reqStartTs,
      timestamp: reqStartTs,
    },
    ts: Date.now(),
  });
}
