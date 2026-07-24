# PiAgent Design System

AI Agent Web Console 设计系统包 — 从 MyAgent 原型中提取的可复用设计语言。

## 快速开始

### 方式 1：纯 HTML 项目

```html
<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="./tokens.css">
  <link rel="stylesheet" href="./components.css">
</head>
<body>
  <!-- 内联图标 sprite -->
  <div id="icons" hidden>
    <!-- 把 icons.svg 的内容粘贴到这里 -->
  </div>

  <!-- 使用组件 -->
  <button class="btn-send"><svg class="icon"><use href="#i-send"/></svg></button>
</body>
</html>
```

### 方式 2：React 项目（如 myagent）

```bash
# 复制文件到项目
cp tokens.css components.css icons.svg your-project/src/styles/piagent-ds/
```

```tsx
// main.tsx 或 App.tsx 顶部引入
import './styles/piagent-ds/tokens.css'
import './styles/piagent-ds/components.css'

// 组件中使用
function SendButton() {
  return (
    <button className="btn-send">
      <svg className="icon"><use href="#i-send" /></svg>
    </button>
  )
}
```

如果想用 CSS Modules，把 class 名加后缀即可：
```css
/* ChatInput.module.css */
.sendButton { composes: btn-send from './piagent-ds/components.css'; }
```

### 方式 3：Next.js 项目（App Router）

Next.js 是这套设计系统最自然的落地场景——CSS 变量对 SSR 零成本，`next/font` 自动优化字体，不需要额外配置。

**Step 1 — 复制文件**

```bash
mkdir -p src/styles/piagent-ds
cp tokens.css components.css icons.svg src/styles/piagent-ds/
```

**Step 2 — 全局样式引入（App Router）**

```tsx
// app/layout.tsx
import '@/styles/piagent-ds/tokens.css'
import '@/styles/piagent-ds/components.css'
import { Inter, JetBrains_Mono } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-body' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

> `next/font` 会自动把 `--font-body` / `--font-mono` 映射到 `tokens.css` 的令牌，无需手动写 `font-family`。`--font-display` 同理用 `Inter`（Neutral Modern 规定 display = body = Inter）。

**Step 3 — 图标组件（替代 SVG sprite）**

Next.js 推荐用 React 组件而非 `<use>` 引用。创建一个 Icon wrapper：

```tsx
// components/Icon.tsx — Client Component
'use client'
import { useRef, useEffect } from 'react'

const SPRITE_PATH = '/icons.svg'  // 放到 public/icons.svg

export function Icon({ name, size = 18, className = 'icon' }: {
  name: string; size?: number; className?: string
}) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true">
      <use href={`${SPRITE_PATH}#${name}`} />
    </svg>
  )
}

// 使用：<Icon name="i-send" />  <Icon name="i-plus" size={20} />
```

把 `icons.svg` 复制到 `public/` 目录即可（Next.js 静态资源自动服务）。

**Step 4 — 组件中使用**

```tsx
// app/page.tsx — Server Component 可以直接用 class（CSS 是全局的）
import { Icon } from '@/components/Icon'  // Icon 本身是 Client Component

