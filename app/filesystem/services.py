import io
import mimetypes
import os
import secrets
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

from flask import after_this_request, jsonify, send_file
from flask_login import current_user
from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from app.filesystem.paths import STORAGE_ROOT, TRASH_ROOT
from app.filesystem.serializers import serialize_file_item, serialize_view_history
from models import db
from models.file_manager_DB import (
    File,
    FileHistory,
    FilePermission,
    FileTrash,
    SharePublic,
    ViewHistory,
)
from models.user_data import Department, User


def normalize_path(path_value, default="/"):
    raw = (path_value or default).strip()
    if not raw:
        return default
    normalized = "/" + raw.strip("/").replace("\\", "/")
    return normalized.rstrip("/") or "/"


def child_path(parent_path, name):
    if parent_path == "/":
        return normalize_path(name)
    return normalize_path(f"{parent_path}/{name}")


def absolute_path(logical_path):
    return STORAGE_ROOT / logical_path.lstrip("/")


def trash_path(trash_id):
    return TRASH_ROOT / str(trash_id)


def ensure_storage_root():
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    TRASH_ROOT.mkdir(parents=True, exist_ok=True)


def subtree_filter(path_value):
    normalized = normalize_path(path_value)
    if normalized == "/":
        return File.path.like("/%")
    return or_(File.path == normalized, File.path.like(f"{normalized}/%"))


def get_subtree_files(path_value):
    return File.query.filter(subtree_filter(path_value)).order_by(File.path.asc()).all()


def path_exists(logical_path, exclude_id=None):
    query = File.query.filter_by(path=logical_path)
    if exclude_id is not None:
        query = query.filter(File.id != exclude_id)
    return query.first() is not None or absolute_path(logical_path).exists()


def check_permission(user_id, file_obj, required):
    if user_id == file_obj.owner_id:
        return True

    user = User.query.get(user_id)
    if not user:
        return False

    perm = FilePermission.query.filter_by(file_id=file_obj.id, user_id=user.id).first()
    if perm:
        if required == "read" and perm.permission in ["read", "read_write", "read_public"]:
            return True
        if required == "write" and perm.permission == "read_write":
            return True

    if user.departments:
        dept_ids = [dept.id for dept in user.departments]
        dept_perms = FilePermission.query.filter(
            FilePermission.file_id == file_obj.id,
            FilePermission.department_id.in_(dept_ids),
        ).all()
        for dept_perm in dept_perms:
            if required == "read" and dept_perm.permission in ["read", "read_write", "read_public"]:
                return True
            if required == "write" and dept_perm.permission == "read_write":
                return True

    if required == "read":
        public_perm = FilePermission.query.filter_by(file_id=file_obj.id, permission="read_public").first()
        if public_perm:
            return True

    return False


def add_history(file_id, user_id, action, old_path=None, new_path=None):
    history = FileHistory(
        file_id=file_id,
        user_id=user_id,
        action=action,
        old_path=old_path,
        new_path=new_path,
    )
    db.session.add(history)
    return history


def add_default_permission(file_obj, user_id):
    db.session.add(FilePermission(file_id=file_obj.id, user_id=user_id, permission="read_write"))


def _find_permission_template_file(logical_path, exclude_file_id=None):
    parent_path = os.path.dirname(logical_path.rstrip("/")) or "/"
    prefix = "" if parent_path == "/" else f"{parent_path}/"
    query = File.query.filter(File.is_folder.is_(False))

    if parent_path == "/":
        query = query.filter(File.path.like("/%"))
    else:
        query = query.filter(File.path.like(f"{prefix}%"))

    if exclude_file_id is not None:
        query = query.filter(File.id != exclude_file_id)

    candidates = query.order_by(File.created_at.asc(), File.id.asc()).all()
    for candidate in candidates:
        rel_path = candidate.path.lstrip("/") if parent_path == "/" else candidate.path[len(prefix) :]
        if rel_path and "/" not in rel_path:
            return candidate
    return None


