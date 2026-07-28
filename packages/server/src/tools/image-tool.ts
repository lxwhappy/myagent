// tools/image-tool.ts — analyze_image 工具 + 会话级图片队列
//
// 流程：
// 1. 用户发图片时，后端 prompt 路由把图片存到 pendingImages 队列（按 chatSessionId 隔离）
// 2. 主 agent（不支持 vision 的模型）收到文字提示，知道有图片待识别
// 3. 主 agent 调 analyze_image 工具 → 工具从队列取图 → 调 glm-5v-turbo vision API → 返回文字描述

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/** 待处理图片（base64） */
export interface PendingImage {
  id: string;
  data: string;       // base64（不含 data:前缀）
  mimeType: string;   // image/png 等
}

// 会话级图片队列：chatSessionId → PendingImage[]
const pendingImages = new Map<string, PendingImage[]>();

/** 存入待处理图片（prompt 路由在用户发图时调用） */
export function pushPendingImages(chatSessionId: string, images: PendingImage[]) {
  const queue = pendingImages.get(chatSessionId) || [];
  queue.push(...images);
  pendingImages.set(chatSessionId, queue);
}

/** 取出并清空待处理图片（analyze_image 工具执行时调用） */
export function takePendingImages(chatSessionId: string): PendingImage[] {
  const images = pendingImages.get(chatSessionId) || [];
  pendingImages.delete(chatSessionId);
  return images;
}

/** 判断是否有待处理图片 */
export function hasPendingImages(chatSessionId: string): boolean {
  return (pendingImages.get(chatSessionId)?.length ?? 0) > 0;
}

// ── Vision 模型配置 ──
// 智谱常规端点（paas/v4，非 coding/paas/v4），同一个 API key 通用。
// glm-4v-flash 免费、所有套餐可用；glm-4v-plus 付费、质量更好。
// 可通过环境变量 IMAGE_VISION_MODEL 覆盖。
const VISION_MODEL_ID = process.env.IMAGE_VISION_MODEL || "glm-4v-flash";
// 常规 API 端点（不含 /chat/completions 后缀）
const VISION_BASE_URL = process.env.IMAGE_VISION_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";

/**
 * 用智谱 vision 模型（glm-4v-flash）识别图片，返回文字描述。
 * 走常规端点（paas/v4），和 coding 端点共用同一个 API key。
 */
async function recognizeImages(
  images: PendingImage[],
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = process.env["ZAI_CODING_CN_API_KEY"] || process.env["ZAI_API_KEY"] || process.env["ANTHROPIC_AUTH_TOKEN"];
  if (!apiKey) {
    return "错误：未配置 API key，无法调用 vision 模型";
  }

  // 构造 OpenAI 兼容的多模态请求
  const content: any[] = [];
  if (prompt) {
    content.push({ type: "text", text: prompt });
  }
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${img.mimeType};base64,${img.data}`,
      },
    });
  }

  const body = {
    model: VISION_MODEL_ID,
    messages: [
      {
        role: "user",
        content: content.length === 1 && content[0].type === "text"
          ? prompt
          : content,
      },
    ],
    max_tokens: 1024,
    stream: false,
  };

  try {
    const resp = await fetch(`${VISION_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return `Vision API 调用失败 (${resp.status}): ${errText.slice(0, 200)}`;
    }

    const data = await resp.json() as any;
    const description = data?.choices?.[0]?.message?.content;
    if (!description) {
      return "Vision 模型未返回内容";
    }
    return typeof description === "string" ? description : JSON.stringify(description);
  } catch (err: any) {
    return `Vision 调用异常: ${err?.message || String(err)}`;
  }
}

/** analyze_image 工具定义 */
export function createAnalyzeImageTool(chatSessionId: string): ToolDefinition {
  return {
    name: "analyze_image",
    label: "IMG",
    description:
      "识别用户发送的图片。当用户消息提到图片、截图、报错画面等，" +
      "且系统提示有待处理图片时，调用此工具获取图片的文字描述。" +
      "工具会用视觉模型识别图片内容并返回描述，你根据描述回答用户问题。",
    promptSnippet:
      "- analyze_image: 识别用户图片。收到\"[有待处理图片]\"提示时调用",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "关于图片的问题（如：图里是什么、图中的报错是什么、这张截图的内容）。默认用用户的原始问题。",
        },
      },
    },

    async execute(_toolCallId: string, params: any) {
      const images = takePendingImages(chatSessionId);
      if (images.length === 0) {
        const text = "当前没有待识别的图片。用户可能已经处理过，或未发送图片。";
        return {
          content: [{ type: "text" as const, text }],
          details: { toolName: "analyze_image", summary: "无待处理图片" },
          output: text, summary: "无待处理图片",
        };
      }

      const question = params?.question || "请详细描述这张图片的内容。";
      console.log(`[analyze_image] ${chatSessionId.slice(0, 8)} 识别 ${images.length} 张图片，问题: ${question.slice(0, 60)}`);

      const description = await recognizeImages(images, question);
      const text = `图片识别结果（${images.length} 张）：\n\n${description}`;
      const summary = `🖼 识别 ${images.length} 张图片`;

      return {
        content: [{ type: "text" as const, text }],
        details: { toolName: "analyze_image", summary },
        output: text, summary,
      };
    },
  };
}
