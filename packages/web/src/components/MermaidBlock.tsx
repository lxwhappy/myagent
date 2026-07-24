// components/MermaidBlock.tsx — Mermaid 流程图渲染
//
// 流式友好：对 chart 做防抖，内容稳定后再 render；失败时保留上次成功的 SVG。
// 交互：默认折叠预览（高度受限 + 渐变蒙层），点击进入全屏 Modal，
//       支持 +/-/重置按钮、滚轮缩放、拖动平移、双击重置、ESC 关闭。

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

let mermaidInitialized = false;
let renderCounter = 0;

export function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const reactId = useId();
  const idBase = reactId.replace(/[^a-zA-Z0-9]/g, "_");
  const lastGoodSvg = useRef<string | null>(null);

  useEffect(() => {
    const code = chart.trim();
    if (!code) return;

    let cancelled = false;

    // 防抖：流式输出时每收到一个 delta 都会重建组件状态，250ms 静默后再渲染
    const timer = setTimeout(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "base",
            securityLevel: "loose",
            themeVariables: {
              // Claude Warm Light 暖色调：暖白底 + 柔和暖灰描边 + 陶土橙点缀
              lineColor: "#C9BCAD",
              primaryColor: "#FFFFFF",
              primaryBorderColor: "#D4C9BC",
              primaryTextColor: "#3D352E",
              secondaryColor: "#F5EBE0",
              secondaryBorderColor: "#C96342",
              secondaryTextColor: "#8B3E1F",
              tertiaryColor: "#FAF4EC",
              tertiaryBorderColor: "#D4C9BC",
              background: "#FAF8F5",
              mainBkg: "#FFFFFF",
              nodeBorder: "#D4C9BC",
              clusterBkg: "#F5F0EA",
              clusterBorder: "#E0D5C7",
              edgeLabelBackground: "#FAF8F5",
              // 判断节点（菱形）走 secondary，用陶土橙强调
              altBackground: "#F5EBE0",
              thickLineWidth: "1.4px",
              thinLineWidth: "1px",
              fontSize: "14px",
              fontFamily: "inherit",
            },
            flowchart: { curve: "basis", useMaxWidth: true, htmlLabels: true, padding: 16 },
            sequence: { useMaxWidth: true },
          });
          mermaidInitialized = true;
        }
        const renderId = `mmd-${idBase}-${++renderCounter}`;
        const result = await mermaid.render(renderId, code);
        cleanupMermaidDom(renderId);
        if (cancelled) return;
        if (result?.svg) {
          // Mermaid v11 语法错误时不抛异常，而是返回一个含 "Syntax error" 的错误 SVG
          const isErrorSvg = /Syntax error|Parse error|error in text/i.test(result.svg);
          if (isErrorSvg) {
            if (lastGoodSvg.current) {
              // 流式过程中代码不完整出错，保留上一次成功的图
              setSvg(lastGoodSvg.current);
            } else {
              setError("Syntax error");
              setLoading(false);
            }
          } else {
            lastGoodSvg.current = result.svg;
            setSvg(result.svg);
            setError(null);
            setLoading(false);
          }
        }
      } catch (e: any) {
        cleanupMermaidDom(`mmd-${idBase}-${renderCounter}`);
        if (cancelled) return;
        if (lastGoodSvg.current) {
          setSvg(lastGoodSvg.current);
        } else {
          setError(e?.message ?? String(e));
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chart, idBase]);

  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-title">⚠️ 流程图渲染失败</div>
        <pre className="mermaid-error-code">{chart}</pre>
        <div className="mermaid-error-msg">{error}</div>
      </div>
    );
  }
  if (!svg) {
    return <div className="mermaid-loading">{loading ? "⏳ 渲染流程图中…" : ""}</div>;
  }

  // 折叠预览（默认）
  const preview = (
    <div
      className="mermaid-render mermaid-preview mermaid-svg-root"
      onClick={() => setExpanded(true)}
      role="button"
      tabIndex={0}
      title="点击查看完整流程图"
    >
      <div
        className="mermaid-preview-inner"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="mermaid-preview-fade" />
      <button
        className="mermaid-expand-btn"
        type="button"
        aria-label="展开"
        onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
        <span>展开</span>
      </button>
    </div>
  );

  return (
    <>
      {preview}
      {expanded && (
        <MermaidModal svg={svg} onClose={() => setExpanded(false)} />
      )}
    </>
  );
}

