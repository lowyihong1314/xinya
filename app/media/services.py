import json
import os
import threading
import time
from datetime import datetime, timezone

import psutil
from flask import abort
from flask_login import current_user
from werkzeug.utils import safe_join, secure_filename

from app.extensions import socketio
from app.media.constants import IMAGE_EXTS, VIDEO_EXTS
from app.media.paths import (
    BROKEN_IMAGE_PATH,
    DATA_PATH,
    abs_data_path,
    event_photo_base_dir,
    event_photo_cache_dir,
    event_photo_mp4_dir,
    to_short_data_path,
)
from app.media.utils import compress_new_cache_file, get_duration, is_video_valid
from app.media.video_tasks import current_video_tasks
from models import db
from models.event_data import AlbumFiles, EventData

VIDEO_CACHE_DURATION_SECONDS = 15
VIDEO_CACHE_MAX_WIDTH = 1280
VIDEO_CACHE_MAX_HEIGHT = 720
VIDEO_CACHE_MAX_RATE = "2500k"
VIDEO_BASE_MAX_WIDTH = 3840
VIDEO_BASE_MAX_HEIGHT = 2160
VIDEO_BASE_MAX_RATE = "20000k"
VIDEO_MAX_FPS = 30


def resolve_media_path(filepath):
    real_path = safe_join(DATA_PATH, filepath)
    if not real_path:
        abort(404)
    return real_path


def get_event_type_payload(file_id):
    file = AlbumFiles.query.get(file_id)
    if not file:
        abort(404, description="File not found")

    ext = os.path.splitext(file.file_name)[1].lower()
    if ext in IMAGE_EXTS:
        mime = f"image/{ext.lstrip('.')}"
    elif ext in {".heic", ".heif"}:
        mime = "image/heic"
    elif ext in {".mp4", ".mov", ".mts", ".avi", ".mkv"}:
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


def _safe_emit(event, data):
    try:
        socketio.server.emit(event, data, namespace="/")
    except Exception as exc:
        print(f"[WS-DISCONNECTED] Emit skipped: {exc}")


def _emit_event_room(event_code, action, payload=None):
    if not event_code:
        return

    message = {
        "event": action,
        "room": event_code,
        "event_code": event_code,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if payload:
        message.update(payload)

    try:
        socketio.emit("media_notification", message, room=event_code)
    except Exception as exc:
        print(f"[WS-DISCONNECTED] Room emit skipped: {exc}")


def _time_to_seconds(value):
    if not value or value == "N/A":
        return 0.0
    try:
        hours, minutes, seconds = value.split(":")
        return float(hours) * 3600 + float(minutes) * 60 + float(seconds)
    except Exception:
        return 0.0


def _video_scale_filter(max_width, max_height):
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
        process = __import__("subprocess").Popen(
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
                "-movflags",
                "+faststart",
                output,
                "-progress",
                "pipe:1",
                "-loglevel",
                "error",
            ],
            stdout=__import__("subprocess").PIPE,
            stderr=__import__("subprocess").PIPE,
            universal_newlines=True,
            bufsize=1,
        )

        def log_stderr(proc):
            for log in proc.stderr:
                print("[FFLOG]", log.strip())

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
                    continue
                if percent > 99.5:
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
    file = AlbumFiles.query.get(file_id)
    if not file:
        abort(404, "File not found")

    ext = os.path.splitext(file.file_name)[1].lower()
    event_code = file.event.event_code
    filename = secure_filename(file.file_name)
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
    abort(400, "Invalid type")


def _get_cache_image_payload(file, filename, ext, event_code):
    if ext in VIDEO_EXTS:
        base, _ = os.path.splitext(filename)
        src = os.path.join(event_photo_base_dir(event_code), filename)
        full_path = os.path.join(event_photo_cache_dir(event_code), f"{base}.mp4")
        lock_file = full_path + ".lock"

        if not os.path.exists(src):
            db.session.delete(file)
            db.session.commit()
            abort(404, "Source missing, record removed")

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
                os.remove(lock_file)
            except Exception:
                if os.path.exists(lock_file):
                    os.remove(lock_file)

        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        try:
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
        if not os.path.exists(full_path):
            src = os.path.join(event_photo_base_dir(event_code), filename)
            if not os.path.exists(src):
                db.session.delete(file)
                db.session.commit()
                abort(404, "Source missing, record removed")
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            full_path = compress_new_cache_file(src, os.path.dirname(full_path))

    if not os.path.exists(full_path):
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
        return {"status": "processing", "ready": False}, 202

    if not os.path.exists(base_path):
        return {
            "status": "success",
            "ready": False,
            "kind": "image",
            "path": "/static/images/file_icon/broken-image.png",
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
                    psutil.Process(pid).terminate()
            except Exception:
                pass
            os.remove(lock_file)
    except Exception as exc:
        print("[FORCE ERROR]", exc)


def create_album_file(event_id, uploaded_file):
    event = EventData.query.get(event_id)
    if not event:
        abort(404, "Event not found")
    if not uploaded_file:
        abort(400, "No file provided")

    filename = secure_filename(uploaded_file.filename)
    file_ext = os.path.splitext(filename)[1].lower().strip(".")
    save_dir = event_photo_base_dir(event.event_code)
    save_path = os.path.join(save_dir, filename)
    os.makedirs(save_dir, exist_ok=True)
    uploaded_file.save(save_path)

    album_file = AlbumFiles(
        event_id=event.id,
        folder_name=event.event_code,
        file_name=filename,
        no=0,
        name=filename,
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
        abort(404, description="File not found")

    ext = os.path.splitext(file.file_name)[1].lower()
    if ext not in [".png", ".jpg", ".jpeg", ".heic"]:
        abort(400, description="File type not supported for rotation")

    base_path = os.path.join(event_photo_base_dir(file.event.event_code), secure_filename(file.file_name))
    if not os.path.exists(base_path):
        abort(404, description="Base file not found")

    img = Image.open(base_path)
    img.rotate(-angle, expand=True).save(base_path)

    cache_file = os.path.join(event_photo_cache_dir(file.event.event_code), f"{os.path.splitext(file.file_name)[0]}.jpeg")
    if os.path.exists(cache_file):
        os.remove(cache_file)

    _emit_event_room(
        file.event.event_code,
        "rotate_album_file",
        {"file_id": file.id, "file_name": file.file_name, "angle": angle},
    )


def delete_album_file(file):
    event_code = file.event.event_code
    stem = os.path.splitext(file.file_name)[0]
    base_path = os.path.join(event_photo_base_dir(file.event.event_code), secure_filename(file.file_name))
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
    for path in [base_path, cache_path, cache_video_path, base_video_path]:
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception as exc:
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
    return [AlbumFiles.query.get(file_id) for file_id in file_ids]
