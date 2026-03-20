import os
import uuid
from datetime import date, datetime
from email.utils import parsedate_to_datetime

from flask import Blueprint, jsonify, request
from flask_login import current_user
from werkzeug.utils import secure_filename

from models import db
from models.info import AboutUs, OurHistory

info_bp = Blueprint("info_bp", __name__)
INFO_IMAGE_DIR = os.path.join("static", "images", "info")


def _resolve_image_path(image_url):
    if not image_url:
        return None
    return image_url.lstrip("/")


def _delete_history_image(image_url):
    image_path = _resolve_image_path(image_url)
    if image_path and os.path.exists(image_path):
        os.remove(image_path)


def _save_history_image(file_storage):
    os.makedirs(INFO_IMAGE_DIR, exist_ok=True)
    original_name = secure_filename(file_storage.filename or "history-image")
    suffix = os.path.splitext(original_name)[1] or ".jpg"
    file_name = f"history-{uuid.uuid4().hex}{suffix}"
    file_path = os.path.join(INFO_IMAGE_DIR, file_name)
    file_storage.save(file_path)
    return f"/{file_path}"


def _serialize_history_entry(entry):
    return {
        "id": entry.id,
        "text": entry.text,
        "img": entry.img,
        "date": entry.date.strftime("%Y-%m-%d") if entry.date else None,
    }


def _parse_history_date(raw_date):
    if raw_date is None:
        return None

    if isinstance(raw_date, datetime):
        return raw_date.date()

    if isinstance(raw_date, date):
        return raw_date

    value = str(raw_date).strip()
    if not value:
        return None

    for pattern in ("%Y-%m-%d", "%a, %d %b %Y %H:%M:%S %Z"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue

    try:
        return parsedate_to_datetime(value).date()
    except (TypeError, ValueError, IndexError):
        return None


@info_bp.get("/get_about_us_text")
def get_about_us_text():
    try:
        entries = AboutUs.query.order_by(AboutUs.created_at.desc()).all()
        return jsonify(
            [
                {
                    "id": entry.id,
                    "username": entry.username,
                    "created_at": entry.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                    "text": entry.text,
                }
                for entry in entries
            ]
        )
    except Exception as exc:
        return jsonify({"error": f"获取失败: {str(exc)}"}), 500


@info_bp.get("/get_our_history")
def get_our_history():
    try:
        entries = OurHistory.query.order_by(OurHistory.created_at.desc()).all()
        return jsonify([_serialize_history_entry(entry) for entry in entries])
    except Exception as exc:
        return jsonify({"error": f"获取失败: {str(exc)}"}), 500


@info_bp.route("/about_us_text", methods=["POST", "DELETE"])
def handle_about_us_text():
    if request.method == "DELETE":
        data = request.get_json() or {}
        entry_id = data.get("id")
        if not entry_id:
            return jsonify({"error": "缺少 ID 参数"}), 400

        entry = AboutUs.query.get(entry_id)
        if not entry:
            return jsonify({"error": "记录不存在"}), 404

        try:
            db.session.delete(entry)
            db.session.commit()
            return jsonify({"success": True})
        except Exception as exc:
            db.session.rollback()
            return jsonify({"error": f"删除失败: {str(exc)}"}), 500

    entry_id = request.form.get("id")
    text = request.form.get("text")
    if not text or not text.strip():
        return jsonify({"error": "内容不能为空"}), 400

    try:
        if entry_id:
            entry = AboutUs.query.get(entry_id)
            if not entry:
                return jsonify({"error": "记录不存在"}), 404
            entry.text = text.strip()
        else:
            entry = AboutUs(username=str(current_user.id), text=text.strip())
            db.session.add(entry)

        db.session.commit()
        return jsonify({"success": True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"操作失败: {str(exc)}"}), 500


@info_bp.route("/add_our_history", methods=["POST", "DELETE"])
def add_our_history():
    if request.method == "DELETE":
        data = request.get_json() or {}
        entry_id = data.get("id")
        if not entry_id:
            return jsonify({"error": "缺少 ID 参数"}), 400

        entry = OurHistory.query.get(entry_id)
        if not entry:
            return jsonify({"error": "记录不存在"}), 404

        try:
            if entry.img:
                _delete_history_image(entry.img)

            db.session.delete(entry)
            db.session.commit()
            return jsonify({"success": True})
        except Exception as exc:
            db.session.rollback()
            return jsonify({"error": f"删除失败: {str(exc)}"}), 500

    if request.content_type and "multipart/form-data" in request.content_type:
        data = request.form
        image = request.files.get("image")
    else:
        data = request.get_json() or {}
        image = None

    entry_id = data.get("id")
    text = data.get("text")
    date = _parse_history_date(data.get("date"))
    remove_image = str(data.get("remove_image", "")).lower() in {"1", "true", "yes", "on"}

    if not text:
        return jsonify({"error": "内容不能为空"}), 400
    if not entry_id and not date:
        return jsonify({"error": "日期不能为空"}), 400
    if data.get("date") and not date:
        return jsonify({"error": "日期格式无效，请使用 YYYY-MM-DD"}), 400
    if not current_user.is_authenticated:
        return jsonify({"error": "未登录"}), 401

    try:
        if entry_id:
            entry = OurHistory.query.get(entry_id)
            if not entry:
                return jsonify({"error": "记录不存在"}), 404
            entry.text = text
            if date:
                entry.date = date
            if image:
                if entry.img:
                    _delete_history_image(entry.img)
                entry.img = _save_history_image(image)
            elif remove_image and entry.img:
                _delete_history_image(entry.img)
                entry.img = None
        else:
            db.session.add(
                OurHistory(
                    username=str(current_user.id),
                    created_at=datetime.now(),
                    text=text,
                    date=date,
                    img=_save_history_image(image) if image else None,
                )
            )

        db.session.commit()
        return jsonify({"success": True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"保存失败: {str(exc)}"}), 500
