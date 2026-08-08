import { useCallback } from "react";
import { useWorkspaceStore, type Workspace } from "../stores/workspace";
import type { FileItem, FileContent } from "./workspace-types";

export function useWorkspace() {
  const store = useWorkspaceStore();

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

  // ── 打开文件（多 tab 模式：加入 tab 列表 + 激活）──
  const openFile = useCallback(async (wsId: string, path: string) => {
    store.setFileLoading(true);
    try {
      const res = await fetch(`/api/workspace/${wsId}/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      store.openFileInTab(data);
    } catch (e: any) {
      console.error(e);
    } finally {
      store.setFileLoading(false);
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
    loadWorkspaces,
    addWorkspace,
    removeWorkspace,
    listDir,
    openFile,
    searchFiles,
    closeFile: () => store.closeAllTabs(),
  };
}
