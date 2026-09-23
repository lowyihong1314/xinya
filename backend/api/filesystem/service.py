"""文件管理器的业务逻辑（原 backend/app/filesystem/services.py，逐行照搬）。

存储模型：库里 ``files`` 表存**逻辑路径**（``/部门/2026/报销.pdf``），落盘位置是
``STORAGE_ROOT`` 拼上同一串路径 —— 也就是说「目录」在库里是一行 is_folder=True 的记录，
在盘上是一个真目录，两边必须同步。删除走回收站：条目搬到 ``TRASH_ROOT/<trash_id>``，
库里的 files 行连同权限/历史/分享一起物理删除，恢复时按 FileTrash.path 重建。

搬迁只动了框架相关的四处，其余一个字节没改 —— 校验顺序、中文错误文案、返回字典的
键名与嵌套形状都是前端在按着分支的契约：

  ① ``flask.send_file`` → ``fastapi.responses.FileResponse``。mimetype 不再让框架猜，
     而是**显式算好再传**：werkzeug 的 send_file 猜不出来时回落
     ``application/octet-stream``，starlette 的 FileResponse 回落 ``text/plain``，
     不显式给的话没有后缀的文件会从二进制下载变成文本。
  ② ``flask.after_this_request`` 清理 /tmp → ``BackgroundTask``。Flask 那边是在响应对象
     建好之后、正文发出之前跑（能删掉是因为 werkzeug 早就把 fd 开着了，Linux 上
     unlink 一个打开的文件不影响读）；BackgroundTask 是**正文发完之后**跑，对客户端
     完全等价，而且更稳。
  ③ ``FileStorage.save(path)`` → ``_save_upload()``。starlette 的 UploadFile 没有 save()。
  ④ ``backend.models.db`` → ``backend.core.db.db``（同一个对象，少走一层包初始化），
     包内 import 从 ``app.filesystem.*`` 改成 ``api.filesystem.*``。
     原来 flask 那行还引了 ``jsonify`` 但全文没用到，跟着 flask 一起删掉了。
     ``get_file_detail`` 里那句函数内 ``import serialize_file_detail`` 提到了文件顶部 ——
     同模块、无环，延迟 import 没有任何作用，提上去不改变行为。

★ 一批「看着像 bug、故意保留」的地方，改之前先想清楚：

  ① ``Department`` 导进来了但全文没用到。留着是因为它是本模块的既有导出面
     （``from ...services import Department`` 这种写法历史上出现过），删掉属于单独的
     清理动作，不在本次搬迁范围内。

  ② ``get_view_histories`` 传了 file_id 就**只按 file_id 过滤、不再限制 user_id** ——
     任何登录用户都能读到别人对该文件的浏览记录。另外 ``file_id=0`` 因为
     ``if file_id:`` 为假会落到「按自己过滤」那一支。
     TODO(越权，勿顺手修): 收口前要先确认前端没有页面在靠「看得到全部浏览者」做展示。

  ③ ``list_directory(path="/")`` 和 ``get_accessible_files`` 都是**把 files 全表拉进内存**
     再逐行跑 ``check_permission``（每行还会各查一次 FilePermission）。文件多起来这是
     O(N) 次查询。照搬不做批量化：``_filter_readable`` 已经是那份批量版，两边语义要
     完全一致才敢换，而 check_permission 里「owner 直接放行」「read_public 兜底」几条
     顺序很容易在改写时走样。

  ④ ``path_exists`` 是「库里有行 **或** 盘上有文件」。于是盘上留下的孤儿文件会永久挡住
     同名路径的创建（409「目录已存在」/「目标文件已存在」），而界面上看不到它。
     这是有意的防覆盖，保留。

  ⑤ ``rename_directory`` 用 ``file_obj.path.replace(old_prefix, new_prefix, 1)`` 改子项路径。
     ``replace`` 找的是**第一次出现的位置**，不保证在开头 —— 路径里若再次出现同一段
     前缀（``/a/b/a/b/x``），替换点可能不是我们想要的那个。现实里前缀一定在开头，
     所以没出过事。TODO(勿顺手修): 要改就改成切片 ``new_prefix + path[len(old_prefix):]``，
     并且必须连同 ``files`` 的取法一起回归测试。

  ⑥ 同上函数里 ``add_history(folder_obj.id if folder_obj else files[0].id if files else 1, ...)``
     的最后那个 ``1`` 是写死的文件 id。它是死分支（上面已经 ``if not folder_obj: raise``），
     照抄。

  ⑦ ``set_directory_permission`` 对没有写权限的子项是 ``continue`` **静默跳过**，最后照样
     返回「目录权限批量设置成功」。``delete_files`` 同理（跳过没权限的，只回一个计数）。
     前端因此不会提示「有 3 个文件没改到」。保留。

  ⑧ ``set_directory_permission`` 的 target_type 不是 "user"/"department" 时，user_id 和
     department_id **双双为 None**，于是会命中/写出「公共权限」那种行。路由层只校验
     字段非空、不校验取值，所以这条路径是真能被外部触发的。保留原行为。

  ⑨ ``create_share`` 要求的是 **write** 权限（不是 read）—— 只读用户分不出去链接。
     另外 ``download_shared_file`` 是**先把 used 加一并 commit，再返回文件**：下载中途
     断掉也算用掉一次额度。两处都保留。

  ⑩ ``purge_all_trash`` 是循环调用 ``purge_trash``，每条各自 commit，中途失败会留下
     「删了一半」的状态。``batch_delete_items`` 也是逐项 commit —— 那一条是**有意**的
     （注释在函数里），因为 move_to_trash 会先搬磁盘文件，整批回滚救不回已经搬走的。

  ⑪ ``restore_trash`` 在 ``db.session.delete(trash_entry)`` + commit **之后**还读
     ``trash_entry.path``。能跑通是因为被删对象 commit 时已经从 identity map 里摘掉、
     不会被 expire_on_commit 过期，属性值还在 ``__dict__`` 里。很脆，但 Flask 时代就是
     这么跑的，DB 垫片用的是同一套 session 语义，行为不变。

  ⑫ ``search_files`` 先把候选硬截到 500 条再在 Python 里按文件名二次过滤，所以
     ``truncated`` 反映的是「权限过滤后超过 limit」，**不包含**被那个 500 截掉的部分。
     搜索结果可能少东西且不自知。保留。
"""

