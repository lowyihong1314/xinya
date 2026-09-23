# api/music — 音乐播放器

> v3：已从 Flask 蓝图搬到 FastAPI（原 `backend/app/music/`）。
> `routes.py` → `router.py`，`services.py` → `service.py`，`storage.py` 原样平移。
> URL 少了 `/api` 这一段：`/api/music/...` → `/music/...`（共 26 条路由）。

上传、专辑管理、下载/流式下发、wma → mp3 缓存转码、歌单、播放队列、播放分钟数统计。

## 文件
- `router.py` — 路由与参数提取（Flask → FastAPI 的全部适配都在这里）
- `service.py` — 业务逻辑（原 `services.py`）
- `storage.py` — 落盘路径、上传保存、下发与转码

## 路由（`/music`）
- `POST /upload`、`POST /replace/<id>`、`DELETE /delete/<id>`、`POST /edit/<id>`
- `GET /albums`、`GET /albums/<id>`、`POST /album`、`POST|DELETE /album/<id>`、
  `POST /albums/<id>/upload_cover`、`GET /album_cover/<path>`
- `GET /list`、`GET /detail/<id>`、`GET /download/<id>`
- `GET|POST /playlists` · `/playlist` · `/playlist/<id>`
- `GET|POST /queue`、`GET|POST /playlist_state`
- `POST /add_one_minute/<id>`、`GET /minute_logs`、`GET /last_played`

**公开路由**（没有 `@login_required`，与 Flask 时代一致）：
`albums` / `albums/<id>` / `list` / `detail/<id>` / `download/<id>` / `album_cover/<path>`。
也就是音频本体不登录就能下载 —— 既有行为，本次迁移不收口。

## 权限
写操作 = `music_edit`。歌单 / 队列 / 播放器状态 / 打点只要求登录（都是"每个用户自己的"数据）。

## 运行时依赖
- `ffmpeg` —— `.wma` 下载时转码成 mp3 并按 `music.id` 缓存在 `<DATA_ROOT>/music/cache/`。
- `Pillow` —— 专辑封面压缩（最长边 1200，JPEG q82，渐进式）。在函数体里 import。

## 迁移时要知道的三件事
1. 下载接口用 `starlette.responses.FileResponse`，**原生支持 Range**（音频拖进度条靠它）。
   不要改成自己 `open().read()` 返回 bytes。
2. `send_file` 的 `Cache-Control` 不是免费的：werkzeug 默认发 `no-cache`，FileResponse
   什么都不发。`storage.py` 里显式把音频的 `no-cache` 和封面的 `public, max-age=2592000`
   补回去了。
3. 封面 URL 入库时仍写 `/api/music/album_cover/<file>`（带 `/api`）。这是**故意的** ——
   前端只取最后一段文件名，而生产还跑 Flask。切换生产时连同 `models/music.py` 的
   `REMOTE_ALBUM_COVER_ROOT` 和 `frontend/.../musicCoverSources.ts` 一起改。

其余「看着像 bug、故意保留」的点各自写在 `service.py` / `storage.py` 的模块 docstring 里。
