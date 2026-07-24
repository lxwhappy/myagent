import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",  // 允许 Tailscale/LAN 访问
    allowedHosts: true,  // 允许所有 host（Tailscale IP/域名）
    // HMR 不设 host，自动用页面当前 URL（IP 或域名都行）
    hmr: {
      protocol: "ws",
      clientPort: 5173,
    },
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        // SSE 需要禁用缓冲
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            // 对 /api/events 的 SSE 响应不缓冲
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
});
