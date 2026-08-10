# MyAgent 快速入门教程 - 视频脚本

## 视频信息
- 时长：约 3-5 分钟
- 风格：简洁、技术向、深色主题
- 目标受众：开发者、AI 爱好者

---

## 章节结构

### Scene 1: 开场标题 (0:00 - 0:15)
- 标题：MyAgent 快速入门
- 副标题：基于 Pi Agent 的 AI Agent + Web 端
- 动效：文字渐入 + 背景微动

### Scene 2: 什么是 MyAgent (0:15 - 0:30)
- 说明：MyAgent 是一个基于 Pi Agent 的小而巧的 AI Agent 系统
- 特点：
  - Node.js 后端 + React 前端
  - WebSocket 实时通信
  - 支持自定义工具和技能

### Scene 3: 安装配置 (0:30 - 1:15)
- 步骤 1：克隆/获取项目代码
- 步骤 2：安装依赖
  ```bash
  pnpm install
  ```
- 步骤 3：配置 API Key
  ```bash
  export ANTHROPIC_API_KEY=sk-ant-your-key-here
  ```
- 说明：也支持 OpenAI、Google、Ollama 等多种 LLM

### Scene 4: 启动服务 (1:15 - 1:45)
- 命令：
  ```bash
  pnpm dev  # 同时启动前后端
  # 或分别启动
  pnpm dev:server  # 后端 3000
  pnpm dev:web     # 前端 5180
  ```
- 展示界面截图

### Scene 5: 基本使用 (1:45 - 2:45)
- 打开浏览器访问 http://localhost:5180
- 展示主界面：
  - 对话区域
  - 输入框
  - 工具执行展示
  - 思考过程面板
- 演示简单对话
- 演示工具调用（如读取文件、执行命令等）

### Scene 6: 切换模型和 Agent (2:45 - 3:15)
- 展示设置面板：切换 LLM Provider
- 展示 Agent 管理：创建自定义 Agent 预设
- 说明：支持多会话、多 Agent 管理

### Scene 7: 扩展功能 (3:15 - 3:45)
- 添加自定义工具
- 安装 Skills
- 二次开发指引

### Scene 8: 结尾 (3:45 - 4:00)
- 总结：快速上手 MyAgent
- 呼吁：开始体验吧！
- 展示项目链接

---

## 视觉风格

### 配色方案（深色主题）
- 主色：#e07855（橙色 accent）
- 背景：#1a1a1a
- 表面：#242424
- 边框：#333
- 文字：#e0e0e0
- 次要文字：#888

### 字体
- 标题：system-ui, -apple-system, sans-serif
- 代码：SF Mono, JetBrains Mono, monospace

### 动效风格
- 入场：平滑淡入 + 轻微位移
- 过渡：快速淡出淡入
- 代码打字：逐字显示效果

---

## 素材清单
- [ ] 界面截图：main-interface.png
- [ ] 界面截图：settings.png
- [ ] 界面截图：agent-selector.png
- [ ] 代码片段：安装、配置、启动命令
- [ ] 代码高亮样式