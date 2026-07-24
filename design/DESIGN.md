# PiAgent Design System

> Category: AI Agent Console
> 基于 Neutral Modern 的 AI Agent Web 控制台设计系统。
> 适用于对话型 AI 工具、开发者助手、Agent 管理平台。

## 视觉基调

冷静、功能导向、安静自信。无装饰。内容优先，外壳其次。
参考产品：ChatGPT、Cursor、Linear、Claude.ai。

## 色彩系统

### 表面层
| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` | `#FAFAFA` | 页面背景 |
| `--surface` | `#FFFFFF` | 卡片、面板、侧边栏 |
| `--surface-warm` | `= --surface` | 预留暖色层 |

### 前景文字
| 令牌 | 值 | 用途 |
|---|---|---|
| `--fg` | `#111111` | 主要文字 |
| `--fg-2` | `= --fg` | 次要文字（预留） |
| `--muted` | `#6B6B6B` | 辅助文字、时间戳、placeholder |
| `--meta` | `= --muted` | 元数据（预留） |

### 边框
| 令牌 | 值 | 用途 |
|---|---|---|
| `--border` | `#E5E5E5` | 标准分隔线、卡片边框 |
| `--border-soft` | `= --border` | 轻量分隔（预留） |

### 强调色
| 令牌 | 值 | 用途 |
|---|---|---|
| `--accent` | `#2F6FEB` | 钴蓝 — CTA、链接、激活态、焦点环 |
| `--accent-on` | `#FFFFFF` | accent 背景上的文字 |
| `--accent-tint` | `mix(white 90%)` | 激活项背景、用户消息气泡、badge |

**规则：** 每屏 accent 使用 ≤ 2 处（一个 CTA + 一个焦点元素）。

### 语义色
| 令牌 | 值 | 用途 |
|---|---|---|
| `--success` | `#17A34A` | 完成、在线、git 分支 |
| `--warn` | `#EAB308` | 运行中、Token 60-85% |
| `--danger` | `#DC2626` | 错误、关闭按钮 hover、Token ≥85% |

### 代码主题（Catppuccin Mocha）
| 令牌 | 值 | 用途 |
|---|---|---|
| `--code-bg` | `#1E1E2E` | 代码块/预览背景 |
| `--code-bg-2` | `#181825` | 代码头部、状态栏背景 |
| `--code-fg` | `#CDD6F4` | 代码文字 |
| `--code-dim` | `#6C7086` | 语言标签、注释 |

## 字体

| 角色 | 字体 | 权重 |
|---|---|---|
| Display/标题 | Inter | 600 |
| Body/正文 | Inter | 400 |
| Mono/代码 | JetBrains Mono | 400/500 |

### 字号
```
xs: 12px | sm: 14px | base: 16px | lg: 20px
xl: 24px | 2xl: 32px | 3xl: 48px | 4xl: 64px
```

### 行高
- 正文: 1.5
- 标题: 1.2
- ≥32px 标题: `letter-spacing: -0.01em`

## 布局架构

### App Shell（双栏）
```
┌──────────┬──────────────────────────────┐
│          │  Chat Header (56px)          │
│ Sidebar  ├──────────────────────────────┤
│ (264px)  │                              │
│          │  Messages (flex, scrollable) │
│ Zone 1-4 │                              │
│          ├──────────────────────────────┤
│          │  Input Bar                   │
└──────────┴──────────────────────────────┘
```

### Sidebar 四区域架构
```
┌─────────────────────────────┐
│ Zone 1: Header (40px)       │ ← 工作空间选择器 + 新建按钮
├─────────────────────────────┤
│ Zone 2: Nav (36px)          │ ← Tab(会话/文件) + 搜索图标
├─────────────────────────────┤
│ Zone 3: Content (flex)      │ ← 会话列表 / 文件树
│                             │
├─────────────────────────────┤
│ Zone 4: Footer (56px)       │ ← Token 进度条 + 用户行
└─────────────────────────────┘
```

### 间距（4px 基数）
```
4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 80 px
```

### 圆角
```
sm: 8px (按钮/输入) | md: 12px (卡片/弹窗) | lg: 16px (消息气泡) | pill: 9999px (badge)
```

## 组件规范

### 按钮
- **Primary**: 钴蓝填充 + 白字, `radius-sm`, `padding: 10px 16px`
- **Secondary**: 1px border + 透明背景
- **Icon button**: 36×36px, hover 变 `--bg` 背景

### 卡片
- 白色, 1px border, `radius-md`, 20px 内边距, 默认无阴影

### 输入框
- 1px border, `radius-sm`, focus 时 border 变 accent + focus-ring

### 消息
- **Assistant**: 头像 + 左对齐, max-width 820px, Markdown 渲染
- **User**: 右对齐, accent-tint 气泡, `radius-lg` + 右下角 `radius-sm`

### 代码块
- Catppuccin Mocha 深色主题
- 头部: 语言标签 + 复制按钮
- 字号 13px, 行高 1.65, 等宽字体

### 工具调用
- 可折叠卡片, 状态点 (完成=绿/运行=黄)
- 展开显示输入参数和输出结果

### 模态框
- `min(560px, 92vw)`, `radius-lg`, scale 入场动画
- 遮罩: `rgba(0,0,0,0.45)`

## 深度

仅两个层级：
- **Flat (0)**: 默认
- **Raised (1)**: 弹窗、下拉 — `0 2px 8px rgba(0,0,0,0.08)`

## 响应式

| 断点 | 行为 |
|---|---|
| ≥1024px | 双栏布局 |
| 768-1023px | 双栏布局, 预览面板保持 |
| <768px | 单栏, 侧边栏变 drawer, 预览全屏覆盖 |

## 设计原则

1. **克制**: accent 每屏 ≤ 2 处, 一个决定性点缀
2. **密度**: 信息密度是特性, 但通过留白节奏而非边框分隔
3. **层级**: 每屏视觉焦点唯一, 眼睛只落在一个地方
4. **一致性**: 所有图标按钮统一 32-36px + 8px 圆角 + 一致 hover
5. **可逆**: hover/active/focus 都有视觉反馈, 过渡 ≤ 200ms

## 禁止

- ❌ 渐变背景（accent → accent-80% 的 hero 渐变除外）
- ❌ 输入框阴影
- ❌ 每屏超过 3 个字号
- ❌ 装饰性 emoji 图标
- ❌ :root 外裸 hex 值
- ❌ 纯黑/纯白背景