/** 全屏查看 Modal：缩放 + 拖动 + 滚轮 */
function MermaidModal({ svg, onClose }: { svg: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // 清洗 SVG：mermaid 生成的 SVG 带 width="100%" + 内联 max-width，
  // 在 modal 的居中容器里会形成尺寸循环依赖（塌缩成 0）。
  // 解法：去掉 width="100%" 和内联 max-width，从 viewBox 解析出原始像素尺寸写回 width/height，
  // 让 SVG 有明确固有尺寸，配合 CSS max-width/max-height 等比缩放。
  const cleanSvg = useMemo(() => {
    let s = svg
      .replace(/\swidth="100%"/, "")
      .replace(/\sstyle="max-width:\s*[^;"]*;?"/, "");
    // 从 viewBox="0 0 W H" 提取原始尺寸写回 width/height
    const m = s.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    if (m) {
      s = s.replace(/<svg /, `<svg width="${m[1]}" height="${m[2]}" `);
    }
    return s;
  }, [svg]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setZoom((z) => clamp(z + 0.2, 0.3, 4));
      else if (e.key === "-") setZoom((z) => clamp(z - 0.2, 0.3, 4));
      else if (e.key === "0") { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 滚轮缩放
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setZoom((z) => clamp(+(z + delta).toFixed(2), 0.3, 4));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
  };
  const onPointerUp = () => { dragRef.current = null; };

  return createPortal(
    <div className="mermaid-modal-overlay" onClick={onClose}>
      <div
        className="mermaid-modal-stage"
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
      >
        <div
          className="mermaid-modal-svg mermaid-svg-root"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
          dangerouslySetInnerHTML={{ __html: cleanSvg }}
        />
      </div>

      {/* 工具栏 */}
      <div className="mermaid-modal-toolbar" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setZoom((z) => clamp(+(z - 0.2).toFixed(2), 0.3, 4))} title="缩小 (-)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /></svg>
        </button>
        <span className="mermaid-modal-zoom" title="重置 (0)">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => clamp(+(z + 0.2).toFixed(2), 0.3, 4))} title="放大 (+)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <span className="mermaid-modal-divider" />
        <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="重置 (0)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></svg>
        </button>
        <button type="button" className="mermaid-modal-close" onClick={onClose} title="关闭 (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div className="mermaid-modal-hint">滚轮缩放 · 拖动平移 · 双击/0 重置 · Esc 关闭</div>
    </div>,
    document.body,
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * 清理 Mermaid v11 在 document.body 上残留的临时渲染容器和错误 SVG。
 * Mermaid render() 失败时不会自动清除它创建的 DOM 元素，导致页面布局错乱。
 */
function cleanupMermaidDom(renderId: string) {
  // 1. 移除指定 renderId 的临时容器
  const el = document.getElementById(renderId);
  if (el) el.remove();

  // 2. 移除所有 body 直属的 mermaid 残留元素（id 以 dmm- 或 mmd- 开头的 div）
  document.querySelectorAll('body > div[id^="dmm-"], body > div[id^="mmd-"]').forEach(e => e.remove());

  // 3. 移除 mermaid 错误 SVG 的残留容器（含 "Syntax error" 文本的孤立 SVG 父元素）
  document.querySelectorAll('body > div > svg').forEach(svg => {
    const text = svg.textContent || "";
    if (/Syntax error|Parse error|error in text/i.test(text)) {
      svg.parentElement?.remove();
    }
  });
}