def add_inherited_or_default_permissions(file_obj, user_id):
    template_file = _find_permission_template_file(file_obj.path, exclude_file_id=file_obj.id)
    if not template_file:
        add_default_permission(file_obj, user_id)
        return

    template_permissions = FilePermission.query.filter_by(file_id=template_file.id).all()
    if not template_permissions:
        add_default_permission(file_obj, user_id)
        return

    for permission in template_permissions:
        db.session.add(
            FilePermission(
                file_id=file_obj.id,
                user_id=permission.user_id,
                department_id=permission.department_id,
                permission=permission.permission,
            )
        )


def get_view_histories(user_id, file_id=None, limit=100):
    query = ViewHistory.query
    if file_id:
        query = query.filter_by(file_id=file_id)
    else:
        query = query.filter_by(user_id=user_id)
    return [serialize_view_history(item) for item in query.order_by(ViewHistory.viewed_at.desc()).limit(limit).all()]


def get_accessible_files(user_id):
    files = File.query.options(joinedload(File.owner)).all()
    return [file_obj for file_obj in files if check_permission(user_id, file_obj, "read")]


def build_tree(user_id):
    directories = set()
    files = []
    for file_obj in get_accessible_files(user_id):
        path_str = file_obj.path.strip("/")
        if not path_str:
            continue
        parts = path_str.split("/")
        if len(parts) > 1:
            for index in range(1, len(parts)):
                directories.add("/" + "/".join(parts[:index]))
        elif file_obj.is_folder:
            directories.add("/" + parts[0])

        if not file_obj.is_folder:
            files.append(
                {
                    "file_id": file_obj.id,
                    "name": parts[-1],
                    "path": file_obj.path,
                    "size": getattr(file_obj, "file_size", None),
                }
            )

    return {"directories": sorted(directories), "files": files}


def record_view(path, user_id, file_id=None):
    db.session.add(ViewHistory(file_id=file_id, path=path, user_id=user_id))
    db.session.commit()


def list_directory(path, user_id):
    base_path = normalize_path(path)
    folder_obj = File.query.filter_by(path=base_path).first()
    if folder_obj and not folder_obj.is_folder:
        raise ValueError("Path is a file, not a directory")

    query_prefix = "" if base_path == "/" else base_path + "/"
    if base_path == "/":
        files = File.query.options(joinedload(File.owner)).all()
    else:
        files = (
            File.query.options(joinedload(File.owner))
            .filter(File.path.like(f"{query_prefix}%"))
            .all()
        )

    directories = {}
    result_files = []
    for file_obj in files:
        if not check_permission(user_id, file_obj, "read"):
            continue

        rel = file_obj.path.lstrip("/") if base_path == "/" else file_obj.path[len(query_prefix) :]
        if not rel:
            continue
        parts = rel.split("/", 1)
        if len(parts) == 1:
            if file_obj.is_folder:
                directories[parts[0]] = {
                    "type": "dir",
                    "name": parts[0],
                    "path": child_path(base_path, parts[0]),
                }
            else:
                result_files.append(serialize_file_item(file_obj))
        else:
            dir_name = parts[0]
            directories.setdefault(
                dir_name,
                {
                    "type": "dir",
                    "name": dir_name,
                    "path": child_path(base_path, dir_name),
                },
            )

    record_view(base_path, user_id)
    return {
        "path": base_path,
        "directories": sorted(directories.values(), key=lambda item: item["name"].lower()),
        "files": sorted(result_files, key=lambda item: item["name"].lower()),
    }


