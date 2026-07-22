// ============================================================
// mcp-manager.ts — MCP (Model Context Protocol) server 连接管理
//
// 读 ~/.pi/agent/mcp.json，连接所有配置的 MCP server，
// 把 MCP tools 转成 Pi Agent 的 ToolDefinition，注入 agent。
// 配置格式（参考 Claude Desktop）：
//   { "mcpServers": { "name": { "command": "...", "args": [...], "env": {} } } }
// ============================================================

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { config } from "./config.js";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolInfo[];
  connectedAt: number;
}

export interface McpToolInfo {
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpServerStatus {
  name: string;
  command: string;
  args: string[];
  status: "connected" | "disconnected" | "error";
  toolCount: number;
  error?: string;
  connectedAt?: number;
}

class McpManager {
  private servers = new Map<string, ConnectedServer>();
  private configPath: string;

  constructor() {
    this.configPath = resolve(process.env.HOME || "~", ".pi/agent/mcp.json");
  }

  /** 读取 mcp.json 配置 */
  readConfig(): McpConfig {
    try {
      if (!existsSync(this.configPath)) return { mcpServers: {} };
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return { mcpServers: parsed.mcpServers || {} };
    } catch (e: any) {
      console.error("[mcp] readConfig error:", e.message);
      return { mcpServers: {} };
    }
  }

  /** 写入 mcp.json 配置 */
  writeConfig(cfg: McpConfig): void {
    writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), "utf-8");
    console.log(`[mcp] config written to ${this.configPath}`);
  }

  /** 连接单个 MCP server */
  private async connectServer(name: string, cfg: McpServerConfig): Promise<ConnectedServer> {
    const args = cfg.args || [];
    const env = { ...process.env, ...cfg.env } as Record<string, string>;

    // StdioClientTransport 接受配置对象，自己管理子进程
    const transport = new StdioClientTransport({
      command: cfg.command,
      args,
      env,
    });

    const client = new Client(
      { name: "myagent", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    const toolsResp = await client.listTools();
    const tools: McpToolInfo[] = (toolsResp.tools || []).map((t: any) => ({
      server: name,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    console.log(`[mcp] ${name}: connected, ${tools.length} tools`);

    return { name, client, transport, tools, connectedAt: Date.now() };
  }

  /** 连接所有配置的 server，已连接的先断开 */
  async connectAll(): Promise<{ connected: string[]; failed: Array<{ name: string; error: string }> }> {
    await this.disconnectAll();
    const cfg = this.readConfig();
    const connected: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const [name, serverCfg] of Object.entries(cfg.mcpServers)) {
      try {
        const srv = await this.connectServer(name, serverCfg);
        this.servers.set(name, srv);
        connected.push(name);
      } catch (e: any) {
        console.error(`[mcp] ${name}: failed - ${e.message}`);
        failed.push({ name, error: e.message ?? String(e) });
      }
    }

    return { connected, failed };
  }

  /** 断开所有 server */
  async disconnectAll(): Promise<void> {
    for (const [name, srv] of this.servers) {
      try {
        await srv.client.close();
      } catch {}
      this.servers.delete(name);
    }
  }

  /** 重载配置并重连 */
  async reload(): Promise<{ connected: string[]; failed: Array<{ name: string; error: string }> }> {
    return this.connectAll();
  }

  /** 列出所有 server 状态 */
  getStatus(): McpServerStatus[] {
    const cfg = this.readConfig();
    return Object.entries(cfg.mcpServers).map(([name, c]) => {
      const srv = this.servers.get(name);
      return {
        name,
        command: c.command,
        args: c.args || [],
        status: srv ? "connected" : "disconnected",
        toolCount: srv?.tools.length ?? 0,
        connectedAt: srv?.connectedAt,
      };
    });
  }

  /** 列出所有已连接的 tools */
  listTools(): McpToolInfo[] {
    const all: McpToolInfo[] = [];
    for (const srv of this.servers.values()) {
      all.push(...srv.tools);
    }
    return all;
  }

  /** 调用 MCP tool */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const srv = this.servers.get(serverName);
    if (!srv) throw new Error(`MCP server not connected: ${serverName}`);
    const result = await srv.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  /** 把所有 MCP tools 转成 Pi Agent ToolDefinition[]，用于注入 customTools */
  toToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const srv of this.servers.values()) {
      for (const tool of srv.tools) {
        const toolName = `mcp__${srv.name}__${tool.name}`;
        defs.push(this.toToolDefinition(toolName, tool));
      }
    }
    return defs;
  }

  /** 单个 MCP tool → ToolDefinition */
  private toToolDefinition(toolName: string, tool: McpToolInfo): ToolDefinition {
    const serverName = tool.server;
    const originalName = tool.name;
    const mcp = this;
    // MCP 返回 JSON Schema，TypeBox 运行时就是 JSON Schema，直接透传
    const parameters = (tool.inputSchema || { type: "object", properties: {} }) as any;

    return {
      name: toolName,
      label: `[MCP:${serverName}] ${originalName}`,
      description: tool.description || `MCP tool ${originalName} from ${serverName}`,
      promptSnippet: `- mcp__${serverName}__${originalName}: ${tool.description || ""}`.trim(),
      parameters,
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        try {
          const result = await mcp.callTool(serverName, originalName, params as Record<string, unknown>);
          // MCP 结果可能是 { content: [{ type: "text", text: "..." }] }
          let outputText = "";
          if (result && typeof result === "object" && "content" in result) {
            const content = (result as any).content;
            if (Array.isArray(content)) {
              outputText = content
                .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
                .join("\n");
            } else {
              outputText = JSON.stringify(content);
            }
          } else {
            outputText = JSON.stringify(result);
          }
          return {
            toolCallId,
            toolName,
            summary: outputText.slice(0, 200),
            output: outputText,
          } as any;
        } catch (e: any) {
          return {
            toolCallId,
            toolName,
            summary: `Error: ${e.message}`,
            output: `Error calling MCP tool ${originalName}: ${e.message}`,
            isError: true,
          } as any;
        }
      },
    } as ToolDefinition;
  }
}

export const mcpManager = new McpManager();
