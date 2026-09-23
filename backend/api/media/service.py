"""活动相册的业务逻辑：取图 / 取缓存 / 转码 / 上传 / 旋转 / 删除 / 爱心。

原 backend/app/media/services.py，逻辑逐字照搬。路由层（鉴权、参数提取、响应构造）
在同目录 router.py。

── 搬迁时改掉的四样东西 ──────────────────────────────────────────────

① ``from flask import abort`` → 本文件的 ``_abort()``（抛 fastapi.HTTPException）。
   状态码和 description 原样保留，**但响应体形状变了**：Flask 的 abort 发的是
   werkzeug 的 HTML 错误页，FastAPI 这边由 main.py 的处理器渲染成
   ``{"status": "error", "message": "<原 description>"}``。
   前端本来就解析不了那张 HTML，两边都只看状态码，所以不构成行为变更。
   ⚠️ ``abort(404)``（不带 description，见 resolve_media_path / toggle_album_file_heart）
   的 message 会是 starlette 填的 ``"Not Found"`` / ``"Bad Request"``。

② ``from flask_login import current_user`` → ``backend.core.auth``（ContextVar 代理）。

③ ``from werkzeug.utils import safe_join, secure_filename``：
   secure_filename 取 ``backend.core.files``（逐字节复刻），
   safe_join 自己实现了一份放在同目录 paths.py —— 它是 ``/media_file/<path>``
   的目录穿越护栏，改之前读那边的注释。

④ Socket.IO → SSE（core.realtime）。两处发送端都换成 ``publish_sync``（**同步版**）：
   一处在 ffmpeg 转码的后台线程里，一处在请求线程里（FastAPI 的 def 路由跑在
   线程池，同样碰不到事件循环），async 版的 publish 在这两处都用不了。

       socket_broker.emit("media_room_update", msg, to=f"media:{code}")
           → publish_sync("media", code, "media_room_update", msg)   频道 rt:media:<code>

   房间名里的 ``media:`` 前缀由频道的 app 段承担（core/realtime.py 的硬约定：
   room_id 必须是**裸 id**），但 **msg 里那个 ``"room": "media:<code>"`` 字段照旧**
   —— 前端 MediaNotification 在读它，那是响应体不是路由参数。
   事件名和 data 的形状一个字都没动。
   ★ 本模块**没有** core.realtime.register(RealtimeApp(...))，也就是说在前端切到
     SSE 之前，这些消息发出去没有订阅者（和 changyou_room 现在一样）。
     旧 Socket.IO 那条链路仍由还没搬的 Flask 进程供着。

── 六处"看着像 bug、但故意保留" ──────────────────────────────────────

① ``get_event_type_payload`` / ``get_event_image_payload`` 是 **GET**，却每次都推一条
   实时消息。等于"有人看图"会广播给全房间，噪音很大。前端 PhotoGrid 靠其中
   ``get_event_image`` 这条做过刷新，删了会掉功能。TODO(噪音): 收口时再议。

② ``_get_cache_image_payload`` 尾部 ``"kind": "video" if ext in VIDEO_EXTS else "image"``
   里的 video 分支是**死代码** —— 视频在上面的 if 里早就 return 了，走到这里 ext
   一定不是视频。照抄不删。

③ ``delete_album_file`` 删缓存时用的是 ``secure_filename(stem + ".jpeg")``，
   而**写**缓存时用的是 ``os.path.splitext(secure_filename(file_name))[0] + ".jpeg"``。
   两者对非 ASCII 文件名会算出不同的名字（"报告.jpg" → 写的是 "jpg.jpeg"、
   删的是 "jpeg"），于是那张缓存删不掉，留在盘上。
   TODO(行为 bug，勿顺手修): 修之前要先写一个清理脚本处理存量孤儿文件。

④ ``create_album_file`` 先把文件写到磁盘，再 ``db.session.add/commit``。
   commit 失败时文件已经落盘了（路由层只 rollback 数据库），留下一个没有记录的
   孤儿文件。原行为，照搬。

⑤ ``_get_cache_image_payload`` / ``_get_base_image_payload`` 在源文件不存在时会
   **直接删库里那条记录**（``db.session.delete(file); commit()``）然后回 404。
   一个 GET 请求带副作用，而且 NAS 临时挂不上的时候会误删记录。原行为，照搬。
   ⚠️ 注意只有 cache 分支这么干，base 分支（``_get_base_image_payload``）是回
   broken-image，两条分支不一样，别对齐。

⑥ ``async_compress_video`` 把 ffmpeg 的输出参数写在 ``output`` **后面**
   （``-progress pipe:1 -loglevel error``）。ffmpeg 容忍这种写法，但它其实是
   "输出文件之后的全局选项"。照抄。
"""

