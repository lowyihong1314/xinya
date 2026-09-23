"""资产 / 库存（原 backend/app/asset/routes.py 的 Flask Blueprint，挂在 /api/asset）。

只做框架适配：装饰器、参数提取、响应构造。校验顺序、状态码、中文文案、响应体的
键名与嵌套形状全部逐字照搬 —— 前端资产页面在按这些键和 message 分支。
业务逻辑全在 service.py，本文件不做任何判断。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了（BASE_PATH 已经区分项目，见 docs/flask_to_fastAPI/11），
其余路径一个字符没动。共 26 条：

    GET    /api/asset/dashboard                         → /asset/dashboard
    GET    /api/asset/master-data                       → /asset/master-data
    GET    /api/asset/inventory                         → /asset/inventory
    GET    /api/asset/movements                         → /asset/movements
    GET    /api/asset/partners                          → /asset/partners
    POST   /api/asset/warehouses                        → /asset/warehouses
    PATCH  /api/asset/warehouses/<int:id>               → /asset/warehouses/{warehouse_id:int}
    DELETE /api/asset/warehouses/<int:id>               → /asset/warehouses/{warehouse_id:int}
    POST   /api/asset/items                             → /asset/items
    POST   /api/asset/partners                          → /asset/partners
    PATCH  /api/asset/partners/<int:id>                 → /asset/partners/{partner_id:int}
    DELETE /api/asset/partners/<int:id>                 → /asset/partners/{partner_id:int}
    PATCH  /api/asset/items/<int:id>                    → /asset/items/{item_id:int}
    DELETE /api/asset/items/<int:id>                    → /asset/items/{item_id:int}
    POST   /api/asset/items/<int:id>/sub-items          → /asset/items/{item_id:int}/sub-items
    PATCH  /api/asset/sub-items/<int:id>                → /asset/sub-items/{sub_item_id:int}
    DELETE /api/asset/sub-items/<int:id>                → /asset/sub-items/{sub_item_id:int}
    GET    /api/asset/stock-documents                   → /asset/stock-documents
    POST   /api/asset/stock-documents                   → /asset/stock-documents
    PATCH  /api/asset/stock-documents/<int:id>          → /asset/stock-documents/{document_id:int}
    POST   /api/asset/stock-documents/<int:id>/confirm         → .../{document_id:int}/confirm
    POST   /api/asset/stock-documents/<int:id>/post-to-finance → .../{document_id:int}/post-to-finance
    POST   /api/asset/stock-documents/<int:id>/cancel          → .../{document_id:int}/cancel
    DELETE /api/asset/stock-documents/<int:id>          → /asset/stock-documents/{document_id:int}
    PATCH  /api/asset/inventory/<int:id>/threshold      → /asset/inventory/{inventory_id:int}/threshold
    POST   /api/asset/stock-documents/<int:id>/invoice  → .../{document_id:int}/invoice

路由的**注册顺序与原文件完全一致**（不是按 REST 分组重排过的）。Starlette 是先注册
先匹配、不回溯，保持同序 = 匹配结果必然同构，也让两份文件能逐条对读。

── 四件搬迁时必须这么写的事 ──────────────────────────────────────────

① **本文件不能写 ``from __future__ import annotations``。**
   core.auth 的装饰器用 functools.wraps 包过，FastAPI 求值注解时用的是
   core/auth.py 的命名空间；开了这行注解全变字符串，会跑去那边找 ``Optional``
   而 NameError（启动即挂）。本模块虽然没用那些装饰器，仍然统一遵守这条。

② **路由函数一律 ``def``（同步），不写 async def。**
   下面每一条最终都落到同步的 SQLAlchemy 查询 + commit（上传那条还要写盘），
   写成 async 会把 worker 的事件循环焊死。FastAPI 会自动把 def 路由丢进线程池。

③ **路径参数写 ``{xxx_id:int}``（Starlette 转换器），不是只靠 ``: int`` 注解。**
   这是行为问题不是风格问题：Flask 的 ``<int:id>`` 在参数不是整数时是
   **不匹配** → 404；只靠注解的话 FastAPI 会先匹配上再校验失败 → **422**，
   前端的 404 分支会失效。

④ **上传那条路由的文件用 async 依赖取，不用 ``File(...)`` 参数。**
   原代码是 ``request.files.get("file")``：非 multipart 请求、畸形 multipart、
   把 file 发成普通文本字段 —— 这三种情况 werkzeug 都给 **None**，
   于是走 service 里的「请选择要上传的 invoice 文件」400 分支。
   声明成 ``file: UploadFile = File(default=None)`` 的话这三种会分别变成
   422 / 400（框架文案）/ 422，三条中文提示全没了。详见 _invoice_upload。

── 鉴权为什么不用 @login_required ──────────────────────────────────
本模块所有出口（含 401/403）都长成 ``{"status": "error", "message": "<中文句子>"}``，
而 core.auth 装饰器的拒绝出口是它自己写死的响应体。换过去就等于换掉
「请先登录」/「没有资产读取权限」/「没有资产编辑权限」这三句话。
所以照搬原结构：每条路由**函数体第一行**显式调 require_asset_*_permission()，
抛出的 AssetError 由 try/except 统一转成响应。
⚠️ 后果是「权限检查在路由体内」——请求会先被 FastAPI 解析完 body/query 才被拒。
   Flask 时代同样如此（装饰器也在视图内部调），不算行为变更。
   上传那条更进一步：依赖跑在路由体之前，所以文件会先落进临时文件再被 403 拒掉。
   响应完全一致，只是白读了一次盘；要改得先把权限判定挪进依赖，那会换掉文案。

── 与 Flask 的已知差异（都不构成前端可见的行为变更）─────────────────
· 请求体不是合法 JSON 时：Flask 的 ``get_json(silent=True)`` 当成 {} 继续走，
  最终落到某条业务校验（400 + 中文文案）；这里 FastAPI 先回 **422**。
  两边都是「请求失败」，但 message 不同。
· 请求体是合法 JSON 但**不是对象**（数组 / 裸字符串）：Flask 会带着它走进 service，
  在 ``payload.get(...)`` 上 AttributeError → 被 ``except Exception`` 接住 → 500；
  这里是 422。原来那个 500 没人依赖。
"""