import io
import mimetypes
import os
import secrets
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import joinedload
from starlette.background import BackgroundTask

# api_prefix 只在拼 share_url 时用到：URL 里的 /api 那一段整体去掉了，
# 但配置项留着是为了需要时还能整体把前缀加回来 —— 写死的话那次改配置只会改到一半。
from backend.core.config import settings
# 原来是 from backend.models import db —— 那是 core.db 里同一个对象的再导出。
from backend.core.db import db
from backend.models.file_manager import (
    File,
    FileHistory,
    FilePermission,
    FileTrash,
    SharePublic,
    ViewHistory,
)
from backend.models.user_data import Department, User  # noqa: F401  （Department 见模块头①）

from backend.api.filesystem.paths import STORAGE_ROOT, TRASH_ROOT
from backend.api.filesystem.serializers import (
    serialize_file_detail,
    serialize_file_item,
    serialize_view_history,
)


# --------------------------------------------------------------------------- #
# 路径工具
# --------------------------------------------------------------------------- #
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
    # 库里有行 **或** 盘上有东西都算占用，见模块头④。
    return query.first() is not None or absolute_path(logical_path).exists()


def _save_upload(upload, target_path):
    """等价于 werkzeug ``FileStorage.save(path)``（starlette 的 UploadFile 没有 save()）。

    先 seek(0) 是因为 UploadFile 的游标可能已经被别处读过；werkzeug 的 save() 是从
    当前位置开始 copy 的，但这里只有我们一个消费者，回到 0 更稳
    （SpooledTemporaryFile 在某些状态下不支持 seek，忽略即可）。
    """
    source = upload.file
    try:
        source.seek(0)
    except (OSError, ValueError):
        pass
    with open(target_path, "wb") as target:
        shutil.copyfileobj(source, target)