import json
import os
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone

import psutil
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from backend.api.media.constants import IMAGE_EXTS, VIDEO_EXTS
from backend.api.media.paths import (
    DATA_PATH,
    event_photo_base_dir,
    event_photo_cache_dir,
    event_photo_mp4_dir,
    safe_join,
    to_short_data_path,
)
from backend.api.media.utils import ensure_jpeg_cache_file, get_duration, is_video_valid, remove_jpeg_cache_file
from backend.api.media.video_tasks import current_video_tasks
from backend.core.auth import current_user
from backend.core.db import db
from backend.core.files import secure_filename
from backend.core.realtime import publish_sync
from backend.models.event_data import AlbumFileHeart, AlbumFiles, EventData

VIDEO_CACHE_DURATION_SECONDS = 15
VIDEO_CACHE_MAX_WIDTH = 1280
VIDEO_CACHE_MAX_HEIGHT = 720
VIDEO_CACHE_MAX_RATE = "2500k"
VIDEO_BASE_MAX_WIDTH = 3840
VIDEO_BASE_MAX_HEIGHT = 2160
VIDEO_BASE_MAX_RATE = "20000k"
VIDEO_MAX_FPS = 30

# core/realtime.py 频道里的 app 段（``rt:{app}:{room_id}``）。必须匹配
# ^[a-z][a-z0-9_]*$，也是前端将来订阅 SSE 时路径里的那个词。
REALTIME_APP = "media"

# 原来 ``_safe_emit`` 发的是**不带 room 的全局广播**（socketio 的 emit 不传 room
# 就是广播给所有连接）。SSE 这边没有"全局"这种东西 —— 每条消息都必须落在某个频道上，
# 所以给它一个固定房间。选 "broadcast" 而不是复用 event_code，是为了保留原来
# "这条消息谁都收得到 / 那条只发给该活动房间" 的区分；两条消息的 payload 完全相同，
# 前端（CacheMediaPlayer / PhotoGrid）今天只订房间那一条。
BROADCAST_ROOM = "broadcast"


def _abort(status_code, detail=None):
    """等价于 Flask 的 ``abort(code)`` / ``abort(code, "描述")``。

    detail 为 None 时 starlette 会填标准短语（404 → "Not Found"），
    最终响应体由 main.py 的处理器渲染成 {"status":"error","message":…}。
    """
    raise HTTPException(status_code=status_code, detail=detail)


def resolve_media_path(filepath):
    """URL 里的相对路径 → DATA_ROOT 下的绝对路径。逃出 DATA_ROOT 就 404。"""
    real_path = safe_join(DATA_PATH, filepath)
    if not real_path:
        _abort(404)
    return real_path


def get_event_type_payload(file_id):
    file = AlbumFiles.query.get(file_id)
    if not file:
        _abort(404, "File not found")

    ext = _resolve_album_file_ext(file)
    if ext in IMAGE_EXTS:
        # 注意 ".jpg" → "image/jpg"（不是标准的 image/jpeg）。前端只拿它判大类，
        # 改成 image/jpeg 属于行为变更，不动。
        mime = f"image/{ext.lstrip('.')}"
    elif ext in {".heic", ".heif"}:
        mime = "image/heic"
    elif ext in VIDEO_EXTS:
        # 所有视频一律报 video/mp4 —— 因为发给前端的永远是转码后的 mp4。
        mime = "video/mp4"
    else:
        mime = "application/octet-stream"

    payload = {"id": file_id, "file_name": file.file_name, "mime": mime}
    _emit_event_room(
        file.event.event_code,
        "get_event_type",
        {"file_id": file_id, "file_name": file.file_name, "mime": mime},
    )
    return payload