import shutil
from typing import Optional

from fastapi import APIRouter, Body, Depends
from starlette.datastructures import UploadFile
from starlette.requests import Request

from backend.api.asset.exceptions import AssetError
from backend.api.asset.permissions import (
    require_asset_edit_permission,
    require_asset_read_permission,
)
from backend.api.asset.serializers import (
    serialize_inventory_row,
    serialize_item,
    serialize_partner,
    serialize_stock_document,
    serialize_sub_item,
    serialize_warehouse,
)
from backend.api.asset.service import (
    cancel_stock_document,
    confirm_stock_document,
    post_document_to_finance,
    create_item,
    create_partner,
    create_stock_document,
    create_sub_item,
    create_warehouse,
    delete_item,
    delete_partner,
    delete_stock_document,
    delete_sub_item,
    delete_warehouse,
    load_asset_dashboard,
    load_asset_documents_data,
    load_asset_inventory_data,
    load_asset_master_data,
    load_asset_movements_data,
    list_asset_partners,
    update_item,
    update_inventory_threshold,
    update_partner,
    update_stock_document,
    update_sub_item,
    update_warehouse,
    upload_document_invoice,
)
from backend.core.config import settings
# 原代码在每个 except 分支里写 ``from backend.models import db``（局部 import，
# Flask 时代为了躲循环引用）。core.db 没有这个问题，提到模块顶上，行为不变。
from backend.core.db import db
from backend.core.responses import json_response

# prefix 用 settings.api_prefix 拼而不是写死 "/asset"：api_prefix 今天是空串，
# 但配置项留着是为了需要时还能整体把前缀加回来 —— 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/asset", tags=["asset"])


# 请求体的取法对应 Flask 的 ``request.get_json(silent=True) or {}``：
#   · ``Optional[dict]`` + ``Body(default=None)`` = 「整个 JSON 体就是这个参数」，
#     不带 embed，前端发什么形状进来就是什么形状。
#   · 没有 body / body 是 null 时落到 None，路由里 ``payload or {}`` 补成空字典，
#     后面的校验分支自然抛 ValidationError（400），与 silent=True 时一致。
_JSON_BODY = Body(default=None)


def _error_response(exc):
    """AssetError → 响应。等价于 Flask 版的 ``jsonify({...}), exc.status_code``。

    状态码来自异常类本身（401/403/404/400），见 exceptions.py 的那张表。
    """
    return json_response({"status": "error", "message": exc.message}, exc.status_code)


