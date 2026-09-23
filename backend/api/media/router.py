"""活动相册：文件分发 / 取图 / 上传 / 旋转 / 删除 / 打包下载 / 爱心。

原 backend/app/media/routes.py 的两个 Flask Blueprint（media_bp + nginx_media_router）。
只做框架适配 —— 校验顺序、状态码、错误文案、响应体的键名与嵌套形状逐字照搬，
业务逻辑在同目录 service.py（那边的 docstring 记着六处"看着像 bug 但故意保留"）。

── URL 对照（旧 → 新）────────────────────────────────────────────────

两个蓝图当年都是 **root 作用域**（``blueprints.py`` 里那个 "root"，不带 ``/api``），
所以路径一个字符没动：

    /media/album_file/<int:file_id>/heart   (POST/GET) → /media/album_file/{file_id:int}/heart
    /media/file/<path:filepath>                        → /media/file/{filepath:path}
    /media/get_event_type/<int:id>                     → /media/get_event_type/{id:int}
    /media/get_event_image/<int:id>/<type>             → /media/get_event_image/{id:int}/{type}
    /media/upload_media                        (POST)  → 同
    /media/rotate_file/<int:file_id>/<int:angle>(POST) → /media/rotate_file/{file_id:int}/{angle:int}
    /media/delete_files                      (DELETE)  → 同
    /media/download_files                      (POST)  → 同
    /media_file/<path:filepath>                        → /media_file/{filepath:path}

★ ``router`` 的 prefix 仍按约定写成 ``f"{settings.api_prefix}/media"``（api_prefix
  今天是空串，等于 "/media"，与 Flask 一致）。但要记住一件事：媒体前缀**将来也不能
  加 /api** —— ``/media_file/`` 那条 nginx location 和库里存的相对路径都咬死了根路径，
  真要整体加前缀时，这一行得单独留在根上。``media_file_router`` 已经是根上的，
  所以它**不带** api_prefix。

★ ``/media_file/<path>`` 生产上由 nginx 直接发（``location /media_file/ { alias …; }``），
  只有 nginx 找不到文件时才回落到这条路由 —— 而"找不到"恰恰是缓存 JPEG 还没生成的
  情况，下面的 _ensure_event_photo_cache_file 就是为这一刻存在的：**它会当场把缓存
  压出来再发**。所以这条路由看着冷门，实际是缩略图第一次访问的主路径，别删。

── 五条迁移硬约束 ────────────────────────────────────────────────────

  ① 本文件**不能写 ``from __future__ import annotations``**：core.auth 的装饰器用
     functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了那一行会在那里找不到 ``Optional`` 而启动即 NameError。
  ② 路由函数一律 ``def``（同步）：底下是同步 ORM、同步 ffprobe/ffmpeg、同步读盘。
     写成 async def 会把 worker 的事件循环焊死（一次 JPEG 压缩几十毫秒，
     一次 ffprobe 可能几百毫秒）。FastAPI 会自动把 def 丢进线程池。
     唯一的 async 是 _upload_media_form 那个依赖 —— 读 body 必须在事件循环里。
  ③ 装饰器顺序保持 Flask 原样：``@login_required`` 在外、``@permission_required`` 在内。
     反过来会把"未登录"的响应从 401 变成 permission_required 的 500，前端的
     重新登录跳转就失效了。
  ④ 路径参数写 ``{file_id:int}``（Starlette 转换器）而不是只靠 ``: int`` 注解：
     Flask 的 ``<int:...>`` 在参数不是整数时是**不匹配** → 404；靠注解会变 422，
     前端的 404 分支会失效。
  ⑤ 不 import flask / werkzeug：secure_filename 取 core.files，safe_join 在 paths.py。

── 与 Flask 的已知差异（都不构成前端可见的行为变更）──────────────────

  · ``abort(404, "…")`` 的响应体从 werkzeug 的 **HTML 错误页**变成
    ``{"status":"error","message":"…"}``（main.py 的 HTTPException 处理器）。
    状态码不变，前端本来也解析不了那张 HTML。
  · 请求体不是合法 JSON 时：Flask 的 ``get_json(silent=True)`` 当成 {} 继续走
    （最终 400），这里落到 FastAPI 的 422。``/delete_files`` 用的是 ``request.json``
    （**没有** silent），Flask 会抛 400 再被那层 try 吞成 **500**；这里是 422。
    三种都是"请求失败"，没有调用方在分这个。
  · 文件响应从 werkzeug 的 send_file 换成 starlette 的 FileResponse。
    ETag 的算法、Last-Modified、``Cache-Control: no-cache``、304、Range
    **全部对齐**（见 _send_file_conditional 的注释），所以浏览器里已经缓存的
    图片在切换后不会全量重下。
"""

