# MyAgent 快速入门教程 - 使用说明

## 📹 视频交付

已生成两个版本的 MP4 视频：

| 文件 | 大小 | 质量 | 路径 |
|------|------|------|------|
| `myagent-quickstart-draft.mp4` | 917 KB | Draft (快速预览) | `myagent-quickstart/myagent-quickstart-draft.mp4` |
| `myagent-quickstart.mp4` | 1.4 MB | High (正式发布) | `myagent-quickstart/myagent-quickstart.mp4` |

**视频规格：**
- 分辨率：1280×720 (720p)
- 帧率：30 FPS
- 时长：~20 秒
- 编码：H.264 (MP4)

---

## 📋 视频内容

### 章节结构
1. **开场标题** (0-2s) - MyAgent 快速入门教程
2. **什么是 MyAgent** (2-4s) - 系统介绍
3. **安装配置** (4-7s) - pnpm install + API Key 配置
4. **启动服务** (7-9.5s) - pnpm dev 命令
5. **主界面介绍** (9.5-11.5s) - 界面截图展示
6. **基本功能** (11.5-13.5s) - 对话交互 + 工具调用
7. **切换模型** (13.5-15.5s) - 设置面板展示
8. **Agent 管理** (15.5-17.5s) - Agent 选择器展示
9. **扩展功能** (17.5-20s) - 自定义工具 + Skills
10. **结尾呼吁** (20s+) - 开始体验 MyAgent

### 字幕内容
视频底部配有动态字幕，讲述每个章节的核心内容。字幕列表：

| 时间段 | 字幕文本 |
|--------|----------|
| 0-2s | MyAgent 快速入门教程，基于 Pi Agent 的 AI Agent + Web 端 |
| 2-4s | MyAgent 是一个基于 Pi Agent 的小而巧的 AI Agent 系统，支持多种模型 |
| 4-7s | 使用 pnpm install 安装依赖，然后配置 ANTHROPIC_API_KEY |
| 7-9.5s | 运行 pnpm dev 同时启动前后端，或分别启动服务和前端 |
| 9.5-11.5s | 主界面提供对话区域和工具执行展示，支持自然语言交互 |
| 11.5-13.5s | 基本功能包括对话交互和工具调用，支持读取文件、执行命令等 |
| 13.5-15.5s | 在设置面板中可以切换 LLM Provider 和选择不同的模型 |
| 15.5-17.5s | Agent 管理支持创建自定义角色预设，定义不同的系统提示词 |
| 17.5-20s | 扩展功能支持自定义工具、Skills 系统和二次开发 |
| 20-22s | 开始体验 MyAgent，快速上手，自定义扩展，无限可能 |

---

## 🎨 视觉风格

### 配色方案（深色主题）
- **主色（橙色）**：`#e07855` - 用于强调、按钮、高亮
- **背景**：`#1a1a1a` - 深灰背景
- **表面**：`#242424` - 卡片、代码块背景
- **边框**：`#333` - 分割线、容器边框
- **主文字**：`#e0e0e0` - 正文内容
- **次要文字**：`#888` - 注释、说明文字
- **代码背景**：`#1e1e1e` - 代码块背景

### 字体
- **标题/正文**：System Font（-apple-system, BlinkMacSystemFont, Segoe UI, Roboto）
- **代码**：SF Mono / JetBrains Mono / Fira Code

### 动效风格
- 入场动画：平滑淡入 + 轻微位移（y 轴）
- 场景切换：快速淡出淡入（0.25s 过渡）
- 元素动画：stagger 交错动画（列表项）

---

## 🔧 源文件说明

### index.html
HyperFrames 格式的 HTML 源文件，包含：
- 完整的 CSS 样式（深色主题）
- 10 个场景的静态内容
- GSAP 动画时间线
- 动态字幕系统

### 截图素材（assets/screenshots/）
- `main-interface.png` - 主界面截图
- `settings.png` - 设置面板截图
- `agent-selector.png` - Agent 选择器截图

### hyperframes.json
项目配置文件：
```json
{
  "paths": {
    "blocks": "compositions",
    "components": "compositions/components",
    "assets": "assets"
  },
  "media": {
    "autoProxy": true
  }
}
```

---

## 🚀 如何修改视频

### 修改文字内容
1. 编辑 `index.html`，找到对应的场景元素（如 `#scene-title`）
2. 修改 `h1`、`p`、`li` 等标签内的文本
3. 如需调整字幕，修改 JavaScript 中的 `captions` 数组

### 修改动画时长
1. 编辑 `index.html` 底部的 JavaScript
2. 修改 `sceneDurations` 数组（单位：秒）
3. 相应更新 `data-duration` 属性和字幕时间

### 添加新截图
1. 将截图放入 `assets/screenshots/` 目录
2. 在 HTML 中引用：`<img src="assets/screenshots/your-image.png">`

### 重新渲染视频
```bash
cd myagent-quickstart

# 快速预览（Draft 质量）
npx hyperframes render --quality draft --output myagent-quickstart-draft.mp4

# 高质量渲染
npx hyperframes render --quality high --output myagent-quickstart.mp4
```

---

## 📦 发布建议

### 直接使用
- 推荐 `myagent-quickstart.mp4`（1.4 MB，高质量）
- 适合嵌入网站、GitHub README、文档中心

### 压缩（如需更小体积）
```bash
# 使用 FFmpeg 进一步压缩
ffmpeg -i myagent-quickstart.mp4 -vcodec libx264 -crf 28 -preset medium myagent-quickstart-compressed.mp4
```

### 多格式导出
```bash
# WebM 格式（更好的 Web 兼容性）
ffmpeg -i myagent-quickstart.mp4 -c:v libvpx -crf 10 -b:v 1M -c:a libvorbis myagent-quickstart.webm

# GIF 格式（用于社交媒体分享）
ffmpeg -i myagent-quickstart.mp4 -vf "fps=10,scale=640:-1" myagent-quickstart.gif
```

---

## 📝 可选改进

### 添加背景音乐
1. 在 `index.html` 中添加 `<audio>` 元素
2. 使用 `npx hyperframes tts` 或外部音频文件
3. 在 GSAP timeline 中添加音频同步逻辑

### 添加旁白（TTS）
```bash
# 生成语音旁白
npx hyperframes tts "MyAgent 快速入门教程" --voice z_xiaoxiao --output narration.wav
```

### 增加场景过渡效果
```bash
# 安装 Shader 过渡效果
npx hyperframes add flash-through-white
npx hyperframes add liquid-wipe
```

---

## 📧 技术支持

如有问题，请参考：
- HyperFrames 文档：https://hyperframes.heygen.com
- GSAP 动画库：https://gsap.com/docs/
- 本项目目录：`myagent-quickstart/`

---

**生成时间：** 2025-08-07
**工具版本：** HyperFrames 0.7.96