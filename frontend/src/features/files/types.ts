/**
 * 文件系统。后端 backend/api/filesystem/router.py（挂载前缀 /files）。
 * 形状来自后端 service.list_directory + serializers.serialize_file_item（要登录，实测不到）。
 */

export interface DirectoryEntry {
  type: "dir";
  name: string;
  path: string;
}

export interface FileEntry {
  id: number;
  name: string;
  path: string;
  is_folder: boolean;
  size?: number | null;
  mime?: string | null;
  owner_name?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface DirectoryListing {
  path: string;
  /** 子目录（可能由深层子项推断出来，不一定有对应的目录行）。 */
  directories: DirectoryEntry[];
  files: FileEntry[];
}