# --------------------------------------------------------------------------- #
# 权限 / 历史
# --------------------------------------------------------------------------- #
def check_permission(user_id, file_obj, required):
    if user_id == file_obj.owner_id:
        return True

    user = User.query.get(user_id)
    if not user:
        return False

    perm = FilePermission.query.filter_by(file_id=file_obj.id, user_id=user.id).first()
    if perm:
        # read_public 也算「可读」：它是挂在文件上的公开标记，不是挂在某个人身上的。
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

    # 最后一道：文件上只要存在任意一条 read_public，所有人都能读。
    # 注意这条**只对 read 生效**，写权限没有对应的兜底。
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
    """在同一个目录里找一个「已有文件」当权限模板。

    找的是**同级的普通文件**（不是目录），按 created_at / id 升序取第一个 —— 也就是
    「这个目录里最早上传的那份文件」。新上传的文件照抄它的权限，这样一个共享目录里
    后传进来的文件不会突然变成只有自己可见。
    """
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
        # like 是带子孙的，这里再手工筛掉「还带斜杠」= 更深层的那些，只留同级。
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

    # 注意：完全照抄模板，**不额外给上传者加 read_write**。
    # 所以往一个自己没有写权限的共享目录上传文件后，上传者可能立刻就改不动它了。
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
        # 传了 file_id 就只按文件过滤，不再限制 user_id —— 见模块头②。
        query = query.filter_by(file_id=file_id)
    else:
        query = query.filter_by(user_id=user_id)
    return [serialize_view_history(item) for item in query.order_by(ViewHistory.viewed_at.desc()).limit(limit).all()]


def get_accessible_files(user_id):
    files = File.query.options(joinedload(File.owner)).all()
    return [file_obj for file_obj in files if check_permission(user_id, file_obj, "read")]


# --------------------------------------------------------------------------- #
# 目录树 / 目录列表
# --------------------------------------------------------------------------- #
def build_tree(user_id):
    directories = set()
    files = []
    for file_obj in get_accessible_files(user_id):
        path_str = file_obj.path.strip("/")
        if not path_str:
            continue
        parts = path_str.split("/")
        if len(parts) > 1:
            # 从子项的路径里**反推**出中间各级目录，所以哪怕库里缺了目录行，
            # 树上也不会断层。
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
            # 深层子项：只把它的第一段登记成目录。setdefault 而不是赋值 ——
            # 上面那一支（真有目录行）写进去的条目优先，别被这里覆盖。
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

    return serialize_file_detail(file_obj, permissions, histories)


# --------------------------------------------------------------------------- #
# 下载
# --------------------------------------------------------------------------- #
def _cleanup_temp_file(temp_path):
    """BackgroundTask 用：正文发完之后删掉转码出来的临时 mp3。

    原实现是 ``@after_this_request`` 里 ``os.remove`` + 吞掉所有异常，这里保持同样的
    「删不掉也不能影响响应」语义 —— BackgroundTask 抛异常会被 starlette 记成 500 日志，
    而那时正文其实已经发完了，只会污染日志。
    """
    try:
        os.remove(temp_path)
    except Exception:
        pass


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
    # 标准库没有 heic，补一条；每次调用都注册一次是幂等的，照搬。
    mimetypes.add_type("image/heic", ".heic")
    mime_type, _ = mimetypes.guess_type(str(path))
    if mime_type is None:
        mime_type = "application/octet-stream"

    if ext == ".wma":
        # 浏览器普遍不认 wma，落盘转一份 mp3 再发。ffmpeg 失败时 check=True 会抛
        # CalledProcessError，由路由层的兜底 except 转成 500 —— 与 Flask 时代一致。
        tmp_mp3_path = f"/tmp/{uuid.uuid4().hex}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(path), "-acodec", "libmp3lame", "-ab", "192k", tmp_mp3_path],
            check=True,
        )

        return FileResponse(
            tmp_mp3_path,
            media_type="audio/mpeg",
            filename=Path(download_name).stem + ".mp3",
            background=BackgroundTask(_cleanup_temp_file, tmp_mp3_path),
        )

    # filename= 会带出 Content-Disposition: attachment（等价于 Flask 的
    # as_attachment=True + download_name），非 ASCII 文件名由 starlette 按 RFC 5987 编码。
    return FileResponse(path, media_type=mime_type, filename=download_name)


def archive_files(file_ids, user_id):
    """把选中的若干条打成一个 zip（内存里）。返回 (BytesIO, 条目数)。

    注意：``file_ids`` 里查不到的 id 会被**静默忽略**，所以全部传错时会得到一个空 zip
    而不是报错；count 也是「查到的条数」，不是「传进来的条数」。保留原行为。
    """
    files = File.query.filter(File.id.in_(file_ids)).all()
    for file_obj in files:
        if not check_permission(user_id, file_obj, "read"):
            raise PermissionError(f"没有权限访问 {file_obj.path}")

    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_obj in files:
            path = absolute_path(file_obj.path)
            if file_obj.is_folder and path.exists():
                # 目录带完整层级进包；普通文件只放 basename（平铺在包根）。
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


