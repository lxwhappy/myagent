// tools/web-tool.ts — web_search + web_fetch 工具
//
// web_search: 调用智谱 Web Search API（search_std 引擎，0.01元/次），共用 GLM 的 API key
// web_fetch: 抓取指定 URL，轻量 HTML→纯文本转换（无额外依赖）

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

// ── 智谱搜索 API ──
const SEARCH_API_URL = "https://open.bigmodel.cn/api/paas/v4/tools/web_search";
const SEARCH_ENGINE = process.env.WEB_SEARCH_ENGINE || "search_std"; // search_std(0.01) | search_pro(0.03) | search_pro_sogou | search_pro_quark

function getApiKey(): string | null {
  return (
    process.env["ZAI_CODING_CN_API_KEY"] ||
    process.env["ZAI_API_KEY"] ||
    process.env["ANTHROPIC_AUTH_TOKEN"] ||
    null
  );
}

function errResult(tool: string, text: string, summary: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: { toolName: tool, summary },
    output: text,
    summary,
  };
}

// ──────────────────────────────────────
// web_search 工具
// ──────────────────────────────────────
export const webSearchTool: ToolDefinition = {
  name: "zai_web_search",
  label: "WEB",
  description:
    "搜索互联网获取最新信息。当需要查询新闻、实时数据、最新技术动态、或任何需要联网才能获取的内容时调用此工具。" +
    "返回多条搜索结果（标题、摘要、链接、来源、发布日期）。",
  promptSnippet: "- web_search: 联网搜索（查询新闻/实时信息/最新动态时使用）",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词（建议 ≤70 字符）" },
      count: { type: "number", description: "返回结果数量，默认 5（最大 20）" },
    },
    required: ["query"],
  },

  async execute(_toolCallId: string, params: any) {
    const query = params?.query;
    if (!query || typeof query !== "string") {
      return errResult("web_search", "请提供搜索关键词（query 参数）", "❌ 缺少关键词");
    }

    const count = Math.min(Math.max(params?.count ?? 5, 1), 20);
    const apiKey = getApiKey();
    if (!apiKey) {
      return errResult("web_search", "错误：未配置 ZAI API key，无法调用搜索 API", "❌ 无 API key");
    }

    console.log(`[web_search] 搜索: "${query.slice(0, 60)}" (count=${count})`);

    try {
      const resp = await fetch(SEARCH_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          search_engine: SEARCH_ENGINE,
          search_query: query,
          count,
          content_size: "medium",
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        return errResult(
          "web_search",
          `搜索 API 失败 (${resp.status}): ${errText.slice(0, 300)}`,
          `❌ API ${resp.status}`,
        );
      }

      const data = (await resp.json()) as any;
      const results: any[] = data?.search_result || [];

      if (results.length === 0) {
        return errResult("web_search", `搜索「${query}」无结果`, "🔍 无结果");
      }

      const formatted = results
        .map((r: any, i: number) => {
          const parts: string[] = [`${i + 1}. ${r.title || "无标题"}`];
          if (r.content) parts.push(`   ${r.content}`);
          const meta: string[] = ["   🔗 " + (r.link || "")];
          if (r.media) meta.push(`(${r.media})`);
          if (r.publish_date) meta.push(r.publish_date);
          parts.push(meta.join(" "));
          return parts.join("\n");
        })
        .join("\n\n");

      const text = `搜索「${query}」共 ${results.length} 条结果：\n\n${formatted}`;
      const summary = `🔍 搜索: ${query.slice(0, 30)}${query.length > 30 ? "…" : ""} (${results.length}条)`;

      console.log(`[web_search] 完成: ${results.length} 条结果`);

      return {
        content: [{ type: "text" as const, text }],
        details: { toolName: "web_search", summary },
        output: text,
        summary,
      };
    } catch (err: any) {
      return errResult(
        "web_search",
        `搜索异常: ${err?.message || String(err)}`,
        "❌ 异常",
      );
    }
  },
};

// ──────────────────────────────────────
// web_fetch 工具
// ──────────────────────────────────────
export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  label: "FETCH",
  description:
    "抓取指定 URL 的网页内容，返回纯文本。适合阅读文章、查看文档、获取页面信息。" +
    "会自动去除 HTML 标签，提取正文文本。返回内容最多 8000 字符。",
  promptSnippet: "- web_fetch: 抓取网页内容（获取文章/页面正文文本）",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "要抓取的网页 URL（必须包含 http:// 或 https://）" },
    },
    required: ["url"],
  },

  async execute(_toolCallId: string, params: any) {
    const url = params?.url;
    if (!url || typeof url !== "string") {
      return errResult("web_fetch", "请提供要抓取的 URL", "❌ 缺少 URL");
    }

    // 简单校验 URL
    let hostname = url;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return errResult("web_fetch", `无效的 URL: ${url}`, "❌ URL无效");
    }

    console.log(`[web_fetch] 抓取: ${url}`);

    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });

      if (!resp.ok) {
        return errResult(
          "web_fetch",
          `抓取失败: HTTP ${resp.status} ${resp.statusText}`,
          `❌ HTTP ${resp.status}`,
        );
      }

      const contentType = resp.headers.get("content-type") || "";
      const html = await resp.text();

      // 非 HTML 内容（如 JSON / 纯文本）直接返回
      let text: string;
      if (contentType.includes("application/json") || contentType.includes("text/plain")) {
        text = html;
      } else {
        text = htmlToText(html);
      }

      // 限制返回长度（约 8000 字符，避免撑爆 LLM 上下文）
      const MAX = 8000;
      if (text.length > MAX) {
        text = text.slice(0, MAX) + "\n\n...(内容已截断，共 " + text.length + " 字符)";
      }

      const summary = `📄 抓取: ${hostname} (${text.length}字)`;
      console.log(`[web_fetch] 完成: ${text.length} 字符`);

      return {
        content: [{ type: "text" as const, text }],
        details: { toolName: "web_fetch", summary },
        output: text,
        summary,
      };
    } catch (err: any) {
      const msg = err?.name === "TimeoutError" ? `请求超时（15s）` : err?.message || String(err);
      return errResult("web_fetch", `抓取异常: ${msg}`, "❌ 异常");
    }
  },
};

// ── 轻量 HTML → 纯文本 ──
// 不依赖外部库，适合抓取文章/新闻页面
function htmlToText(html: string): string {
  return (
    html
      // 尝试提取 <main> / <article> / <body> 内容（优先级递减）
      .replace(/[\s\S]*?<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i, "$1")
      // 移除 script/style/noscript/iframe/svg/template
      .replace(/<(script|style|noscript|iframe|svg|template|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, "")
      // 移除 HTML 注释
      .replace(/<!--[\s\S]*?-->/g, "")
      // 块级元素 → 换行
      .replace(/<(\/?)(p|div|section|article|br|h[1-6]|li|tr|hr|blockquote|pre)[^>]*>/gi, "\n")
      // 移除所有剩余标签
      .replace(/<[^>]+>/g, "")
      // 解码常见 HTML 实体
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      // 压缩空白
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