def get_file_detail(file_id, user_id):
    file_obj = File.query.get_or_404(file_id)
    if not check_permission(user_id, file_obj, "read"):
        raise PermissionError("Permission denied")

    permissions = []
    for permission in FilePermission.query.filter_by(file_id=file_id).all():
        permissions.append(
            {
                "id": permission.id,
                "user_id": permission.user_id,
                "department_id": permission.department_id,
                "permission": permission.permission,
            }
        )

    histories = []
    for history in (
        FileHistory.query.filter_by(file_id=file_id)
        .order_by(FileHistory.timestamp.desc())
        .limit(10)
        .all()
    ):
        user = User.query.get(history.user_id)
        histories.append(
            {
                "id": history.id,
                "user_id": history.user_id,
                "user_name": (user.display_name or user.username) if user else None,
                "action": history.action,
                "old_path": history.old_path,
                "new_path": history.new_path,
                "timestamp": history.timestamp.isoformat(),
            }
        )

    from app.filesystem.serializers import serialize_file_detail

    return serialize_file_detail(file_obj, permissions, histories)


def send_file_content(file_id, user_id):
    file_obj = File.query.get_or_404(file_id)
    if not check_permission(user_id, file_obj, "read"):
        raise PermissionError("Permission denied")
    if file_obj.is_folder:
        raise ValueError("目录不能直接下载")

    path = absolute_path(file_obj.path)
    if not path.exists():
        raise FileNotFoundError("文件丢失")

    ext = path.suffix.lower()
    download_name = os.path.basename(file_obj.path)
    mimetypes.add_type("image/heic", ".heic")
    mime_type, _ = mimetypes.guess_type(str(path))
    if mime_type is None:
        mime_type = "application/octet-stream"

    if ext == ".wma":
        tmp_mp3_path = f"/tmp/{uuid.uuid4().hex}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(path), "-acodec", "libmp3lame", "-ab", "192k", tmp_mp3_path],
            check=True,
        )

        @after_this_request
        def cleanup(response):
            try:
                os.remove(tmp_mp3_path)
            except Exception:
                pass
            return response

        return send_file(
            tmp_mp3_path,
            mimetype="audio/mpeg",
            as_attachment=True,
            download_name=Path(download_name).stem + ".mp3",
        )

    return send_file(path, mimetype=mime_type, as_attachment=True, download_name=download_name)


def archive_files(file_ids, user_id):
    files = File.query.filter(File.id.in_(file_ids)).all()
    for file_obj in files:
        if not check_permission(user_id, file_obj, "read"):
            raise PermissionError(f"没有权限访问 {file_obj.path}")

    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_obj in files:
            path = absolute_path(file_obj.path)
            if file_obj.is_folder and path.exists():
                for nested_path in path.rglob("*"):
                    if nested_path.is_file():
                        zip_file.write(
                            nested_path,
                            arcname=str(Path(file_obj.path.lstrip("/")) / nested_path.relative_to(path)),
                        )
            elif path.exists():
                zip_file.write(path, arcname=os.path.basename(file_obj.path))

    memory_file.seek(0)
    return memory_file, len(files)


def ensure_folder_record(path, owner_id):
    existing = File.query.filter_by(path=path).first()
    if existing:
        return existing

    folder = File(path=path, owner_id=owner_id, is_folder=True, file_size=0)
    db.session.add(folder)
    db.session.flush()
    add_default_permission(folder, owner_id)
    add_history(folder.id, owner_id, "create", new_path=path)
    return folder


def create_directory(path, user_id):
    ensure_storage_root()
    normalized = normalize_path(path)
    if normalized == "/":
        raise ValueError("根目录不能重复创建")
    if path_exists(normalized):
        raise FileExistsError("目录已存在")

    absolute_path(normalized).mkdir(parents=True, exist_ok=True)
    parent_parts = Path(normalized.lstrip("/")).parts[:-1]
    running = "/"
    for part in parent_parts:
        running = child_path(running, part)
        ensure_folder_record(running, user_id)

    folder = ensure_folder_record(normalized, user_id)
    db.session.commit()
    return {"success": True, "directory": {"file_id": folder.id, "path": normalized, "type": "dir"}}


