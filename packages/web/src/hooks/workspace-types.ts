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
