// 懒加载的代码高亮组件
// 把 react-syntax-highlighter (~440KB) 从首屏静态导入改为按需动态导入，
// 首屏不渲染代码块时不会加载高亮库，大幅加快首屏速度。
//
// 主题跟随 useThemeStore.resolved 动态切换：
//   dark  → oneDark（Catppuccin Mocha 风格）
//   light → oneLight（柔和浅色风格）

import { Suspense, lazy, useMemo } from "react";
import type { CSSProperties, ElementType, HTMLAttributes } from "react";
import { useThemeStore } from "../stores/theme";

// 动态导入 SyntaxHighlighter + 两套主题，全部并行加载
const LazyHighlighter = lazy(async () => {
  const [{ Prism: SyntaxHighlighter }, { oneDark, oneLight }] = await Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism"),
  ]);

  // 清理 textShadow（0 1px 阴影在深色背景上像横线）
  const clean = (theme: Record<string, CSSProperties>): Record<string, CSSProperties> => {
    const cleaned: Record<string, CSSProperties> = {};
    for (const [key, val] of Object.entries(theme)) {
      cleaned[key] = { ...val, textShadow: "none" };
    }
    return cleaned;
  };

  const dark = clean(oneDark as Record<string, CSSProperties>);
  const light = clean(oneLight as Record<string, CSSProperties>);

  return {
    default: (props: HighlighterProps & { theme: "dark" | "light" }) => {
      const style = props.theme === "light" ? light : dark;
      const { theme: _t, ...rest } = props;
      return <SyntaxHighlighter style={style} {...rest} />;
    },
  };
});

interface HighlighterProps {
  language: string;
  theme: "dark" | "light";
  PreTag?: ElementType;
  showLineNumbers?: boolean;
  customStyle?: CSSProperties;
  wrapLines?: boolean;
  lineProps?: (lineNumber: number) => HTMLAttributes<HTMLElement>;
  children: string;
}

export interface CodeBlockProps {
  language: string;
  content: string;
  showLineNumbers?: boolean;
  customStyle?: CSSProperties;
  /**
   * 为每行代码打上 data-line="N" 标记，使外部可基于选区精确还原行号。
   * 仅在文件预览面板等需要行级交互的场景开启。
   */
  tagLines?: boolean;
}

function FallbackPre({ content, customStyle }: { content: string; customStyle?: CSSProperties }) {
  return (
    <pre style={{ margin: 0, padding: "12px", background: "var(--code-bg)", ...customStyle }}>
      <code>{content}</code>
    </pre>
  );
}

export function CodeBlock({ language, content, showLineNumbers, customStyle, tagLines }: CodeBlockProps) {
  const resolved = useThemeStore(s => s.resolved);

  // memo 防止 resolved 不变时重复创建 props
  const lineProps = useMemo(
    () => tagLines ? (ln: number) => ({ "data-line": ln } as unknown as HTMLAttributes<HTMLElement>) : undefined,
    [tagLines],
  );

  return (
    <Suspense fallback={<FallbackPre content={content} customStyle={customStyle} />}>
      <LazyHighlighter
        language={language}
        theme={resolved}
        PreTag="div"
        showLineNumbers={showLineNumbers}
        customStyle={customStyle}
        wrapLines={tagLines}
        lineProps={lineProps as any}
      >
        {content}
      </LazyHighlighter>
    </Suspense>
  );
}
