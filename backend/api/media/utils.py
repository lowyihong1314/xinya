"""ffmpeg / Pillow / zip 的小工具（原 backend/app/media/utils.py）。

搬迁时只动了三处 import 层面的东西，算法一行没改：

  · ``from werkzeug.utils import secure_filename`` → ``backend.core.files``
    （werkzeug 的逐字节复刻）。**落盘名必须完全一致**，否则老文件点开就是 404。
  · 删掉了 ``send_video_partial``。它是唯一依赖 flask 的函数（request / Response /
    send_file），而全仓库**零个调用点**（已 grep：只有 core/db.py 的注释提过它）。
    它做的事 —— 解析 Range 头、回 206 + Content-Range —— starlette 的 FileResponse
    原生就有（见 router.py 的 _send_file_conditional），真要用不必复活这份代码。
  · 顶部的 ``import re`` 跟着 send_video_partial 一起没了（别的地方不用正则）。

★ JPEG 缓存的两条不变量，改之前先想清楚：
  ① 缓存文件名恒为 ``<源文件 stem>.jpeg``（注意是 5 个字母的 .jpeg，不是 .jpg）——
     router / service / 前端三处都在按这个名字拼路径。
  ② 每个缓存文件旁边有一个 ``<缓存文件名>.cache_version`` 的兄弟文件。
     版本串对不上就重新压一遍（is_cache_stale）。改 JPEG_CACHE_VERSION 的值
     等于**让全站缓存失效**、下次访问逐张重压 —— 上一次改它是为了修 EXIF 方向。
"""

import io
import json
import os
import subprocess
import zipfile

import pillow_heif
from PIL import Image, ImageOps

from backend.api.media.constants import ALLOWED_EXTENSIONS, IMAGE_EXTS, VIDEO_EXTS
from backend.core.files import secure_filename

# HEIC/HEIF 也能进 JPEG 缓存流水线，但它们走 pillow_heif 而不是 PIL.Image.open，
# 所以只在这里并进来，constants.IMAGE_EXTS 本身不含它们（见那边的注释）。
JPEG_CACHE_SOURCE_EXTS = IMAGE_EXTS | {".heic", ".heif"}
JPEG_CACHE_VERSION = "exif-orientation-normalized-v2"
EXIF_ORIENTATION_TAG = 274


def jpeg_cache_version_path(cache_path):
    return f"{cache_path}.cache_version"


def _read_jpeg_cache_version(cache_path):
    try:
        with open(jpeg_cache_version_path(cache_path), encoding="utf-8") as file_obj:
            return file_obj.read().strip()
    except OSError:
        return ""


