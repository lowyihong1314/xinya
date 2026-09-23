/**
 * 文件管理器。后端 backend/api/filesystem/router.py（包名叫 filesystem，
 * **挂载前缀是 /files**，两者不同名是既有事实）+ serializers.py。
 *
 * ★ 形状**来自后端代码，未实测**：23 条路由里除了公开分享下载那条，每一条都挂着
 *   @login_required，`node scripts/api-shape.mjs /files/tree` 打过去只有
 *   `{"status":"error","message":"unauthorized"}`。登录之后请按这里的键名逐条复核。
 *
 * 四个凭直觉一定会写错的地方（serializers.py 的模块头把它们标成「故意不统一」）：
 *   · 列表行的主键是 **file_id**，而单条详情的主键是 **id**。
 *   · **目录行没有 file_id**，只有 type/name/path —— 目录的一切操作都按 path 走。
 *   · type 有两套词表：列表 "dir"/"file"，详情 "folder"/MIME/"unknown"，
 *     上传回来的目录又叫 "folder"。
 *   · 大小字段在目录上是 **null**（不是 0），前端靠它区分「目录不显示大小」。
 */

// --------------------------------------------------------------------------- //
// 浏览：POST /files/query
// --------------------------------------------------------------------------- //

/**
 * 目录行。★ 只有这三个键 —— **没有 file_id、没有 size、没有 owner、没有时间**。
 * 后端是从子项路径现推出来的（库里缺目录行时树也不会断层），所以它根本没有实体。
 */
export interface DirectoryEntry {
  type: "dir";
  name: string;
  path: string;
}

/** 文件行（serialize_file_item）。搜索结果复用它，那里 type 也可能是 "dir"。 */
export interface FileEntry {
  /** ★ 主键是 file_id，不是 id。 */
  file_id: number;
  /** path 的最后一段。 */
  name: string;
  /** 逻辑路径，形如 "/部门/2026/报销.pdf"。前端的一切「按路径」的操作都用它。 */
  path: string;
  size: number | null;
  /** ★ 是**字符串**不是对象：display_name → username → String(owner_id) 三级回退。 */
  owner: string;
  created_at: string | null;
  updated_at: string | null;
  type: "dir" | "file";
}

export interface DirectoryListResponse {
  /** 规范化之后的路径（根目录是 "/"）。面包屑用它回填，别用自己发出去的那个值。 */
  path: string;
  directories: DirectoryEntry[];
  files: FileEntry[];
}

// --------------------------------------------------------------------------- //
// 目录树：GET /files/tree
// --------------------------------------------------------------------------- //

export interface TreeFile {
  file_id: number;
  name: string;
  path: string;
  size: number | null;
}

/**
 * ★ directories 是从**子项路径反推**出来的，而且反推时**不含最后一段** ——
 *   一个没有任何子项的 "/a/b" 只会让 "/a" 出现在树上，"/a/b" 自己不会。
 *   也就是说：**空的深层目录在树里是看不见的**。移动目标选择器就受这个限制。
 */
export interface TreeResponse {
  directories: string[];
  files: TreeFile[];
}

// --------------------------------------------------------------------------- //
// 详情：GET /files/items/{id}、GET /files/directories/detail
// --------------------------------------------------------------------------- //

/** 后端认的三个值。read_public 是挂在文件上的公开标记，不是挂在某个人身上的。 */
export type FilePermissionValue = "read" | "read_write" | "read_public";

export interface FilePermissionRow {
  id: number;
  /**
   * ★ 只有 /items/{id}/permissions 那条带这个键；
   *   文件详情里内嵌的 permissions 数组**没有** file_id。
   */
  file_id?: number;
  /** user_id 与 department_id 恒有一个是 null（权限要么给人、要么给部门）。 */
  user_id: number | null;
  department_id: number | null;
  /** 后端不是枚举列，理论上可能出现清单外的值，所以留了 string 兜底。 */
  permission: FilePermissionValue | string;
}

export interface FileHistoryRow {
  id: number;
  user_id: number;
  user_name: string | null;
  /** create / upload / move / set_permission / remove_permission / rename_dir / delete。 */
  action: string;
  old_path: string | null;
  new_path: string | null;
  /** ISO。 */
  timestamp: string;
}

export interface FileDetail {
  /** ★ 详情这里是 id，不是 file_id。 */
  id: number;
  path: string;
  owner_id: number;
  is_folder: boolean;
  created_at: string | null;
  updated_at: string | null;
  /** "folder" | MIME | "unknown" —— 和列表行的 "dir"/"file" 是两套词表。 */
  file_type: string;
  /** ★ 目录上是 null（不是 0）。 */
  file_size: number | null;
  permissions: FilePermissionRow[];
  /** 最近 10 条，倒序。 */
  history: FileHistoryRow[];
}

