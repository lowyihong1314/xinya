"""音频 / 封面的落盘与下发（原 backend/app/music/storage.py）。

只做框架适配，业务规则一字未改：允许的扩展名集合、MIME 猜测顺序、wma → mp3 的缓存
转码、封面压缩参数、以及每条出错分支的中文文案和状态码，全部与 Flask 时代逐字一致。

── 搬迁改了什么 ──────────────────────────────────────────────────────
  · ``werkzeug FileStorage``  → ``starlette UploadFile``：
    ``file_storage.save(path)`` / ``.stream`` 在 UploadFile 上不存在，换成
    ``_copy_upload_to()`` / ``upload.file``（见下面那个函数的注释）。
  · ``flask.send_file``       → ``starlette.responses.FileResponse``
  · ``flask.jsonify(d), 404`` → ``core.responses.json_response(d, status_code=404)``
  · 原文件 import 了 ``PROJECT_ROOT`` 但全文没用到，跟着 Flask 一起删掉（纯死 import）。

★ send_file → FileResponse 的四处头部差异，都是刻意接受的，别"顺手对齐"：

  ① **Range**：两边都支持。werkzeug 是 ``make_conditional(accept_ranges=True)``，
     starlette 的 FileResponse 自己解析 Range 头并回 206。音频要能拖进度条全靠它 ——
     所以**绝对不要**改成自己 ``open().read()`` 再返回 bytes，那样 Range 就没了，
     表现是「进度条拖不动 / iOS Safari 根本不播」。

  ② **Cache-Control**：werkzeug 的 send_file 无条件先写 ``no-cache``，只有 max_age>0
     时才换成 ``public, max-age=N``。FileResponse 什么都不写（浏览器会启发式缓存）。
     所以这里显式把两个值补回去 —— ``_AUDIO_CACHE_CONTROL`` / ``_COVER_CACHE_CONTROL``。
     漏掉的话，换了文件的封面会在用户浏览器里挂很久。

  ③ **Expires**：Flask 在 max_age>0 时还会发一个 Expires。HTTP/1.1 下 Cache-Control
     的 max-age 覆盖 Expires，纯冗余，这里不补。

  ④ **ETag 算法不同**：werkzeug 是 ``mtime-size-adler32``，starlette 是
     ``md5(mtime-size)``。切换当天客户端手里的旧 ETag 会全部失配 → 第一次请求回 200
     整包而不是 304。之后就稳定了，不用处理。

★ 一处「像 bug 但照搬」：``serve_album_image`` 的路由是 ``<path:filename>``，
  也就是 filename 可以带斜杠；这里靠 ``os.path.basename()`` 把目录部分砍掉来防穿越。
  ``"../../etc/passwd"`` → basename 得到 ``"passwd"`` → 落在 ALBUM_IMAGE_DIR 里找不到
  → 404。能挡住，但挡法很绕。TODO(收口): 换成 Path.resolve() 后校验前缀更直白，
  不过那会改掉「带目录的路径当纯文件名处理」这个既有行为，另行评估。
"""

import mimetypes
import os
import shutil
import subprocess
import uuid
from pathlib import Path

from starlette.responses import FileResponse

from backend.core.paths import DATA_ROOT
from backend.core.responses import json_response


MUSIC_DIR = os.path.join(DATA_ROOT, "music")
CACHE_DIR = os.path.join(MUSIC_DIR, "cache")
ALBUM_IMAGE_DIR = os.path.join(DATA_ROOT, "album_image")
DEBUG_FORCE_TRANSCODE = False