def _extension_from_file_type(file_type):
    normalized = str(file_type or "").strip().lower().lstrip(".")
    if not normalized:
        return ""
    return f".{normalized}"


def _detect_image_extension(path):
    if not os.path.exists(path):
        return ""
    try:
        from PIL import Image

        with Image.open(path) as image:
            image_format = str(image.format or "").lower()
    except Exception:
        return ""

    if image_format in {"jpeg", "jpg"}:
        return ".jpg"
    if image_format in {"png", "bmp", "tiff", "webp"}:
        return f".{image_format if image_format != 'tiff' else 'tif'}"
    return ""


def _resolve_album_file_ext(file, filename=None, event_code=None):
    """按「文件名扩展名 → 库里的 file_type → 嗅探文件内容」三级回退认格式。

    第一级用的是 secure_filename **之后**的名字：中文名被清空后扩展名也会跟着没，
    所以才需要后面两级兜底（老数据里有一批这样的记录）。
    """
    safe_filename = filename or secure_filename(file.file_name)
    ext = os.path.splitext(safe_filename)[1].lower()
    if ext:
        return ext

    file_type_ext = _extension_from_file_type(getattr(file, "file_type", None))
    if file_type_ext in IMAGE_EXTS or file_type_ext in VIDEO_EXTS or file_type_ext in {".heic", ".heif"}:
        return file_type_ext

    resolved_event_code = event_code or getattr(getattr(file, "event", None), "event_code", None)
    if not resolved_event_code:
        return ""

    source_path = os.path.join(event_photo_base_dir(resolved_event_code), safe_filename)
    return _detect_image_extension(source_path)


def _safe_emit(event, data):
    """原来的"全局广播"通道（见 BROADCAST_ROOM 的注释）。

    原实现把 emit 包在 try/except 里打一行 [WS-DISCONNECTED] 就算了；
    publish_sync 自己吞异常、只返回 bool，所以这里不再需要 try —— 语义一致：
    **推送失败不能让正在转码的线程炸掉**。返回值故意不看。
    """
    publish_sync(REALTIME_APP, BROADCAST_ROOM, event, data)


def _media_socket_room(event_code):
    """消息体里那个 ``room`` 字段的值。前端在读，保留 ``media:`` 前缀。

    ⚠️ 它**不是** publish_sync 的 room_id —— 那边要裸 event_code，
    传这个值进去会拼成 ``rt:media:media:<code>``。
    """
    return f"media:{event_code}"


