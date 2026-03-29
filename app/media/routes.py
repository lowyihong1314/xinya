from flask import Blueprint, abort, jsonify, request, send_file
from flask_login import login_required

from app.auth import permission_required
from app.media.paths import BROKEN_IMAGE_PATH
from app.media.services import (
    create_album_file,
    delete_album_file,
    get_album_file,
    get_album_files,
    get_event_image_payload,
    get_event_type_payload,
    resolve_media_path,
    rotate_album_file,
)
from app.media.utils import allowed_file, build_zip_from_files, ensure_jpeg_cache_file, parse_file_ids
from models import db

media_bp = Blueprint("media", __name__)
nginx_media_router = Blueprint("media_file", __name__)


@nginx_media_router.route("/<path:filepath>")
def send_file_py_path(filepath):
    real_path = resolve_media_path(filepath)
    import os

    if not os.path.isfile(real_path):
        return send_file(
            BROKEN_IMAGE_PATH,
            conditional=True,
            etag=True,
            last_modified=os.path.getmtime(BROKEN_IMAGE_PATH),
        )
    return send_file(
        real_path,
        conditional=True,
        etag=True,
        last_modified=os.path.getmtime(real_path),
    )


@media_bp.get("/get_event_type/<int:id>")
def get_event_type(id):
    return get_event_type_payload(id)


@media_bp.get("/get_event_image/<int:id>/<type>")
def get_event_image(id, type):
    result = get_event_image_payload(id, type, force=request.args.get("force") == "1")
    if isinstance(result, tuple):
        return result
    return result


@media_bp.post("/upload_media")
@login_required
@permission_required("event_edit")
def upload_media():
    event_id = request.form.get("event_id")
    if not event_id:
        abort(400, "event_id is required")
    if "file" not in request.files:
        abort(400, "No file provided")

    uploaded_file = request.files["file"]
    if not (uploaded_file and allowed_file(uploaded_file.filename)):
        abort(400, "Invalid file type")

    try:
        album_file, filename, file_ext = create_album_file(event_id, uploaded_file)
    except Exception:
        db.session.rollback()
        raise

    return jsonify(
        {
            "status": "success",
            "uploaded": filename,
            "file_id": album_file.id,
            "file_type": file_ext,
        }
    )


@media_bp.post("/rotate_file/<int:file_id>/<int:angle>")
@login_required
@permission_required("event_edit")
def rotate_file(file_id, angle):
    rotate_album_file(file_id, angle)
    return jsonify({"status": "success", "message": "Image rotated"})


@media_bp.delete("/delete_files")
@login_required
@permission_required("event_edit")
def delete_files():
    try:
        file_ids = (request.json or {}).get("file_ids", [])
        if not file_ids:
            return jsonify({"status": "error", "message": "No file_ids provided"}), 400
        for file in get_album_files(file_ids):
            if file:
                delete_album_file(file)
        db.session.commit()
        return jsonify({"status": "success", "message": "Files deleted successfully"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@media_bp.post("/download_files")
def download_files():
    try:
        file_ids = parse_file_ids(request.form.get("file_ids", "[]"))
        download_type = (request.form.get("download_type") or "original").strip().lower()
        if not file_ids:
            return jsonify({"status": "error", "message": "No file_ids provided"}), 400
        if download_type not in {"original", "jpeg"}:
            return jsonify({"status": "error", "message": "Invalid download_type"}), 400

        files = []
        for file in get_album_files(file_ids):
            if file:
                from app.media.constants import IMAGE_EXTS
                from app.media.paths import event_photo_base_dir, event_photo_cache_dir
                from werkzeug.utils import secure_filename
                import os

                safe_name = secure_filename(file.file_name)
                original_path = os.path.join(
                    event_photo_base_dir(file.event.event_code),
                    safe_name,
                )
                target_name = file.file_name
                target_path = original_path

                if download_type == "jpeg":
                    stem, ext = os.path.splitext(safe_name)
                    ext = ext.lower()
                    if ext in IMAGE_EXTS or ext in {".heic", ".heif"}:
                        jpeg_path = os.path.join(
                            event_photo_cache_dir(file.event.event_code),
                            f"{stem}.jpeg",
                        )
                        if os.path.exists(original_path):
                            jpeg_path = ensure_jpeg_cache_file(original_path, os.path.dirname(jpeg_path))
                        if os.path.exists(jpeg_path):
                            target_path = jpeg_path
                            target_name = f"{os.path.splitext(file.file_name)[0]}.jpeg"

                files.append(
                    (
                        file.id,
                        target_name,
                        target_path,
                    )
                )

        return send_file(
            build_zip_from_files(files),
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"event_files_{download_type}.zip",
        )
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