export interface DirectoryDetail {
  name: string;
  path: string;
  /**
   * 服务器上的真实磁盘路径。后端注释把它标成「既有的信息泄露，去掉是可见的行为变更」——
   * 新前端**不显示它**，所以后端哪天收口也不牵动这里。
   */
  abs_path: string;
  created_at: string | null;
  updated_at: string | null;
  /** 只统计当前用户**读得到**的那些子项。 */
  file_count: number;
  total_size: number;
  sub_dir_count: number;
  sub_dirs: string[];
}

export interface PermissionListResponse {
  permissions: FilePermissionRow[];
}

/** GET /files/history/views。本模块没有接这条，见 api.ts 末尾的说明。 */
export interface ViewHistoryRow {
  id: number;
  file_id: number | null;
  path: string;
  user_id: number;
  /** ★ 这一条是 "YYYY-MM-DD HH:MM:SS" 本地格式串，不是 ISO。 */
  timestamp: string;
}

// --------------------------------------------------------------------------- //
// 变更类接口的回包
// --------------------------------------------------------------------------- //

export interface UploadedEntry {
  file_id: number;
  path: string;
  /** ★ 上传文件回 "file"，只建目录那一支回 **"folder"**（不是 "dir"）。 */
  type: "file" | "folder";
}

/** 传了文件回 files，只传 relative_paths[] 的「建空目录」模式回 folders。 */
export interface UploadResponse {
  success: boolean;
  files?: UploadedEntry[];
  folders?: UploadedEntry[];
}

export interface CreateDirectoryResponse {
  success: boolean;
  directory: { file_id: number; path: string; type: "dir" };
}

/** 重命名文件 / 移动文件。 */
export interface NewPathResponse {
  success: boolean;
  new_path: string;
}

/** 重命名目录：updated 是**跟着改路径的子项数**，不含目录自己。 */
export interface RenameDirectoryResponse extends NewPathResponse {
  updated: number;
}

/** 删除目录 / 删除文件：deleted 是真正进了回收站的条数（没有写权限的被静默跳过）。 */
export interface DeleteResponse {
  success: boolean;
  deleted: number;
}

export interface BatchDeleteResult {
  /** 文件是 file_id，目录是 path —— 跟着请求里那一项的类型走。 */
  key: number | string;
  success: boolean;
  /** 只有失败的那些有。 */
  error?: string;
}

/** ★ 批量删除**永远 200**，逐项成败在 results 里，不看状态码。 */
export interface BatchDeleteResponse {
  results: BatchDeleteResult[];
  deleted: number;
}

export interface SearchResponse {
  query: string;
  items: FileEntry[];
  /** 权限过滤后超过 limit 被截断了。 */
  truncated: boolean;
}

export interface ShareResponse {
  /**
   * **应用内裸路径**（形如 "/files/shares/xxx/download"），不带 BASE_PATH 也不带 origin。
   * 要给人的话得过一次 publicUrl()。
   */
  share_url: string;
  expire_minutes: number;
  credit: number;
  file_path: string;
}

export interface TrashItem {
  /** 回收站条目自己的 id（还原 / 彻底删除用它），**不是**原文件的 file_id。 */
  id: number;
  file_id: number | null;
  /** 删除前的逻辑路径，还原时按它复原。 */
  path: string;
  size: number | null;
  deleted_at: string | null;
}

export interface TrashListResponse {
  items: TrashItem[];
}

/** restored 是还原出来的条数（目录会带着整棵子树回来）。 */
export interface RestoreTrashResponse {
  success: boolean;
  restored: number;
  path: string;
}

export interface PurgeAllTrashResponse {
  success: boolean;
  purged: number;
}

/** ★ 设置权限那条的回包是 {status,message}，和本模块其它条的 {success} 不一样。 */
export interface SetPermissionResponse {
  status: string;
  message: string;
}

// --------------------------------------------------------------------------- //
// 前端自己的形状（不是后端返回的）
// --------------------------------------------------------------------------- //

/**
 * 界面上被操作的那一项。
 *
 * 之所以是个联合类型而不是「一个带可选 file_id 的对象」：目录**真的没有 file_id**，
 * 所有目录操作都只能按 path 走。分成两支之后，TS 会在写错的那一行就拦住
 * （比如拿目录去调 renameFile），而不是等到运行时 undefined。
 *
 * 形状刻意和批量删除接口的 item 对齐（{type:"file",id} / {type:"dir",path}）。
 */
export type FileTarget =
  | { type: "dir"; path: string; name: string }
  | { type: "file"; file_id: number; path: string; name: string };
