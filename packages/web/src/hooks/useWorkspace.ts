import { useState, useCallback } from "react";
import { useWorkspaceStore, type Workspace } from "../stores/workspace";

export interface FileItem {
  name: string;
  path: string;
  type: "dir" | "file";
  ext: string;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  language: string;
}

export function useWorkspace() {
  const store = useWorkspaceStore();
  const [currentFile, setCurrentFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);

  // ── 加载工作空间列表 ──
  const loadWorkspaces = useCallback(async () => {
    const res = await fetch("/api/workspaces");
    const data = await res.json();
    store.setWorkspaces(data.workspaces || []);
  }, []);

  // ── 添加工作空间 ──
  const addWorkspace = useCallback(async (path: string, name?: string): Promise<Workspace> => {
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to add workspace");
    store.addWorkspace(data);
    return data;
  }, []);

  // ── 删除工作空间 ──
  const removeWorkspace = useCallback(async (id: string) => {
    await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    store.removeWorkspace(id);
  }, []);

  // ── 列出目录 ──
  const listDir = useCallback(async (wsId: string, path: string): Promise<FileItem[]> => {
    const res = await fetch(`/api/workspace/${wsId}/list?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.items;
  }, []);

  // ── 打开文件 ──
  const openFile = useCallback(async (wsId: string, path: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspace/${wsId}/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurrentFile(data);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 搜索文件 ──
  const searchFiles = useCallback(async (wsId: string, q: string): Promise<FileItem[]> => {
    const res = await fetch(`/api/workspace/${wsId}/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) return [];
    return data.results || [];
  }, []);

  return {
    ...store,
    currentFile,
    loading,
    loadWorkspaces,
    addWorkspace,
    removeWorkspace,
    listDir,
    openFile,
    searchFiles,
    closeFile: () => setCurrentFile(null),
  };
}
