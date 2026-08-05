import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import type { FileItem } from "../hooks/workspace-types";
import { Icon } from "./Icon";
import { CodeBlock } from "./CodeBlock";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "../stores/chat";
import { getSessionStats } from "../utils/sessionStats";
import { useWorkspaceStore } from "../stores/workspace";
import { useUIStore } from "../stores/ui";

// ════════════════════════════════════════════════════════
// 侧边栏"文件"Tab：文件树 + 搜索 + 文件/变更切换
// ════════════════════════════════════════════════════════
export function SidebarFileTree({ onOpenFile }: { onOpenFile: () => void }) {
  const ws = useWorkspace();
  const activeWs = ws.workspaces.find(w => w.id === ws.activeId);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([""]));
  const [searchResults, setSearchResults] = useState<FileItem[] | null>(null);
  const [activeTab, setActiveTab] = useState<"files" | "changes">("files");
  const prevWsId = useRef<string | null>(ws.activeId);

  // 订阅 UI store：TaskSummaryCard 点击文件 → 自动切到"变更"子tab
  const gotoFilesTab = useUIStore(s => s.gotoFilesTab);
  useEffect(() => {
    if (gotoFilesTab > 0) setActiveTab("changes");
  }, [gotoFilesTab]);

  // 统一的文件打开逻辑：加载文件内容 + 通知 App 打开右侧面板
  const handleOpenFile = useCallback((path: string) => {
    if (activeWs) {
      ws.openFile(activeWs.id, path);
      onOpenFile();
    }
  }, [activeWs, ws, onOpenFile]);

  useEffect(() => {
    if (prevWsId.current !== ws.activeId) {
      prevWsId.current = ws.activeId;
      setExpandedDirs(new Set([""]));
      setSearchResults(null);
      ws.setSearchQuery("");
      ws.closeFile();
    }
  }, [ws.activeId]);

  useEffect(() => {
    if (!ws.activeId || !ws.searchQuery) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      const results = await ws.searchFiles(ws.activeId!, ws.searchQuery);
      setSearchResults(results);
    }, 200);
    return () => clearTimeout(timer);
  }, [ws.searchQuery, ws.activeId]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  if (!activeWs) {
    return <div className="ws-empty-hint">先选择工作空间</div>;
  }

  return (
    <div className="sidebar-file-panel">
      {/* Tab: 文件 / 变更 */}
      <div className="sb-file-tabs">
        <button className={`sb-file-tab ${activeTab === "files" ? "active" : ""}`} onClick={() => setActiveTab("files")}>
          <Icon name="i-folder" size={14} /> 文件
        </button>
        <button className={`sb-file-tab ${activeTab === "changes" ? "active" : ""}`} onClick={() => setActiveTab("changes")}>
          <Icon name="i-edit" size={14} /> 变更
          <ChangesBadge />
        </button>
      </div>

      {activeTab === "changes" ? (
        <ChangesPanel wsId={activeWs.id} openFile={handleOpenFile} />
      ) : (
        <>
          {/* 搜索框 */}
          <div className="sb-file-search">
            <Icon name="i-search" size={13} className="sb-file-search-icon" />
            <input
              type="text"
              placeholder="筛选文件..."
              value={ws.searchQuery}
              onChange={e => ws.setSearchQuery(e.target.value)}
            />
          </div>

          {/* 搜索结果 or 目录树 */}
          <div className="sb-file-list">
            {searchResults ? (
              <div className="sb-search-results">
                {searchResults.length === 0 ? (
                  <div className="sb-file-empty">无匹配文件</div>
                ) : (
                  searchResults.map(item => (
                    <div
                      key={item.path}
                      className={`file-node ${ws.currentFile?.path === item.path ? "active" : ""}`}
                      onClick={() => item.type === "file" && handleOpenFile(item.path)}
                    >
                      {item.type === "dir"
                        ? <Icon name="i-folder" size={15} className="file-node-icon folder" />
                        : <Icon name="i-file" size={15} className="file-node-icon" />}
                      <span className="file-node-name">{item.name}</span>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <FileTree
                key={activeWs.id}
                wsId={activeWs.id}
                basePath=""
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                listDir={ws.listDir}
                openFile={handleOpenFile}
                currentPath={ws.currentFile?.path}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── 变更徽标 ──
function ChangesBadge() {
  const activeChatId = useChatStore(s => s.activeChatSessionId);
  const messages = useChatStore(s => activeChatId ? s.sessions[activeChatId]?.messages : undefined);
  const subagents = useChatStore(s => activeChatId ? s.sessions[activeChatId]?.subagents : undefined);
  if (!messages) return null;
  const stats = getSessionStats(messages, subagents);
  if (stats.filesChanged.length === 0) return null;
  return <span className="sb-file-tab-badge">{stats.filesChanged.length}</span>;
}

// ── 变更面板 ──
function ChangesPanel({ wsId, openFile }: { wsId?: string; openFile: (path: string) => void }) {
  const activeChatId = useChatStore(s => s.activeChatSessionId);
  const messages = useChatStore(s => activeChatId ? s.sessions[activeChatId]?.messages : undefined);
  const subagents = useChatStore(s => activeChatId ? s.sessions[activeChatId]?.subagents : undefined);
  const highlightFilePath = useUIStore(s => s.highlightFilePath);

  if (!messages || messages.length === 0) return <div className="sb-file-empty">本次会话暂无活动</div>;

  const stats = getSessionStats(messages, subagents);
  if (stats.filesChanged.length === 0) {
    return (
      <div className="sb-file-empty">
        <Icon name="i-activity" size={24} />
        <p>本次会话暂无文件变更</p>
      </div>
    );
  }

  return (
    <div className="sb-changes-panel">
      <div className="sb-changes-stats">
        <div className="sb-changes-stat"><span className="sb-changes-stat-value">{stats.filesChanged.length}</span><span>文件</span></div>
        <div className="sb-changes-stat"><span className="sb-changes-stat-value">{stats.edits}</span><span>编辑</span></div>
        <div className="sb-changes-stat"><span className="sb-changes-stat-value">{stats.commands}</span><span>命令</span></div>
      </div>
      <div className="sb-changes-list">
        {stats.filesChanged.map(f => (
          <div
            key={f.path}
            className={`sb-change-item ${highlightFilePath === f.path ? "sb-change-item-hl" : ""}`}
            onClick={() => wsId && openFile(f.path)}
          >
            <span className={`sb-change-dot ${f.lastStatus === "error" ? "error" : "done"}`} />
            <div className="sb-change-info">
              <span className="sb-change-name">
                {f.name}
                {f.source === "subagent" && <span className="sb-change-source" title="子 Agent 变更">🤖</span>}
              </span>
              <span className="sb-change-path">{f.path}</span>
            </div>
            {f.edits > 1 && <span className="sb-change-count">{f.edits}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 递归文件树 ──
function FileTree({
  wsId, basePath, expandedDirs, toggleDir, listDir, openFile, currentPath, depth = 0,
}: {
  wsId: string;
  basePath: string;
  expandedDirs: Set<string>;
  toggleDir: (p: string) => void;
  listDir: (wsId: string, p: string) => Promise<FileItem[]>;
  openFile: (p: string) => void;
  currentPath?: string;
  depth?: number;
}) {
  const [items, setItems] = useState<FileItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const expanded = expandedDirs.has(basePath);

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      setItems(await listDir(wsId, basePath));
      setLoaded(true);
    } catch { setLoaded(true); }
  }, [wsId, basePath, loaded, listDir]);

  if (depth === 0 || expanded) load();
  if (!loaded) return <div style={{ paddingLeft: depth * 14 + 12 }} className="sb-file-loading">...</div>;

  return (
    <>
      {items.map(item => {
        const isDir = item.type === "dir";
        const isOpen = expandedDirs.has(item.path);
        const isActive = currentPath === item.path;
        return (
          <div key={item.path}>
            <div
              className={`file-node ${isActive ? "active" : ""} ${isDir ? "folder" : ""}`}
              style={{ paddingLeft: depth * 14 + 8 }}
              onClick={() => isDir ? toggleDir(item.path) : openFile(item.path)}
            >
              {isDir ? (
                <span className={`file-chevron ${isOpen ? "open" : ""}`}>
                  <Icon name="i-chevron" size={12} />
                </span>
              ) : (
                <span className="file-chevron-spacer" />
              )}
              {isDir ? (
                <Icon name={isOpen ? "i-folder-open" : "i-folder"} size={15} className="file-node-icon folder" />
              ) : (
                <Icon name="i-file" size={15} className="file-node-icon" />
              )}
              <span className="file-node-name">{item.name}</span>
            </div>
            {isDir && isOpen && (
              <FileTree
                wsId={wsId} basePath={item.path}
                expandedDirs={expandedDirs} toggleDir={toggleDir}
                listDir={listDir} openFile={openFile}
                currentPath={currentPath} depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

// ════════════════════════════════════════════════════════
// 右侧预览面板：只显示文件内容
// ════════════════════════════════════════════════════════
export function FilePreviewPane() {
  const ws = useWorkspace();
  const wsStore = useWorkspaceStore();
  const [viewMode, setViewMode] = useState<"source" | "diff">("source");
  const [diffData, setDiffData] = useState<string | null | undefined>(undefined); // undefined=未加载, null=无diff, string=diff内容
  const [diffLoading, setDiffLoading] = useState(false);

  const close = () => {
    ws.closeFile();
    wsStore.setDrawerOpen(false);
  };

  // 切换到 diff 模式时加载 diff 数据
  useEffect(() => {
    if (viewMode !== "diff" || !ws.currentFile || !wsStore.activeId) return;
    if (diffData !== undefined) return; // 已加载
    setDiffLoading(true);
    fetch(`/api/workspace/${wsStore.activeId}/diff?path=${encodeURIComponent(ws.currentFile.path)}`)
      .then(r => r.json())
      .then(d => { setDiffData(d.diff || null); })
      .catch(() => { setDiffData(null); })
      .finally(() => setDiffLoading(false));
  }, [viewMode, ws.currentFile, wsStore.activeId]);

  // 文件切换时重置 diff
  useEffect(() => {
    setDiffData(undefined);
    setViewMode("source");
  }, [ws.currentFile?.path]);

  if (!ws.currentFile) {
    return (
      <div className="preview-pane">
        <div className="preview-empty">
          <Icon name="i-code" size={48} />
          <div className="preview-empty-text">从左侧文件树选择文件<br />即可在此预览代码</div>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-pane">
      <div className="preview-head">
        <Icon name="i-file" size={16} className="preview-file-icon" />
        <span className="preview-filename">{ws.currentFile.path.split("/").pop()}</span>
        <span className="preview-lang">{ws.currentFile.language}</span>
        <div className="preview-spacer" />
        {/* 源码 / Diff 模式切换 */}
        <div className="preview-modes">
          <button
            className={`preview-mode-btn ${viewMode === "source" ? "active" : ""}`}
            onClick={() => setViewMode("source")}
          >源码</button>
          <button
            className={`preview-mode-btn ${viewMode === "diff" ? "active" : ""}`}
            onClick={() => setViewMode("diff")}
          >Diff</button>
        </div>
        <button className="preview-btn" onClick={close} title="关闭预览">
          <Icon name="i-x" size={14} />
        </button>
      </div>
      <div className="preview-body">
        {viewMode === "diff" ? (
          <DiffView
            diff={diffData}
            loading={diffLoading}
            language={ws.currentFile.language}
          />
        ) : ws.fileLoading ? (
          <div className="preview-empty">加载中...</div>
        ) : ws.currentFile.language === "markdown" ? (
          <MarkdownPreview content={ws.currentFile.content} />
        ) : ws.currentFile.language === "html" || ws.currentFile.language === "svg" ? (
          <HtmlPreview
            content={ws.currentFile.content}
            filename={ws.currentFile.path.split("/").pop() || "preview"}
            language={ws.currentFile.language}
            wsId={wsStore.activeId}
            path={ws.currentFile.path}
          />
        ) : (
          <CodeBlock
            language={ws.currentFile.language}
            content={ws.currentFile.content}
            showLineNumbers
            customStyle={{ margin: 0, fontSize: "13px", background: "var(--code-bg)" }}
          />
        )}
      </div>
    </div>
  );
}

// ── HTML / SVG 渲染预览 ──
// HTML：用后端代理 URL 加载（iframe src），相对路径的 CSS/JS/图片会被浏览器
//       自动解析为 /api/workspace/:id/preview/<dir>/... 正确加载。
//       sandbox 限制：允许脚本和同源（资源加载），禁止 top-navigation。
// SVG：内联内容少、无外部依赖，用 srcDoc 包一层 HTML 容器即可。
function HtmlPreview({ content, filename, language, wsId, path }: {
  content: string;
  filename: string;
  language: string;
  wsId: string | null;
  path: string;
}) {
  const [mode, setMode] = useState<"render" | "source">("render");

  // HTML 代理 URL（有 wsId 才能用后端目录服务）
  const previewUrl = wsId && language === "html"
    ? `/api/workspace/${wsId}/preview/${path}`
    : null;

  // SVG 用 srcDoc：包一层 HTML 容器，白底居中 + 自适应缩放
  const srcDoc = useMemo(() => {
    if (language === "svg") {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;}
        svg{max-width:100%;max-height:100%;}
      </style></head><body>${content}</body></html>`;
    }
    return content;
  }, [content, language]);

  // 新窗口打开：HTML 用代理 URL（相对路径可用）；SVG 用 Blob
  const openInNewTab = () => {
    if (previewUrl) {
      window.open(previewUrl, "_blank");
    } else {
      const blob = new Blob([srcDoc], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  };

  return (
    <div className="html-preview-wrap">
      <div className="html-preview-toolbar">
        <div className="html-preview-modes">
          <button
            className={`hpv-mode-btn ${mode === "render" ? "active" : ""}`}
            onClick={() => setMode("render")}
          >渲染</button>
          <button
            className={`hpv-mode-btn ${mode === "source" ? "active" : ""}`}
            onClick={() => setMode("source")}
          >源码</button>
        </div>
        <button className="hpv-newwin-btn" onClick={openInNewTab} title="新窗口打开">
          ↗ 新窗口
        </button>
      </div>
      <div className="html-preview-body">
        {mode === "render" ? (
          previewUrl ? (
            <iframe
              title={filename}
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin"
              className="html-preview-iframe"
            />
          ) : (
            <iframe
              title={filename}
              srcDoc={srcDoc}
              sandbox="allow-same-origin"
              className="html-preview-iframe"
            />
          )
        ) : (
          <CodeBlock
            language={language}
            content={content}
            showLineNumbers
            customStyle={{ margin: 0, fontSize: "13px", background: "var(--code-bg)", height: "100%" }}
          />
        )}
      </div>
    </div>
  );
}

// ── Markdown 预览 ──
function MarkdownPreview({ content }: { content: string }) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const hasFrontmatter = !!fmMatch;
  const frontmatterText = fmMatch?.[1] ?? "";
  const bodyContent = hasFrontmatter ? content.slice(fmMatch![0].length) : content;
  const fmPairs = hasFrontmatter ? parseSimpleYaml(frontmatterText) : [];

  return (
    <div className="ws-md-preview">
      {fmPairs.length > 0 && (
        <div className="ws-frontmatter">
          {fmPairs.map(({ key, value }) => (
            <div key={key} className="ws-fm-row">
              <span className="ws-fm-key">{key}</span>
              <span className="ws-fm-value">{value}</span>
            </div>
          ))}
        </div>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyContent}</ReactMarkdown>
    </div>
  );
}

function parseSimpleYaml(text: string): Array<{ key: string; value: string }> {
  const pairs: Array<{ key: string; value: string }> = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!match) { i++; continue; }
    let key = match[1];
    let value = match[2].trim();
    if (value === "|" || value === ">") {
      const multiline: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
        multiline.push(lines[i].replace(/^[ \t]+/, ""));
        i++;
      }
      value = multiline.join(" ").trim();
    } else if (value.startsWith("[")) {
      while (i + 1 < lines.length && !lines[i].includes("]") && lines[i + 1]?.trim().startsWith("[")) {
        i++;
        value += " " + lines[i].trim();
      }
    }
    if (!value && i + 1 < lines.length && (lines[i + 1].startsWith("  ") || lines[i + 1].startsWith("\t"))) {
      const nested: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
        nested.push(lines[i].replace(/^[ \t]+/, ""));
        i++;
      }
      value = nested.join(", ");
    } else {
      i++;
    }
    if (value) pairs.push({ key, value });
  }
  return pairs;
}

// ── Diff 视图：解析 unified diff 并渲染为着色的行 ──
function DiffView({ diff, loading, language }: { diff: string | null | undefined; loading: boolean; language: string }) {
  if (loading) {
    return <div className="preview-empty">加载 Diff...</div>;
  }

  if (diff === undefined) {
    return <div className="preview-empty">准备中...</div>;
  }

  if (diff === null || !diff.trim()) {
    return (
      <div className="preview-empty">
        <Icon name="i-check" size={32} />
        <div className="preview-empty-text">该文件无未提交的变更</div>
      </div>
    );
  }

  // 解析 unified diff 行
  const lines = diff.split("\n");
  const rendered: React.ReactNode[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跳过 diff header（--- / +++ / diff -- / index 等元信息行）
    if (line.startsWith("diff --") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++") || line.startsWith("new file") || line.startsWith("deleted file")) {
      continue;
    }

    // hunk header: @@ -a,b +c,d @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLineNum = parseInt(hunkMatch[1]) - 1;
      newLineNum = parseInt(hunkMatch[2]) - 1;
      rendered.push(
        <div key={`hunk-${i}`} className="diff-hunk-header">{line}</div>
      );
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      newLineNum++;
      rendered.push(
        <div key={i} className="diff-line added">
          <span className="diff-line-num">{newLineNum}</span>
          <span className="diff-line-sign">+</span>
          <span className="diff-line-content">{line.slice(1)}</span>
        </div>
      );
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      oldLineNum++;
      rendered.push(
        <div key={i} className="diff-line removed">
          <span className="diff-line-num">{oldLineNum}</span>
          <span className="diff-line-sign">-</span>
          <span className="diff-line-content">{line.slice(1)}</span>
        </div>
      );
    } else if (line.startsWith(" ")) {
      oldLineNum++;
      newLineNum++;
      rendered.push(
        <div key={i} className="diff-line context">
          <span className="diff-line-num">{newLineNum}</span>
          <span className="diff-line-sign"> </span>
          <span className="diff-line-content">{line.slice(1)}</span>
        </div>
      );
    }
  }

  return (
    <div className="diff-view">
      {rendered}
    </div>
  );
}