def _emit_event_room(event_code, action, payload=None):
    if not event_code:
        return

    room = _media_socket_room(event_code)
    message = {
        "event": action,
        "room": room,
        "event_code": event_code,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if payload:
        # payload 里的键会**覆盖**上面四个同名键。原行为（没有调用方传同名键）。
        message.update(payload)

    # 事件名恒为 "media_room_update"，具体动作在 message["event"] 里 —— 前端只挂了
    # 一个监听器，靠 message.event 分支，所以这层嵌套不能拍平。
    publish_sync(REALTIME_APP, str(event_code), "media_room_update", message)


def _time_to_seconds(value):
    if not value or value == "N/A":
        return 0.0
    try:
        hours, minutes, seconds = value.split(":")
        return float(hours) * 3600 + float(minutes) * 60 + float(seconds)
    except Exception:
        return 0.0


def _video_scale_filter(max_width, max_height):
    # force_divisible_by=2：H.264 要求宽高是偶数，奇数分辨率会让 libx264 直接报错。
    return (
        "scale="
        f"w='min({max_width},iw)':"
        f"h='min({max_height},ih)':"
        "force_original_aspect_ratio=decrease:"
        "force_divisible_by=2:"
        "in_range=auto:"
        "out_range=tv"
    )


def async_compress_video(
    source,
    output,
    lock_file,
    video_id,
    event_code,
    *,
    variant,
    max_width,
    max_height,
    max_rate,
    max_duration=None,
):
    """ffmpeg 转码 + 进度推送。**跑在后台线程里**（daemon=True）。

    ★ 线程里只能用 publish_sync：这里没有事件循环，async 的 publish 用不了，
      而每 0.5 秒一条进度，用 asyncio.run() 每次新建循环是灾难。
    ★ lock_file 是跨进程的互斥：内容是 JSON，带 pid，别的 worker 靠
      psutil.pid_exists(pid) 判断"是不是真的还在转"（进程被 kill 后锁会变成孤儿）。
      finally 里无论成败都删锁 —— 漏了这一句，那个文件就永远 202 了。
    """

    def write_lock(data_override=None):
        payload = {
            "pid": os.getpid(),
            "video_id": video_id,
            "source": source,
            "output": output,
            "start_time": time.time(),
            "last_percent": 0,
        }
        if data_override:
            payload.update(data_override)
        with open(lock_file, "w") as file_obj:
            file_obj.write(json.dumps(payload))

    current_video_tasks[video_id] = {
        "pid": os.getpid(),
        "source": source,
        "output": output,
        "start_time": time.time(),
        "last_percent": 0,
        "status": "running",
    }
    write_lock()

    video_name = os.path.basename(source)
    total_duration = get_duration(source) or 0
    effective_total = min(total_duration, max_duration) if total_duration > 0 and max_duration else total_duration
    last_emit = 0
    last_percent = 0.0
    _emit_event_room(
        event_code,
        "video_processing_started",
        {"video": video_name, "video_id": video_id, "type": "started"},
    )

    try:
        # 原文件这里写的是 ``__import__("subprocess").Popen``（模块顶部没 import）。
        # 提到顶部的普通 import，行为完全等价。
        process = subprocess.Popen(
            [
                "ffmpeg",
                "-hide_banner",
                "-y",
                "-i",
                source,
                *([] if not max_duration else ["-t", str(max_duration)]),
                "-vf",
                f"{_video_scale_filter(max_width, max_height)},fps={VIDEO_MAX_FPS}",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "23",
                "-preset",
                "fast",
                "-threads",
                "6",
                "-maxrate",
                max_rate,
                "-bufsize",
                max_rate,
                "-c:a",
                "aac",
                "-b:a",
                "96k" if variant == "cache" else "128k",
                "-r",
                str(VIDEO_MAX_FPS),
                # +faststart：把 moov 原子挪到文件头，浏览器才能边下边播。
                "-movflags",
                "+faststart",
                output,
                "-progress",
                "pipe:1",
                "-loglevel",
                "error",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            bufsize=1,
        )

        def log_stderr(proc):
            for log in proc.stderr:
                print("[FFLOG]", log.strip())

        # stderr 必须有人一直读：管道缓冲区写满时 ffmpeg 会卡死在写日志上，
        # 表现是"转码进度停在某个百分比不动"。
        threading.Thread(target=log_stderr, args=(process,), daemon=True).start()
        current_time = 0.0
        speed = 1.0

        for line in process.stdout:
            if "=" not in line:
                continue

            key, value = line.strip().split("=", 1)
            if key == "out_time_ms" and value.isdigit():
                current_time = float(value) / 1_000_000
            elif key == "out_time":
                current_time = _time_to_seconds(value)
            elif key == "speed":
                try:
                    speed = float(value.replace("x", ""))
                except Exception:
                    speed = 1.0

            if effective_total > 0 and current_time > 0:
                percent = round((min(current_time, effective_total) / effective_total) * 100, 2)
                if percent < last_percent:
                    # 进度条只许往前走：ffmpeg 偶尔会回吐一个更小的 out_time。
                    continue
                if percent > 99.5:
                    # 卡在 99.5 等真正的 done 事件 —— 先到 100 再等几秒，用户会以为卡住了。
                    percent = 99.5

                last_percent = percent
                current_video_tasks[video_id]["last_percent"] = percent
                write_lock({"last_percent": percent})

                now = time.time()
                if now - last_emit >= 0.5:
                    eta = round((effective_total - min(current_time, effective_total)) / speed, 1) if speed > 0 else None
                    _safe_emit(
                        "video_progress",
                        {
                            "video": video_name,
                            "video_id": video_id,
                            "type": "progress",
                            "percent": percent,
                            "current": round(current_time, 2),
                            "total": round(effective_total, 2),
                            "eta": eta,
                        },
                    )
                    _emit_event_room(
                        event_code,
                        "video_progress",
                        {
                            "video": video_name,
                            "video_id": video_id,
                            "type": "progress",
                            "percent": percent,
                            "current": round(current_time, 2),
                            "total": round(effective_total, 2),
                            "eta": eta,
                        },
                    )
                    last_emit = now

        ret = process.wait()
        if ret == 0:
            current_video_tasks[video_id]["status"] = "done"
            _safe_emit(
                "video_progress",
                {"video": video_name, "video_id": video_id, "type": "done", "percent": 100},
            )
            _emit_event_room(
                event_code,
                "video_done",
                {"video": video_name, "video_id": video_id, "type": "done", "percent": 100},
            )
        else:
            current_video_tasks[video_id]["status"] = "error"
            _safe_emit(
                "video_progress",
                {
                    "video": video_name,
                    "video_id": video_id,
                    "type": "error",
                    "value": f"FFmpeg exited {ret}",
                },
            )
            _emit_event_room(
                event_code,
                "video_error",
                {
                    "video": video_name,
                    "video_id": video_id,
                    "type": "error",
                    "value": f"FFmpeg exited {ret}",
                },
            )
    except Exception as exc:
        current_video_tasks[video_id]["status"] = "error"
        _safe_emit(
            "video_progress",
            {"video": video_name, "video_id": video_id, "type": "error", "value": str(exc)},
        )
        _emit_event_room(
            event_code,
            "video_error",
            {"video": video_name, "video_id": video_id, "type": "error", "value": str(exc)},
        )
    finally:
        current_video_tasks.pop(video_id, None)
        if os.path.exists(lock_file):
            os.remove(lock_file)


def get_event_image_payload(file_id, variant, force=False):
    """取某个文件的可播放/可显示地址。返回 dict，或 (dict, 202)（转码中）。

    variant 只认 "cache"（列表页缩略图 / 15 秒预览）和 "base"（大图 / 完整视频），
    别的值 400。
    """
    file = AlbumFiles.query.get(file_id)
    if not file:
        _abort(404, "File not found")

    event_code = file.event.event_code
    filename = secure_filename(file.file_name)
    ext = _resolve_album_file_ext(file, filename, event_code)
    _emit_event_room(
        event_code,
        "get_event_image",
        {
            "file_id": file_id,
            "file_name": file.file_name,
            "variant": variant,
            "force": force,
        },
    )

    if ext not in IMAGE_EXTS and ext not in VIDEO_EXTS and ext not in {".heic", ".heif"}:
        # 认不出格式（.svg / .raw / 扩展名被中文名洗掉且嗅探失败）→ 给个坏图占位，
        # 状态仍是 success：前端靠 ready=False + kind=unsupported 分支，不是靠 HTTP 码。
        return {
            "status": "success",
            "ready": False,
            "kind": "unsupported",
            "path": "/static/images/file_icon/broken-image.png",
        }

    if variant == "cache":
        return _get_cache_image_payload(file, filename, ext, event_code)
    if variant == "base":
        return _get_base_image_payload(file, filename, ext, event_code, force)
    _abort(400, "Invalid type")


def _get_cache_image_payload(file, filename, ext, event_code):
    if ext in VIDEO_EXTS:
        base, _ = os.path.splitext(filename)
        src = os.path.join(event_photo_base_dir(event_code), filename)
        full_path = os.path.join(event_photo_cache_dir(event_code), f"{base}.mp4")
        lock_file = full_path + ".lock"

        if not os.path.exists(src):
            # ⚠️ GET 带副作用：源文件没了就把库里的记录删掉（见模块头 ⑤）。
            db.session.delete(file)
            db.session.commit()
            _abort(404, "Source missing, record removed")

        if os.path.exists(full_path) and is_video_valid(
            full_path,
            src,
            max_duration=VIDEO_CACHE_DURATION_SECONDS,
        ):
            return {
                "status": "success",
                "ready": True,
                "kind": "video",
                "cache": True,
                "path": to_short_data_path(full_path),
            }

        if os.path.exists(lock_file):
            try:
                with open(lock_file) as file_obj:
                    pid = json.load(file_obj).get("pid")
                if pid and psutil.pid_exists(pid):
                    return {"status": "processing", "ready": False, "kind": "video"}, 202
                # 锁在、进程不在 = 上次转码被 kill 了，清掉锁重来。
                os.remove(lock_file)
            except Exception:
                if os.path.exists(lock_file):
                    os.remove(lock_file)

        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        try:
            # O_CREAT|O_EXCL 是原子的：多个 worker 同时进来只有一个能建成锁，
            # 其余的落到 FileExistsError 回 202。别换成 exists() + open()。
            fd = os.open(lock_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
        except FileExistsError:
            return {"status": "processing", "ready": False, "kind": "video"}, 202

        threading.Thread(
            target=async_compress_video,
            args=(src, full_path, lock_file, file.id, event_code),
            kwargs={
                "variant": "cache",
                "max_width": VIDEO_CACHE_MAX_WIDTH,
                "max_height": VIDEO_CACHE_MAX_HEIGHT,
                "max_rate": VIDEO_CACHE_MAX_RATE,
                "max_duration": VIDEO_CACHE_DURATION_SECONDS,
            },
            daemon=True,
        ).start()
        return {"status": "processing", "ready": False, "kind": "video"}, 202
    else:
        base, _ = os.path.splitext(filename)
        full_path = os.path.join(event_photo_cache_dir(event_code), f"{base}.jpeg")
        src = os.path.join(event_photo_base_dir(event_code), filename)
        if not os.path.exists(src):
            db.session.delete(file)
            db.session.commit()
            _abort(404, "Source missing, record removed")
        # 图片是**同步**压的（转码才丢后台线程）：JPEG 压缩几十毫秒，
        # 为它加一套 202 轮询不划算。
        full_path = ensure_jpeg_cache_file(src, os.path.dirname(full_path))

    if not os.path.exists(full_path):
        # 见模块头 ②：走到这里 ext 一定不是视频，那个 video 分支是死代码。
        return {
            "status": "success",
            "ready": False,
            "kind": "video" if ext in VIDEO_EXTS else "image",
            "path": "/static/images/file_icon/broken-image.png",
        }

    return {
        "status": "success",
        "ready": True,
        "kind": "image",
        "cache": True,
        "path": to_short_data_path(full_path),
    }


def _get_base_image_payload(file, filename, ext, event_code, force):
    base_path = os.path.join(event_photo_base_dir(event_code), filename)
    if ext in VIDEO_EXTS:
        base, _ = os.path.splitext(filename)
        mp4_path = os.path.join(event_photo_mp4_dir(event_code), f"{base}_web.mp4")
        lock_file = mp4_path + ".lock"

        if force:
            # ?force=1：用户点了"重新转码"。先把旧产物和锁（连同还在跑的 ffmpeg）清掉。
            _force_remove_video_outputs(mp4_path, lock_file)

        if not force and os.path.exists(mp4_path) and is_video_valid(mp4_path, base_path):
            return {
                "status": "success",
                "ready": True,
                "kind": "video",
                "path": to_short_data_path(mp4_path),
            }

        if os.path.exists(lock_file):
            try:
                with open(lock_file) as file_obj:
                    pid = json.load(file_obj).get("pid")
                if pid and psutil.pid_exists(pid):
                    return {"status": "processing", "ready": False}, 202
                os.remove(lock_file)
            except Exception:
                if os.path.exists(lock_file):
                    os.remove(lock_file)

        os.makedirs(os.path.dirname(mp4_path), exist_ok=True)
        try:
            fd = os.open(lock_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
        except FileExistsError:
            return {"status": "processing", "ready": False}, 202

        threading.Thread(
            target=async_compress_video,
            args=(base_path, mp4_path, lock_file, file.id, event_code),
            kwargs={
                "variant": "base",
                "max_width": VIDEO_BASE_MAX_WIDTH,
                "max_height": VIDEO_BASE_MAX_HEIGHT,
                "max_rate": VIDEO_BASE_MAX_RATE,
            },
            daemon=True,
        ).start()
        # 注意这两条 202 的 payload **没有** kind 键，cache 分支的有。
        # 不是疏忽就是历史，前端两边都不读 kind —— 照抄，别对齐。
        return {"status": "processing", "ready": False}, 202

    if not os.path.exists(base_path):
        # 图片分支源文件不存在**不删记录**（与 cache 分支不同，见模块头 ⑤）。
        return {
            "status": "success",
            "ready": False,
            "kind": "image",
            "path": "/static/images/file_icon/broken-image.png",
        }

    if ext in {".heic", ".heif"}:
        # 浏览器不认 HEIC，大图也必须发转好的 JPEG。
        jpeg_path = ensure_jpeg_cache_file(base_path, event_photo_cache_dir(event_code))
        return {
            "status": "success",
            "ready": True,
            "kind": "image",
            "cache": True,
            "path": to_short_data_path(jpeg_path),
        }

    return {
        "status": "success",
        "ready": True,
        "kind": "image",
        "path": to_short_data_path(base_path),
    }


def _force_remove_video_outputs(mp4_path, lock_file):
    try:
        if os.path.exists(mp4_path):
            os.remove(mp4_path)
        if os.path.exists(lock_file):
            try:
                with open(lock_file) as file_obj:
                    pid = json.load(file_obj).get("pid")
                if pid and psutil.pid_exists(pid):
                    # terminate 而不是 kill：给 ffmpeg 机会自己收尾。
                    # 注意**不等**它退出，紧接着就删锁 —— 原行为。
                    psutil.Process(pid).terminate()
            except Exception:
                pass
            os.remove(lock_file)
    except Exception as exc:
        print("[FORCE ERROR]", exc)


def _save_upload(upload, save_path):
    """等价于原来的 ``uploaded_file.save(save_path)``（werkzeug FileStorage → starlette UploadFile）。

    werkzeug 的 save() 是从文件对象的**当前位置**开始 copy 的；这里显式 seek(0)
    更稳（UploadFile 的游标可能已被别处读过），spooled 文件不支持 seek 时忽略。
    """
    source = upload.file
    try:
        source.seek(0)
    except (OSError, ValueError):
        pass
    with open(save_path, "wb") as target:
        shutil.copyfileobj(source, target)


def create_album_file(event_id, uploaded_file):
    event = EventData.query.get(event_id)
    if not event:
        _abort(404, "Event not found")
    if not uploaded_file:
        _abort(400, "No file provided")

    filename = secure_filename(uploaded_file.filename)
    file_ext = os.path.splitext(filename)[1].lower().strip(".")
    save_dir = event_photo_base_dir(event.event_code)
    save_path = os.path.join(save_dir, filename)
    os.makedirs(save_dir, exist_ok=True)
    # ⚠️ 同名文件直接覆盖（原行为）：一个活动里传两张 DSC_0001.JPG，后一张会盖掉前一张，
    # 而数据库里会多出一条指向同一个文件的记录。TODO(行为 bug，勿顺手修)。
    _save_upload(uploaded_file, save_path)

    album_file = AlbumFiles(
        event_id=event.id,
        folder_name=event.event_code,
        file_name=filename,
        no=0,
        name=filename,
        # 这两个占位串会显示在前端的标题/说明位上，等人去编辑。照抄。
        title="Update Now!!",
        info="Update Now!!",
        username=current_user.username,
        user_id=current_user.id,
        file_type=file_ext,
    )
    db.session.add(album_file)
    db.session.commit()
    _emit_event_room(
        event.event_code,
        "create_album_file",
        {
            "event_id": event.id,
            "file_id": album_file.id,
            "file_name": filename,
            "file_type": file_ext,
            "user_id": getattr(current_user, "id", None),
            "username": getattr(current_user, "username", None),
        },
    )
    return album_file, filename, file_ext


def rotate_album_file(file_id, angle):
    from PIL import Image

    file = AlbumFiles.query.get(file_id)
    if not file:
        _abort(404, "File not found")

    # 注意这里用的是**原始** file_name 的扩展名（没过 secure_filename），
    # 与下面取 base_path 时的处理不同 —— 原行为，照抄。
    ext = os.path.splitext(file.file_name)[1].lower()
    if ext not in [".png", ".jpg", ".jpeg", ".heic"]:
        _abort(400, "File type not supported for rotation")

    base_path = os.path.join(event_photo_base_dir(file.event.event_code), secure_filename(file.file_name))
    if not os.path.exists(base_path):
        _abort(404, "Base file not found")

    # ⚠️ 直接覆盖原图：转多少次就有损多少次，而且 .heic 会被 PIL 以 JPEG 之外的方式
    # 处理（实际会抛异常 → 500）。原行为，不改。
    img = Image.open(base_path)
    img.rotate(-angle, expand=True).save(base_path)

    # 原图变了，缓存必须失效（下次取图会重压一张）。
    cache_file = os.path.join(event_photo_cache_dir(file.event.event_code), f"{os.path.splitext(file.file_name)[0]}.jpeg")
    remove_jpeg_cache_file(cache_file)

    _emit_event_room(
        file.event.event_code,
        "rotate_album_file",
        {"file_id": file.id, "file_name": file.file_name, "angle": angle},
    )


def delete_album_file(file):
    """删一条记录连带盘上的四个文件。**不 commit** —— 由调用方批量提交。"""
    event_code = file.event.event_code
    stem = os.path.splitext(file.file_name)[0]
    base_path = os.path.join(event_photo_base_dir(file.event.event_code), secure_filename(file.file_name))
    # 见模块头 ③：这三个 secure_filename(stem + 后缀) 与写缓存时的算法不一致，
    # 非 ASCII 文件名会漏删。TODO(行为 bug，勿顺手修)。
    cache_path = os.path.join(
        event_photo_cache_dir(file.event.event_code),
        secure_filename(stem + ".jpeg"),
    )
    cache_video_path = os.path.join(
        event_photo_cache_dir(file.event.event_code),
        secure_filename(stem + ".mp4"),
    )
    base_video_path = os.path.join(
        event_photo_mp4_dir(file.event.event_code),
        secure_filename(stem + "_web.mp4"),
    )
    remove_jpeg_cache_file(cache_path)

    for path in [base_path, cache_video_path, base_video_path]:
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception as exc:
                # 删不掉只打日志：数据库那条还是要删的，不然前端列表里留着一条点不开的。
                print(f"删除文件失败: {path}, 错误: {exc}")

    db.session.delete(file)
    _emit_event_room(
        event_code,
        "delete_album_file",
        {"file_id": file.id, "file_name": file.file_name},
    )


def get_album_file(file_id):
    return AlbumFiles.query.get(file_id)


def get_album_files(file_ids):
    # 逐个 get（N+1）。照抄不做批量化：调用方靠"结果里可能有 None"这个性质
    # 来跳过不存在的 id，换成 filter(id.in_(...)) 会把那个分支变成"静默少几条"。
    return [AlbumFiles.query.get(file_id) for file_id in file_ids]


def album_file_heart_count(file_id):
    return int(
        db.session.query(db.func.count(AlbumFileHeart.id))
        .filter(AlbumFileHeart.file_id == file_id)
        .scalar()
        or 0
    )


def toggle_album_file_heart(file_id, user_id=None, visitor_token=None):
    """按一下爱心：同一个人再按一次就取消。返回 (是否已按, 总数)。

    登录用户以 user_id 认人，未登录访客以浏览器里的 visitor_token 认人，
    两者各有唯一索引，所以同一个人只可能留下一颗。
    """
    album_file = AlbumFiles.query.get(file_id)
    if not album_file:
        _abort(404)
    if not user_id and not visitor_token:
        _abort(400)

    identity = (
        AlbumFileHeart.user_id == user_id
        if user_id
        else AlbumFileHeart.visitor_token == visitor_token
    )
    existing = AlbumFileHeart.query.filter(AlbumFileHeart.file_id == album_file.id, identity).first()

    if existing:
        db.session.delete(existing)
        db.session.commit()
        return False, album_file_heart_count(album_file.id)

    db.session.add(
        AlbumFileHeart(
            file_id=album_file.id,
            user_id=user_id,
            visitor_token=None if user_id else visitor_token,
        )
    )
    try:
        db.session.commit()
    except IntegrityError:
        # 同一个人连点两下撞上唯一索引：当成已经按过，不报错
        db.session.rollback()
    return True, album_file_heart_count(album_file.id)
