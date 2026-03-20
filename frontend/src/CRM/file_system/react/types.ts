export type FileRow = {
  file_id: number;
  name: string;
  path: string;
  size?: number | null;
  owner?: string;
  created_at?: string | null;
  updated_at?: string | null;
  type: "file" | "dir";
};

export type DirectoryNode = {
  name: string;
  path: string;
  type: "dir";
};

export type DirectoryResult = {
  path: string;
  directories: DirectoryNode[];
  files: FileRow[];
};

export type TreeResponse = {
  directories: string[];
  files: Array<{ file_id: number; name: string; path: string; size?: number | null }>;
};

export type PermissionRow = {
  id: number;
  file_id: number;
  user_id?: number | null;
  department_id?: number | null;
  permission: string;
};

export type FileDetail = {
  id: number;
  path: string;
  owner_id: number;
  is_folder: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  file_type?: string;
  file_size?: number | null;
  permissions: PermissionRow[];
  history: Array<{
    id: number;
    user_id: number;
    user_name?: string | null;
    action: string;
    old_path?: string | null;
    new_path?: string | null;
    timestamp: string;
  }>;
};

export type TrashRow = {
  id: number;
  file_id: number;
  path: string;
  size: number;
  deleted_at?: string | null;
};

export type Toast = {
  tone: "success" | "error" | "info";
  message: string;
};

export type SelectableItem = FileRow | (DirectoryNode & { file_id: number });
