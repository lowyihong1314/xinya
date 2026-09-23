"""网站内容：关于我们 / 大事记 / 树洞留言 / 使用说明。

原 backend/app/content/routes.py（Flask Blueprint ``info_bp``，挂在 /api/info）。
只做框架适配：装饰器、参数提取、响应构造。校验顺序、状态码、中文文案、响应体的键名
全部逐字照搬 —— 前端 frontend/src/info/react/api.ts 的 parseJson 是按
``data.error || data.message`` 取提示语的，改一个键就是「弹窗变成 Request failed」。

URL 变化（/api 这一段没了；BASE_PATH 由 nginx 剥掉，应用内部一律写裸路径）：

    /api/info/get_about_us_text            → /info/get_about_us_text
    /api/info/get_our_history              → /info/get_our_history
    /api/info/about_us_text                → /info/about_us_text          (POST / DELETE)
    /api/info/add_our_history              → /info/add_our_history        (POST / DELETE)
    /api/info/tree_hole/messages           → /info/tree_hole/messages     (GET / POST)
    /api/info/tree_hole/messages/<id>      → /info/tree_hole/messages/{id}(PUT / DELETE)
    /api/info/manual                       → /info/manual
    /api/info/manual/<name>                → /info/manual/{name}

包名叫 content、前缀却是 /info：蓝图变量名历史上就是 info_bp，前端 8 个调用点写死了
/info 这一段，改前缀等于改 URL，所以只让包名跟着模块名走。

★ 迁移要点（后面搬别的模块的人先看一眼）：

  ① **本文件不能写 ``from __future__ import annotations``**。core.auth 的装饰器用
     functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了这一行会在那里找不到 Optional 而**启动即 NameError**。详见
     api/permission_mgmt/router.py 顶部。

  ② 路由一律 ``def``（同步）：底下全是同步 DB / 文件 IO，async def 会把 worker 的
     事件循环焊死。只有「读请求体」这件事必须在 async 侧做，所以写成 Depends 依赖
     （_history_form_or_json），路由本体仍是 sync。

  ③ **_MANUAL_DIR 的层级重算过**。原来是
     ``Path(__file__).resolve().parents[3] / "docs" / "user_manual"``；
     app/content/routes.py 和 api/content/router.py 恰好都是「仓库根往下 3 层」，
     字面搬过来也对 —— 但这是巧合，再挪一次目录就会静默指到别处（表现是使用说明
     页面永远空列表，且不报错）。所以这里改用 core.paths.PROJECT_ROOT，
     它自己会跟着 backend/core/paths.py 的位置算。

★ 几处「看着像 bug，故意保留」的地方：

  · add_our_history 里的 ``if not current_user.is_authenticated: 401`` 是死代码：
    外面的 @permission_required 未登录时已经先返回 500 了（core.auth 契约 2）。
    照搬不删 —— 删了万一哪天权限装饰器换语义，这条兜底就没了。
  · remove_image 的真值判断在 add_our_history 里内联了一份 {"1","true","yes","on"}，
    与 _parse_bool 重复。不合并：_parse_bool 带 default 参数（缺字段时保持原值），
    而这里缺字段就是 False，两者语义不同，合并会让「不传 remove_image」变成删图。
  · 树洞的 403 用 ``{"status","message"}``、其它错误用 ``{"error"}`` —— 两种形状在
    同一个文件里并存是现状，前端两边都在读，不要统一。
  · 更新大事记时 ``if date: entry.date = date`` —— 不传 date 就保持原值，
    而新建时 date 必填。这条不对称是故意的（编辑弹窗可以只改文字）。

★ 与 Flask 的已知差异（都只出现在畸形请求上）：

  · 两条 DELETE 原来走 ``request.get_json()``（非 silent），Flask 在 Content-Type
    不是 application/json 时会返回 **415 HTML 错误页**；这里落到 ``payload=None``
    → ``{}`` → 400「缺少 ID 参数」。前端两处都带着 Content-Type 发 JSON，走不到。
  · 请求体是坏 JSON 时 FastAPI 回 422（形状见 main.py 的校验异常处理器），
    Flask 回 400 HTML。两边前端都解析不了，不算行为变更。
  · ``/tree_hole/messages/{message_id}`` 传非数字：Flask 的 ``<int:...>`` 转换器
    压根不匹配这条规则 → **404**；FastAPI 匹配上了再校验 → **422**。
    前端只会拼数字 id，两者都是「请求失败」，不值得为它把 message_id 收成 str
    再手工 int()（那会把一条清晰的校验错误换成一条假 404）。
  · 往 /add_our_history 发 ``application/x-www-form-urlencoded``：原代码只认
    multipart 和 JSON 两条路，urlencoded 会掉进 ``request.get_json()`` 那一支，
    Flask 抛 415；这里落到空字典 → 400「内容不能为空」。两边都是失败，没有调用方在用。
"""

