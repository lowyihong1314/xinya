"""文件管理器：目录树 / 浏览 / 上传下载 / 权限 / 回收站 / 分享链接。

原 backend/app/filesystem/routes.py（Flask Blueprint，变量名 ``files_bp``，
挂在 ``/api/files``）。包名叫 filesystem、挂载前缀是 **/files** —— 两者不同名是既有事实，
前端 400 多行 ``apiFetch("/files/...")`` 按的是后者。

只做框架适配：装饰器、参数提取、响应构造。校验顺序、状态码、中文错误文案、响应体的
键名与嵌套形状全部逐字照搬 —— 前端 ``parseJson`` 读的是 ``data.error``，
所以每一条失败出口都必须是 ``{"error": "<原文案>"}``，不是新信封。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了（BASE_PATH 已经区分项目，见 docs/flask_to_fastAPI/11），
其余路径一个字符没动：

    GET    /api/files/history/views              → /files/history/views
    GET    /api/files/tree                       → /files/tree
    POST   /api/files/query                      → /files/query
    GET    /api/files/items/<int:id>             → /files/items/{file_id:int}
    GET    /api/files/items/<int:id>/permissions → /files/items/{file_id:int}/permissions
    GET    /api/files/items/<int:id>/content     → /files/items/{file_id:int}/content
    POST   /api/files/items/archive              → /files/items/archive
    POST   /api/files/uploads                    → /files/uploads
    GET    /api/files/directories/detail         → /files/directories/detail
    POST   /api/files/directories                → /files/directories
    PATCH  /api/files/directories/rename         → /files/directories/rename
    PUT    /api/files/directories/permissions    → /files/directories/permissions
    DELETE /api/files/directories                → /files/directories
    DELETE /api/files/items                      → /files/items
    POST   /api/files/items/batch_delete         → /files/items/batch_delete
    GET    /api/files/search                     → /files/search
    PATCH  /api/files/items/<int:id>/rename      → /files/items/{file_id:int}/rename
    POST   /api/files/items/move                 → /files/items/move
    POST   /api/files/shares                     → /files/shares
    GET    /api/files/trash                      → /files/trash
    POST   /api/files/trash/<int:id>/restore     → /files/trash/{trash_id:int}/restore
    DELETE /api/files/trash/<int:id>             → /files/trash/{trash_id:int}
    DELETE /api/files/trash                      → /files/trash
    DELETE /api/files/permissions/<int:id>       → /files/permissions/{permission_id:int}
    GET    /api/files/shares/<token>/download    → /files/shares/{token}/download

``create_share`` 返回的 ``share_url`` 里那段写死的 ``/api/files/...`` 也跟着去掉了
（见 service.py 的注释）；它仍然是应用内裸路径，前缀由前端 publicUrl() 补。

── 四条搬迁时必须这么写的事 ──────────────────────────────────────────

① **本文件不能写 ``from __future__ import annotations``。**
   core.auth 的装饰器用 functools.wraps 包过，FastAPI 求值注解时用的是
   core/auth.py 的命名空间；开了这行注解全变字符串，会跑去那边找 ``Optional``
   而 NameError（启动即挂）。

② **路由函数一律 ``def``（同步），不写 async def。**
   底下是同步 SQLAlchemy + 读写磁盘 + ffmpeg 子进程，写成 async 会把 worker 的
   事件循环焊死。FastAPI 会自动把 def 路由丢进线程池。

③ **装饰器顺序：``@router.xxx`` 在上、``@login_required`` 在下。**
   顺序反了的话 FastAPI 注册的是未鉴权的原函数。

④ **路径参数写 ``{file_id:int}``（Starlette 转换器），不是只靠 ``: int`` 注解。**
   这是行为问题不是风格问题：Flask 的 ``<int:file_id>`` 在参数不是整数时是
   **不匹配** → 404；只靠注解的话 FastAPI 会先匹配上再校验失败 → **422**，
   前端的 404 分支会失效。带上转换器之后，``/items/archive`` / ``/items/move`` /
   ``/items/batch_delete`` 这几条具名路径在**匹配阶段**就不会被 ``{file_id:int}`` 吃掉，
   所以下面的注册顺序可以原样保持 routes.py 的样子（便于对照 diff）。

── 与 Flask 的已知差异（都不构成前端可见的行为变更）──────────────────

· 原代码用的是 ``request.get_json()``（**没有** silent=True）：Flask 在没有 body /
  Content-Type 不对 / body 不是合法 JSON 时抛 400 或 415 的 **HTML 错误页**。
  这里 ``Optional[dict] = Body(default=None)`` 在「没有 body」时落到 None →
  ``payload or {}`` → 走各自的「Missing xxx」400 JSON 分支；body 不是合法 JSON 时
  落到 FastAPI 的 422 JSON。两边前端都解析不出业务字段，等价。
· ``get_file_detail`` / ``send_file_content`` 里的 ``File.query.get_or_404`` 在
  FastAPI 下抛 HTTPException(404)，响应体从 werkzeug 的 HTML 错误页变成
  ``{"status": "error", "message": ...}``（见 core/db.py 模块头）。前端这两处读的是
  ``data.error``，两种形状都取不到值 → 落到 "Request failed" 兜底文案，行为一致。
· ``/items/archive`` 的 zip 从 ``send_file(BytesIO)`` 换成 ``Response(bytes)``：
  zip 本来就是整个在内存里拼好的，没有流式可言，Content-Length / 文件名头都一样。

★ 一处「看着该修、故意保留」的地方：

  ``/history/views`` 的 ``file_id`` 传了之后，service 只按 file_id 过滤、**不限制
  user_id** —— 任何登录用户都能读到别人对该文件的浏览记录。这是原行为。
  TODO(越权，勿顺手修): 收口前要先确认没有页面在靠「看得到全部浏览者」做展示。
"""

