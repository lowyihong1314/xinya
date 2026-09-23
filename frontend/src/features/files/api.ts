/**
 * 文件管理器。后端 backend/api/filesystem/router.py（挂载前缀是 /files）。
 *
 * 这是整个模块**唯一**知道接口路径长什么样的地方。
 *
 * ⚠️ 前端页面地址是 /files 和 /files/recycle：
 *    后端占了 /files/query、/files/trash、/files/search… 但**没有占 /files 本身**，
 *    所以列表页可以叫 /files；回收站却不能叫 /files/trash（后端有这条 GET，
 *    页面永远到不了浏览器，点开只会下载一坨 JSON），于是改叫 /files/recycle。
 *    查法：node scripts/check-route-collisions.mjs
 */
import { http } from "@/shared/api/client";
import { upload } from "@/shared/api/upload";
import { tokenStore } from "@/shared/auth/tokenStore";
import { API_ROOT, IS_APK } from "@/shared/config/env";

import type {
  BatchDeleteResponse,
  CreateDirectoryResponse,
  DeleteResponse,
  DirectoryDetail,
  DirectoryListResponse,
  FileDetail,
  FilePermissionValue,
  FileTarget,
  NewPathResponse,
  PermissionListResponse,
  PurgeAllTrashResponse,
  RenameDirectoryResponse,
  RestoreTrashResponse,
  SearchResponse,
  SetPermissionResponse,
  ShareResponse,
  TrashListResponse,
  TreeResponse,
  UploadResponse,
} from "./types";

export const fileKeys = {
  all: ["files"] as const,
  list: (path: string) => [...fileKeys.all, "list", path] as const,
  tree: () => [...fileKeys.all, "tree"] as const,
  search: (q: string) => [...fileKeys.all, "search", q] as const,
  detail: (fileId: number) => [...fileKeys.all, "detail", fileId] as const,
  directoryDetail: (path: string) => [...fileKeys.all, "directory-detail", path] as const,
  permissions: (fileId: number) => [...fileKeys.all, "permissions", fileId] as const,
  trash: () => [...fileKeys.all, "trash"] as const,
};

// --------------------------------------------------------------------------- //
// 浏览 / 搜索
// --------------------------------------------------------------------------- //

/**
 * 浏览一个目录。
 *
 * ★ 根目录传 "/" 或者空字符串都行（normalize_path 两个都变成 "/"）。
 *   **唯一不能做的是不传这个键**：后端判的是 `"path" not in data`，而
 *   JSON.stringify 会把值为 undefined 的键整个丢掉 → 400「Missing path」，
 *   根目录就永远打不开了。
 *   注意这条用的是 `not in`，同一个模块里 POST /files/directories 用的却是
 *   `not data.get("path")`（空串会被拦下），两条的差异是有意的。
 */
export const listDirectory = (path: string) =>
  http.post<DirectoryListResponse>("/files/query", { path });

/** 目录树。只用来做「移动到哪里」的候选，注意它看不见空的深层目录（见 types.ts）。 */
export const fetchTree = () => http.get<TreeResponse>("/files/tree");

/**
 * 按**文件名**搜索（SQL 先匹配整条路径，后端再二次过滤掉只有目录名命中的）。
 * limit 缺省 100，后端钳在 1–200。
 */
export const searchFiles = (q: string, limit?: number) =>
  http.get<SearchResponse>("/files/search", { query: { q, limit } });

// --------------------------------------------------------------------------- //
// 单条：详情 / 权限 / 下载
// --------------------------------------------------------------------------- //

export const fetchFileDetail = (fileId: number) =>
  http.get<FileDetail>(`/files/items/${fileId}`);

/** 目录没有 file_id，只能按 path 问详情。库里查不到这条路径时 404。 */
export const fetchDirectoryDetail = (path: string) =>
  http.get<DirectoryDetail>("/files/directories/detail", { query: { path } });

export const fetchItemPermissions = (fileId: number) =>
  http.get<PermissionListResponse>(`/files/items/${fileId}/permissions`);