import os
import zlib
from datetime import timezone
from email.utils import formatdate, parsedate_to_datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, Form, HTTPException
from starlette.datastructures import UploadFile
from starlette.requests import Request
from starlette.responses import FileResponse, Response

from backend.api.media.constants import IMAGE_EXTS
from backend.api.media.paths import BROKEN_IMAGE_PATH, event_photo_base_dir, event_photo_cache_dir
from backend.api.media.service import (
    album_file_heart_count,
    create_album_file,
    delete_album_file,
    get_album_file,
    get_album_files,
    get_event_image_payload,
    get_event_type_payload,
    resolve_media_path,
    rotate_album_file,
    toggle_album_file_heart,
)
from backend.api.media.utils import (
    JPEG_CACHE_SOURCE_EXTS,
    allowed_file,
    build_zip_from_files,
    ensure_jpeg_cache_file,
    parse_file_ids,
)
from backend.core.auth import current_user, login_required, permission_required
from backend.core.config import settings
from backend.core.db import db
from backend.core.files import secure_filename
from backend.core.responses import json_response

# prefix 用 settings.api_prefix 拼而不是写死：api_prefix 今天是空串，
# 留着配置项是为了需要时还能整体把前缀加回来（但见模块头那条 ★）。
router = APIRouter(prefix=f"{settings.api_prefix}/media", tags=["media"])