def _unexpected_error_response(exc):
    """非 AssetError 的兜底：回滚 + 500 + ``str(exc)``。

    原文件里这三行在 20 个写操作路由里**逐字重复**，这里抽成一个函数，行为一致：
      · 先 ``db.session.rollback()`` —— service 里大量 add/flush 之后才 commit，
        不回滚的话这个会话在同一个请求的后续操作里会一直带着脏状态。
      · 再把 ``str(exc)`` 原样发给前端。⚠️ 这会把 SQLAlchemy 的报错（含 SQL 片段）
        漏给客户端。原行为如此，前端也确实在把它当提示弹出来。
        TODO(安全): 收口时应改成固定文案 + 服务端日志，但要先确认没有页面在匹配它。
    """
    db.session.rollback()
    return json_response({"status": "error", "message": str(exc)}, 500)


# ─────────────────────────── invoice 上传 ───────────────────────────


def _first_file(form, field):
    """取第一个同名的文件部分，对齐 werkzeug 的 ``request.files.get(field)``。

    ⚠️ 不能写成 ``form.get(field)``：客户端把 "file" 发成普通文本字段时那样会拿到
    一个 str，service 里 ``uploaded_file.filename`` 就是 AttributeError → 500。
    werkzeug 那边这种请求 files 里根本没有这一项 → None → 400「请选择要上传的 invoice 文件」。
    同名字段重复出现时 werkzeug 的 MultiDict.get 取**第一个**，
    starlette 的 ImmutableMultiDict.get 取**最后一个**，所以这里也必须自己遍历。
    """
    for key, value in form.multi_items():
        if key == field and isinstance(value, UploadFile):
            return value
    return None


async def _invoice_upload(request: Request):
    """等价于 ``request.files.get("file")``。

    写成 async 依赖而不是 ``File(...)`` 参数：读请求体这件事必须在 async 侧做，
    而路由本体要保持 sync（底下是同步写盘 + commit）。依赖跑在事件循环里，不阻塞。
    三条「werkzeug 给 None」的路径都照着复现：
      · 不是 multipart（没 body、JSON、urlencoded）→ request.files 是空 MultiDict。
      · 畸形 multipart → werkzeug 默认**静默**给空表单（不抛）；
        starlette 会抛 MultiPartException，接住它才不会冒成 500。
      · file 发成普通文本字段 → 见 _first_file。
    """
    content_type = request.headers.get("content-type")
    if not (content_type and "multipart/form-data" in content_type):
        yield None
        return

    try:
        form = await request.form()
    except Exception:
        yield None
        return

    try:
        yield _first_file(form, "file")
    finally:
        # 手工解析的表单要手工关：不关的话 spooled 临时文件要等 GC 才释放。
        # 依赖的收尾在路由返回**之后**才跑，所以路由里 save() 时文件还在。
        await form.close()


class _FileStorageShim:
    """starlette UploadFile → service 层认识的 werkzeug FileStorage。

    service.upload_document_invoice 只用到三样东西：``.filename`` / ``.mimetype`` /
    ``.save(path)``。在框架边界上把这三样补齐，service.py 就一个字都不用改 ——
    业务逻辑不该知道自己跑在哪个框架下。
    """

    __slots__ = ("_upload",)

    def __init__(self, upload):
        self._upload = upload

    @property
    def filename(self):
        # 两边缺文件名时都是 None；``filename=""`` 时都是空串，
        # service 的 ``if not (uploaded_file and uploaded_file.filename)`` 两种都拦得住。
        return self._upload.filename

    @property
    def mimetype(self):
        # werkzeug: ``parse_options_header(content_type)[0].lower()`` ——
        # 去掉 ``; charset=...`` 这类参数并转小写，**头缺失时是空串而不是 None**。
        # service 里用它猜扩展名、还会存进 document.invoice_type，所以要按 werkzeug 来。
        return (self._upload.content_type or "").split(";")[0].strip().lower()

    def save(self, dst, buffer_size=16384):
        source = self._upload.file
        # werkzeug 的 save() 是从流的当前位置开始 copy 的。starlette 解析完会把游标
        # 归零，这里再显式回 0 只是保险（spooled 文件不支持 seek 时忽略）。
        try:
            source.seek(0)
        except (OSError, ValueError):
            pass
        with open(dst, "wb") as target:
            shutil.copyfileobj(source, target, buffer_size)


