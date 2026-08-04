// 懒加载的代码高亮组件
// 把 react-syntax-highlighter (~440KB) 从首屏静态导入改为按需动态导入，
// 首屏不渲染代码块时不会加载高亮库，大幅加快首屏速度。

import { Suspense, lazy } from "react";
import type { CSSProperties } from "react";

// 动态导入 SyntaxHighlighter + 主题，两者并行加载
const LazyHighlighter = lazy(async () => {
  const [{ Prism: SyntaxHighlighter }, { oneDark }] = await Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism"),
  ]);
  // 从 oneDark 主题中移除 textShadow（0 1px 阴影在深色背景上像横线）
  const cleaned: Record<string, CSSProperties> = {};
  for (const [key, val] of Object.entries(oneDark)) {
    const v = val as CSSProperties;
    cleaned[key] = { ...v, textShadow: "none" };
  }
  return {
    default: (props: HighlighterProps) => (
      <SyntaxHighlighter style={cleaned} {...props} />
    ),
  };
});

interface HighlighterProps {
  language: string;
  PreTag?: string;
  showLineNumbers?: boolean;
  customStyle?: CSSProperties;
  children: string;
}

export interface CodeBlockProps {
  language: string;
  content: string;
  showLineNumbers?: boolean;
  customStyle?: CSSProperties;
}

/** 加载高亮库期间的轻量占位：纯 <pre>，不带高亮 */
function FallbackPre({ content, customStyle }: { content: string; customStyle?: CSSProperties }) {
  return (
    <pre style={{ margin: 0, padding: "12px", background: "var(--code-bg)", ...customStyle }}>
      <code>{content}</code>
    </pre>
  );
}

export function CodeBlock({ language, content, showLineNumbers, customStyle }: CodeBlockProps) {
  return (
    <Suspense fallback={<FallbackPre content={content} customStyle={customStyle} />}>
      <LazyHighlighter
        language={language}
        PreTag="div"
        showLineNumbers={showLineNumbers}
        customStyle={customStyle}
      >
        {content}
      </LazyHighlighter>
    </Suspense>
  );
}
