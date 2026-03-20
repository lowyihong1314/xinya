import io
import json
import os
import re
import subprocess
import zipfile

import pillow_heif
from PIL import Image
from flask import Response, request, send_file
from werkzeug.utils import secure_filename

from app.media.constants import ALLOWED_EXTENSIONS, IMAGE_EXTS, VIDEO_EXTS


def allowed_file(filename):
    return "." in filename and os.path.splitext(filename)[1].lower() in ALLOWED_EXTENSIONS


def send_video_partial(path):
    file_size = os.path.getsize(path)
    range_header = request.headers.get("Range")
    if not range_header:
        return send_file(path, mimetype="video/mp4")

    byte1, byte2 = 0, None
    match = re.search(r"bytes=(\d+)-(\d*)", range_header)
    if match:
        byte1 = int(match.group(1))
        if match.group(2):
            byte2 = int(match.group(2))

    length = file_size - byte1 if byte2 is None else byte2 - byte1 + 1

    def generate():
        with open(path, "rb") as file_obj:
            file_obj.seek(byte1)
            remaining = length
            chunk_size = 8192
            while remaining > 0:
                chunk = file_obj.read(min(chunk_size, remaining))
                if not chunk:
                    break
                yield chunk
                remaining -= len(chunk)

    response = Response(generate(), 206, mimetype="video/mp4", direct_passthrough=True)
    response.headers.add("Content-Range", f"bytes {byte1}-{byte1 + length - 1}/{file_size}")
    response.headers.add("Accept-Ranges", "bytes")
    response.headers.add("Content-Length", str(length))
    return response


def get_duration(video_path):
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return float(result.stdout.strip())
    except Exception:
        return None


def is_video_valid(mp4_path, original_path=None, max_duration=None):
    mp4_duration = get_duration(mp4_path)
    if not mp4_duration or mp4_duration <= 1:
        print(f"[CHECK] ❌ MP4 时长异常: {mp4_duration}")
        return False

    if original_path:
        original_duration = get_duration(original_path)
        expected_duration = original_duration
        if expected_duration and max_duration:
            expected_duration = min(expected_duration, max_duration)
        if expected_duration and mp4_duration < expected_duration * 0.95:
            print(f"[CHECK] ⚠️ MP4 时长不完整: 原={expected_duration}s, MP4={mp4_duration}s")
            return False

    print(f"[CHECK] ✅ MP4 时长正常: {mp4_duration}s")
    return True


def compress_new_cache_file(img_path, cache_root=None):
    if not os.path.exists(img_path):
        raise FileNotFoundError(f"文件不存在: {img_path}")

    base_dir, filename = os.path.split(img_path)
    name, ext = os.path.splitext(filename)
    ext = ext.lower()

    if cache_root is None:
        cache_root = os.path.join(os.path.dirname(base_dir), "CACHE")
    os.makedirs(cache_root, exist_ok=True)

    if ext in IMAGE_EXTS:
        out_path = os.path.join(cache_root, f"{name}.jpeg")
        img = Image.open(img_path)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(out_path, "JPEG", quality=85)
    elif ext in [".heic", ".heif"]:
        out_path = os.path.join(cache_root, f"{name}.jpeg")
        heif_file = pillow_heif.read_heif(img_path)
        img = Image.frombytes(
            heif_file.mode,
            heif_file.size,
            heif_file.data,
            "raw",
            heif_file.mode,
            heif_file.stride,
        )
        img.save(out_path, "JPEG", quality=85)
    else:
        raise ValueError(f"不支持的文件类型: {ext}")

    return out_path


def build_zip_from_files(files):
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_id, file_name, base_path in files:
            if os.path.exists(base_path):
                zip_file.write(base_path, arcname=f"{file_id}_{secure_filename(file_name)}")
    memory_file.seek(0)
    return memory_file


def parse_file_ids(raw):
    try:
        return json.loads(raw)
    except Exception:
        return []