def upload_entries(files, relative_paths, folder_location, user_id):
    ensure_storage_root()
    base_path = normalize_path(folder_location)
    uploaded = []

    if not files:
        for relative_path in relative_paths:
            normalized_relative = relative_path.strip("/").replace("\\", "/")
            logical_path = child_path(base_path, normalized_relative)
            existing = File.query.filter_by(path=logical_path).first()
            if existing and not existing.is_folder:
                raise FileExistsError(f"已有同名文件: {logical_path}")
            abs_path = absolute_path(logical_path)
            abs_path.mkdir(parents=True, exist_ok=True)
            folder = ensure_folder_record(logical_path, user_id)
            uploaded.append({"file_id": folder.id, "path": logical_path, "type": "folder"})
        db.session.commit()
        return {"success": True, "folders": uploaded}

    for uploaded_file, relative_path in zip(files, relative_paths):
        normalized_relative = relative_path.lstrip("/").replace("\\", "/")
        logical_path = child_path(base_path, normalized_relative)
        if File.query.filter_by(path=logical_path).first():
            raise FileExistsError(f"文件已存在: {logical_path}")
        abs_path = absolute_path(logical_path)
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        uploaded_file.save(abs_path)

        parent_parts = Path(logical_path.lstrip("/")).parts[:-1]
        running = "/"
        for part in parent_parts:
            running = child_path(running, part)
            ensure_folder_record(running, user_id)

        db_file = File(
            path=logical_path,
            owner_id=user_id,
            is_folder=False,
            file_size=os.path.getsize(abs_path),
        )
        db.session.add(db_file)
        db.session.flush()
        add_inherited_or_default_permissions(db_file, user_id)
        add_history(db_file.id, user_id, "upload", new_path=logical_path)
        uploaded.append({"file_id": db_file.id, "path": logical_path, "type": "file"})

    db.session.commit()
    return {"success": True, "files": uploaded}


def build_directory_detail(path, user_id):
    normalized = normalize_path(path)
    files = get_subtree_files(normalized)
    if not files:
        raise FileNotFoundError("Directory not found in DB")

    file_count = 0
    total_size = 0
    sub_dirs = set()
    folder_obj = File.query.filter_by(path=normalized).first()
    for file_obj in files:
        if not check_permission(user_id, file_obj, "read"):
            continue
        if not file_obj.is_folder:
            file_count += 1
            total_size += file_obj.file_size or 0
        rel_path = file_obj.path[len(normalized) :].lstrip("/")
        if "/" in rel_path:
            sub_dirs.add(rel_path.split("/")[0])

    abs_path = absolute_path(normalized)
    return {
        "name": normalized.split("/")[-1] or "/",
        "path": normalized,
        "abs_path": str(abs_path),
        "created_at": folder_obj.created_at.isoformat() if folder_obj and folder_obj.created_at else None,
        "updated_at": folder_obj.updated_at.isoformat() if folder_obj and folder_obj.updated_at else None,
        "file_count": file_count,
        "total_size": total_size,
        "sub_dir_count": len(sub_dirs),
        "sub_dirs": sorted(sub_dirs),
    }