# 原 nginx_media_router 蓝图：挂在应用**根**上，不带任何前缀。
# 库里存的是 DATA_ROOT 下的相对路径，前端直接拼 "/media_file/" + 它 —— 这个前缀
# 同时也是一条 nginx location，两边必须一模一样。
media_file_router = APIRouter(tags=["media"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}``：不带 embed，前端发什么形状
# 进来就是什么形状；没有 body / body 是 null 时落到 None，路由里 ``payload or {}``
# 补成空字典，后面的校验分支自然走"缺少访客标识"那一支。
_JSON_BODY = Body(default=None)


def _abort(status_code, detail=None):
    """等价于 Flask 的 ``abort(code)`` / ``abort(code, "描述")``。

    detail 为 None 时 starlette 会填标准短语（404 → "Not Found"），
    最终响应体由 main.py 的处理器渲染成 {"status":"error","message":…}。
    """
    raise HTTPException(status_code=status_code, detail=detail)


# ─────────────────────────── 爱心 ───────────────────────────


def _viewer_identity(request, payload=None):
    """谁在按：登录用户认 user_id，访客认浏览器里的 visitor_token。"""
    if getattr(current_user, "is_authenticated", False):
        return getattr(current_user, "id", None), None
    source = payload if isinstance(payload, dict) else {}
    # body 里的 visitor_token 优先，其次是请求头 —— APK 走头，网页走 body。
    # 截断到 64 字符是**后**于 strip 的，顺序别换（库里那列就是 64）。
    token = str(source.get("visitor_token") or request.headers.get("X-Visitor-Token") or "").strip()
    return None, (token[:64] or None)


@router.post("/album_file/{file_id:int}/heart")
def toggle_album_file_heart_route(request: Request, file_id: int, payload: Optional[dict] = _JSON_BODY):
    """照片点爱心（再按一次取消）。活动公开时访客也能按。"""
    album_file = get_album_file(file_id)
    if not album_file:
        _abort(404)
    event = album_file.event
    # 不公开的活动对访客等于不存在，跟 get_event 保持一致
    if event is not None and not event.is_public and not getattr(current_user, "is_authenticated", False):
        _abort(404)

    data = payload or {}
    user_id, visitor_token = _viewer_identity(request, data)
    if not user_id and not visitor_token:
        return json_response({"status": "error", "message": "缺少访客标识"}, 400)

    hearted, count = toggle_album_file_heart(file_id, user_id=user_id, visitor_token=visitor_token)
    return json_response({"status": "success", "hearted": hearted, "heart_count": count})


@router.get("/album_file/{file_id:int}/heart")
def get_album_file_heart_route(file_id: int):
    # 只读计数，不做公开性校验（原行为：知道 file_id 就能读到数字）。
    if not get_album_file(file_id):
        _abort(404)
    return json_response({"status": "success", "heart_count": album_file_heart_count(file_id)})


# ─────────────────────────── 文件分发 ───────────────────────────


def _event_photo_cache_source_path(filepath):
    """``CACHE/UTBA/event_photo/<code>/<stem>.jpeg`` → 对应的源文件绝对路径。

    只认**恰好五段**、前三段固定、扩展名是 .jpeg 的路径；别的一律返回 None
    （返回 None 等于"这个请求跟缓存重建无关"，照原样去发盘上的文件）。
    源文件的扩展名未知，所以在源目录里按 stem 扫一遍，多个候选时取排序后的第一个
    —— 保证同一个 stem 每次都选中同一个源，不会两次请求压出不同的图。
    """
    normalized = filepath.replace("\\", "/").strip("/")
    parts = normalized.split("/")
    if len(parts) != 5 or parts[:3] != ["CACHE", "UTBA", "event_photo"]:
        return None

    event_code, cache_name = parts[3], parts[4]
    stem, ext = os.path.splitext(cache_name)
    if not stem or ext.lower() != ".jpeg":
        return None

    source_dir = event_photo_base_dir(event_code)
    if not os.path.isdir(source_dir):
        return None

    candidates = []
    for source_name in os.listdir(source_dir):
        source_stem, source_ext = os.path.splitext(source_name)
        if source_stem != stem or source_ext.lower() not in JPEG_CACHE_SOURCE_EXTS:
            continue
        source_path = os.path.join(source_dir, source_name)
        if os.path.isfile(source_path):
            candidates.append(source_path)
    return sorted(candidates)[0] if candidates else None


def _ensure_event_photo_cache_file(filepath, real_path):
    """缓存 JPEG 不在（或过期）就当场压一张出来再发。

    ★ 这是 nginx 回落到应用的主要理由，见模块头。压失败**不报错**，打一行日志后
      照原路径发下去（多半会落到 broken-image）—— 一张图压不出来不该让整页挂掉。
    """
    source_path = _event_photo_cache_source_path(filepath)
    if not source_path:
        return real_path
    try:
        return ensure_jpeg_cache_file(source_path, os.path.dirname(real_path))
    except Exception as exc:
        print(f"[MEDIA] Failed to rebuild cache for {filepath}: {exc}")
        return real_path


def _is_not_modified(request, etag, mtime):
    """对应 werkzeug ``Response.make_conditional`` 里的条件请求判断。

    两条规则的**优先级**照 RFC 7232 / werkzeug 的实现来：
    只要带了 If-None-Match 就只看它（If-Modified-Since 被忽略），
    没带才回落到 If-Modified-Since。反过来写会让"图片改了但 mtime 没变"的
    场景一直发 304。
    """
    if_none_match = request.headers.get("if-none-match")
    if if_none_match:
        if if_none_match.strip() == "*":
            return True
        # ``W/"abc"`` → ``"abc"``：strip(" W/") 去的是首尾的空格 / W / 斜杠，
        # 引号留着（etag 本身带引号）。
        return any(candidate.strip(" W/") == etag for candidate in if_none_match.split(","))

    if_modified_since = request.headers.get("if-modified-since")
    if if_modified_since:
        try:
            since = parsedate_to_datetime(if_modified_since)
        except (TypeError, ValueError):
            return False
        if since is None:
            return False
        if since.tzinfo is None:
            # HTTP 日期恒为 GMT；解析出来是 naive 的话按 UTC 处理，
            # 否则 .timestamp() 会按**本机时区**算，夏令时/时区一变就全判错。
            since = since.replace(tzinfo=timezone.utc)
        # Last-Modified 头只有秒精度，比较时要把 mtime 也截到秒，
        # 否则 mtime=…​.7 的文件永远"比客户端的新"，永远 200。
        return int(mtime) <= int(since.timestamp())

    return False


def _send_file_conditional(request, path):
    """等价于 ``send_file(path, conditional=True, etag=True, last_modified=mtime)``。

    逐项对齐 werkzeug 3.1.6 的 send_file，不是"差不多就行"：

      · **ETag 算法完全照抄** ``f'"{mtime}-{size}-{adler32(path)}"'``。
        算法一致 = 浏览器里已经缓存的图在切到 FastAPI 之后仍然命中 304；
        换成 starlette 自己的 md5 格式的话，上线当天全站图片会被重新下一遍。
        adler32 的入参是**路径字符串**（Flask 那边是 root_path join 后的绝对路径，
        我们这里本来就是绝对路径，两者同一个字符串）。
      · ``Cache-Control: no-cache`` —— werkzeug 在没传 max_age 时就是这个值，
        意思是"可以缓存，但每次都要来问一次"，304 这条链路靠它工作。
      · 304 不能带正文，所以走 Response 而不是 FileResponse。
      · Range 请求交给 FileResponse（starlette 原生支持 206 + Content-Range），
        原来是 werkzeug 的 make_conditional(accept_ranges=True) 在做。
      · ``Content-Disposition: inline; filename="…"``：werkzeug 无论如何都会带上
        这个头，starlette 只在传了 filename 时才带 —— 所以这里显式传。

    两处**故意留下的**细微差别（都与前端无关，实测过）：
      · 文件名的引号：werkzeug 发 ``inline; filename=photo.jpg``，starlette 发
        ``inline; filename="photo.jpg"``。RFC 6266 两种都合法。
      · werkzeug 只在收到 Range 请求时才回 ``Accept-Ranges``，FileResponse 总是带。
        多带一个"我支持断点续传"的声明，没有副作用。
    """
    stat_result = os.stat(path)
    etag = f'"{stat_result.st_mtime}-{stat_result.st_size}-{zlib.adler32(path.encode()) & 0xFFFFFFFF}"'
    headers = {
        "Cache-Control": "no-cache",
        "ETag": etag,
        "Last-Modified": formatdate(stat_result.st_mtime, usegmt=True),
    }

    if request.method in ("GET", "HEAD") and _is_not_modified(request, etag, stat_result.st_mtime):
        return Response(status_code=304, headers={**headers, "Accept-Ranges": "bytes"})

    return FileResponse(
        path,
        stat_result=stat_result,
        headers=headers,
        filename=os.path.basename(path),
        content_disposition_type="inline",
    )


def _send_resolved_media_file(request, filepath):
    real_path = resolve_media_path(filepath)
    real_path = _ensure_event_photo_cache_file(filepath, real_path)

    if not os.path.isfile(real_path):
        # ★ 文件不存在时发的是占位图 + **200**，不是 404。
        #   前端的 <img> 靠这张图显示"坏文件"，改成 404 会变成浏览器自带的碎图标。
        return _send_file_conditional(request, BROKEN_IMAGE_PATH)
    return _send_file_conditional(request, real_path)


@media_file_router.get("/media_file/{filepath:path}")
def send_file_py_path(request: Request, filepath: str):
    return _send_resolved_media_file(request, filepath)


@router.get("/file/{filepath:path}")
def send_media_file(request: Request, filepath: str):
    return _send_resolved_media_file(request, filepath)


# ─────────────────────────── 取图元数据 ───────────────────────────


@router.get("/get_event_type/{id:int}")
def get_event_type(id: int):
    # Flask 里 return dict 会被自动 jsonify，这里等价地包一层 json_response。
    return json_response(get_event_type_payload(id))


@router.get("/get_event_image/{id:int}/{type}")
def get_event_image(id: int, type: str, force: str = ""):
    # ``force`` 只认字面量 "1"：``request.args.get("force") == "1"``。
    # 不能声明成 bool —— FastAPI 会把 "true"/"yes"/"on" 也解析成 True，行为就变了。
    result = get_event_image_payload(id, type, force=force == "1")
    if isinstance(result, tuple):
        # service 用 (payload, 202) 表示"转码中，等会儿再来"。
        return json_response(result[0], result[1])
    return json_response(result)


# ─────────────────────────── 上传 / 旋转 / 删除 ───────────────────────────


def _form_to_dict(form):
    """multipart 表单 → 纯文本字段的普通字典，对齐 Flask 的 ``request.form``。

    两处必须自己动手（与 api/content/router.py 同一份理由）：
      · 文件部分在 Flask 里只出现在 request.files，不在 request.form；
        starlette 的 FormData 把两者混在一起。
      · 同名字段重复出现时 werkzeug 的 MultiDict.get 取**第一个**，
        starlette 的 ImmutableMultiDict.get 取**最后一个**。
    """
    data = {}
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            continue
        if key not in data:
            data[key] = value
    return data


def _first_file(form, field):
    """取第一个同名的文件部分，对齐 ``request.files[field]``。

    ⚠️ 不能写成 ``form.get(field)``：客户端把 "file" 发成普通文本字段时那样会拿到
    一个 str，后面 ``allowed_file(str)`` 会用错的东西判扩展名；Flask 那边这种请求
    压根不进 request.files，走的是"No file provided"那一支。
    """
    for key, value in form.multi_items():
        if key == field and isinstance(value, UploadFile):
            return value
    return None


async def _upload_media_form(request: Request):
    """替掉 ``request.form`` / ``request.files``，返回 ``(表单字典, 文件或 None)``。

    写成 async 依赖而不是 ``Form(...)`` / ``File(...)`` 参数，是为了保住原来的
    **校验顺序和文案**：声明成参数的话，缺字段会先被 FastAPI 判 422，
    而原代码是先 400「event_id is required」再 400「No file provided」。
    依赖跑在事件循环里（读 body 不能阻塞），路由本体仍是 sync。
    """
    try:
        form = await request.form()
    except Exception:
        # 畸形 multipart：werkzeug 默认是**静默**给一个空表单，照着来 ——
        # 往下走会自然落到 400「event_id is required」。不接的话 starlette 会
        # 抛 400「There was an error parsing the body」，文案就不是原来那句了。
        yield {}, None
        return
    try:
        yield _form_to_dict(form), _first_file(form, "file")
    finally:
        # 手工解析的表单要手工关：不关的话 spooled 临时文件要等 GC 才释放。
        await form.close()


@router.post("/upload_media")
@login_required
@permission_required("event_edit")
def upload_media(form_and_file=Depends(_upload_media_form)):
    form, uploaded_file = form_and_file

    event_id = form.get("event_id")
    if not event_id:
        _abort(400, "event_id is required")
    if uploaded_file is None:
        _abort(400, "No file provided")

    if not (uploaded_file and allowed_file(uploaded_file.filename)):
        _abort(400, "Invalid file type")

    try:
        album_file, filename, file_ext = create_album_file(event_id, uploaded_file)
    except Exception:
        # 只回滚数据库；已经落盘的文件不删（原行为，见 service 模块头 ④）。
        db.session.rollback()
        raise

    return json_response(
        {
            "status": "success",
            "uploaded": filename,
            "file_id": album_file.id,
            "file_type": file_ext,
        }
    )


@router.post("/rotate_file/{file_id:int}/{angle:int}")
@login_required
@permission_required("event_edit")
def rotate_file(file_id: int, angle: int):
    rotate_album_file(file_id, angle)
    # 文案是英文的（原样）：这条接口的提示前端自己覆盖，不显示这串。
    return json_response({"status": "success", "message": "Image rotated"})


@router.delete("/delete_files")
@login_required
@permission_required("event_edit")
def delete_files(payload: Optional[dict] = _JSON_BODY):
    try:
        file_ids = (payload or {}).get("file_ids", [])
        if not file_ids:
            return json_response({"status": "error", "message": "No file_ids provided"}, 400)
        for file in get_album_files(file_ids):
            # get_album_files 对不存在的 id 会给 None，跳过（不报错）。
            if file:
                delete_album_file(file)
        # 一次性提交：删到一半失败就整批回滚，但**盘上已经删掉的文件回不来**。
        # 原行为，照搬。
        db.session.commit()
        return json_response({"status": "success", "message": "Files deleted successfully"})
    except Exception as exc:
        db.session.rollback()
        # 把异常原文发给前端（会暴露内部细节）。原行为，照搬。
        return json_response({"status": "error", "message": str(exc)}, 500)


# ─────────────────────────── 打包下载 ───────────────────────────


@router.post("/download_files")
def download_files(
    # 注意这条路由**没有**任何鉴权装饰器：知道 file_id 就能下原图。原行为，照搬。
    # TODO(安全): 收口时应至少加 login_required，但要先确认分享页没有在匿名调用。
    #
    # 两个字段都声明成带默认值的 Form：必填会让缺字段的请求回 422，
    # 而原来是 400 +「No file_ids provided」。
    file_ids: str = Form(default="[]"),
    download_type: Optional[str] = Form(default=None),
):
    try:
        parsed_file_ids = parse_file_ids(file_ids)
        download_type = (download_type or "original").strip().lower()
        if not parsed_file_ids:
            return json_response({"status": "error", "message": "No file_ids provided"}, 400)
        if download_type not in {"original", "jpeg"}:
            return json_response({"status": "error", "message": "Invalid download_type"}, 400)

        files = []
        for file in get_album_files(parsed_file_ids):
            if file:
                # 原文件把这四行 import 写在**循环体里**（历史遗留），提到模块顶部，
                # 行为完全等价。
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
                            # 现压一张（或复用缓存）。注意 ensure_jpeg_cache_file 的第二个
                            # 参数是**目录**，所以这里传 dirname。
                            jpeg_path = ensure_jpeg_cache_file(original_path, os.path.dirname(jpeg_path))
                        if os.path.exists(jpeg_path):
                            target_path = jpeg_path
                            # zip 里的名字用**原始** file_name 的 stem（可能含中文），
                            # 不是 secure_filename 后的 —— 用户看到的是自己传的名字。
                            target_name = f"{os.path.splitext(file.file_name)[0]}.jpeg"

                files.append(
                    (
                        file.id,
                        target_name,
                        target_path,
                    )
                )

        memory_file = build_zip_from_files(files)
        # 等价于 ``send_file(memory_file, mimetype="application/zip", as_attachment=True,
        # download_name=…)``。zip 已经整个在内存里了（build_zip_from_files 就是
        # BytesIO），所以直接发 bytes，不用 StreamingResponse 再包一层。
        # download_type 在上面已经被限死在 {"original","jpeg"}，拼进头里是安全的。
        return Response(
            content=memory_file.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="event_files_{download_type}.zip"'},
        )
    except Exception as exc:
        return json_response({"status": "error", "message": str(exc)}, 500)