# --------------------------------------------------------------------------- #
# 创建 / 上传
# --------------------------------------------------------------------------- #
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
    # 逐级补齐父目录的库记录：``/a/b/c`` 会顺手把 /a、/a/b 也建出来。
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
        # 只传了 relative_paths[] 没传 files = 「建空目录」模式（拖一个空文件夹进来）。
        # 这一支用 strip("/")，下面那支用 lstrip("/") —— 不一致但照搬。
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

    # zip() 在短的一边截断：files 比 relative_paths 多时多出来的文件会被**悄悄丢掉**。
    # 前端两个上传入口都是成对 append 的，所以长度总是相等。照搬。
    for uploaded_file, relative_path in zip(files, relative_paths):
        normalized_relative = relative_path.lstrip("/").replace("\\", "/")
        logical_path = child_path(base_path, normalized_relative)
        if File.query.filter_by(path=logical_path).first():
            raise FileExistsError(f"文件已存在: {logical_path}")
        abs_path = absolute_path(logical_path)
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        _save_upload(uploaded_file, abs_path)

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


# --------------------------------------------------------------------------- #
# 目录详情 / 重命名 / 移动
# --------------------------------------------------------------------------- #
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
        # abs_path 把服务器的真实磁盘路径吐给了前端。属于信息泄露，但界面上在显示它，
        # 去掉就是可见的行为变更。TODO(勿顺手修): 要拿掉得先改前端的目录属性面板。
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

    # 目录本身 + 每一个子项都要有写权限，**有一个没有就整体拒绝**（不是跳过）。
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

    # replace(..., 1) 见模块头⑤。
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

    # new_name 没过 secure_filename，靠 normalize_path 把 ".." 之类留在路径段里 ——
    # 于是 "../x" 会变成一个字面上带 ".." 的逻辑路径，absolute_path 拼出来就跳出
    # STORAGE_ROOT 了。TODO(路径穿越，勿顺手修): 修它会改变已有的重命名结果，
    # 需要和前端的文件名校验一起收口。
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
    # action 写的是 "move" 而不是 "rename" —— 历史记录里看不出这是一次重命名。照搬。
    add_history(file_obj.id, user_id, "move", old_path=old_path, new_path=new_logical_path)
    db.session.commit()
    return {"success": True, "new_path": new_logical_path}


def move_file(file_path, dir_path, user_id):
    source_path = normalize_path(file_path)
    target_dir = normalize_path(dir_path)
    file_obj = File.query.filter_by(path=source_path).first()
    if not file_obj:
        raise FileNotFoundError("File not found")
    if not check_permission(user_id, file_obj, "write"):
        raise PermissionError("No permission for file")

    # 目标目录**没有库记录时不校验权限**（dir_obj 为 None 直接放行）。
    # 也就是说可以往一个不存在的目录里移动，磁盘目录由下面的 mkdir 顺手建出来。保留。
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
    # 只改了这一行的 path：移动一个**目录**时子项路径不会跟着变（move_file 本来就只给
    # 文件用，前端也只在文件上开放这个操作）。目录请走 rename_directory。
    add_history(file_obj.id, user_id, "move", old_path=old_path, new_path=new_logical_path)
    db.session.commit()
    return {"success": True, "new_path": new_logical_path}


