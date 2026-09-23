"""文件管理器的 JSON 序列化（原 backend/app/filesystem/serializers.py，一字未改）。

这里每个键名都是前端文件管理器在读的字段，**改名即线上故障**。几处容易被「顺手优化」
掉、但必须保持原样的地方：

  · ``serialize_file_item`` 的 ``owner`` 是**字符串**：display_name → username →
    ``str(owner_id)`` 三级回退。最后一级把数字 id 当人名显示很难看，但前端的表格列
    直接渲染这个值，改成 None 会变成空白格；改成字典会直接渲染出 "[object Object]"。
  · ``name`` 是 ``path.rstrip("/").split("/")[-1]`` —— 根目录 ``"/"`` 会得到空串。
    实际上根目录不会被序列化（list_directory 跳过 rel 为空的行），照搬即可。
  · ``type`` 用的是 ``"dir"`` / ``"file"``，而 ``serialize_file_detail`` 的
    ``file_type`` 用的是 ``"folder"`` / MIME / ``"unknown"`` —— **两套词表，故意不统一**，
    前端两个视图分别按各自的值分支。
  · ``serialize_view_history`` 的 ``timestamp`` 是 ``"%Y-%m-%d %H:%M:%S"`` 本地格式串，
    而别处一律 ``isoformat()``。同样是前端在按各自的格式解析，别对齐。
  · ``serialize_file_detail`` 的 ``file_size`` 在目录上出 None（不是 0），
    前端靠它区分「目录不显示大小」。
"""

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
