import os
import re
from datetime import date, datetime

from flask import make_response, redirect, render_template, request, send_from_directory

from app.media.constants import IMAGE_EXTS
from app.media.services import get_event_image_payload, resolve_media_path
from app.paths import STATIC_ROOT
from models.event_data import AlbumFiles, EventData

EVENT_SHARE_CACHE_SECONDS = 300
EVENT_SHARE_IMAGE_EXTS = IMAGE_EXTS | {".heic", ".heif"}


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


def _event_share_image_url(event):
    album_file = _pick_event_share_image(event)
    if not album_file:
        return _fallback_share_image_url()

    try:
        payload = get_event_image_payload(album_file.id, "cache")
        if isinstance(payload, tuple):
            payload = payload[0]
        if payload.get("ready") and payload.get("path"):
            path = payload["path"]
            version = _version_for_public_path(path, album_file.id)
            return _media_file_url(path, version)
    except Exception:
        pass

    return _fallback_share_image_url()


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
        image_url = _event_share_image_url(event)
        canonical_url = _absolute_url(f"/event/{event.id}")
        app_url = _absolute_url(f"/#/event/{event.id}")
        response = make_response(
            render_template(
                "event_share.html",
                event=event,
                title=title,
                description=_event_share_description(event),
                image_url=image_url,
                icon_url=image_url,
                canonical_url=canonical_url,
                app_url=app_url,
            )
        )
        response.headers["Cache-Control"] = f"public, max-age={EVENT_SHARE_CACHE_SECONDS}"
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