from typing import List, Optional

from fastapi import APIRouter, Body, File, Form, UploadFile
from fastapi.responses import Response

from backend.core.auth import current_user, login_required
from backend.core.config import settings
from backend.core.db import db
from backend.core.responses import json_response

from backend.api.filesystem.service import (
    archive_files,
    batch_delete_items,
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
    purge_all_trash,
    purge_trash,
    remove_permission,
    rename_directory,
    rename_file,
    restore_trash,
    search_files,
    send_file_content,
    set_directory_permission,
    upload_entries,
)

# prefix 用 settings.api_prefix 拼而不是写死 "/files"：api_prefix 今天是空串，
# 但配置项留着是为了需要时还能整体把前缀加回来 —— 写死的话那次改配置只会改到一半。
# 注意是 /files 不是 /filesystem：包名和挂载前缀本来就不同名，见模块头。
router = APIRouter(prefix=f"{settings.api_prefix}/files", tags=["filesystem"])

# 请求体的取法对应 Flask 的 ``request.get_json() or {}``：不带 embed，所以前端发的
# 整个 JSON 体原样进到这个参数；没有 body 时落到 None，路由里 ``payload or {}``
# 补成空字典，后面的校验分支自然走各自的 400。
_JSON_BODY = Body(default=None)


def _error(message, code):
    """等价 Flask 版的 ``jsonify({"error": message}), code``。

    键名是 ``error``（不是 message、不是新信封的 ``error.message``）——
    前端 api.ts 的 parseJson 读的就是 ``data.error``，换形状 = 弹窗里只剩
    "Request failed"。
    """
    return json_response({"error": message}, code)


def _int_arg(raw):
    """对应 Flask 的 ``request.args.get(name, type=int)``。

    关键是「转不动就当没传」：Flask 转换失败时静默回 default，而把参数直接声明成
    ``Optional[int]`` 会让 ``?file_id=abc`` 变成 422。查询参数一律声明成 ``str = ""``
    再在这里手工转，就是为了守住这个分支。
    """
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# 浏览历史 / 目录树 / 目录列表
# --------------------------------------------------------------------------- #
@router.get("/history/views")
@login_required
def get_history_views(file_id: str = ""):
    # file_id 解不出整数（含缺省）时是 None → service 里 ``if file_id:`` 为假 →
    # 按当前用户过滤。"0" 会转成 0，同样为假，走同一支 —— 与 Flask 一致。
    return json_response({"histories": get_view_histories(current_user.id, file_id=_int_arg(file_id))})


@router.get("/tree")
@login_required
def get_tree():
    return json_response(build_tree(current_user.id))