def rename_directory(old_path, new_name, user_id):
    old_path = normalize_path(old_path)
    parent = os.path.dirname(old_path.rstrip("/")) or "/"
    new_path = child_path(parent, new_name)
    old_prefix = old_path.rstrip("/") + "/"
    new_prefix = new_path.rstrip("/") + "/"

    files = File.query.filter(File.path.like(f"{old_prefix}%")).all()
    folder_obj = File.query.filter_by(path=old_path).first()
    if old_path == "/" or not folder_obj or not folder_obj.is_folder:
        raise FileNotFoundError("Directory not found")
    if path_exists(new_path, exclude_id=folder_obj.id):
        raise FileExistsError("目标目录已存在")

    if not check_permission(user_id, folder_obj, "write"):
        raise PermissionError("Permission denied")

    for file_obj in files:
        if not check_permission(user_id, file_obj, "write"):
            raise PermissionError("Permission denied")

    old_abs = absolute_path(old_path)
    new_abs = absolute_path(new_path)
    if old_abs.exists():
        os.makedirs(new_abs.parent, exist_ok=True)
        os.rename(old_abs, new_abs)

    for file_obj in files:
        file_obj.path = file_obj.path.replace(old_prefix, new_prefix, 1)
    if folder_obj and folder_obj.is_folder:
        folder_obj.path = new_path

    add_history(folder_obj.id if folder_obj else files[0].id if files else 1, user_id, "rename_dir", old_path=old_path, new_path=new_path)
    db.session.commit()
    return {"success": True, "new_path": new_path, "updated": len(files)}


def rename_file(file_id, new_name, user_id):
    file_obj = File.query.get(file_id)
    if not file_obj:
        raise FileNotFoundError("File not found")
    if file_obj.is_folder:
        raise ValueError("目录请使用目录重命名接口")
    if not check_permission(user_id, file_obj, "write"):
        raise PermissionError("No permission for file")

    new_logical_path = child_path(os.path.dirname(file_obj.path.rstrip("/")) or "/", new_name)
    if path_exists(new_logical_path, exclude_id=file_obj.id):
        raise FileExistsError("目标文件已存在")

    old_abs = absolute_path(file_obj.path)
    new_abs = absolute_path(new_logical_path)
    new_abs.parent.mkdir(parents=True, exist_ok=True)
    if not old_abs.exists():
        raise FileNotFoundError(f"File not found on disk: {old_abs}")

    shutil.move(str(old_abs), str(new_abs))
    old_path = file_obj.path
    file_obj.path = new_logical_path
    file_obj.file_size = new_abs.stat().st_size
    add_history(file_obj.id, user_id, "move", old_path=old_path, new_path=new_logical_path)
    db.session.commit()
    return {"success": True, "new_path": new_logical_path}


def set_directory_permission(dir_path, target_type, target_id, permission, user_id):
    normalized = normalize_path(dir_path)
    files = get_subtree_files(normalized)
    for file_obj in files:
        if not check_permission(user_id, file_obj, "write"):
            continue
        existing = FilePermission.query.filter_by(
            file_id=file_obj.id,
            user_id=target_id if target_type == "user" else None,
            department_id=target_id if target_type == "department" else None,
        ).first()
        if existing:
            existing.permission = permission
        else:
            db.session.add(
                FilePermission(
                    file_id=file_obj.id,
                    user_id=target_id if target_type == "user" else None,
                    department_id=target_id if target_type == "department" else None,
                    permission=permission,
                )
            )
        add_history(file_obj.id, user_id, "set_permission", new_path=f"{target_type}:{target_id}:{permission}")
    db.session.commit()
    return {"status": "success", "message": "目录权限批量设置成功"}


def list_permissions(file_id, user_id):
    file_obj = File.query.get(file_id)
    if not file_obj:
        raise FileNotFoundError("File not found")
    if not check_permission(user_id, file_obj, "read"):
        raise PermissionError("Permission denied")

    permissions = FilePermission.query.filter_by(file_id=file_id).all()
    return {
        "permissions": [
            {
                "id": permission.id,
                "file_id": permission.file_id,
                "user_id": permission.user_id,
                "department_id": permission.department_id,
                "permission": permission.permission,
            }
            for permission in permissions
        ]
    }


def remove_permission(permission_id, user_id):
    permission = FilePermission.query.get(permission_id)
    if not permission:
        raise FileNotFoundError("Permission not found")

    file_obj = File.query.get(permission.file_id)
    if not file_obj:
        raise FileNotFoundError("File not found")
    if not check_permission(user_id, file_obj, "write"):
        raise PermissionError("Permission denied")

    db.session.delete(permission)
    add_history(file_obj.id, user_id, "remove_permission", new_path=str(permission_id))
    db.session.commit()
    return {"success": True}