# ─────────────────────────── 只读：看板 / 主数据 ───────────────────────────


@router.get("/dashboard")
def get_asset_dashboard():
    try:
        require_asset_read_permission()
        return json_response({"status": "success", "data": load_asset_dashboard()})
    except AssetError as exc:
        return _error_response(exc)


@router.get("/master-data")
def get_asset_master_data():
    try:
        require_asset_read_permission()
        return json_response({"status": "success", "data": load_asset_master_data()})
    except AssetError as exc:
        return _error_response(exc)


@router.get("/inventory")
def get_asset_inventory():
    try:
        require_asset_read_permission()
        return json_response({"status": "success", "data": load_asset_inventory_data()})
    except AssetError as exc:
        return _error_response(exc)


@router.get("/movements")
def get_asset_movements():
    try:
        require_asset_read_permission()
        return json_response({"status": "success", "data": load_asset_movements_data()})
    except AssetError as exc:
        return _error_response(exc)


@router.get("/partners")
def get_asset_partners():
    try:
        require_asset_read_permission()
        return json_response({"status": "success", "data": list_asset_partners()})
    except AssetError as exc:
        return _error_response(exc)


# ─────────────────────────── 仓库 ───────────────────────────
# ★ 只有这几条只读路由是 ``except AssetError`` 单分支：别的异常照原样冒泡成 500
#   （FastAPI 的默认 500 响应体）。下面的写操作路由才有 ``except Exception`` 兜底 +
#   rollback。两种写法的差别是**有意的**：读操作没有事务要回滚。