/**
 * 文件下载直链（给 `<a href download>` 用）。
 *
 * ★ 不走 http 客户端：它会把响应当文本读进内存再 JSON.parse，二进制附件在这一步就废了；
 *   而且会丢掉 Range，大文件没法续传。后端 FileResponse 本来就是流式的 + 带
 *   Content-Disposition，交给浏览器自己下最省事。
 * ★ 必须用 API_ROOT（origin + BASE_PATH）：裸路径在 APK 里会去找
 *   capacitor://localhost/files/…，永远 404。
 * ⚠️ 直链带的是 Cookie 凭证，APK（Bearer）下拿不到 —— 和 fahui 的报价单 PDF、
 *    music 的音频直链是同一个已知限制，网页版可用。
 */
export const fileContentUrl = (fileId: number) => `${API_ROOT}/files/items/${fileId}/content`;

// --------------------------------------------------------------------------- //
// 上传
// --------------------------------------------------------------------------- //

/**
 * 上传**一个**文件。
 *
 * ★ 一次请求只传一个，不是一次性发一批。两个原因：
 *   ① shared/api/upload 的 fields 是 `Record<string, …>`，同一个键只能出现一次，
 *      而后端要的是和 files 一一对应的重复键 `relative_paths[]`
 *      （两边靠 zip() 配对，长度不等时多出来的文件会被**悄悄丢掉**）。一次一个天然对齐。
 *   ② 逐个传才有逐个的进度和逐个的失败：后端遇到同名文件抛 409 会**中断整批**，
 *      十个文件里第三个重名，后七个就都没传上去，而界面只会说一句「上传失败」。
 *
 * relativePath 支持带子目录（"子文件夹/a.jpg"），后端会顺手把中间目录建出来；
 * 本页只传文件名（手机上没有目录选择器）。
 */
export const uploadFile = (
  file: File,
  folderLocation: string,
  options: { relativePath?: string; onProgress?: (fraction: number) => void } = {},
) =>
  upload<UploadResponse>(
    "/files/uploads",
    { files: file },
    {
      fields: {
        "relative_paths[]": options.relativePath ?? file.name,
        // 空串会被 normalize_path 变成 "/"，所以根目录也能直接传。
        folder_location: folderLocation,
      },
      onProgress: options.onProgress,
      // upload 走的是 XHR，不经过 http 客户端注入令牌的那条路，壳里要自己带 Bearer。
      bearerToken: IS_APK ? tokenStore.getAccess() : null,
    },
  );

// --------------------------------------------------------------------------- //
// 目录：新建 / 重命名 / 删除
// --------------------------------------------------------------------------- //

/** 传完整路径（"/a/b/c"），中间缺的几级后端会顺手补出来。 */
export const createDirectory = (path: string) =>
  http.post<CreateDirectoryResponse>("/files/directories", { path });

/** new_name 是**新名字**不是新路径；父目录由后端从 old_path 推。 */
export const renameDirectory = (oldPath: string, newName: string) =>
  http.patch<RenameDirectoryResponse>("/files/directories/rename", {
    old_path: oldPath,
    new_name: newName,
  });

/**
 * 删除目录（进回收站，带整棵子树）。
 * ⚠️ 后端**没有** PermissionError 的单独分支，没权限时回的是 **500** 而不是 403，
 *    正文是「没有权限删除 /x/y」。所以页面照样把 ApiError.message 显示出来就行，
 *    不要按状态码分支。
 */
export const deleteDirectory = (path: string) =>
  http.delete<DeleteResponse>("/files/directories", { body: { path } });

// --------------------------------------------------------------------------- //
// 文件：重命名 / 移动 / 删除 / 分享
// --------------------------------------------------------------------------- //

/** ★ 只能用在文件上，目录走 renameDirectory（后端对目录直接回 400）。 */
export const renameFile = (fileId: number, newName: string) =>
  http.patch<NewPathResponse>(`/files/items/${fileId}/rename`, { new_name: newName });

/**
 * 移动文件。★ 源是**路径**不是 id（后端按 path 查的），目标是目录路径。
 * ★ 同样只能用在文件上：后端只改这一行的 path，移动目录不会带上子项。
 */
export const moveFile = (filePath: string, dirPath: string) =>
  http.post<NewPathResponse>("/files/items/move", { file_path: filePath, dir_path: dirPath });

/** 删除文件（进回收站）。没有写权限的那些被**静默跳过**，deleted 才是真删掉的条数。 */
export const deleteFiles = (fileIds: number[]) =>
  http.delete<DeleteResponse>("/files/items", { body: { ids: fileIds } });

