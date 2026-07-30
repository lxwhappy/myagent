import { createRoot } from "react-dom/client";
import App from "./App";

// 字体（本地自托管，替代 Google Fonts CDN）
import "./styles/fonts.css";
// 设计系统
import "./styles/piagent-ds/tokens.css";
import "./styles/piagent-ds/components.css";
// 功能样式（流式、skill-picker、mermaid 等组件系统未覆盖的部分）
import "./styles.css";

// 主题：在渲染前初始化，确保 data-theme 在首次绘制时就设置好（避免 FOUC 闪烁）
import "./stores/theme";

createRoot(document.getElementById("root")!).render(<App />);