@router.post("/query")
@login_required
def query_directory(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    # 是 ``"path" not in data`` 而不是 ``not data.get("path")``：
    # 显式传 ``{"path": ""}`` 会**通过**这一关，交给 normalize_path 变成 "/"（根目录）。
    # 前端就是靠这个行为浏览根目录的，别改成真值判断。
    if "path" not in data:
        return _error("Missing path", 400)
    try:
        return json_response(list_directory(data["path"], current_user.id))
    except ValueError as exc:
        return _error(str(exc), 400)


# --------------------------------------------------------------------------- #
# 单个条目：详情 / 权限 / 内容 / 打包下载
# --------------------------------------------------------------------------- #
@router.get("/items/{file_id:int}")
@login_required
def get_item_detail(file_id: int):
    try:
        return json_response(get_file_detail(file_id, current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)


@router.get("/items/{file_id:int}/permissions")
@login_required
def get_item_permissions(file_id: int):
    try:
        return json_response(list_permissions(file_id, current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)


@router.get("/items/{file_id:int}/content")
@login_required
def get_item_content(file_id: int):
    try:
        return send_file_content(file_id, current_user.id)
    except PermissionError as exc:
        return _error(str(exc), 403)
    except ValueError as exc:
        return _error(str(exc), 400)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except Exception as exc:
        # 兜底 500：ffmpeg 转 wma 失败（CalledProcessError）会落到这里，
        # 并且把 **异常原文** 发给前端。照搬 —— 前端的错误提示在显示它。
        return _error(str(exc), 500)


@router.post("/items/archive")
@login_required
def download_archive(payload: Optional[dict] = _JSON_BODY):
    file_ids = (payload or {}).get("ids", [])
    if not file_ids:
        return _error("没有选择文件", 400)
    try:
        memory_file, count = archive_files(file_ids, current_user.id)
        # 原来是 send_file(BytesIO, mimetype="application/zip", as_attachment=True,
        # download_name=f"files_{count}.zip")。zip 本来就整个在内存里，直接发字节即可，
        # Response 会自动带 Content-Length；文件名是纯 ASCII，不需要 RFC 5987 编码。
        return Response(
            content=memory_file.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="files_{count}.zip"'},
        )
    except PermissionError as exc:
        return _error(str(exc), 403)


# --------------------------------------------------------------------------- #
# 上传
# --------------------------------------------------------------------------- #
@router.post("/uploads")
@login_required
def upload_items(
    # 对应 ``request.files.getlist("files")`` / ``request.form.getlist("relative_paths[]")``：
    # 都给默认空列表，**不能声明成必填** —— 缺字段时 Flask 回的是空列表（然后走
    # upload_entries 的「只建目录」分支），声明必填会变成 422。
    # 字段名字面量就带方括号，所以 relative_paths 必须走 alias。
    files: List[UploadFile] = File(default=[]),
    relative_paths: List[str] = Form(default=[], alias="relative_paths[]"),
    folder_location: str = Form(default="/"),
):
    try:
        return json_response(
            upload_entries(
                files,
                relative_paths,
                folder_location,
                current_user.id,
            )
        )
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except Exception as exc:
        # 上传是「先写盘再写库」，中途抛异常必须回滚，否则这个请求脏掉的 session
        # 会被下一个复用它的请求带着走。
        db.session.rollback()
        return _error(str(exc), 500)


# --------------------------------------------------------------------------- #
# 目录：详情 / 新建 / 重命名 / 权限 / 删除
# --------------------------------------------------------------------------- #
@router.get("/directories/detail")
@login_required
def get_directory_detail(path: str = ""):
    # Flask 那边缺参数时是 None，这里是 ""，两者在 ``if not path`` 下等价。
    if not path:
        return _error("Missing path", 400)
    try:
        return json_response(build_directory_detail(path, current_user.id))
    except FileNotFoundError as exc:
        return _error(str(exc), 404)


@router.post("/directories")
@login_required
def create_directory_route(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    # 这一条是 ``not data.get("path")``（和 /query 那条的 ``not in`` 不同）：
    # 空字符串会被拦在这里，不会走到「根目录不能重复创建」。两条的差异是有意的。
    if not data.get("path"):
        return _error("Missing path", 400)
    try:
        return json_response(create_directory(data["path"], current_user.id))
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except ValueError as exc:
        return _error(str(exc), 400)


@router.patch("/directories/rename")
@login_required
def rename_directory_route(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    # 不校验 old_path / new_name 是否为空：缺了就交给 service，
    # normalize_path(None) → "/" → 抛 FileNotFoundError("Directory not found") → 404。
    try:
        return json_response(rename_directory(data.get("old_path"), data.get("new_name"), current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except Exception as exc:
        db.session.rollback()
        return _error(str(exc), 500)


@router.put("/directories/permissions")
@login_required
def update_directory_permissions(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    required = ["type", "id", "permission", "dir_path"]
    # ★ 这一条的失败出口是 ``{"status": "error", "message": ...}``，**和本模块其它条
    #   不一样**（别的都是 {"error": ...}）。照搬 —— 前端这个弹窗读的是 message。
    #   注意 ``data[key] in [None, ""]`` 用的是 ==，所以 id=0 会被判成缺参数
    #   （0 == False，但 0 不 == None/""，其实拦不住 0）—— 原样保留这份绕。
    if any(key not in data or data[key] in [None, ""] for key in required):
        return json_response({"status": "error", "message": "Missing parameters"}, 400)
    try:
        return json_response(
            set_directory_permission(
                data["dir_path"],
                data["type"],
                data["id"],
                data["permission"],
                current_user.id,
            )
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.delete("/directories")
@login_required
def delete_directory_route(payload: Optional[dict] = _JSON_BODY):
    path = (payload or {}).get("path")
    if not path:
        return _error("Missing path", 400)
    try:
        return json_response(delete_directory(path, current_user.id))
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except Exception as exc:
        # PermissionError 没有单独分支，落到这里 → **500**（不是 403）。
        # 也就是说删一个没权限的目录，前端看到的是 500 + "没有权限删除 /x/y"。照搬。
        db.session.rollback()
        return _error(str(exc), 500)


# --------------------------------------------------------------------------- #
# 批量删除 / 搜索
# --------------------------------------------------------------------------- #
@router.delete("/items")
@login_required
def delete_items_route(payload: Optional[dict] = _JSON_BODY):
    ids = (payload or {}).get("ids", [])
    if not ids:
        return _error("No file ids provided", 400)
    try:
        return json_response(delete_files(ids, current_user.id))
    except Exception as exc:
        db.session.rollback()
        return _error(str(exc), 500)


@router.post("/items/batch_delete")
@login_required
def batch_delete_route(payload: Optional[dict] = _JSON_BODY):
    items = (payload or {}).get("items", [])
    if not items:
        return _error("没有选择项目", 400)
    # batch_delete_items 自己吞掉每一项的异常，永远返回 200 + 逐项结果，
    # 所以这里没有 try —— 前端按 results[].success 展示。
    return json_response(batch_delete_items(items, current_user.id))


@router.get("/search")
@login_required
def search_route(q: str = "", limit: str = ""):
    q = (q or "").strip()
    if not q:
        return _error("缺少搜索词", 400)
    # ``request.args.get("limit", 100, type=int)``：缺省或转不动都回 100。
    limit_value = _int_arg(limit)
    if limit_value is None:
        limit_value = 100
    return json_response(search_files(q, current_user.id, limit=max(1, min(limit_value, 200))))


# --------------------------------------------------------------------------- #
# 文件：重命名 / 移动 / 分享
# --------------------------------------------------------------------------- #
@router.patch("/items/{file_id:int}/rename")
@login_required
def rename_item_route(file_id: int, payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    if not data.get("new_name"):
        return _error("Missing new_name", 400)
    try:
        return json_response(rename_file(file_id, data["new_name"], current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except ValueError as exc:
        return _error(str(exc), 400)


@router.post("/items/move")
@login_required
def move_item_route(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    if not data.get("dir_path") or not data.get("file_path"):
        return _error("Missing dir_path or file_path", 400)
    try:
        return json_response(move_file(data["file_path"], data["dir_path"], current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except FileExistsError as exc:
        return _error(str(exc), 409)
    except Exception as exc:
        db.session.rollback()
        return _error(str(exc), 500)


@router.post("/shares")
@login_required
def create_share_route(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    # minutes / credit 的默认值在**这里**（10 / 1），不在 service 的签名上；
    # 显式传 null 时进去的就是 None，SharePublic 那两列 nullable=False → commit 抛 500。
    # 照搬，前端两个入口都会带上这两个字段。
    try:
        return json_response(
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


# --------------------------------------------------------------------------- #
# 回收站
# --------------------------------------------------------------------------- #
@router.get("/trash")
@login_required
def get_trash():
    return json_response(list_trash(current_user.id))


@router.post("/trash/{trash_id:int}/restore")
@login_required
def restore_trash_route(trash_id: int):
    try:
        return json_response(restore_trash(trash_id, current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except FileExistsError as exc:
        return _error(str(exc), 409)


@router.delete("/trash/{trash_id:int}")
@login_required
def purge_trash_route(trash_id: int):
    try:
        return json_response(purge_trash(trash_id, current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)


@router.delete("/trash")
@login_required
def purge_all_trash_route():
    # 没有 try：purge_all_trash 里逐条 purge_trash 抛出来的 PermissionError /
    # FileNotFoundError 会一路冒泡成 500。实际上取的就是自己的条目，触发不到。照搬。
    return json_response(purge_all_trash(current_user.id))


# --------------------------------------------------------------------------- #
# 权限删除 / 公开分享下载
# --------------------------------------------------------------------------- #
@router.delete("/permissions/{permission_id:int}")
@login_required
def delete_permission_route(permission_id: int):
    try:
        return json_response(remove_permission(permission_id, current_user.id))
    except PermissionError as exc:
        return _error(str(exc), 403)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)


@router.get("/shares/{token}/download")
def download_share_route(token: str):
    """★ 本模块唯一**不需要登录**的路由（分享链接就是给外部人点的）。

    鉴权完全靠 token 本身 + SharePublic.can_download()（有效期 + 剩余次数）。
    别顺手加 @login_required：加了分享链接就失效了。
    """
    try:
        return download_shared_file(token)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except PermissionError as exc:
        return _error(str(exc), 403)
    except ValueError as exc:
        return _error(str(exc), 400)