import os
import shutil
import uuid
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, Form
from starlette.datastructures import FormData, UploadFile
from starlette.requests import Request
# secure_filename 从 core/files.py 取（werkzeug 的逐字节复刻）——
# 为一个纯字符串函数拖回整个 werkzeug（实测 32 个模块）不划算。
from backend.core.files import secure_filename

from backend.core.auth import (
    current_user,
    get_current_user_permissions,
    login_required,
    permission_required,
)
from backend.core.config import settings
from backend.core.paths import DATA_ROOT, PROJECT_ROOT, data_media_url
from backend.core.responses import json_response
from backend.models import db
from backend.models.info import AboutUs, OurHistory, TreeHoleMessage

# prefix 用 settings.api_prefix 拼而不是写死 "/info"：api_prefix 今天是空串，
# 但配置项留着是为了需要时能整体把 /api 加回来 —— 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/info", tags=["content"])

# 上传的图存 DATA_ROOT；写进仓库的 static/ 会被 deploy 时的 git pull 删掉。
INFO_IMAGE_SUBDIR = "info_image"
INFO_IMAGE_DIR = DATA_ROOT / INFO_IMAGE_SUBDIR

# 使用说明的 Markdown 源目录 = 仓库根/docs/user_manual（见顶部要点③）。
_MANUAL_DIR = PROJECT_ROOT / "docs" / "user_manual"

# 对应 Flask 的 ``request.get_json() or {}``：没有 body 时落到 None，
# 路由里 ``payload or {}`` 补成空字典，后面的校验分支自然会回 400。
_JSON_BODY = Body(default=None)


# ─────────────────────────── 图片文件 ───────────────────────────


def _resolve_image_path(image_url):
    """把库里存的公开 URL 还原成磁盘路径；不在 info_image 目录下的一律返回 None。

    ★ 这个前缀校验是删除操作的唯一护栏：img 字段是库里的字符串，真被写进
      "/media_file/../../etc/passwd" 之类的值时，没有这一层就会删到目录外。
      basename + secure_filename 是第二层。
    """
    normalized = str(image_url or "").strip().replace("\\", "/")
    if not normalized.startswith(data_media_url(INFO_IMAGE_SUBDIR) + "/"):
        return None

    file_name = secure_filename(os.path.basename(normalized))
    return str(INFO_IMAGE_DIR / file_name) if file_name else None


def _delete_history_image(image_url):
    image_path = _resolve_image_path(image_url)
    if image_path and os.path.exists(image_path):
        os.remove(image_path)


def _save_history_image(upload):
    """等价于原来的 ``file_storage.save(path)``（werkzeug FileStorage → starlette UploadFile）。

    文件名一律换成 ``history-<uuid><原扩展名>``，原文件名只用来取后缀 ——
    客户端给的名字不进磁盘路径。
    """
    INFO_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    original_name = secure_filename(upload.filename or "history-image")
    suffix = os.path.splitext(original_name)[1] or ".jpg"
    file_name = f"history-{uuid.uuid4().hex}{suffix}"

    source = upload.file
    # UploadFile 的游标可能已经被别处读过；werkzeug 的 save() 是从当前位置开始 copy 的，
    # 但这里只有我们一个消费者，显式回到 0 更稳（spooled 文件不支持 seek 时忽略）。
    try:
        source.seek(0)
    except (OSError, ValueError):
        pass
    with open(INFO_IMAGE_DIR / file_name, "wb") as target:
        shutil.copyfileobj(source, target)
    return data_media_url(INFO_IMAGE_SUBDIR, file_name)


# ─────────────────────────── 序列化 / 解析 ───────────────────────────


def _serialize_history_entry(entry):
    return {
        "id": entry.id,
        "text": entry.text,
        "img": entry.img,
        "date": entry.date.strftime("%Y-%m-%d") if entry.date else None,
    }


def _parse_history_date(raw_date):
    """接受 YYYY-MM-DD、RFC 2822（旧前端把 Date 直接 toUTCString 发过来过）以及 date 对象。

    解不出来返回 None —— 调用点靠「传了但解不出」这个组合来区分
    「没填日期」和「填了但格式错」，两者文案不同。
    """
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


