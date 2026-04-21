import mimetypes
import os
import subprocess
import uuid
from pathlib import Path

from flask import jsonify, send_file

from app.paths import DATA_ROOT, PROJECT_ROOT


MUSIC_DIR = os.path.join(DATA_ROOT, "music")
CACHE_DIR = os.path.join(MUSIC_DIR, "cache")
ALBUM_IMAGE_DIR = os.path.join(DATA_ROOT, "album_image")
DEBUG_FORCE_TRANSCODE = False

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


def allowed_audio_extension(filename):
    return Path(filename).suffix.lower() in ALLOWED_AUDIO_EXTENSIONS


def save_music_upload(file_storage):
    ext = Path(file_storage.filename).suffix.lower()
    file_id = uuid.uuid4().hex
    file_name = f"{file_id}{ext}"
    file_path = os.path.join(MUSIC_DIR, file_name)
    file_storage.save(file_path)
    return file_name, file_path, ext


def replace_music_upload(file_storage, old_file_name=None):
    file_name, file_path, ext = save_music_upload(file_storage)
    if old_file_name and old_file_name != file_name:
        delete_music_file(old_file_name)
    return file_name, file_path, ext


def detect_audio_mime(ext):
    if ext in AUDIO_MIME_OVERRIDES:
        return AUDIO_MIME_OVERRIDES[ext]

    mime_type, _ = mimetypes.guess_type(f"track{ext}")
    if mime_type and mime_type.startswith("audio/"):
        return mime_type
    return "application/octet-stream"


def stream_music_file(music):
    file_path = os.path.join(MUSIC_DIR, music.file_name)
    if not os.path.exists(file_path):
        return jsonify({"error": "文件不存在"}), 404

    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".wma":
        return _stream_wma_as_mp3(file_path, music)

    mime_type = detect_audio_mime(ext)
    if mime_type == "application/octet-stream":
        mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type:
        mime_type = "application/octet-stream"

    return send_file(
        file_path,
        mimetype=mime_type,
        as_attachment=False,
        download_name=music.file_name,
    )


def delete_music_file(file_name):
    file_path = os.path.join(MUSIC_DIR, file_name)
    if os.path.exists(file_path):
        os.remove(file_path)


def serve_album_image(filename):
    safe_name = os.path.basename(filename)
    file_path = os.path.join(ALBUM_IMAGE_DIR, safe_name)
    if not os.path.exists(file_path):
        return jsonify({"error": "图片不存在"}), 404
    mime_type, _ = mimetypes.guess_type(file_path)
    return send_file(file_path, mimetype=mime_type or "application/octet-stream")


def delete_music_cache(music_id):
    cache_path = os.path.join(CACHE_DIR, f"{music_id}.mp3")
    if os.path.exists(cache_path):
        os.remove(cache_path)


def _stream_wma_as_mp3(file_path, music):
    cached_mp3_path = os.path.join(CACHE_DIR, f"{music.id}.mp3")
    if os.path.exists(cached_mp3_path) and not DEBUG_FORCE_TRANSCODE:
        return send_file(
            cached_mp3_path,
            mimetype="audio/mpeg",
            as_attachment=False,
            download_name=f"{os.path.splitext(music.file_name)[0]}.mp3",
        )

    tmp_mp3_path = os.path.join(CACHE_DIR, f"tmp_{uuid.uuid4().hex}.mp3")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", file_path, "-acodec", "libmp3lame", "-ab", "192k", tmp_mp3_path],
            check=True,
        )
        if os.path.exists(cached_mp3_path):
            os.remove(cached_mp3_path)
        os.rename(tmp_mp3_path, cached_mp3_path)
        return send_file(
            cached_mp3_path,
            mimetype="audio/mpeg",
            as_attachment=False,
            download_name=f"{os.path.splitext(music.file_name)[0]}.mp3",
        )
    except subprocess.CalledProcessError as exc:
        return jsonify({"error": "WMA 转码失败", "detail": str(exc)}), 500
    except Exception as exc:
        return jsonify({"error": "缓存保存失败", "detail": str(exc)}), 500
