from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from app.filesystem.services import (
    archive_files,
    build_directory_detail,
    build_tree,
    create_directory,
    create_share,
    delete_directory,
    delete_files,
    download_shared_file,
    get_file_detail,
    get_view_histories,
    list_directory,
    list_permissions,
    list_trash,
    move_file,
    remove_permission,
    rename_file,
    rename_directory,
    restore_trash,
    send_file_content,
    set_directory_permission,
    upload_entries,
)

files_bp = Blueprint("files", __name__)


def _error(message, code):
    return jsonify({"error": message}), code


@files_bp.get("/history/views")
@login_required
def get_history_views():
    file_id = request.args.get("file_id", type=int)
    return jsonify({"histories": get_view_histories(current_user.id, file_id=file_id)})


@files_bp.get("/tree")
@login_required
def get_tree():
    return jsonify(build_tree(current_user.id))


@files_bp.post("/query")
@login_required
def query_directory():
    data = request.get_json() or {}
    if "path" not in data:
        return _error("Missing path", 400)
    try:
        return jsonify(list_directory(data["path"], current_user.id))
    except ValueError as exc:
        return _error(str(exc), 400)


@files_bp.get("/items/<int:file_id>")
@login_required
def get_item_detail(file_id):
    try:
        return jsonify(get_file_detail(file_id, current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)


@files_bp.get("/items/<int:file_id>/permissions")
@login_required
def get_item_permissions(file_id):
    try:
        return jsonify(list_permissions(file_id, current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)


@files_bp.get("/items/<int:file_id>/content")
@login_required
def get_item_content(file_id):
    try:
        return send_file_content(file_id, current_user.id)
    except PermissionError as exc:
        return _error(str(exc), 403)
    except ValueError as exc:
        return _error(str(exc), 400)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except Exception as exc:
        return _error(str(exc), 500)


@files_bp.post("/items/archive")
@login_required
def download_archive():
    file_ids = (request.get_json() or {}).get("ids", [])
    if not file_ids:
        return _error("没有选择文件", 400)
    try:
        memory_file, count = archive_files(file_ids, current_user.id)
        from flask import send_file

        return send_file(
            memory_file,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"files_{count}.zip",
        )
    except PermissionError as exc:
        return _error(str(exc), 403)


@files_bp.post("/uploads")
@login_required
def upload_items():
    try:
        return jsonify(
            upload_entries(
                request.files.getlist("files"),
                request.form.getlist("relative_paths[]"),
                request.form.get("folder_location", "/"),
                current_user.id,
            )
        )
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return _error(str(exc), 500)


@files_bp.get("/directories/detail")
@login_required
def get_directory_detail():
    path = request.args.get("path")
    if not path:
        return _error("Missing path", 400)
    try:
        return jsonify(build_directory_detail(path, current_user.id))
    except FileNotFoundError as exc:
        return _error(str(exc), 404)


@files_bp.post("/directories")
@login_required
def create_directory_route():
    data = request.get_json() or {}
    if not data.get("path"):
        return _error("Missing path", 400)
    try:
        return jsonify(create_directory(data["path"], current_user.id))
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except ValueError as exc:
        return _error(str(exc), 400)


@files_bp.patch("/directories/rename")
@login_required
def rename_directory_route():
    data = request.get_json() or {}
    try:
        return jsonify(rename_directory(data.get("old_path"), data.get("new_name"), current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return _error(str(exc), 500)


@files_bp.put("/directories/permissions")
@login_required
def update_directory_permissions():
    data = request.get_json() or {}
    required = ["type", "id", "permission", "dir_path"]
    if any(key not in data or data[key] in [None, ""] for key in required):
        return jsonify({"status": "error", "message": "Missing parameters"}), 400
    try:
        return jsonify(
            set_directory_permission(
                data["dir_path"],
                data["type"],
                data["id"],
                data["permission"],
                current_user.id,
            )
        )
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@files_bp.delete("/directories")
@login_required
def delete_directory_route():
    path = (request.get_json() or {}).get("path")
    if not path:
        return _error("Missing path", 400)
    try:
        return jsonify(delete_directory(path, current_user.id))
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return _error(str(exc), 500)


@files_bp.delete("/items")
@login_required
def delete_items_route():
    ids = (request.get_json() or {}).get("ids", [])
    if not ids:
        return _error("No file ids provided", 400)
    try:
        return jsonify(delete_files(ids, current_user.id))
    except Exception as exc:
        from models import db

        db.session.rollback()
        return _error(str(exc), 500)


@files_bp.patch("/items/<int:file_id>/rename")
@login_required
def rename_item_route(file_id):
    data = request.get_json() or {}
    if not data.get("new_name"):
        return _error("Missing new_name", 400)
    try:
        return jsonify(rename_file(file_id, data["new_name"], current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except ValueError as exc:
        return _error(str(exc), 400)


@files_bp.post("/items/move")
@login_required
def move_item_route():
    data = request.get_json() or {}
    if not data.get("dir_path") or not data.get("file_path"):
        return _error("Missing dir_path or file_path", 400)
    try:
        return jsonify(move_file(data["file_path"], data["dir_path"], current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return _error(str(exc), 500)


@files_bp.post("/shares")
@login_required
def create_share_route():
    data = request.get_json() or {}
    try:
        return jsonify(
            create_share(
                data.get("file_id"),
                data.get("minutes", 10),
                data.get("credit", 1),
                current_user.id,
            )
        )
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except PermissionError as exc:
        return _error(str(exc), 403)


@files_bp.get("/trash")
@login_required
def get_trash():
    return jsonify(list_trash(current_user.id))


@files_bp.post("/trash/<int:trash_id>/restore")
@login_required
def restore_trash_route(trash_id):
    try:
        return jsonify(restore_trash(trash_id, current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except FileExistsError as exc:
        return _error(str(exc), 409)


@files_bp.delete("/permissions/<int:permission_id>")
@login_required
def delete_permission_route(permission_id):
    try:
        return jsonify(remove_permission(permission_id, current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)


@files_bp.get("/shares/<token>/download")
def download_share_route(token):
    try:
        return download_shared_file(token)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except PermissionError as exc:
        return _error(str(exc), 403)
    except ValueError as exc:
        return _error(str(exc), 400)