def _compute_entry_size(abs_path, file_obj):
    try:
        if abs_path.is_dir():
            return sum(item.stat().st_size for item in abs_path.rglob("*") if item.is_file())
        return abs_path.stat().st_size if abs_path.exists() else file_obj.file_size
    except Exception:
        return file_obj.file_size


def _delete_related_records(file_ids):
    if not file_ids:
        return
    FilePermission.query.filter(FilePermission.file_id.in_(file_ids)).delete(synchronize_session=False)
    FileHistory.query.filter(FileHistory.file_id.in_(file_ids)).delete(synchronize_session=False)
    ViewHistory.query.filter(ViewHistory.file_id.in_(file_ids)).delete(synchronize_session=False)
    SharePublic.query.filter(SharePublic.file_id.in_(file_ids)).delete(synchronize_session=False)


def move_to_trash(file_obj, deleted_by):
    ensure_storage_root()
    subtree_files = get_subtree_files(file_obj.path) if file_obj.is_folder else [file_obj]
    for subtree_file in subtree_files:
        if not check_permission(deleted_by, subtree_file, "write"):
            raise PermissionError(f"没有权限删除 {subtree_file.path}")

    abs_path = absolute_path(file_obj.path)
    trash_entry = FileTrash(
        file_id=file_obj.id,
        owner_id=file_obj.owner_id,
        deleted_by=deleted_by,
        path=file_obj.path,
        size=_compute_entry_size(abs_path, file_obj),
    )
    db.session.add(trash_entry)
    db.session.flush()

    if abs_path.exists():
        shutil.move(str(abs_path), str(trash_path(trash_entry.id)))

    # Once the snapshot is in trash, it should no longer depend on the live
    # `files` row, otherwise deleting that row can trip FK constraints.
    trash_entry.file_id = None

    _delete_related_records([item.id for item in subtree_files])
    for subtree_file in sorted(subtree_files, key=lambda item: len(item.path), reverse=True):
        db.session.delete(subtree_file)

    return len(subtree_files)


def delete_directory(path, user_id):
    normalized = normalize_path(path)
    folder_obj = File.query.filter_by(path=normalized).first()
    if not folder_obj or not folder_obj.is_folder:
        raise FileNotFoundError("Directory not found in DB")
    deleted_count = move_to_trash(folder_obj, user_id)
    db.session.commit()
    return {"success": True, "deleted": deleted_count}


def delete_files(file_ids, user_id):
    files = File.query.filter(File.id.in_(file_ids)).all()
    deleted_count = 0
    for file_obj in files:
        if check_permission(user_id, file_obj, "write"):
            deleted_count += move_to_trash(file_obj, user_id)
    db.session.commit()
    return {"success": True, "deleted": deleted_count}


def move_file(file_path, dir_path, user_id):
    source_path = normalize_path(file_path)
    target_dir = normalize_path(dir_path)
    file_obj = File.query.filter_by(path=source_path).first()
    if not file_obj:
        raise FileNotFoundError("File not found")
    if not check_permission(user_id, file_obj, "write"):
        raise PermissionError("No permission for file")

    dir_obj = File.query.filter_by(path=target_dir).first()
    if dir_obj and not check_permission(user_id, dir_obj, "write"):
        raise PermissionError("No permission for directory")

    old_abs = absolute_path(source_path)
    new_logical_path = child_path(target_dir, os.path.basename(source_path))
    if path_exists(new_logical_path, exclude_id=file_obj.id):
        raise FileExistsError("目标路径已存在")
    new_abs = absolute_path(new_logical_path)
    new_abs.parent.mkdir(parents=True, exist_ok=True)
    if not old_abs.exists():
        raise FileNotFoundError(f"File not found on disk: {old_abs}")

    shutil.move(str(old_abs), str(new_abs))
    old_path = file_obj.path
    file_obj.path = new_logical_path
    add_history(file_obj.id, user_id, "move", old_path=old_path, new_path=new_logical_path)
    db.session.commit()
    return {"success": True, "new_path": new_logical_path}


