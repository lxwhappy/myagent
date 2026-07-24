import { createRoot } from "react-dom/client";
import App from "./App";

// 设计系统
import "./styles/piagent-ds/tokens.css";
import "./styles/piagent-ds/components.css";
// 功能样式（流式、skill-picker、mermaid 等组件系统未覆盖的部分）
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