export default function Page() {
  return (
    <div className="app">
      <aside className="sidebar">
        <button className="sb-header-btn">
          <Icon name="i-plus" />
          新建会话
        </button>
      </aside>
      <main className="main">
        {/* 消息列表、输入栏等 */}
      </main>
    </div>
  )
}
```

> **Server vs Client 组件：** 纯展示组件（用 CSS class）可以是 Server Component；带交互（onClick / useState）的组件加 `'use client'`。CSS class 在两者中都能用，无限制。

**Step 5 — 暗色模式（可选，配合 next-themes）**

```tsx
// components/ThemeProvider.tsx
'use client'
import { ThemeProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider attribute="class" defaultTheme="light">{children}</ThemeProvider>
}
```

然后在 `tokens.css` 末尾加：
```css
.dark {
  --bg: #181825;
  --surface: #1e1e2e;
  --fg: #cdd6f4;
  --muted: #6c7086;
  --border: #313244;
  --accent: #89b4fa;
  --accent-tint: color-mix(in oklab, #89b4fa, #1e1e2e 85%);
}
```

### 方式 4：Vue 项目

```vue
<!-- App.vue -->
<style>
@import './styles/piagent-ds/tokens.css';
@import './styles/piagent-ds/components.css';
</style>

<template>
  <button class="btn-send">
    <svg class="icon"><use href="#i-send" /></svg>
  </button>
</template>
```

## 文件清单

```
pi-agent-design-system/
├── tokens.css          ← 设计令牌（颜色/字体/间距/圆角/动效），唯一需要自定义的文件
├── components.css      ← 全部组件样式（19 个模块），依赖 tokens.css
├── icons.svg           ← 28 个 SVG 图标 symbol，内联使用
├── DESIGN.md           ← 设计规范文档（色彩/字体/布局/组件用法）
├── README.md           ← 本文件（集成指南）
└── index.html          ← 组件预览页（浏览器直接打开）
```

## 自定义

### 改主题色

只需覆盖 `tokens.css` 中的令牌值：

```css
:root {
  --accent: #8b5cf6;  /* 改成紫色 */
  --bg: #f8fafc;      /* 改背景 */
}
```

所有组件通过 `var(--xxx)` 引用，会自动跟随。

### 改字体

```css
:root {
  --font-display: "Noto Sans SC", system-ui, sans-serif;
  --font-body: "Noto Sans SC", system-ui, sans-serif;
  --font-mono: "Fira Code", monospace;
}
```

### 暗色模式

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #181825;
    --surface: #1e1e2e;
    --fg: #cdd6f4;
    --muted: #6c7086;
    --border: #313244;
    --accent: #89b4fa;
    --accent-tint: color-mix(in oklab, #89b4fa, #1e1e2e 85%);
  }
}
```

### 改侧边栏宽度

```css
:root {
  --sidebar-w: 300px;  /* 默认 264px */
}
```

## 组件模块索引

| 模块 | CSS 区域 | 核心 class |
|---|---|---|
| App Shell | §2 | `.app`, `.main-body`, `.chat-pane` |
| 侧边栏头部 | §3 | `.sb-header`, `.ws-switcher`, `.sb-header-btn` |
| 侧边栏导航 | §4 | `.sb-nav`, `.sb-tab`, `.sb-search-bar` |
| 会话列表 | §5 | `.session-list`, `.session-item`, `.session-title` |
| 文件树 | §6 | `.file-tree-panel`, `.file-node`, `.file-children` |
| 侧边栏底部 | §7 | `.sb-footer`, `.token-row`, `.user-row` |
| 聊天头部 | §8 | `.chat-head`, `.chat-title`, `.icon-btn` |
| 消息 | §9 | `.msg`, `.msg-content`, `.msg-user` |
| 代码块 | §10 | `.code-block`, `.code-header`, `.code-copy` |
| 工具调用 | §11 | `.tool-call`, `.tool-call-header`, `.tool-status` |
| 输入栏 | §12 | `.input-bar`, `.input-wrapper`, `.btn-send` |
| 空状态 | §13 | `.empty-state`, `.suggestions`, `.suggestion-card` |
| 代码预览 | §14 | `.preview-pane`, `.preview-code`, `.tok-*` |
| 工作空间下拉 | §15 | `.ws-dropdown`, `.ws-dropdown-item` |
| 工作空间弹窗 | §16 | `.modal-overlay`, `.modal`, `.ws-ws-item` |
| 设置弹窗 | §17 | `.settings-modal`, `.settings-tab` |
| 配置控件 | §18 | `.toggle`, `.slider`, `.config-select`, `.skill-item` |

## 图标列表

```
i-plus i-search i-send i-paperclip i-settings i-x i-chevron
i-menu i-bot i-tool i-check i-copy i-edit i-download i-code
i-zap i-terminal i-file i-database i-message i-globe
i-folder i-folder-open i-git i-clock i-tree i-arrow-r i-activity
```

使用方式：`<svg class="icon"><use href="#i-plus"/></svg>`

## 交互模式复用

这套系统沉淀了 5 个有设计含量的交互模式，可在任何技术栈中复用：

### 1. 四区域侧边栏
```
Header(选择器) → Nav(Tab+搜索) → Content(列表) → Footer(状态+用户)
```
每区域唯一职责，纵向空间最优。

### 2. 会话-工作空间隔离
顶部选择器切换上下文，下方列表只显示当前空间的数据。

### 3. Tab 共享区域
会话/文件共享同一区域，Tab 切换不额外占空间。搜索是 Tab 栏的图标按钮。

### 4. 文件树 → 代码预览分栏
点击文件在右侧滑出预览面板，关闭恢复全宽。预览面板用独立代码主题。

### 5. Token 用量进度条
底部常驻，按会话实时计算百分比，状态色分级（绿/黄/红）。

## 与 myagent 项目集成

如果你的 myagent 项目（Fastify + React + Zustand）要使用：

```bash
# 1. 复制文件
cp -r output/pi-agent-design-system/ ~/workspace/myagent/web/src/styles/piagent-ds/

# 2. 在 main.tsx 引入
import '@/styles/piagent-ds/tokens.css'
import '@/styles/piagent-ds/components.css'

# 3. 在 index.html 内联图标 sprite（或用 react-inlinesvg）
```

Zustand store 可以管理 `--accent` 等令牌的动态切换：
```tsx
useThemeStore.subscribe((state) => {
  document.documentElement.style.setProperty('--accent', state.accentColor)
})
```
