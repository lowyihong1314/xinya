import os
import re
import subprocess
from datetime import date, datetime

from flask import make_response, redirect, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

from app.media.constants import IMAGE_EXTS, VIDEO_EXTS
from app.media.paths import event_photo_base_dir, event_photo_cache_dir, to_short_data_path
from app.media.services import get_event_image_payload, resolve_media_path
from app.paths import STATIC_ROOT
from models.event_data import AlbumFiles, EventData

EVENT_SHARE_CACHE_SECONDS = 300
EVENT_SHARE_IMAGE_EXTS = IMAGE_EXTS | {".heic", ".heif"}
IMAGE_SHARE_CACHE_SECONDS = 300
VIDEO_SHARE_POSTER_SUFFIX = "_share_poster.jpeg"
SHARE_ICON_SIZE = 192
SHARE_ICON_SUFFIX = "_share_icon.png"
BROWSER_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def _absolute_url(path):
    normalized = str(path or "").strip()
    if not normalized:
        return ""
    if re.match(r"^https?://", normalized, re.IGNORECASE):
        return normalized
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return f"{request.url_root.rstrip('/')}{normalized}"


def _with_version(url, version):
    if not version:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}v={version}"


def _compact_text(value, fallback="", limit=220):
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return fallback
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


def _format_event_datetime(value):
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _album_file_ext(album_file):
    raw_type = str(getattr(album_file, "file_type", "") or "").strip().lower().lstrip(".")
    if raw_type:
        return f".{raw_type}"
    _, ext = os.path.splitext(getattr(album_file, "file_name", "") or "")
    return ext.lower()


def _pick_event_share_image(event):
    if event.event_image and _album_file_ext(event.event_image) in EVENT_SHARE_IMAGE_EXTS:
        return event.event_image

    return (
        AlbumFiles.query
        .filter(AlbumFiles.event_id == event.id)
        .filter(AlbumFiles.file_type.in_([ext.lstrip(".") for ext in EVENT_SHARE_IMAGE_EXTS]))
        .order_by(AlbumFiles.created_at.desc(), AlbumFiles.id.desc())
        .first()
    )


def _version_for_public_path(path, fallback):
    normalized = str(path or "").strip()
    try:
        if normalized.startswith("/static/"):
            real_path = os.path.join(str(STATIC_ROOT), normalized[len("/static/"):].lstrip("/"))
        elif normalized.startswith("/media_file/"):
            real_path = resolve_media_path(normalized[len("/media_file/"):])
        elif normalized and not re.match(r"^https?://", normalized, re.IGNORECASE):
            real_path = resolve_media_path(normalized)
        else:
            real_path = ""

        if real_path and os.path.exists(real_path):
            return str(int(os.path.getmtime(real_path)))
    except Exception:
        pass
    return str(fallback or "")


def _media_file_url(path, version):
    normalized = str(path or "").strip()
    if not normalized:
        return ""
    if normalized.startswith("/static/") or normalized.startswith("/media_file/") or re.match(r"^https?://", normalized, re.IGNORECASE):
        return _with_version(_absolute_url(normalized), version)
    return _with_version(_absolute_url(f"/media_file/{normalized.lstrip('/')}"), version)


def _fallback_share_image_url():
    path = "/static/images/logo/logo.png"
    version = _version_for_public_path(path, "logo")
    return _media_file_url(path, version)