def create_share(file_id, minutes, credit, user_id):
    file_obj = File.query.get(file_id)
    if not file_obj:
        raise FileNotFoundError("File not found")
    if not check_permission(user_id, file_obj, "write"):
        raise PermissionError("Permission denied")

    token = secrets.token_urlsafe(16)
    share = SharePublic(
        file_id=file_id,
        expire_minutes=minutes,
        created_user=user_id,
        token=token,
        credit=credit,
    )
    db.session.add(share)
    db.session.commit()
    return {
        "share_url": f"/api/files/shares/{token}/download",
        "expire_minutes": minutes,
        "credit": credit,
        "file_path": file_obj.path,
    }


def download_shared_file(token):
    share = SharePublic.query.filter_by(token=token).first()
    if not share:
        raise FileNotFoundError("无效的分享链接")
    if not share.can_download():
        raise PermissionError("链接已失效或下载次数已用完")

    file_obj = File.query.get(share.file_id)
    if not file_obj:
        raise FileNotFoundError("文件不存在")
    if file_obj.is_folder:
        raise ValueError("目录不能下载")

    abs_path = absolute_path(file_obj.path)
    if not abs_path.exists():
        raise FileNotFoundError("文件丢失")

    share.used += 1
    db.session.commit()

    return send_file(abs_path, as_attachment=True, download_name=os.path.basename(file_obj.path))


def list_trash(user_id):
    items = FileTrash.query.filter_by(owner_id=user_id).order_by(FileTrash.deleted_at.desc()).all()
    return {
        "items": [
            {
                "id": item.id,
                "file_id": item.file_id,
                "path": item.path,
                "size": item.size,
                "deleted_at": item.deleted_at.isoformat() if item.deleted_at else None,
            }
            for item in items
        ]
    }


def batch_delete_items(items, user_id):
    results = []
    deleted_count = 0
    for item in items:
        item_type = item.get("type")
        key = item.get("id") if item_type == "file" else item.get("path")
        try:
            if item_type == "file":
                file_obj = File.query.get(item.get("id"))
                if not file_obj:
                    raise FileNotFoundError("文件不存在")
            elif item_type == "dir":
                normalized = normalize_path(item.get("path"))
                file_obj = File.query.filter_by(path=normalized).first()
                if not file_obj or not file_obj.is_folder:
                    raise FileNotFoundError("目录不存在")
            else:
                raise ValueError("未知的项目类型")

            # move_to_trash 会先移动磁盘文件，逐项提交避免失败回滚扩散到已删项
            deleted_count += move_to_trash(file_obj, user_id)
            db.session.commit()
            results.append({"key": key, "success": True})
        except PermissionError as exc:
            db.session.rollback()
            results.append({"key": key, "success": False, "error": str(exc) or "没有权限"})
        except FileNotFoundError as exc:
            db.session.rollback()
            results.append({"key": key, "success": False, "error": str(exc)})
        except Exception as exc:
            db.session.rollback()
            results.append({"key": key, "success": False, "error": f"删除失败：{exc}"})
    return {"results": results, "deleted": deleted_count}


def _filter_readable(files, user_id):
    # 批量版读权限过滤，语义须与 check_permission(required="read") 保持一致：
    # owner / 用户级权限 / 部门级权限 / read_public 兜底
    if not files:
        return []
    user = User.query.get(user_id)
    if not user:
        return []
    dept_ids = {dept.id for dept in user.departments} if user.departments else set()
    file_ids = [f.id for f in files]
    perms = FilePermission.query.filter(FilePermission.file_id.in_(file_ids)).all()
    readable_ids = set()
    for perm in perms:
        if perm.permission not in ("read", "read_write", "read_public"):
            continue
        if perm.permission == "read_public":
            readable_ids.add(perm.file_id)
        elif perm.user_id == user_id:
            readable_ids.add(perm.file_id)
        elif perm.department_id and perm.department_id in dept_ids:
            readable_ids.add(perm.file_id)
    return [f for f in files if f.owner_id == user_id or f.id in readable_ids]


