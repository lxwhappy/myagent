// components/Icon.tsx — SVG 图标组件
//
// 使用内联 symbol sprite，避免外部文件加载。

import { memo } from "react";

const ICONS: Record<string, string> = {
  "i-plus": "M12 5v14M5 12h14",
  "i-search": "M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.35-4.35",
  "i-send": "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  "i-paperclip": "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  "i-settings": "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  "i-x": "M18 6L6 18M6 6l12 12",
  "i-chevron": "M6 9l6 6 6-6",
  "i-sidebar-collapse": "M3 4h18v16H3z M9 4v16",
  "i-menu": "M3 12h18M3 6h18M3 18h18",
  "i-bot": "M3 11a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M12 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M12 7v2",
  "i-tool": "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  "i-check": "M20 6L9 17l-5-5",
  "i-copy": "M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  "i-download": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  "i-code": "M16 18l6-6-6-6 M8 6l-6 6 6 6",
  "i-zap": "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  "i-terminal": "M4 17l6-6-6-6 M12 19h8",
  "i-file": "M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M13 2v7h7",
  "i-folder": "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  "i-folder-open": "M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v1H7l-4 8z M21 11v6a2 2 0 0 1-2 2H6",
  "i-git": "M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M6 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M18 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M6 9v6 M15 12H9",
  "i-clock": "M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0 M12 6v6l4 2",
  "i-message": "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  "i-globe": "M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0 M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  "i-edit": "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  "i-activity": "M22 12h-4l-3 9L9 3l-3 9H2",
  "i-arrow-r": "M9 18l6-6-6-6",
  "i-trash": "M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6",
  "i-lightbulb": "M15 14c.2-1 .7-1.7 1.5-2.5C17.9 10.4 18 9 18 8a6 6 0 0 0-12 0c0 1 .1 2.4 1.5 3.5.8.8 1.3 1.5 1.5 2.5 M9 18h6 M10 22h4",
  "i-bot-robot": "M12 8V4H8 M12 8V4h4 M8 14v.01 M16 14v.01 M11 18h2 M12 2v2 M2 9a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z",
  "i-loader": "M12 2a10 10 0 1 1-7 2.9",
};

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  "aria-label"?: string;
}

export const Icon = memo(function Icon({ name, size = 18, className = "icon", ...rest }: IconProps) {
  const path = ICONS[name];
  if (!path) return null;
  const paths = path.split("M").map((seg, i) =>
    i === 0 ? null : <path key={i} d={"M" + seg} />
  ).filter(Boolean);
  const isSpin = className.includes("icon-spin");
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest["aria-label"] ? undefined : true}
      role={rest["aria-label"] ? "img" : undefined}
      {...rest}
    >
      {isSpin ? <g className="spin-group">{paths}</g> : paths}
    </svg>
  );
});