def _share_icon_path(source_path):
    if not source_path or not os.path.exists(source_path):
        return ""

    stem, _ = os.path.splitext(source_path)
    output_path = f"{stem}{SHARE_ICON_SUFFIX}"
    try:
        if os.path.exists(output_path) and os.path.getmtime(output_path) >= os.path.getmtime(source_path):
            from PIL import Image

            with Image.open(output_path) as icon:
                if icon.size == (SHARE_ICON_SIZE, SHARE_ICON_SIZE):
                    return output_path
    except OSError:
        pass
    except Exception:
        try:
            os.remove(output_path)
        except OSError:
            pass

    tmp_path = f"{output_path}.tmp.{os.getpid()}.png"
    try:
        from PIL import Image, ImageOps

        with Image.open(source_path) as raw_image:
            image = ImageOps.exif_transpose(raw_image).convert("RGB")
            width, height = image.size
            side = min(width, height)
            left = max(0, (width - side) // 2)
            top = max(0, (height - side) // 2)
            image = image.crop((left, top, left + side, top + side))
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
            image = image.resize((SHARE_ICON_SIZE, SHARE_ICON_SIZE), resampling)
            image.save(tmp_path, "PNG", optimize=True)
        os.replace(tmp_path, output_path)
        return output_path
    except Exception as exc:
        print(f"[WEB] Failed to build share icon for {source_path}: {exc}")
        return ""
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _share_icon_url_for_path(path, fallback):
    try:
        source_path = resolve_media_path(path)
    except Exception:
        source_path = ""

    icon_path = _share_icon_path(source_path)
    if icon_path:
        icon_short_path = to_short_data_path(icon_path)
        version = _version_for_public_path(icon_short_path, fallback)
        return _media_file_url(icon_short_path, version)
    return _fallback_share_image_url()


def _browser_source_image_url(album_file, ext):
    if ext not in BROWSER_IMAGE_EXTS:
        return ""

    event = getattr(album_file, "event", None)
    event_code = getattr(event, "event_code", None)
    filename = secure_filename(getattr(album_file, "file_name", "") or "")
    if not event_code or not filename:
        return ""

    source_path = os.path.join(event_photo_base_dir(event_code), filename)
    if not os.path.exists(source_path):
        return ""

    path = to_short_data_path(source_path)
    version = _version_for_public_path(path, album_file.id)
    return _media_file_url(path, version)


def _event_share_image_urls(event):
    album_file = _pick_event_share_image(event)
    if not album_file:
        fallback = _fallback_share_image_url()
        return fallback, fallback

    try:
        payload = get_event_image_payload(album_file.id, "cache")
        if isinstance(payload, tuple):
            payload = payload[0]
        if payload.get("ready") and payload.get("path"):
            path = payload["path"]
            version = _version_for_public_path(path, album_file.id)
            return _media_file_url(path, version), _share_icon_url_for_path(path, album_file.id)
    except Exception:
        pass

    fallback = _fallback_share_image_url()
    return fallback, fallback


def _run_video_poster_ffmpeg(source_path, output_path, seek_seconds):
    tmp_path = f"{output_path}.tmp.{os.getpid()}.jpeg"
    try:
        command = [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-ss",
            str(seek_seconds),
            "-i",
            source_path,
            "-frames:v",
            "1",
            "-vf",
            "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
            "-q:v",
            "3",
            tmp_path,
        ]
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=25)
        if result.returncode != 0 or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) <= 0:
            return False
        os.replace(tmp_path, output_path)
        return True
    except Exception as exc:
        print(f"[WEB] Failed to extract video poster for {source_path}: {exc}")
        return False
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _video_share_poster_path(album_file):
    event = getattr(album_file, "event", None)
    event_code = getattr(event, "event_code", None)
    if not event_code:
        return ""

    filename = secure_filename(getattr(album_file, "file_name", "") or "")
    if not filename:
        return ""

    source_path = os.path.join(event_photo_base_dir(event_code), filename)
    if not os.path.exists(source_path):
        return ""

    stem, _ = os.path.splitext(filename)
    output_path = os.path.join(event_photo_cache_dir(event_code), f"{stem}{VIDEO_SHARE_POSTER_SUFFIX}")
    try:
        if os.path.exists(output_path) and os.path.getmtime(output_path) >= os.path.getmtime(source_path):
            return output_path
    except OSError:
        pass

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    if _run_video_poster_ffmpeg(source_path, output_path, 1) or _run_video_poster_ffmpeg(source_path, output_path, 0):
        return output_path
    return ""


def _image_file_share_urls(album_file):
    ext = _album_file_ext(album_file)
    if ext in EVENT_SHARE_IMAGE_EXTS:
        try:
            payload = get_event_image_payload(album_file.id, "cache")
            if isinstance(payload, tuple):
                payload = payload[0]
            if payload.get("ready") and payload.get("path"):
                path = payload["path"]
                version = _version_for_public_path(path, album_file.id)
                image_url = _media_file_url(path, version)
                icon_url = _share_icon_url_for_path(path, album_file.id)
                body_image_url = _browser_source_image_url(album_file, ext) or image_url
                return image_url, icon_url, body_image_url
        except Exception as exc:
            print(f"[WEB] Failed to prepare image share cache for file {album_file.id}: {exc}")
        fallback = _fallback_share_image_url()
        return fallback, fallback, fallback

    if ext in VIDEO_EXTS:
        poster_path = _video_share_poster_path(album_file)
        if poster_path:
            path = to_short_data_path(poster_path)
            version = _version_for_public_path(path, album_file.id)
            image_url = _media_file_url(path, version)
            return image_url, _share_icon_url_for_path(path, album_file.id), image_url
        fallback = _fallback_share_image_url()
        return fallback, fallback, fallback

    fallback = _fallback_share_image_url()
    return fallback, fallback, fallback