def search_files(q, user_id, limit=100):
    escaped = q.replace("\\", r"\\").replace("%", r"\%").replace("_", r"\_")
    candidates = (
        File.query.options(joinedload(File.owner))
        .filter(File.path.ilike(f"%{escaped}%", escape="\\"))
        .order_by(File.updated_at.desc())
        .limit(500)
        .all()
    )
    q_lower = q.lower()
    candidates = [f for f in candidates if q_lower in f.path.rstrip("/").rsplit("/", 1)[-1].lower()]
    readable = _filter_readable(candidates, user_id)
    return {
        "query": q,
        "items": [serialize_file_item(f) for f in readable[:limit]],
        "truncated": len(readable) > limit,
    }


def purge_trash(trash_id, user_id):
    trash_entry = FileTrash.query.get(trash_id)
    if not trash_entry:
        raise FileNotFoundError("回收站条目不存在")
    if trash_entry.owner_id != user_id:
        raise PermissionError("没有权限")

    source = trash_path(trash_entry.id)
    if source.exists():
        if source.is_dir():
            shutil.rmtree(source)
        else:
            source.unlink()
    db.session.delete(trash_entry)
    db.session.commit()
    return {"success": True}


def purge_all_trash(user_id):
    entries = FileTrash.query.filter_by(owner_id=user_id).all()
    purged = 0
    for entry in entries:
        purge_trash(entry.id, user_id)
        purged += 1
    return {"success": True, "purged": purged}


def restore_trash(trash_id, user_id):
    trash_entry = FileTrash.query.get(trash_id)
    if not trash_entry:
        raise FileNotFoundError("Trash entry not found")
    if trash_entry.owner_id != user_id:
        raise PermissionError("Permission denied")

    source = trash_path(trash_entry.id)
    if not source.exists():
        raise FileNotFoundError("Trash content not found")
    if path_exists(trash_entry.path):
        raise FileExistsError("原路径已被占用，无法恢复")

    target = absolute_path(trash_entry.path)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))

    restored_count = _rebuild_restored_path(trash_entry.path, trash_entry.owner_id)
    db.session.delete(trash_entry)
    db.session.commit()
    return {"success": True, "restored": restored_count, "path": trash_entry.path}


def _rebuild_restored_path(logical_path, owner_id):
    target = absolute_path(logical_path)
    created = 0
    if target.is_dir():
        created += _create_restored_record(logical_path, owner_id, True, 0)
        for directory in sorted([item for item in target.rglob("*") if item.is_dir()]):
            dir_logical = child_path(logical_path, str(directory.relative_to(target)).replace("\\", "/"))
            created += _create_restored_record(dir_logical, owner_id, True, 0)
        for file_path in [item for item in target.rglob("*") if item.is_file()]:
            file_logical = child_path(logical_path, str(file_path.relative_to(target)).replace("\\", "/"))
            created += _create_restored_record(file_logical, owner_id, False, file_path.stat().st_size)
        return created

    return _create_restored_record(logical_path, owner_id, False, target.stat().st_size)


def _create_restored_record(path, owner_id, is_folder, file_size):
    if File.query.filter_by(path=path).first():
        return 0
    record = File(path=path, owner_id=owner_id, is_folder=is_folder, file_size=file_size)
    db.session.add(record)
    db.session.flush()
    add_default_permission(record, owner_id)
    add_history(record.id, owner_id, "restore", new_path=path)
    return 1
