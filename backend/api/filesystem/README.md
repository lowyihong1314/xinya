# api/filesystem — File Manager

> v3：已从 Flask 蓝图搬到 FastAPI（原 `backend/app/filesystem/`）。
> `routes.py` → `router.py`，`services.py` → `service.py`，`serializers.py` / `paths.py` 原样平移。
> URL 少了 `/api` 这一段：`/api/files/...` → `/files/...`。
> **包名是 `filesystem`，挂载前缀是 `/files`** —— 蓝图时代就不同名（变量名 `files_bp`），
> 前端按的是 `/files`，别对齐。

## Files

- `router.py`：25 条 REST 风格的文件管理接口。
- `service.py`：路径处理、权限、上传、删除、分享、目录查询。
- `serializers.py`：file / list / history 的输出整形。
- `paths.py`：两个存储根（`STORAGE_ROOT` / `TRASH_ROOT`）。

## Model (`models/file_manager.py`)

- `File` — 一行 = 一个逻辑路径。`is_folder=True` 的是目录，`path` 唯一。
  逻辑路径直接映射磁盘：`STORAGE_ROOT / path.lstrip("/")`。
- `FilePermission` — 挂在 file 上的权限行，三种：用户级（`user_id`）、
  部门级（`department_id`）、公开（两者都空 + `permission="read_public"`）。
  取值 ∈ `read` / `read_write` / `read_public`。
- `FileHistory` / `ViewHistory` — 操作历史 / 浏览历史。
- `FileTrash` — 回收站快照。磁盘内容搬到 `TRASH_ROOT/<trash_id>`，
  对应的 `files` 行连同权限/历史/分享一起**物理删除**；恢复时按 `path` 重建。
- `SharePublic` — 免登录分享链接（token + 有效期 + 剩余次数）。

## Routes (`/files`)

- `GET  /history/views`、`GET /tree`、`POST /query`、`GET /search`
- `GET  /items/<id>`、`/items/<id>/permissions`、`/items/<id>/content`
- `POST /items/archive`（打包 zip）、`POST /uploads`
- `POST /items/move`、`PATCH /items/<id>/rename`、`DELETE /items`、`POST /items/batch_delete`
- `GET  /directories/detail`、`POST /directories`、`PATCH /directories/rename`、
  `PUT /directories/permissions`、`DELETE /directories`
- `GET  /trash`、`POST /trash/<id>/restore`、`DELETE /trash/<id>`、`DELETE /trash`
- `DELETE /permissions/<id>`
- `POST /shares`、`GET /shares/<token>/download`（**唯一免登录路由**）

## Permissions

不接权限位（没有 `permission_required`），全部走**每个文件自己的 ACL**：
`service.check_permission(user_id, file_obj, "read"|"write")` ——
owner 直接放行 → 用户级权限 → 部门级权限 → 任意一条 `read_public` 兜底（只对 read 生效）。
除 `/shares/<token>/download` 外所有路由都要 `@login_required`。

## Current Gaps

沿用旧 README 的清单，本次搬迁没有补：

- 回收站的「彻底删除」在 API 上有（`DELETE /trash/<id>`），但前端还没接全
- 分享链接的列表 / 吊销 API
- 复制文件 / 复制目录 API
- 单文件级的细粒度权限修改 API

## Notes

- 本模块不保留旧的 `/api/file_system/*` 路由形状。
- `router.py` / `service.py` 顶部各有一段「看着像 bug、故意保留」的清单，
  改任何一条之前先读那里（越权的浏览历史、路径穿越的重命名、静默跳过的批量权限……）。
