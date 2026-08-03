// 懒加载的代码高亮组件
// 把 react-syntax-highlighter (~440KB) 从首屏静态导入改为按需动态导入，
// 首屏不渲染代码块时不会加载高亮库，大幅加快首屏速度。

import { Suspense, lazy, useState, useCallback } from "react";
import type { CSSProperties } from "react";

// 动态导入 SyntaxHighlighter + 主题，两者并行加载
const LazyHighlighter = lazy(async () => {
  const [{ Prism: SyntaxHighlighter }, { oneDark }] = await Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism"),
  ]);
  return {
    default: (props: HighlighterProps) => (
      <SyntaxHighlighter style={oneDark} {...props} />
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

/** 代码块顶栏：语言标签 + 复制按钮 */
function CodeToolbar({ language, onCopy, copied }: { language: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="code-toolbar">
      <span className="code-lang">{language || "text"}</span>
      <button className="code-copy-btn" onClick={onCopy}>
        {copied ? "✓ 已复制" : "复制"}
      </button>
    </div>
  );
}

export function CodeBlock({ language, content, showLineNumbers, customStyle }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  return (
    <div className="code-block-wrapper">
      <CodeToolbar language={language} onCopy={handleCopy} copied={copied} />
      <Suspense fallback={<FallbackPre content={content} customStyle={customStyle} />}>
        <LazyHighlighter
          language={language}
          PreTag="div"
          showLineNumbers={showLineNumbers}
          customStyle={{ margin: 0, borderRadius: 0, ...customStyle }}
        >
          {content}
        </LazyHighlighter>
      </Suspense>
    </div>
  );
}
