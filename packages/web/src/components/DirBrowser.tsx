import { useState, useEffect, useCallback } from "react";

interface DirItem {
  name: string;
  path: string;
  type: "dir";
  hidden?: boolean;
}

interface DirBrowserProps {
  onSelect: (path: string, name: string) => void;
  onCancel: () => void;
}

export function DirBrowser({ onSelect, onCancel }: DirBrowserProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [dirs, setDirs] = useState<DirItem[]>([]);
  const [hiddenDirs, setHiddenDirs] = useState<DirItem[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // 初始加载 home 目录
  useEffect(() => {
    fetch("/api/fs/home")
      .then((r) => r.json())
      .then((d) => browseTo(d.home));
  }, []);

  const browseTo = useCallback(async (path: string) => {
    setLoading(true);
    setSelectedPath(null);
    try {
      const res = await fetch(`/api/fs/browse?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurrentPath(data.current);
      setDirs(data.dirs || []);
      setHiddenDirs(data.hiddenDirs || []);
      setParent(data.parent);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // 面包屑路径分段
  const breadcrumbs = currentPath.split("/").filter(Boolean);

  const handleConfirm = () => {
    if (!selectedPath) return;
    const name = selectedPath.split("/").pop() ?? selectedPath;
    onSelect(selectedPath, name);
  };

  return (
    <div className="modal-overlay show" onClick={onCancel}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="modal-header">
          <h2>选择项目目录</h2>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        {/* 面包屑导航 */}
        <div className="dir-breadcrumb">
          <span
            className="crumb"
            onClick={() => browseTo("/")}
          >
            /
          </span>
          {breadcrumbs.map((seg, i) => {
            const fullPath = "/" + breadcrumbs.slice(0, i + 1).join("/");
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={fullPath}>
                <span className="crumb-sep">›</span>
                <span
                  className={`crumb ${isLast ? "crumb-current" : ""}`}
                  onClick={() => !isLast && browseTo(fullPath)}
                >
                  {seg}
                </span>
              </span>
            );
          })}
        </div>

        {/* 目录列表 */}
        <div className="dir-list">
          {loading ? (
            <div className="dir-loading">加载中...</div>
          ) : (
            <>
              {/* 返回上级 */}
              {parent && (
                <div className="dir-item dir-item-up" onClick={() => browseTo(parent)}>
                  <span className="dir-icon">↰</span>
                  <span className="dir-name">上级目录</span>
                </div>
              )}

              {/* 普通目录 */}
              {dirs.length === 0 && hiddenDirs.length === 0 && (
                <div className="dir-empty">此目录下没有子目录</div>
              )}

              {dirs.map((d) => (
                <div
                  key={d.path}
                  className={`dir-item ${selectedPath === d.path ? "dir-item-selected" : ""}`}
                  onClick={() => setSelectedPath(d.path)}
                  onDoubleClick={() => browseTo(d.path)}
                >
                  <span className="dir-icon">📁</span>
                  <span className="dir-name">{d.name}</span>
                </div>
              ))}

              {/* 隐藏目录（需手动展开） */}
              {hiddenDirs.length > 0 && (
                <>
                  <div
                    className="dir-hidden-toggle"
                    onClick={() => setShowHidden(!showHidden)}
                  >
                    {showHidden ? "▼" : "▶"} 隐藏目录 ({hiddenDirs.length})
                  </div>
                  {showHidden && hiddenDirs.map((d) => (
                    <div
                      key={d.path}
                      className={`dir-item dir-item-hidden ${selectedPath === d.path ? "dir-item-selected" : ""}`}
                      onClick={() => setSelectedPath(d.path)}
                      onDoubleClick={() => browseTo(d.path)}
                    >
                      <span className="dir-icon">📁</span>
                      <span className="dir-name">{d.name}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* 选中路径 + 确认 */}
        <div className="modal-footer">
          <div className="dir-selected-path">
            {selectedPath ? (
              <>选中: <code>{selectedPath}</code></>
            ) : currentPath ? (
              <button className="dir-select-current" onClick={() => setSelectedPath(currentPath)}>
                选择当前目录: {currentPath.split("/").pop()}
              </button>
            ) : null}
          </div>
          <div className="modal-actions">
            <button className="modal-btn-cancel" onClick={onCancel}>取消</button>
            <button
              className="modal-btn-confirm"
              onClick={handleConfirm}
              disabled={!selectedPath}
            >
              确认添加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
