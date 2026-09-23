/**
 * 文件管理器的路径工具与显示文案。**只有本模块在用**。
 *
 * ★ 这里全是**展示**和**拼路径**用的换算，不是校验文案。所有错误提示一律用后端返回的
 *   中文原文（ApiError.message），本文件不参与。
 */
import type { FilePermissionValue } from "./types";

// --------------------------------------------------------------------------- //
// 路径
// --------------------------------------------------------------------------- //

/**
 * 规范化路径。**镜像后端 service.normalize_path**：去掉首尾斜杠、反斜杠转正斜杠、
 * 再补一个前导斜杠，空的话就是根目录 "/"。
 *
 * 前端也要有一份，是因为面包屑和「新建到哪里」都要在发请求**之前**先把路径算出来；
 * 两边算法一致，界面上显示的路径才和后端存的那条对得上。
 */
export function normalizePath(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "/";
  const normalized = `/${raw.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return normalized === "/" ? "/" : normalized.replace(/\/+/g, "/");
}

/** 父目录 + 名字 → 子路径。镜像后端 service.child_path。 */
export function joinPath(parent: string, name: string): string {
  const base = normalizePath(parent);
  return base === "/" ? normalizePath(name) : normalizePath(`${base}/${name}`);
}

/** 上一级。根目录的上一级还是根目录。 */
export function parentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  const cut = normalized.lastIndexOf("/");
  return cut <= 0 ? "/" : normalized.slice(0, cut);
}

/**
 * 面包屑。总是以「全部文件」（根目录）开头。
 *
 * 返回的 path 用的是**后端认的逻辑路径**，页面直接拿它当跳转参数，
 * 不要再在调用点拼一次 —— 拼两次就有两种结果。
 */
export function breadcrumbs(path: string): Array<{ name: string; path: string }> {
  const normalized = normalizePath(path);
  const crumbs = [{ name: "全部文件", path: "/" }];
  if (normalized === "/") return crumbs;

  let running = "";
  for (const segment of normalized.slice(1).split("/")) {
    running = `${running}/${segment}`;
    crumbs.push({ name: segment, path: running });
  }
  return crumbs;
}

// --------------------------------------------------------------------------- //
// 显示
// --------------------------------------------------------------------------- //

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * 文件大小。
 * ★ null 要显示成 "—" 而不是 "0 B"：目录的 size 就是 null，
 *   显示成 0 会让人以为目录是空的。
 */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${UNITS[unit]}`;
}

/**
 * 时间戳。后端给的是 **裸 ISO**（utcnow()，不带时区），交给 new Date() 会被当成
 * 本地时间，差 8 小时还看不出来。所以只按字符串裁剪，不做解析、不做时区换算 ——
 * 和 fahui/format.ts 的 formatTimestamp 同一个处理口径。
 */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

/** 权限值 → 中文。三个值来自后端 check_permission 认的那三种。 */
export const PERMISSION_LABELS: Record<FilePermissionValue, string> = {
  read: "只读",
  read_write: "可读写",
  read_public: "公开可读",
};

export function permissionLabel(value: string): string {
  return PERMISSION_LABELS[value as FilePermissionValue] ?? value;
}

/**
 * 操作历史的 action → 中文。**镜像**后端 add_history 的几个调用点，
 * 认不出来的原样显示（后端将来加动作，这里不会崩）。
 *
 * ★ "move" 同时是「移动」和「重命名文件」—— 后端重命名时写的 action 就是 move
 *   （service.rename_file 里标了「照搬」），所以这里只能叫「移动/重命名」。
 */
const ACTION_LABELS: Record<string, string> = {
  create: "创建",
  upload: "上传",
  move: "移动/重命名",
  rename_dir: "重命名目录",
  delete: "删除",
  set_permission: "设置权限",
  remove_permission: "移除权限",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