def _write_jpeg_cache_version(cache_path):
    version_path = jpeg_cache_version_path(cache_path)
    # 先写临时文件再 os.replace：replace 在同一文件系统上是原子的，
    # 别的 worker 要么看到旧版本串要么看到新的，不会读到写了一半的空文件。
    tmp_path = f"{version_path}.tmp.{os.getpid()}"
    try:
        with open(tmp_path, "w", encoding="utf-8") as file_obj:
            file_obj.write(f"{JPEG_CACHE_VERSION}\n")
        os.replace(tmp_path, version_path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def remove_jpeg_cache_file(cache_path):
    for path in [cache_path, jpeg_cache_version_path(cache_path)]:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


def _normal_orientation_exif():
    exif = Image.Exif()
    exif[EXIF_ORIENTATION_TAG] = 1
    return exif.tobytes()


def _save_normalized_jpeg_cache(img, tmp_path):
    # 先按 EXIF 把像素真正转正，再把 EXIF 方向写回 1 —— 两步都要做：
    # 只转像素不改 EXIF，会让还认 EXIF 的客户端再转一次（照片躺倒）。
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.save(tmp_path, "JPEG", quality=85, exif=_normal_orientation_exif())


def _sniff_image_ext(img_path):
    """靠文件内容认格式。用于文件名没有扩展名（或扩展名在骗人）的情况。"""
    try:
        with Image.open(img_path) as img:
            image_format = str(img.format or "").lower()
    except Exception:
        return ""

    if image_format in {"jpeg", "jpg"}:
        return ".jpg"
    if image_format in {"png", "bmp", "tiff", "webp"}:
        return f".{image_format if image_format != 'tiff' else 'tif'}"
    return ""


def _resolve_jpeg_source_ext(img_path, ext):
    if ext in JPEG_CACHE_SOURCE_EXTS:
        return ext
    sniffed = _sniff_image_ext(img_path)
    return sniffed or ext


def allowed_file(filename):
    return "." in filename and os.path.splitext(filename)[1].lower() in ALLOWED_EXTENSIONS


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
        # ffprobe 不在 / 文件不是视频 / 输出空 —— 一律当成"读不出时长"。
        # 调用方（is_video_valid）把 None 当作"转码结果不可信"。
        return None


def is_video_valid(mp4_path, original_path=None, max_duration=None):
    """转码产物可不可信：时长 > 1 秒，且不比源短太多（95%）。

    ffmpeg 被 kill 掉时会留下一个能播的半截 mp4，光看文件存在会一直发半截视频出去，
    所以这里按时长复核。打印的那几行 [CHECK] 是线上排查转码问题的主要线索，别删。
    """
    mp4_duration = get_duration(mp4_path)
    if not mp4_duration or mp4_duration <= 1:
        print(f"[CHECK] ❌ MP4 时长异常: {mp4_duration}")
        return False

    if original_path:
        original_duration = get_duration(original_path)
        expected_duration = original_duration
        if expected_duration and max_duration:
            # 预览版只转前 15 秒，期望时长要按 max_duration 截断，否则永远判不合格。
            expected_duration = min(expected_duration, max_duration)
        if expected_duration and mp4_duration < expected_duration * 0.95:
            print(f"[CHECK] ⚠️ MP4 时长不完整: 原={expected_duration}s, MP4={mp4_duration}s")
            return False

    print(f"[CHECK] ✅ MP4 时长正常: {mp4_duration}s")
    return True


def jpeg_cache_path_for_source(img_path, cache_root=None):
    if not os.path.exists(img_path):
        raise FileNotFoundError(f"文件不存在: {img_path}")

    base_dir, filename = os.path.split(img_path)
    name, ext = os.path.splitext(filename)
    ext = ext.lower()
    ext = _resolve_jpeg_source_ext(img_path, ext)

    if ext not in JPEG_CACHE_SOURCE_EXTS:
        raise ValueError(f"不支持的文件类型: {ext}")

    if cache_root is None:
        # 缺省是"源目录的兄弟目录 CACHE"。实际调用方全都显式传 cache_root
        # （event_photo_cache_dir），所以这条分支基本走不到 —— 照抄保留。
        cache_root = os.path.join(os.path.dirname(base_dir), "CACHE")
    os.makedirs(cache_root, exist_ok=True)
    return os.path.join(cache_root, f"{name}.jpeg")


def is_cache_stale(source_path, cache_path):
    if not os.path.exists(cache_path):
        return True
    if _read_jpeg_cache_version(cache_path) != JPEG_CACHE_VERSION:
        return True
    try:
        return os.path.getmtime(cache_path) < os.path.getmtime(source_path)
    except OSError:
        # 读不到 mtime（文件在这一刻被删了）→ 当成过期，重压一张总比发旧图强。
        return True


def compress_new_cache_file(img_path, cache_root=None):
    out_path = jpeg_cache_path_for_source(img_path, cache_root)
    _, filename = os.path.split(img_path)
    _, ext = os.path.splitext(filename)
    ext = ext.lower()
    ext = _resolve_jpeg_source_ext(img_path, ext)
    tmp_path = f"{out_path}.tmp.{os.getpid()}"

    try:
        if ext in IMAGE_EXTS:
            with Image.open(img_path) as img:
                _save_normalized_jpeg_cache(img, tmp_path)
        elif ext in [".heic", ".heif"]:
            heif_file = pillow_heif.read_heif(img_path)
            img = Image.frombytes(
                heif_file.mode,
                heif_file.size,
                heif_file.data,
                "raw",
                heif_file.mode,
                heif_file.stride,
            )
            _save_normalized_jpeg_cache(img, tmp_path)
        else:
            raise ValueError(f"不支持的文件类型: {ext}")
        # 同样是先写临时文件再 replace：并发请求同一张图时不会读到半截 JPEG。
        os.replace(tmp_path, out_path)
        _write_jpeg_cache_version(out_path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    return out_path


def ensure_jpeg_cache_file(img_path, cache_root=None):
    out_path = jpeg_cache_path_for_source(img_path, cache_root)
    if not is_cache_stale(img_path, out_path):
        return out_path
    # 注意第二个实参是 ``os.path.dirname(out_path)`` 而不是原来的 cache_root：
    # cache_root=None 时 out_path 已经落在默认 CACHE 目录里，再传 None 会重算一次。
    return compress_new_cache_file(img_path, os.path.dirname(out_path))


def build_zip_from_files(files):
    """把 [(file_id, file_name, base_path)] 打成内存里的 zip。

    ★ 打包名是 ``<file_id>_<secure_filename(file_name)>``：加 id 前缀是因为同一个活动里
      重名文件很常见（DSC_0001.JPG），不加前缀 zip 里会互相覆盖。
    ★ 源文件不存在就**静默跳过**，不报错 —— 前端拿到的是一个少了几张的 zip。
      照搬（前端没有处理部分失败的分支）。
    """
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_id, file_name, base_path in files:
            if os.path.exists(base_path):
                zip_file.write(base_path, arcname=f"{file_id}_{secure_filename(file_name)}")
    memory_file.seek(0)
    return memory_file


def parse_file_ids(raw):
    """表单里的 file_ids 是一串 JSON。解不动就当成空列表（→ 路由回 400）。"""
    try:
        return json.loads(raw)
    except Exception:
        return []
