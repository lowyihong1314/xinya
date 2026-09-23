# api/media — Event album: files, thumbnails, transcoding

> v3：已从 Flask 蓝图搬到 FastAPI（原 `backend/app/media/`）。
> `routes.py` → `router.py`，`services.py` → `service.py`，其余文件原样平移。
> 两个蓝图当年都是 root 作用域，所以 URL 一个字符没动（`/media/...`、`/media_file/...`）。
> Socket.IO 的两处 emit 换成了 `core.realtime.publish_sync("media", ...)`。

## Files

- `router.py`: HTTP endpoints. 两个 router —— `router`（`/media/*`）与
  `media_file_router`（挂在应用**根**上的 `/media_file/<path>`）。
- `service.py`: event-media business logic and the video conversion flow.
- `utils.py`: ffmpeg / Pillow / zip helpers.
- `paths.py`: media storage path helpers + `safe_join`（werkzeug 语义的自实现，
  是 `/media_file/<path>` 的目录穿越护栏）。
- `constants.py`: supported file extensions（三张表，别合并，见文件注释）。
- `video_tasks.py`: in-memory task state for active conversion jobs（每进程一份）。

## Routes

- `GET    /media_file/<path>` — nginx 找不到文件时的回落；**会当场重建 JPEG 缓存**
- `GET    /media/file/<path>` — 同上，带 `/media` 前缀的别名
- `GET    /media/get_event_type/<id>`
- `GET    /media/get_event_image/<id>/<cache|base>?force=1`
- `POST   /media/upload_media`（`event_edit`）
- `POST   /media/rotate_file/<file_id>/<angle>`（`event_edit`）
- `DELETE /media/delete_files`（`event_edit`）
- `POST   /media/download_files` — 打包 zip，**无鉴权**（原行为）
- `GET|POST /media/album_file/<file_id>/heart` — 公开活动的访客也能按

## Storage layout（全部在 `DATA_ROOT` 下）

```
NAS/UTBA/event_photo/<event_code>/<file>          原始上传
CACHE/UTBA/event_photo/<event_code>/<stem>.jpeg   缩略图缓存（+ .cache_version 兄弟文件）
CACHE/UTBA/event_photo/<event_code>/<stem>.mp4    15 秒预览转码
MP4/UTBA/event_photo/<event_code>/<stem>_web.mp4  完整转码
<output>.lock                                     转码互斥锁（JSON，含 pid）
```

## Notes

- 文件响应的 ETag 算法与 werkzeug `send_file` **逐字符一致**，浏览器里已有的缓存
  在 Flask → FastAPI 切换后仍然命中 304。改 `_send_file_conditional` 前先读那段注释。
- `safe_join` 改动后跑 `./venv/bin/python scripts/verify_media_safe_join.py`。
- service.py 的模块 docstring 列了六处「看着像 bug 但故意保留」，动之前先看那里。
