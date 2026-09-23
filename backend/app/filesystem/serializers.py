import mimetypes


def serialize_file_item(file_obj):
    owner_name = None
    if getattr(file_obj, "owner", None):
        owner_name = file_obj.owner.display_name or file_obj.owner.username
    if not owner_name:
        owner_name = str(file_obj.owner_id)

    return {
        "file_id": file_obj.id,
        "name": file_obj.path.rstrip("/").split("/")[-1],
        "path": file_obj.path,
        "size": file_obj.file_size,
        "owner": owner_name,
        "created_at": file_obj.created_at.isoformat() if file_obj.created_at else None,
        "updated_at": file_obj.updated_at.isoformat() if file_obj.updated_at else None,
        "type": "dir" if file_obj.is_folder else "file",
    }


def serialize_view_history(history):
    return {
        "id": history.id,
        "file_id": history.file_id,
        "path": history.path,
        "user_id": history.user_id,
        "timestamp": history.viewed_at.strftime("%Y-%m-%d %H:%M:%S"),
    }


def serialize_file_detail(file_obj, permissions, histories):
    file_type = "folder" if file_obj.is_folder else mimetypes.guess_type(file_obj.path)[0] or "unknown"
    return {
        "id": file_obj.id,
        "path": file_obj.path,
        "owner_id": file_obj.owner_id,
        "is_folder": file_obj.is_folder,
        "created_at": file_obj.created_at.isoformat() if file_obj.created_at else None,
        "updated_at": file_obj.updated_at.isoformat() if file_obj.updated_at else None,
        "file_type": file_type,
        "file_size": None if file_obj.is_folder else file_obj.file_size,
        "permissions": permissions,
        "history": histories,
    }
