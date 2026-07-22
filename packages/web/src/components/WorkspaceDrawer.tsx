import { useState, useCallback, useEffect, useRef } from "react";
import { useWorkspace, type FileItem } from "../hooks/useWorkspace";
import { Splitter } from "./Splitter";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "../stores/chat";
import { getSessionStats } from "../utils/sessionStats";

export function WorkspaceDrawer() {
  const ws = useWorkspace();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([""]));
  const [searchResults, setSearchResults] = useState<FileItem[] | null>(null);
  const [activeTab, setActiveTab] = useState<"files" | "changes">("files");

  // 切换工作空间时重置全部内部状态
  const prevWsId = useRef<string | null>(ws.activeId);
  useEffect(() => {
    if (prevWsId.current !== ws.activeId) {
      prevWsId.current = ws.activeId;
      setExpandedDirs(new Set([""]));
      setSearchResults(null);
      ws.setSearchQuery("");
      ws.closeFile();
    }
  }, [ws.activeId]);

  const activeWs = ws.workspaces.find(w => w.id === ws.activeId);

  // 搜索防抖
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

  const handleRemoveWs = async () => {
    if (!activeWs) return;
    if (confirm(`删除工作空间 "${activeWs.name}"？（不会删除文件，仅从列表移除）`)) {
      await ws.removeWorkspace(activeWs.id);
    }
  };

  return (
    <div className="ws-drawer">
      {/* ── 顶部工具栏 ── */}
      <div className="ws-toolbar">
        <span className="ws-title">📁 {activeWs?.name ?? "工作空间"}</span>
        <button className="ws-btn-icon" onClick={handleRemoveWs} title="移除工作空间">🗑</button>
        <button className="ws-btn-icon" onClick={() => ws.toggleDrawer()} title="收起">✕</button>
      </div>

      {/* ── 主体：预览(左，仅有文件时显示) | 目录树(右) ── */}
      <div className="ws-body">
        {/* 文件预览 — 只有选中文件时才显示 */}
        {ws.currentFile && (
          <>
            <div className="ws-preview-section" style={{ width: ws.previewWidth }}>
              {ws.loading ? (
                <div className="ws-loading">加载中...</div>
              ) : (
                <div className="ws-file-viewer">
                  <div className="ws-file-header">
                    <span>{ws.currentFile.path.split("/").pop()}</span>
                    <span className="ws-file-size">{formatSize(ws.currentFile.size)}</span>
                  </div>
                  <div className="ws-file-content">
                    {ws.currentFile.language === "markdown" ? (
                      <MarkdownPreview content={ws.currentFile.content} />
                    ) : (
                      <SyntaxHighlighter
                        language={ws.currentFile.language}
                        style={oneDark}
                        showLineNumbers
                        customStyle={{ margin: 0, fontSize: "12px" }}
                      >
                        {ws.currentFile.content}
                      </SyntaxHighlighter>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 中间分隔条：拖拽只调目录树宽度 */}
            <Splitter onResize={delta => ws.setTreeWidth(ws.treeWidth - delta)} />
          </>
        )}

        {/* 目录树（含搜索）— 固定宽度，无预览时占满 */}
        <div className="ws-tree-section" style={{ width: ws.treeWidth }}>
          {/* Tab 切换：文件 / 变更 */}
          <div className="ws-tabs">
            <button
              className={`ws-tab ${activeTab === "files" ? "ws-tab-active" : ""}`}
              onClick={() => setActiveTab("files")}
            >
              文件
            </button>
            <button
              className={`ws-tab ${activeTab === "changes" ? "ws-tab-active" : ""}`}
              onClick={() => setActiveTab("changes")}
            >
              变更
              <ChangesBadge />
            </button>
          </div>

          {activeTab === "changes" ? (
            <ChangesPanel wsId={activeWs?.id} openFile={(p) => activeWs && ws.openFile(activeWs.id, p)} />
          ) : (
          <>
          {/* 搜索框：只在树面板上方 */}
          <div className="ws-search-bar">
            <input
              type="text"
              className="ws-search-input"
              placeholder="🔍 筛选文件..."
              value={ws.searchQuery}
              onChange={e => ws.setSearchQuery(e.target.value)}
            />
          </div>

          {/* 搜索结果 or 目录树 */}
          <div className="ws-tree-list">
            {searchResults ? (
            <div className="ws-search-results">
              {searchResults.length === 0 ? (
                <div className="ws-empty-hint">无匹配文件</div>
              ) : (
                searchResults.map(item => (
                  <div
                    key={item.path}
                    className={`tree-item ${ws.currentFile?.path === item.path ? "tree-item-active" : ""}`}
                    onClick={() => item.type === "file" && activeWs && ws.openFile(activeWs.id, item.path)}
                  >
                    <span className="tree-icon">{item.type === "dir" ? "📁" : getIcon(item.ext)}</span>
                    <span className="tree-name">{item.name}</span>
                    <span className="tree-path">{item.path}</span>
                  </div>
                ))
              )}
            </div>
          ) : (
            activeWs && (
              <FileTree
                key={activeWs.id}
                wsId={activeWs.id}
                basePath=""
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                listDir={ws.listDir}
                openFile={p => ws.openFile(activeWs.id, p)}
                currentPath={ws.currentFile?.path}
              />
            )
          )}
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 变更徽标（显示变更文件数量） ──
function ChangesBadge() {
  const activeChatId = useChatStore(s => s.activeChatSessionId);
  const messages = useChatStore(s => activeChatId ? s.sessions[activeChatId]?.messages : undefined);
  if (!messages) return null;
  const stats = getSessionStats(messages);
  if (stats.filesChanged.length === 0) return null;
  return <span className="ws-tab-badge">{stats.filesChanged.length}</span>;
}

// ── 变更面板：显示本次会话修改的文件 ──
function ChangesPanel({ wsId, openFile }: { wsId?: string; openFile: (path: string) => void }) {
  const activeChatId = useChatStore(s => s.activeChatSessionId);
  const messages = useChatStore(s => activeChatId ? s.sessions[activeChatId]?.messages : undefined);

  if (!messages || messages.length === 0) {
    return <div className="ws-empty-hint">本次会话暂无活动</div>;
  }

  const stats = getSessionStats(messages);

  if (stats.filesChanged.length === 0) {
    return (
      <div className="ws-changes-empty">
        <div className="ws-changes-empty-icon">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path d="M16 8v8M16 20v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
          </svg>
        </div>
        <p>本次会话暂无文件变更</p>
        <span>Agent 编辑的文件会显示在这里</span>
      </div>
    );
  }

  return (
    <div className="ws-changes">
      {/* 统计摘要 */}
      <div className="ws-changes-summary">
        <div className="ws-changes-stat">
          <span className="ws-changes-stat-value">{stats.filesChanged.length}</span>
          <span className="ws-changes-stat-label">文件</span>
        </div>
        <div className="ws-changes-stat">
          <span className="ws-changes-stat-value">{stats.edits}</span>
          <span className="ws-changes-stat-label">编辑</span>
        </div>
        <div className="ws-changes-stat">
          <span className="ws-changes-stat-value">{stats.commands}</span>
          <span className="ws-changes-stat-label">命令</span>
        </div>
      </div>

      {/* 文件列表 */}
      <div className="ws-changes-list">
        {stats.filesChanged.map(f => (
          <div
            key={f.path}
            className="ws-change-item"
            onClick={() => wsId && openFile(f.path)}
          >
            <span className={`ws-change-dot ${f.lastStatus === "error" ? "dot-error" : "dot-edited"}`} />
            <div className="ws-change-info">
              <span className="ws-change-name">{f.name}</span>
              <span className="ws-change-path">{f.path}</span>
            </div>
            {f.edits > 1 && <span className="ws-change-count">{f.edits}</span>}
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
  if (!loaded) return <div style={{ paddingLeft: depth * 14 + 12 }} className="tree-loading">...</div>;

  return (
    <>
      {items.map(item => {
        const isDir = item.type === "dir";
        const isOpen = expandedDirs.has(item.path);
        const isActive = currentPath === item.path;
        return (
          <div key={item.path}>
            <div
              className={`tree-item ${isActive ? "tree-item-active" : ""}`}
              style={{ paddingLeft: depth * 14 + 8 }}
              onClick={() => isDir ? toggleDir(item.path) : openFile(item.path)}
            >
              <span className="tree-icon">{isDir ? (isOpen ? "📂" : "📁") : getIcon(item.ext)}</span>
              <span className="tree-name">{item.name}</span>
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

function formatSize(b: number) {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}

function getIcon(ext: string) {
  const m: Record<string, string> = {
    ".ts": "📘", ".tsx": "📘", ".js": "📄", ".json": "🔧",
    ".css": "🎨", ".html": "🌐", ".md": "📝", ".py": "🐍",
    ".go": "🐹", ".sh": "⚙️", ".yaml": "⚙️", ".yml": "⚙️",
  };
  return m[ext] ?? "📄";
}

// ── Markdown 预览（解析 YAML frontmatter → 元数据卡片 + 正文） ──
function MarkdownPreview({ content }: { content: string }) {
  // 解析 frontmatter：文件开头是 --- ... --- 包裹的 YAML 块
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const hasFrontmatter = !!fmMatch;
  const frontmatterText = fmMatch?.[1] ?? "";
  const bodyContent = hasFrontmatter ? content.slice(fmMatch![0].length) : content;

  // 把 YAML frontmatter 解析为 key-value 对
  const fmPairs = hasFrontmatter ? parseSimpleYaml(frontmatterText) : [];

  return (
    <div className="ws-md-preview">
      {/* frontmatter 元数据卡片 */}
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
      {/* 正文 Markdown */}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyContent}</ReactMarkdown>
    </div>
  );
}

// 简易 YAML 解析：提取顶层 key: value（够用，不需要完整 YAML 解析器）
function parseSimpleYaml(text: string): Array<{ key: string; value: string }> {
  const pairs: Array<{ key: string; value: string }> = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // 匹配 key: value 或 key: |（多行值）
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!match) { i++; continue; }

    let key = match[1];
    let value = match[2].trim();

    // 多行值（key: | 或 key: >）
    if (value === "|" || value === ">") {
      const multiline: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
        multiline.push(lines[i].replace(/^[ \t]+/, ""));
        i++;
      }
      value = multiline.join(" ").trim();
    } else if (value.startsWith("[")) {
      // 数组格式 [a, b, c]：原样保留
      // 继续读取直到匹配的 ]
      while (i + 1 < lines.length && !lines[i].includes("]") && lines[i + 1]?.trim().startsWith("[")) {
        i++;
        value += " " + lines[i].trim();
      }
    }

    // 跳过嵌套对象（如 metadata: 缩进块）
    if (!value && i + 1 < lines.length && (lines[i + 1].startsWith("  ") || lines[i + 1].startsWith("\t"))) {
      // 收集缩进行作为简短摘要
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