def _parse_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _current_user_has_permission(permission_name):
    if not current_user.is_authenticated:
        return False
    return permission_name in get_current_user_permissions(current_user)


def _get_request_ip(request):
    """照搬原实现：优先 X-Forwarded-For 的第一段，截断到 45 字符（ip 列宽）。

    ``request.headers.get("X-Forwarded-For", "")`` 在 starlette 里没有默认值参数，
    缺头时返回 None，所以补一个 ``or ""``；``request.remote_addr`` 对应 request.client.host。
    """
    forwarded_for = (request.headers.get("X-Forwarded-For") or "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()[:45]
    client = request.client
    return ((client.host if client else None) or "unknown")[:45]


def _form_to_dict(form):
    """multipart 表单 → 纯文本字段的普通字典，对齐 Flask 的 ``request.form``。

    两处必须自己动手，否则与 Flask 有细微出入：
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
    """取第一个同名的文件部分，对齐 ``request.files.get(field)``。

    ⚠️ 不能写成 ``form.get(field)``：客户端把 "image" 发成普通文本字段时那样会拿到
    一个 str，而 ``if image:`` 为真 → 进到保存分支 → AttributeError 500。
    Flask 那边这种请求 image 是 None，走的是「不动图」分支。
    """
    for key, value in form.multi_items():
        if key == field and isinstance(value, UploadFile):
            return value
    return None


async def _history_form_or_json(request: Request):
    """替掉原来那段 ``if "multipart/form-data" in request.content_type`` 分支。

    写成 async 依赖而不是 Form(...) 参数：这条路由**同时**要吃 multipart 和 JSON
    （前端发 multipart，但历史上有发 JSON 的调用方）。一旦声明了 Form 参数，
    FastAPI 就只按表单解析，JSON 请求会变成「字段全空」→ 400「内容不能为空」，
    属于行为变更。依赖跑在事件循环里，读 body 不阻塞；路由本体仍是 sync。

    返回 ``(data, image)``：data 是取字段用的字典，image 是 UploadFile 或 None。
    """
    content_type = request.headers.get("content-type")
    if content_type and "multipart/form-data" in content_type:
        try:
            form = await request.form()
        except Exception:
            # 畸形 multipart：werkzeug 默认是**静默**给一个空表单（不抛），
            # 照着来 —— 往下走会自然落到 400「内容不能为空」。
            # 不照办的话 starlette 的 MultiPartException 会冒成 500。
            yield FormData(), None
            return
        try:
            yield _form_to_dict(form), _first_file(form, "image")
        finally:
            # 手工解析的表单要手工关：不关的话 spooled 临时文件要等 GC 才释放。
            await form.close()
        return

    try:
        payload = await request.json()
    except Exception:
        payload = None
    yield (payload if isinstance(payload, dict) else {}), None


# ─────────────────────────── 关于我们 ───────────────────────────


@router.get("/get_about_us_text")
def get_about_us_text():
    try:
        entries = AboutUs.query.order_by(AboutUs.created_at.desc()).all()
        return json_response(
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
        return json_response({"error": f"获取失败: {str(exc)}"}, status_code=500)


@router.get("/get_our_history")
def get_our_history():
    try:
        entries = OurHistory.query.order_by(OurHistory.created_at.desc()).all()
        return json_response([_serialize_history_entry(entry) for entry in entries])
    except Exception as exc:
        return json_response({"error": f"获取失败: {str(exc)}"}, status_code=500)


# 原来是一个 @route(methods=["POST","DELETE"]) 里按 request.method 分叉，
# 这里拆成两个函数。路径相同，所以「用错方法」仍然是 405，与 Flask 一致。
@router.post("/about_us_text")
@permission_required("edit_info")
def save_about_us_text(
    # 前端用 FormData 发（frontend/src/info/react/api.ts:saveAboutEntry），
    # 对应 Flask 的 request.form.get。声明成带默认值的 Form 而不是必填：
    # 必填会让缺字段的请求回 422，而原来是 400 +「内容不能为空」。
    id: Optional[str] = Form(default=None),
    text: Optional[str] = Form(default=None),
):
    entry_id = id
    if not text or not text.strip():
        return json_response({"error": "内容不能为空"}, status_code=400)

    try:
        if entry_id:
            entry = AboutUs.query.get(entry_id)
            if not entry:
                return json_response({"error": "记录不存在"}, status_code=404)
            entry.text = text.strip()
        else:
            entry = AboutUs(username=str(current_user.id), text=text.strip())
            db.session.add(entry)

        db.session.commit()
        return json_response({"success": True})
    except Exception as exc:
        db.session.rollback()
        return json_response({"error": f"操作失败: {str(exc)}"}, status_code=500)


@router.delete("/about_us_text")
@permission_required("edit_info")
def delete_about_us_text(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    entry_id = data.get("id")
    if not entry_id:
        return json_response({"error": "缺少 ID 参数"}, status_code=400)

    entry = AboutUs.query.get(entry_id)
    if not entry:
        return json_response({"error": "记录不存在"}, status_code=404)

    try:
        db.session.delete(entry)
        db.session.commit()
        return json_response({"success": True})
    except Exception as exc:
        db.session.rollback()
        return json_response({"error": f"删除失败: {str(exc)}"}, status_code=500)


# ─────────────────────────── 大事记 ───────────────────────────


@router.post("/add_our_history")
@permission_required("edit_info")
def add_our_history(parsed=Depends(_history_form_or_json)):
    data, image = parsed

    entry_id = data.get("id")
    text = data.get("text")
    date = _parse_history_date(data.get("date"))
    remove_image = str(data.get("remove_image", "")).lower() in {"1", "true", "yes", "on"}

    if not text:
        return json_response({"error": "内容不能为空"}, status_code=400)
    # 新建必须有日期；编辑（带 entry_id）可以不传，走下面的「不传就保持原值」。
    if not entry_id and not date:
        return json_response({"error": "日期不能为空"}, status_code=400)
    # 「传了但解不出来」才是格式错 —— 顺序不能和上一条对调，否则新建时不传日期
    # 会拿到「格式无效」这条更让人困惑的提示。
    if data.get("date") and not date:
        return json_response({"error": "日期格式无效，请使用 YYYY-MM-DD"}, status_code=400)
    # TODO(迁移): 这一条是死代码 —— 外层 @permission_required 未登录时已经先返回 500。
    #   保留是为了不改行为（也留一条兜底）。
    if not current_user.is_authenticated:
        return json_response({"error": "未登录"}, status_code=401)

    try:
        if entry_id:
            entry = OurHistory.query.get(entry_id)
            if not entry:
                return json_response({"error": "记录不存在"}, status_code=404)
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
        return json_response({"success": True})
    except Exception as exc:
        db.session.rollback()
        return json_response({"error": f"保存失败: {str(exc)}"}, status_code=500)


@router.delete("/add_our_history")
@permission_required("edit_info")
def delete_our_history(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    entry_id = data.get("id")
    if not entry_id:
        return json_response({"error": "缺少 ID 参数"}, status_code=400)

    entry = OurHistory.query.get(entry_id)
    if not entry:
        return json_response({"error": "记录不存在"}, status_code=404)

    try:
        # 先删图再删行：反过来的话 commit 成功而 unlink 失败就留下孤儿文件，
        # 且再也找不到它的 URL（行没了）。
        if entry.img:
            _delete_history_image(entry.img)

        db.session.delete(entry)
        db.session.commit()
        return json_response({"success": True})
    except Exception as exc:
        db.session.rollback()
        return json_response({"error": f"删除失败: {str(exc)}"}, status_code=500)


# ─────────────────────────── 树洞留言 ───────────────────────────


def _load_tree_hole_entry(message_id):
    """两条 detail 路由（PUT / DELETE）的前两步完全相同：先查权限再查记录。

    返回 ``(entry, error_response)``，error_response 非 None 时直接返回它。
    """
    if not _current_user_has_permission("info_tree_hole"):
        return None, json_response(
            {"status": "error", "message": "没有权限管理树洞留言"}, status_code=403
        )

    entry = TreeHoleMessage.query.get(message_id)
    if not entry:
        return None, json_response({"error": "留言不存在"}, status_code=404)
    return entry, None


@router.get("/tree_hole/messages")
def list_tree_hole_messages():
    # 这条路由**故意没挂 @login_required**：未登录时 _current_user_has_permission
    # 返回 False，于是拿到 403 而不是 401。前端（InfoPage）是按「能不能读到列表」
    # 决定要不要显示管理区的，401 会被 apiFetch 当成掉线处理。
    if not _current_user_has_permission("info_tree_hole"):
        return json_response(
            {"status": "error", "message": "没有权限查看树洞留言"}, status_code=403
        )

    try:
        entries = TreeHoleMessage.query.order_by(
            TreeHoleMessage.created_at.desc(), TreeHoleMessage.id.desc()
        ).all()
        return json_response([entry.to_dict() for entry in entries])
    except Exception as exc:
        return json_response({"error": f"获取失败: {str(exc)}"}, status_code=500)


@router.post("/tree_hole/messages")
def create_tree_hole_message(request: Request, payload: Optional[dict] = _JSON_BODY):
    # 留言是**公开**接口：不登录也能发，所以这里不挂任何权限装饰器。
    data = payload or {}
    raw_message = data.get("message")
    raw_author_name = data.get("author_name")

    message = str(raw_message or "").strip()
    if not message:
        return json_response({"error": "留言内容不能为空"}, status_code=400)
    if len(message) > 4000:
        return json_response({"error": "留言内容不能超过 4000 字"}, status_code=400)

    author_name = str(raw_author_name or "").strip() or None
    if author_name and len(author_name) > 120:
        return json_response({"error": "称呼不能超过 120 字"}, status_code=400)

    try:
        entry = TreeHoleMessage(
            # user_id 恒为 None：这是「树洞」的全部意义 —— 连登录用户的留言也不记账号。
            user_id=None,
            author_name=author_name,
            message=message,
            ip=_get_request_ip(request),
            phone="",
            is_spam=False,
            display=True,
        )
        db.session.add(entry)
        db.session.commit()
        return json_response({"success": True, "message": "留言已送出"}, status_code=201)
    except Exception as exc:
        db.session.rollback()
        return json_response({"error": f"提交失败: {str(exc)}"}, status_code=500)


@router.put("/tree_hole/messages/{message_id}")
def update_tree_hole_message(message_id: int, payload: Optional[dict] = _JSON_BODY):
    entry, denied = _load_tree_hole_entry(message_id)
    if denied is not None:
        return denied

    data = payload or {}
    message = str(data.get("message") or "").strip()
    if not message:
        return json_response({"error": "留言内容不能为空"}, status_code=400)
    if len(message) > 4000:
        return json_response({"error": "留言内容不能超过 4000 字"}, status_code=400)

    author_name = str(data.get("author_name") or "").strip() or None
    if author_name and len(author_name) > 120:
        return json_response({"error": "称呼不能超过 120 字"}, status_code=400)

    try:
        entry.message = message
        entry.author_name = author_name
        # 缺字段时保持原值（_parse_bool 的 default），而不是当 False ——
        # 前端整条 PUT 都会带上这两个键，但别的调用方可能只改文字。
        entry.display = _parse_bool(data.get("display"), default=bool(entry.display))
        entry.is_spam = _parse_bool(data.get("is_spam"), default=bool(entry.is_spam))
        entry.updated_at = datetime.utcnow()
        db.session.commit()
        return json_response({"success": True, "message": "留言已更新", "data": entry.to_dict()})
    except Exception as exc:
        db.session.rollback()
        return json_response({"error": f"更新失败: {str(exc)}"}, status_code=500)


@router.delete("/tree_hole/messages/{message_id}")
def delete_tree_hole_message(message_id: int):
    # DELETE 不声明 body：前端这条请求不带 Content-Type 也不带 body
    # （api.ts:deleteTreeHoleEntry），声明了反而多一层解析。
    entry, denied = _load_tree_hole_entry(message_id)
    if denied is not None:
        return denied

    try:
        db.session.delete(entry)
        db.session.commit()
        return json_response({"success": True, "message": "留言已删除"})
    except Exception as exc:
        db.session.rollback()
        return json_response({"error": f"删除失败: {str(exc)}"}, status_code=500)


# ─────────────────────────── 使用说明（用户手册）───────────────────────────


def _manual_title(text, fallback):
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return fallback


@router.get("/manual")
@login_required
def list_manual_docs():
    docs = []
    if _MANUAL_DIR.is_dir():
        for path in sorted(_MANUAL_DIR.glob("*.md")):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            docs.append({"name": path.stem, "title": _manual_title(text, path.stem)})
    # README 置顶作为总览
    docs.sort(key=lambda item: (item["name"] != "README", item["name"]))
    return json_response({"status": "success", "docs": docs})


@router.get("/manual/{name}")
@login_required
def get_manual_doc(name: str):
    safe = os.path.basename(str(name))  # 防路径穿越
    path = _MANUAL_DIR / f"{safe}.md"
    if not path.is_file():
        return json_response({"status": "error", "message": "文档不存在"}, status_code=404)
    return json_response(
        {"status": "success", "name": safe, "content": path.read_text(encoding="utf-8")}
    )