@router.post("/warehouses")
def create_warehouse_route(payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        warehouse = create_warehouse(payload, user)
        # 新建一律 201，更新是 200 —— 前端按状态码区分「新增成功」和「保存成功」的提示。
        return json_response(
            {
                "status": "success",
                "message": "仓库已创建",
                "data": serialize_warehouse(warehouse),
            },
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.patch("/warehouses/{warehouse_id:int}")
def update_warehouse_route(warehouse_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        warehouse = update_warehouse(warehouse_id, payload, user)
        return json_response(
            {
                "status": "success",
                "message": "仓库已更新",
                "data": serialize_warehouse(warehouse),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.delete("/warehouses/{warehouse_id:int}")
def delete_warehouse_route(warehouse_id: int):
    try:
        user = require_asset_edit_permission()
        delete_warehouse(warehouse_id, user)
        # 删除只回 message，没有 data 键 —— 前端不会去读，别为了「形状统一」补上。
        return json_response({"status": "success", "message": "仓库已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


# ─────────────────────────── item / 往来对象 / 子 item ───────────────────────────
# 顺序照抄原文件：items 的 POST 夹在 warehouses 和 partners 中间，
# items 的 PATCH/DELETE 又排在 partners 之后。看着乱，但不影响匹配，保持可逐条对读。


@router.post("/items")
def create_item_route(payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        item = create_item(payload, user)
        return json_response(
            {
                "status": "success",
                "message": "资产 item 已创建",
                "data": serialize_item(item),
            },
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.post("/partners")
def create_partner_route(payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        partner = create_partner(payload, user)
        return json_response(
            {
                "status": "success",
                "message": "往来对象已创建",
                "data": serialize_partner(partner),
            },
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.patch("/partners/{partner_id:int}")
def update_partner_route(partner_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        partner = update_partner(partner_id, payload, user)
        return json_response(
            {
                "status": "success",
                "message": "往来对象已更新",
                "data": serialize_partner(partner),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.delete("/partners/{partner_id:int}")
def delete_partner_route(partner_id: int):
    try:
        user = require_asset_edit_permission()
        delete_partner(partner_id, user)
        return json_response({"status": "success", "message": "往来对象已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.patch("/items/{item_id:int}")
def update_item_route(item_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        item = update_item(item_id, payload, user)
        return json_response(
            {
                "status": "success",
                "message": "资产 item 已更新",
                "data": serialize_item(item),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.delete("/items/{item_id:int}")
def delete_item_route(item_id: int):
    try:
        user = require_asset_edit_permission()
        delete_item(item_id, user)
        return json_response({"status": "success", "message": "资产 item 已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.post("/items/{item_id:int}/sub-items")
def create_sub_item_route(item_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        sub_item = create_sub_item(item_id, payload, user)
        return json_response(
            {
                "status": "success",
                "message": "子 item 已创建",
                "data": serialize_sub_item(sub_item),
            },
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.patch("/sub-items/{sub_item_id:int}")
def update_sub_item_route(sub_item_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        sub_item = update_sub_item(sub_item_id, payload, user)
        return json_response(
            {
                "status": "success",
                "message": "子 item 已更新",
                "data": serialize_sub_item(sub_item),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.delete("/sub-items/{sub_item_id:int}")
def delete_sub_item_route(sub_item_id: int):
    try:
        user = require_asset_edit_permission()
        delete_sub_item(sub_item_id, user)
        return json_response({"status": "success", "message": "子 item 已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


# ─────────────────────────── 库存单据 ───────────────────────────


@router.get("/stock-documents")
def get_stock_documents():
    try:
        require_asset_read_permission()
        return json_response({"status": "success", "data": load_asset_documents_data()})
    except AssetError as exc:
        return _error_response(exc)


@router.post("/stock-documents")
def create_stock_document_route(payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        document = create_stock_document(payload, user)
        # include_children=True 是显式写出来的（serialize 的默认值也是 True）——
        # 前端建单之后直接拿 lines/movements 渲染，照抄，别精简掉这个参数。
        return json_response(
            {
                "status": "success",
                "message": "库存单据已创建",
                "data": serialize_stock_document(document, include_children=True),
            },
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.patch("/stock-documents/{document_id:int}")
def update_stock_document_route(document_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        document = update_stock_document(document_id, payload, user)
        return json_response(
            {
                "status": "success",
                "message": "库存单据已更新",
                "data": serialize_stock_document(document, include_children=True),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.post("/stock-documents/{document_id:int}/confirm")
def confirm_stock_document_route(document_id: int):
    # 确认 = 真正扣/加库存并写流水。**不读请求体**（原代码也没读），
    # 所以这里不加 payload 参数：加了的话发 ``Content-Type: application/json`` 但 body
    # 畸形的请求会从「确认成功」变成 422。
    try:
        user = require_asset_edit_permission()
        document = confirm_stock_document(document_id, user)
        return json_response(
            {
                "status": "success",
                "message": "库存单据已确认",
                "data": serialize_stock_document(document, include_children=True),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.post("/stock-documents/{document_id:int}/post-to-finance")
def post_stock_document_to_finance_route(document_id: int):
    try:
        user = require_asset_edit_permission()
        document = post_document_to_finance(document_id, user)
        return json_response(
            {
                "status": "success",
                "message": "已推送到收款审核",
                "data": serialize_stock_document(document, include_children=True),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.post("/stock-documents/{document_id:int}/cancel")
def cancel_stock_document_route(document_id: int):
    try:
        user = require_asset_edit_permission()
        document = cancel_stock_document(document_id, user)
        return json_response(
            {
                "status": "success",
                "message": "库存单据已作废",
                "data": serialize_stock_document(document, include_children=True),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.delete("/stock-documents/{document_id:int}")
def delete_stock_document_route(document_id: int):
    try:
        user = require_asset_edit_permission()
        delete_stock_document(document_id, user)
        return json_response({"status": "success", "message": "库存单据已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


# ─────────────────────────── 库存预警线 / 发票文件 ───────────────────────────


@router.patch("/inventory/{inventory_id:int}/threshold")
def update_inventory_threshold_route(inventory_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_asset_edit_permission()
        payload = payload or {}
        inventory = update_inventory_threshold(inventory_id, payload, user)
        return json_response(
            {
                "status": "success",
                "message": "最低库存已更新",
                "data": serialize_inventory_row(inventory),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)


@router.post("/stock-documents/{document_id:int}/invoice")
def upload_document_invoice_route(document_id: int, uploaded_file=Depends(_invoice_upload)):
    try:
        user = require_asset_edit_permission()
        # 没有文件时传 None 进去，由 service 抛「请选择要上传的 invoice 文件」——
        # 判定留在 service 里，和 Flask 时代同一个位置。
        document = upload_document_invoice(
            document_id,
            _FileStorageShim(uploaded_file) if uploaded_file is not None else None,
            user,
        )
        return json_response(
            {
                "status": "success",
                "message": "invoice 文件已上传",
                "data": serialize_stock_document(document, include_children=True),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        return _unexpected_error_response(exc)