def _image_share_description(album_file, event):
    parts = [
        getattr(album_file, "file_name", None),
        _format_event_datetime(getattr(album_file, "created_at", None)),
        getattr(event, "location", None),
    ]
    return _compact_text(" · ".join(str(part).strip() for part in parts if part), "UTBA 活动媒体")


def _event_share_description(event):
    parts = [
        _format_event_datetime(event.datetime),
        event.location,
        event.type,
        event.target,
        event.purpose,
    ]
    return _compact_text(" · ".join(str(part).strip() for part in parts if part), "UTBA 活动详情")


def register_web_routes(app):
    @app.route("/")
    def index():
        return send_from_directory(str(STATIC_ROOT), "index.html")

    @app.route("/event/<int:event_id>")
    def event_share(event_id):
        event = EventData.query.get_or_404(event_id)
        title = _compact_text(event.event_name, f"活动 #{event.id}", 90)
        image_url, icon_url = _event_share_image_urls(event)
        canonical_url = _absolute_url(f"/event/{event.id}")
        app_url = _absolute_url(f"/#/event/{event.id}")
        response = make_response(
            render_template(
                "event_share.html",
                event=event,
                title=title,
                description=_event_share_description(event),
                image_url=image_url,
                icon_url=icon_url,
                canonical_url=canonical_url,
                app_url=app_url,
            )
        )
        response.headers["Cache-Control"] = f"public, max-age={EVENT_SHARE_CACHE_SECONDS}"
        return response

    @app.route("/image/<int:file_id>")
    def image_share(file_id):
        album_file = AlbumFiles.query.get_or_404(file_id)
        event = EventData.query.get(album_file.event_id) if album_file.event_id else None
        title = _compact_text(getattr(event, "event_name", None), f"媒体 #{album_file.id}", 90)
        image_url, icon_url, body_image_url = _image_file_share_urls(album_file)
        canonical_url = _absolute_url(f"/image/{album_file.id}")
        response = make_response(
            render_template(
                "image_share.html",
                title=title,
                description=_image_share_description(album_file, event),
                image_url=image_url,
                body_image_url=body_image_url,
                icon_url=icon_url,
                canonical_url=canonical_url,
            )
        )
        response.headers["Cache-Control"] = f"public, max-age={IMAGE_SHARE_CACHE_SECONDS}"
        return response

    @app.route("/favicon.ico")
    def favicon():
        return send_from_directory(
            os.path.join(STATIC_ROOT, "images", "logo"),
            "logo.png",
            mimetype="image/png",
        )

    @app.route("/changyou-room/<room_id>")
    def changyou_room_public(room_id):
        return render_template("changyou_room_public.html", room_id=room_id)

    @app.route("/changyou-room-v2/<room_id>")
    def changyou_room_public_v2(room_id):
        return redirect(f"/changyou-room/{room_id}")

    @app.route("/music-portal")
    def music_portal():
        return render_template("music_portal.html")

    @app.route("/quiz")
    def quiz_public_entry():
        token = request.args.get("token") or ""
        target = "/#/music/turntable/quiz"
        if token:
            target = f"{target}?token={token}"
        return redirect(target)

    @app.route("/privacy")
    def privacy_policy_short():
        return redirect("/privacy-policy")

    @app.route("/privacy-policy")
    def privacy_policy():
        return render_template("privacy_policy.html")

    @app.route("/template/long-open-registration-form")
    def long_open_registration_form_template():
        return render_template("form/long_open_registration_form_public.html")

    @app.route("/template/youth-class-registration")
    def youth_class_registration_template():
        preferred = request.args.get("preferred") or "youth_class"
        return redirect(f"/template/long-open-registration-form?preferred={preferred}")

    @app.route("/template/youth-class-registration/payment")
    def youth_class_registration_payment_template():
        return render_template("form/youth_class_payment_public.html")

    @app.route("/template/membership-application")
    def membership_application_template():
        preferred = request.args.get("preferred") or "membership"
        source = request.args.get("source")
        target = f"/template/long-open-registration-form?preferred={preferred}"
        if source:
            target = f"{target}&source={source}"
        return redirect(target)

    @app.route("/template/membership-payment")
    def membership_payment_template():
        return render_template("form/membership_payment_public.html")

    @app.route("/template/council-sign")
    def council_sign_template():
        return render_template("form/council_sign_public.html")