# --------------------------------------------------------------------------- #
# 权限设置
# --------------------------------------------------------------------------- #
def set_directory_permission(dir_path, target_type, target_id, permission, user_id):
    normalized = normalize_path(dir_path)
    files = get_subtree_files(normalized)
    for file_obj in files:
        if not check_permission(user_id, file_obj, "write"):
            continue  # 静默跳过，见模块头⑦
        existing = FilePermission.query.filter_by(
            file_id=file_obj.id,
            # target_type 不是 user/department 时两边都是 None，见模块头⑧
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


# --------------------------------------------------------------------------- #
# 删除 / 回收站
# --------------------------------------------------------------------------- #
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
    # 整棵子树都要有写权限，缺一个就整体抛 —— 不会出现「删了一半」。
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

    # 磁盘条目整个搬到 TRASH_ROOT/<trash_id>，所以回收站里同名文件不会互相覆盖。
    if abs_path.exists():
        shutil.move(str(abs_path), str(trash_path(trash_entry.id)))

    # 快照一旦进了回收站就不该再依赖那一行活着的 ``files`` 记录，
    # 否则紧接着删除该行会撞上外键约束。
    trash_entry.file_id = None

    _delete_related_records([item.id for item in subtree_files])
    # 按路径长度倒序删：先删最深的子项，避免依赖父项的约束在中途报错。
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
        # 没有写权限的**静默跳过**（不报错），见模块头⑦。
        if check_permission(user_id, file_obj, "write"):
            deleted_count += move_to_trash(file_obj, user_id)
    db.session.commit()
    return {"success": True, "deleted": deleted_count}


def list_trash(user_id):
    # 按 owner_id 过滤，不是 deleted_by：别人删掉我的文件，出现在**我**的回收站里。
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
    """逐项删除，**不整批回滚**：返回每一项的成功/失败。

    永远返回 200 —— 前端按 results 里每条的 success 字段展示，不看状态码。
    """
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
    # 逐条调 purge_trash，每条各自 commit：中途失败会留下删了一半的状态，见模块头⑩。
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
    # commit 之后还读 trash_entry.path，见模块头⑪。
    return {"success": True, "restored": restored_count, "path": trash_entry.path}


def _rebuild_restored_path(logical_path, owner_id):
    """按磁盘上的真实内容重建 files 记录。

    ★ 重建出来的记录一律**只给 owner 一条 read_write**（走 add_default_permission），
      原来挂在这些文件上的共享权限在 move_to_trash 时就被物理删掉了，恢复不回来。
      这是既有行为：恢复之后需要重新配权限。
    """
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


# --------------------------------------------------------------------------- #
# 分享链接
# --------------------------------------------------------------------------- #
def create_share(file_id, minutes, credit, user_id):
    file_obj = File.query.get(file_id)
    if not file_obj:
        raise FileNotFoundError("File not found")
    # 分享要求的是 **write**（不是 read），见模块头⑨。
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
        # 旧值是写死的 "/api/files/shares/{token}/download"。这里只去掉 /api 那一段 ——
        # 仍然是**应用内裸路径**，不带 BASE_PATH。前端 useFileSystemController 拿到后会
        # 过一次 publicUrl()（幂等 + 绝对地址原样放行），自己补前缀和 origin。
        # 想改成后端直接返回绝对地址的话，要把 request 一路传进来走 core.urls.public_url。
        "share_url": f"{settings.api_prefix}/files/shares/{token}/download",
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

    # 先扣额度再发文件：下载中途断掉也算用掉一次，见模块头⑨。
    share.used += 1
    db.session.commit()

    download_name = os.path.basename(file_obj.path)
    # 原来是 send_file(abs_path, as_attachment=True, download_name=...)，不传 mimetype ——
    # werkzeug 会按 download_name 猜、猜不出回落 application/octet-stream。
    # starlette 的 FileResponse 猜不出时回落的是 text/plain，所以这里必须显式算一遍，
    # 否则无后缀文件会从「下载」变成「浏览器当纯文本打开」。
    mime_type = mimetypes.guess_type(download_name)[0] or "application/octet-stream"
    return FileResponse(abs_path, media_type=mime_type, filename=download_name)


# --------------------------------------------------------------------------- #
# 搜索
# --------------------------------------------------------------------------- #
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
    # 先转义 LIKE 的通配符再 ilike：不转义的话搜 "%" 会匹配全表。
    escaped = q.replace("\\", r"\\").replace("%", r"\%").replace("_", r"\_")
    candidates = (
        File.query.options(joinedload(File.owner))
        .filter(File.path.ilike(f"%{escaped}%", escape="\\"))
        .order_by(File.updated_at.desc())
        .limit(500)
        .all()
    )
    q_lower = q.lower()
    # 二次过滤：SQL 匹配的是整条路径，这里只认**文件名**命中（目录名命中不算）。
    candidates = [f for f in candidates if q_lower in f.path.rstrip("/").rsplit("/", 1)[-1].lower()]
    readable = _filter_readable(candidates, user_id)
    return {
        "query": q,
        "items": [serialize_file_item(f) for f in readable[:limit]],
        # truncated 只反映「权限过滤后超过 limit」，不含上面那个 500 的硬截断，见模块头⑫。
        "truncated": len(readable) > limit,
    }