/** 前端选中项 → 批量删除接口要的 item 形状。 */
const toBatchItem = (target: FileTarget) =>
  target.type === "file" ? { type: "file", id: target.file_id } : { type: "dir", path: target.path };

/**
 * 混选（目录 + 文件）一起删。
 * ★ 逐项删、逐项提交、**永远 200**：成败看 results[].success，不看状态码。
 */
export const batchDelete = (targets: readonly FileTarget[]) =>
  http.post<BatchDeleteResponse>("/files/items/batch_delete", { items: targets.map(toBatchItem) });

/**
 * 生成分享链接。
 * ★ 要的是 **write** 权限（不是 read）—— 只读的人看得到文件但分享不了。
 * ★ minutes / credit 必须带上：后端默认值写在路由的 `data.get(..., 10)` 上，
 *   显式传 null 会进到 nullable=False 的列里，commit 时 500。
 */
export const createShare = (fileId: number, minutes: number, credit: number) =>
  http.post<ShareResponse>("/files/shares", { file_id: fileId, minutes, credit });

// --------------------------------------------------------------------------- //
// 权限
// --------------------------------------------------------------------------- //

/**
 * 给「一条路径及其整棵子树」设权限。**这是后端唯一的「设权限」接口**，
 * 所以给单个文件设权限时 dirPath 就传**文件自己的路径** ——
 * 后端的 subtree_filter 是 `path == x OR path LIKE x/%`，正好只命中它自己。
 *
 * ★ 没有写权限的条目会被**静默跳过**，接口照样回 200「目录权限批量设置成功」——
 *   「设置成功」不等于真写进去了。所以对话框设完必须重新拉一次权限列表，以列表为准。
 * ★ 这条的失败出口是 {"status":"error","message":…}，和本模块其它条的 {"error":…}
 *   不一样；两种 http 客户端都认得，页面不用管。
 */
export const setPathPermission = (input: {
  dirPath: string;
  targetType: "user" | "department";
  targetId: number;
  permission: FilePermissionValue;
}) =>
  http.put<SetPermissionResponse>("/files/directories/permissions", {
    dir_path: input.dirPath,
    type: input.targetType,
    id: input.targetId,
    permission: input.permission,
  });

/** 删一条已有的权限。要求对**那个文件**有写权限。 */
export const removePermission = (permissionId: number) =>
  http.delete<{ success: boolean }>(`/files/permissions/${permissionId}`);

// --------------------------------------------------------------------------- //
// 回收站
// --------------------------------------------------------------------------- //

/** ★ 按 owner_id 过滤，不是 deleted_by：别人删掉我的文件，出现在**我**的回收站里。 */
export const fetchTrash = () => http.get<TrashListResponse>("/files/trash");

/** 原路还原。原路径被新文件占了会 409。 */
export const restoreTrash = (trashId: number) =>
  http.post<RestoreTrashResponse>(`/files/trash/${trashId}/restore`);

export const purgeTrash = (trashId: number) =>
  http.delete<{ success: boolean }>(`/files/trash/${trashId}`);

/** 清空。逐条删各自提交，中途失败会留下删了一半的状态（后端原行为）。 */
export const purgeAllTrash = () => http.delete<PurgeAllTrashResponse>("/files/trash");

// --------------------------------------------------------------------------- //
// 没有接进来的三条（23 条里剩下的）
// --------------------------------------------------------------------------- //
//
// · POST /files/items/archive（打包下载选中项）
//   回的是 zip 二进制。http 客户端会把它当文本读了再 JSON.parse，拿不到可用的字节；
//   而 <a href> 做不了 POST，所以这条**暂时没有入口**，选中多个文件时只能逐个下载。
//   要做的话得先给 shared/api 加一个「响应当 blob」的出口（见 blockers）。
//
// · GET /files/history/views（浏览记录）
//   后端模块头自己标了：传了 file_id 之后**不限制 user_id**，任何登录用户都能读到
//   别人对该文件的浏览记录，是待收口的越权。新前端不开这个入口，免得又多一处依赖。
//   文件详情里的「最近操作」走的是另一张表（FileHistory），不受影响。
//
// · GET /files/shares/{token}/download（公开分享下载）
//   本模块唯一不要登录的路由，是给**拿到链接的外部人**点的。
//   前端只负责把 createShare 给的 share_url 过一次 publicUrl() 交出去。