# import 期就建目录（原样保留）。DATA_ROOT 不在仓库里，deploy 时不会被 git 清掉。
os.makedirs(MUSIC_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(ALBUM_IMAGE_DIR, exist_ok=True)

ALLOWED_AUDIO_EXTENSIONS = {
    ".mp3",
    ".mp4",
    ".wav",
    ".wave",
    ".wma",
    ".m4a",
    ".m4b",
    ".aac",
    ".ogg",
    ".oga",
    ".flac",
    ".opus",
    ".webm",
    ".aif",
    ".aiff",
    ".amr",
    ".3gp",
    ".3g2",
}

ALLOWED_ALBUM_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
ALBUM_COVER_MAX_DIMENSION = 1200
ALBUM_COVER_JPEG_QUALITY = 82
ALBUM_COVER_CACHE_MAX_AGE = 30 * 24 * 60 * 60

# ⚠️ 这串是**错误提示里的原文**（"仅支持 XXX 音频"），不是校验依据。
# 注意它和 ALLOWED_AUDIO_EXTENSIONS 其实对不齐（少了 3G2、把 .oga 归进 OGG），
# 原样保留 —— 改了等于改用户看到的句子。
SUPPORTED_AUDIO_FORMATS_LABEL = "MP3/MP4/WAV/WMA/M4A/M4B/AAC/OGG/FLAC/OPUS/WEBM/AIFF/AMR/3GP"

AUDIO_MIME_OVERRIDES = {
    ".mp4": "audio/mp4",
    ".m4a": "audio/mp4",
    ".m4b": "audio/mp4",
    ".wav": "audio/wav",
    ".wave": "audio/wav",
    ".wma": "audio/x-ms-wma",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
    ".aac": "audio/aac",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
    ".amr": "audio/amr",
    ".3gp": "audio/3gpp",
    ".3g2": "audio/3gpp2",
}

# 见模块头 ②。werkzeug: max_age=None → "no-cache"；max_age=N>0 → "public, max-age=N"。
_AUDIO_CACHE_CONTROL = "no-cache"
_COVER_CACHE_CONTROL = f"public, max-age={ALBUM_COVER_CACHE_MAX_AGE}"


def allowed_audio_extension(filename):
    return Path(filename).suffix.lower() in ALLOWED_AUDIO_EXTENSIONS


def allowed_album_image_extension(filename):
    return Path(filename).suffix.lower() in ALLOWED_ALBUM_IMAGE_EXTENSIONS


def _copy_upload_to(upload, file_path):
    """等价于原来的 ``file_storage.save(file_path)``。

    werkzeug 的 save() 是「从流的当前位置 copyfileobj 到目标」。UploadFile 没有这个
    方法，所以这里手写：先回到 0（游标可能已经被别的地方读过），再 copyfileobj。
    SpooledTemporaryFile 不支持 seek 时忽略 —— 与 content 模块的写法保持一致。
    """
    source = upload.file
    try:
        source.seek(0)
    except (OSError, ValueError):
        pass
    with open(file_path, "wb") as target:
        shutil.copyfileobj(source, target)


def save_music_upload(file_storage):
    """落盘一份音频，返回 (文件名, 绝对路径, 扩展名)。

    落盘名是 ``uuid4().hex + 原扩展名`` —— 客户端给的文件名**不进磁盘路径**，
    所以这里不需要 secure_filename（原代码也没用）。
    """
    ext = Path(file_storage.filename).suffix.lower()
    file_id = uuid.uuid4().hex
    file_name = f"{file_id}{ext}"
    file_path = os.path.join(MUSIC_DIR, file_name)
    _copy_upload_to(file_storage, file_path)
    return file_name, file_path, ext


def replace_music_upload(file_storage, old_file_name=None):
    # 先写新文件再删旧文件：反过来的话，新文件写失败会把用户的音频弄丢。
    file_name, file_path, ext = save_music_upload(file_storage)
    if old_file_name and old_file_name != file_name:
        delete_music_file(old_file_name)
    return file_name, file_path, ext


def save_album_cover_upload(file_storage, album_id):
    """把上传的封面压成 ``<album_id>.jpg``。

    PIL 在函数体里 import（原样保留）：Pillow 的导入不便宜，而这个模块在**每个**
    带音乐的请求路径上都会被 import 到。
    """
    from PIL import Image, ImageOps

    filename = f"{int(album_id)}.jpg"
    file_path = os.path.join(ALBUM_IMAGE_DIR, filename)
    tmp_path = f"{file_path}.tmp"

    # ``file_storage.stream`` → ``upload.file``（UploadFile 上没有 .stream）。
    # 显式 seek(0)：FastAPI 解析完 multipart 后游标停在末尾，不回零的话 PIL 读到空文件。
    source = file_storage.file
    try:
        source.seek(0)
    except (OSError, ValueError):
        pass

    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode in ("RGBA", "LA") or "transparency" in image.info:
            # 透明区铺白底再转 RGB：JPEG 没有 alpha 通道，直接 convert("RGB") 会把
            # 透明的地方变成黑色。
            rgba_image = image.convert("RGBA")
            background = Image.new("RGB", rgba_image.size, (255, 255, 255))
            background.paste(rgba_image, mask=rgba_image.getchannel("A"))
            image = background
        else:
            image = image.convert("RGB")

        resampling = getattr(Image, "Resampling", Image).LANCZOS
        image.thumbnail((ALBUM_COVER_MAX_DIMENSION, ALBUM_COVER_MAX_DIMENSION), resampling)
        image.save(
            tmp_path,
            format="JPEG",
            quality=ALBUM_COVER_JPEG_QUALITY,
            optimize=True,
            progressive=True,
        )

    # 先写 .tmp 再 os.replace：同名覆盖是原子的，不会出现「正在下发时文件写了一半」。
    os.replace(tmp_path, file_path)
    _delete_album_cover_variants(album_id, keep_filename=filename)
    return filename


def _delete_album_cover_variants(album_id, keep_filename=None):
    """清掉同一张专辑的历史封面（早年存过 .png/.webp 等别的扩展名）。"""
    prefix = f"{int(album_id)}."
    for name in os.listdir(ALBUM_IMAGE_DIR):
        if not name.startswith(prefix) or name == keep_filename:
            continue
        path = os.path.join(ALBUM_IMAGE_DIR, name)
        if os.path.isfile(path):
            os.remove(path)


def detect_audio_mime(ext):
    if ext in AUDIO_MIME_OVERRIDES:
        return AUDIO_MIME_OVERRIDES[ext]

    mime_type, _ = mimetypes.guess_type(f"track{ext}")
    if mime_type and mime_type.startswith("audio/"):
        return mime_type
    return "application/octet-stream"


def stream_music_file(music):
    """下发音频本体。wma 走转码缓存，其余原文件直出。"""
    file_path = os.path.join(MUSIC_DIR, music.file_name)
    if not os.path.exists(file_path):
        return json_response({"error": "文件不存在"}, status_code=404)

    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".wma":
        return _stream_wma_as_mp3(file_path, music)

    mime_type = detect_audio_mime(ext)
    if mime_type == "application/octet-stream":
        # 覆盖表里没有、mimetypes 也没认出是 audio/* 时，再按**完整路径**猜一次。
        # 这一步能捞回 .mp3 之类系统表里有、但上面那次因为 "track{ext}" 形式没命中的情况。
        mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type:
        mime_type = "application/octet-stream"

    # as_attachment=False + download_name  →  Content-Disposition: inline; filename="..."
    # FileResponse 默认是 attachment，所以必须显式给 content_disposition_type。
    # 给成 attachment 的话 <audio src> 仍能播，但浏览器会多弹一次下载，是行为变更。
    return FileResponse(
        file_path,
        media_type=mime_type,
        filename=music.file_name,
        content_disposition_type="inline",
        headers={"Cache-Control": _AUDIO_CACHE_CONTROL},
    )


def delete_music_file(file_name):
    file_path = os.path.join(MUSIC_DIR, file_name)
    if os.path.exists(file_path):
        os.remove(file_path)


def serve_album_image(filename):
    safe_name = os.path.basename(filename)
    file_path = os.path.join(ALBUM_IMAGE_DIR, safe_name)
    if not os.path.exists(file_path):
        return json_response({"error": "图片不存在"}, status_code=404)
    mime_type, _ = mimetypes.guess_type(file_path)
    # Flask 那边 download_name 为 None 时会自动取 basename(path)，所以 Content-Disposition
    # 仍是 ``inline; filename="3.jpg"``；这里显式传 safe_name 把它补回来。
    return FileResponse(
        file_path,
        media_type=mime_type or "application/octet-stream",
        filename=safe_name,
        content_disposition_type="inline",
        headers={"Cache-Control": _COVER_CACHE_CONTROL},
    )


def delete_music_cache(music_id):
    cache_path = os.path.join(CACHE_DIR, f"{music_id}.mp3")
    if os.path.exists(cache_path):
        os.remove(cache_path)


def _stream_wma_as_mp3(file_path, music):
    """wma 浏览器普遍不认，转成 mp3 并按 music.id 缓存一份。

    ★ 转码是**同步阻塞**的 ``subprocess.run(check=True)``：第一次点一首长 wma 会占住
      一个线程池线程直到 ffmpeg 跑完（路由是 def，FastAPI 丢线程池，不会卡事件循环）。
      原行为如此，保持。TODO(音乐): 想改的话应该是「入库时后台转」，不是在这里加超时。
    """
    cached_mp3_path = os.path.join(CACHE_DIR, f"{music.id}.mp3")
    if os.path.exists(cached_mp3_path) and not DEBUG_FORCE_TRANSCODE:
        return FileResponse(
            cached_mp3_path,
            media_type="audio/mpeg",
            filename=f"{os.path.splitext(music.file_name)[0]}.mp3",
            content_disposition_type="inline",
            headers={"Cache-Control": _AUDIO_CACHE_CONTROL},
        )

    # 转到临时名再 rename：两个请求同时转同一首时，谁先 rename 谁生效，
    # 不会出现「另一个请求读到写了一半的 mp3」。
    tmp_mp3_path = os.path.join(CACHE_DIR, f"tmp_{uuid.uuid4().hex}.mp3")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", file_path, "-acodec", "libmp3lame", "-ab", "192k", tmp_mp3_path],
            check=True,
        )
        if os.path.exists(cached_mp3_path):
            os.remove(cached_mp3_path)
        os.rename(tmp_mp3_path, cached_mp3_path)
        return FileResponse(
            cached_mp3_path,
            media_type="audio/mpeg",
            filename=f"{os.path.splitext(music.file_name)[0]}.mp3",
            content_disposition_type="inline",
            headers={"Cache-Control": _AUDIO_CACHE_CONTROL},
        )
    except subprocess.CalledProcessError as exc:
        # ffmpeg 没装 / 不在 PATH 时抛的是 FileNotFoundError，落到下面那条「缓存保存失败」，
        # 文案会对不上真实原因。原行为，照搬。
        return json_response({"error": "WMA 转码失败", "detail": str(exc)}, status_code=500)
    except Exception as exc:
        # tmp 文件没清理（原样保留）：转码中途失败会在 cache/ 里留下 tmp_*.mp3 垃圾。
        # TODO(音乐): 加 finally 清 tmp，但要确认没人靠这些残留排查过问题。
        return json_response({"error": "缓存保存失败", "detail": str(exc)}, status_code=500)
