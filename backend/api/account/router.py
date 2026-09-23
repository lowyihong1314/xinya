"""报销申请 + 财政收款 + Payment Voucher（原 backend/app/account/routes.py 的两个 Flask Blueprint）。

只做框架适配：装饰器、参数提取、响应构造。校验顺序、状态码、中文文案、响应体的
键名与嵌套形状全部逐字照搬 —— 前端 CRM/Account 页面在按这些键和 message 分支。

── 两个 Blueprint 合成了一个 router ─────────────────────────────────
原来是 ``account_bp`` (16 条，挂 /api/account) 和 ``payment_voucher_bp``
(5 条，挂 /api/account/print_payment_voucher) 两个蓝图。这里合成**一个**
APIRouter，prefix 取 ``/account``，voucher 那 5 条的路径里自带
``/print_payment_voucher`` 前缀 —— 拼出来的 URL 与原来**逐字一致**。
（合成而不是导出两个 router，是为了 __init__.py 保持全模块统一的那三行。）

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了（BASE_PATH 已经区分项目，见 docs/flask_to_fastAPI/11），
其余路径一个字符没动：

    /api/account/submit_new_claim                     → /account/submit_new_claim
    /api/account/get_all_claim                        → /account/get_all_claim
    /api/account/payments                             → /account/payments
    /api/account/payments/manual          (POST)      → /account/payments/manual
    /api/account/payments/manual/<id>     (DELETE)    → /account/payments/manual/{payment_id:int}
    /api/account/payments/<id>/status     (POST)      → /account/payments/{payment_id:int}/status
    /api/account/payments/report          (POST)      → /account/payments/report
    /api/account/claim/read_bill          (POST)      → /account/claim/read_bill
    /api/account/claim/report             (POST)      → /account/claim/report
    /api/account/claim_decision/<id>      (POST)      → /account/claim_decision/{request_id:int}
    /api/account/claim/<id>/withdraw_decision (POST)  → /account/claim/{request_id:int}/withdraw_decision
    /api/account/delete_claim/<id>        (DELETE)    → /account/delete_claim/{request_id:int}
    /api/account/claim/<id>               (PUT)       → /account/claim/{request_id:int}
    /api/account/claim/<id>/attachments   (POST)      → /account/claim/{request_id:int}/attachments
    /api/account/claim/attachments/<id>   (DELETE)    → /account/claim/attachments/{attachment_id:int}
    /api/account/claim/<id>/event         (PUT)       → /account/claim/{request_id:int}/event

    /api/account/print_payment_voucher/download_payment_voucher/<id>
        → /account/print_payment_voucher/download_payment_voucher/{request_id:int}
    /api/account/print_payment_voucher/share_payment_voucher/<id>
        → /account/print_payment_voucher/share_payment_voucher/{request_id:int}
    /api/account/print_payment_voucher/public/<token>            (GET)
        → /account/print_payment_voucher/public/{token}
    /api/account/print_payment_voucher/public/<token>/sign       (POST)
        → /account/print_payment_voucher/public/{token}/sign
    /api/account/print_payment_voucher/public/<token>/download   (GET)
        → /account/print_payment_voucher/public/{token}/download

── 四件搬迁时必须这么写的事 ──────────────────────────────────────────

① **本文件不能写 ``from __future__ import annotations``。**
   core.auth 的装饰器用 functools.wraps 包过，FastAPI 求值注解时用的是
   core/auth.py 的命名空间；开了这行注解全变字符串，会跑去那边找 ``Optional``
   而 NameError（启动即挂）。本模块虽然没用那些装饰器，仍然统一遵守这条。

② **路由函数一律 ``def``（同步），不写 async def。**
   下面每一条最终都落到同步的 SQLAlchemy 查询 + commit、reportlab 画 PDF、
   或者 urllib 打 BytePlus（读单最长 120 秒），写成 async 会把 worker 的事件
   循环焊死。FastAPI 会自动把 def 路由丢进线程池。

③ **路径参数写 ``{request_id:int}``（Starlette 转换器），不是只靠 ``: int`` 注解。**
   行为问题不是风格问题：Flask 的 ``<int:request_id>`` 在参数不是整数时是
   **不匹配** → 404；只靠注解的话 FastAPI 会先匹配上再校验失败 → **422**，
   前端的 404 分支会失效。带上转换器后，``/claim/read_bill`` / ``/claim/report``
   / ``/claim/attachments/<id>`` 这些具名路径在**匹配阶段**就不会被
   ``{request_id:int}`` 吃掉。即便如此，下面仍保持原文件的注册顺序
   （具名的在前），作为第二道保险。
   ``/public/{token}`` 对应 Flask 的 ``<string:token>``：两边都是「不含斜杠的一段」，
   语义相同，不需要写转换器。

④ **鉴权不用 @login_required / @permission_required 装饰器。**
   本模块所有出口（含 401/403）都长成 ``{"status": "error", "message": "<中文句子>"}``，
   而 core.auth 装饰器的拒绝出口是它自己写死的响应体。换过去就等于换掉
   「未登录」/「没有 account_submit_claim 权限」/「没有查看报销单权限」/
   「没有 account_edit 权限」这几句话。所以照搬原结构：每条路由**函数体第一行**
   显式调 require_*()，抛出的 AccountError 由 try/except 统一转成响应。
   ⚠️ 后果是「权限检查在路由体内」——请求会先被 FastAPI 解析完 body/表单才被拒。
      Flask 时代同样如此（装饰器也在视图内部调），不算行为变更。

── 与 Flask 的已知差异 ──────────────────────────────────────────────

  · **body 不是合法 JSON 时**：Flask 的 ``get_json(silent=True)`` 当成 ``{}`` 继续走，
    最终落到业务校验的 400（「action 必须是 approve 或 reject」之类）；
    FastAPI 直接回 422。状态码不同、都是失败，记在交付说明里。
  · **三条上传路由的表单解析**走 uploads.form_and_files 这个依赖，而不是
    ``= Form(...)`` / ``= File(...)`` 参数：这样 multipart 与 urlencoded 两种编码
    都认（Flask 的 request.form 就是两种都吃），非表单请求则落到空表单 → 业务层 400，
    与 Flask 一致。见那个文件的注释。
  · ``send_file(BytesIO, …)`` → ``Response(bytes, …)`` 而不是 FileResponse ——
    PDF 是内存里现画的，没有落盘路径。Content-Disposition 见 _pdf_attachment_response。

── ⚠️ 一条路由现在是坏的（不是本次搬坏的，是跨模块依赖）────────────
``POST /account/payments/{id}/status`` 对 **form / membership / youth_class** 三个
scope 会转发到还没搬的 app/form、app/user_control，那两个模块的函数体里真的在调
``flask.jsonify()`` —— FastAPI 进程里没有 Flask 应用上下文，会抛 RuntimeError。
manual / sales / fahui 三个 scope 是好的。详见 service.py 模块 docstring ★①。
"""

from typing import Optional

from fastapi import APIRouter, Body, Depends
from starlette.responses import Response

from backend.api.account.exceptions import AccountError
from backend.api.account.pdf import (
    build_claim_report_pdf,
    build_payment_report_pdf,
    build_payment_voucher_pdf,
)
from backend.api.account.permissions import (
    require_authenticated_user,
    require_claim_edit_permission,
    require_claim_list_permission,
    require_claim_submit_permission,
)
from backend.api.account.serializers import serialize_request_data
from backend.api.account.service import (
    add_claim_attachments,
    build_claim_report_context,
    build_payment_report_context,
    build_payment_voucher_context,
    build_public_payment_voucher_context,
    create_claim_from_form,
    create_manual_finance_payment,
    delete_claim,
    delete_claim_attachment,
    delete_manual_finance_payment,
    get_payment_voucher_share_data,
    get_public_payment_voucher_data,
    list_claims_for_user,
    list_finance_payments,
    read_bill_from_file,
    record_claim_decision,
    submit_public_payment_voucher_signature,
    update_claim,
    update_claim_event,
    update_finance_payment_status,
    withdraw_claim_decision,
)
from backend.core.uploads import form_and_files
from backend.core.config import settings
# 原来每个 except 分支里都写着 ``from backend.models import db``（Flask 时代为了绕
# 循环 import）。core.db 没有这个问题，提到模块顶上，rollback 的时机一字未变。
from backend.core.db import db
from backend.core.responses import json_response

# prefix 用 settings.api_prefix 拼而不是写死 "/account"：api_prefix 今天是空串，
# 但配置项留着是为了需要时还能整体把前缀加回来 —— 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/account", tags=["account"])

# 请求体的取法对应 Flask 的 ``request.get_json(silent=True) or {}``：
#   · ``Optional[dict]`` + ``Body(default=None)`` = 「整个 JSON 体就是这个参数」，
#     不带 embed，前端发什么形状进来就是什么形状。
#   · 没有 body / body 是 null 时落到 None，路由里 ``payload or {}`` 补成空字典，
#     后面的校验分支自然抛 ValidationError（400），与 silent=True 时一致。
_JSON_BODY = Body(default=None)


def _error_response(exc):
    """AccountError → 响应。等价于 Flask 版的 ``jsonify({...}), exc.status_code``。

    状态码来自异常类本身（401/403/404/400），见 exceptions.py 的那张表。
    """
    return json_response({"status": "error", "message": exc.message}, exc.status_code)


def _pdf_attachment_response(pdf_buffer, download_name):
    """等价 Flask 的 ``send_file(buf, mimetype="application/pdf", as_attachment=True,
    download_name=...)``。

    ★ 用 ``Response(bytes)`` 而不是 ``FileResponse``：pdf.py 画完返回的是一个
      已经 ``seek(0)`` 过的 BytesIO，磁盘上没有这个文件，FileResponse 要的是路径。
      starlette 会按 content 的长度自动补 Content-Length，和 send_file 一致。

    ★ Content-Disposition 写成**不带引号**的 ``attachment; filename=X.pdf`` ——
      这正是 werkzeug ``Headers.set("Content-Disposition", "attachment", filename=…)``
      在文件名是合法 token 时生成的形式（已对拍）。本模块三个文件名
      （PaymentReport_N / ClaimReport_N / PaymentVoucher_ID）全是 ASCII 字母数字
      加 ``_`` 和 ``.``，所以逐字节相同。
      TODO(照搬现状): 哪天文件名里混进中文或空格，这里要补 RFC 5987 的
      ``filename*=UTF-8''…``（werkzeug 是自动补的，这里不会）。
    """
    return Response(
        content=pdf_buffer.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={download_name}"},
    )


# --------------------------------------------------------------------------- #
# 报销申请：提交 / 列表
# --------------------------------------------------------------------------- #
@router.post("/submit_new_claim")
def submit_new_claim(parsed=Depends(form_and_files)):
    # parsed 是 (form, files)：form 对齐 request.form（纯文本字段），
    # files 对齐 request.files（只有 .get / .getlist）。见 uploads.py。
    form, files = parsed
    try:
        user = require_claim_submit_permission()
        request_obj = create_claim_from_form(form, files, user)
        return json_response(
            {
                "status": "success",
                "message": "申请提交成功",
                "data": serialize_request_data(request_obj),
            },
            201,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        # ⚠️ 这一支的信封和别处**不一样**：是 ``{"error": ...}`` 而不是
        # ``{"status": "error", "message": ...}``。原样保留 —— 前端 claim/api.ts
        # 在两个键上都做了兜底，改成统一形状反而要改前端。
        return json_response({"error": str(exc)}, 500)


@router.get("/get_all_claim")
def get_all_claim():
    try:
        user = require_claim_list_permission()
        result = list_claims_for_user(user)
        return json_response(
            {
                "status": "success",
                "can_view_all": result["can_view_all"],
                "count": len(result["data"]),
                "data": result["data"],
            },
            200,
        )
    except AccountError as exc:
        return _error_response(exc)


# --------------------------------------------------------------------------- #
# 财政收款（聚合列表：报名 / 法会 / 销售 / 手动）
# --------------------------------------------------------------------------- #
@router.get("/payments")
def get_finance_payments(scope: Optional[str] = None, status: Optional[str] = None):
    # 两个参数都声明成 ``Optional[str] = None``，对齐 ``request.args.get(k)``：
    # 缺参数 → None，``?scope=`` → ""。service 里 ``scope in (None, "", "all")``
    # 这一串判断把两者都当成「全都要」，所以不能在这里 ``or None`` 归一化 ——
    # 归一化本身无害，但会让那行判断看起来有冗余分支，下一个人就会去删它。
    try:
        require_claim_list_permission()
        payments = list_finance_payments(
            scope=scope,
            status=status,
        )
        return json_response({"status": "success", "count": len(payments), "payments": payments}, 200)
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.post("/payments/manual")
def create_manual_finance_payment_route(payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_claim_edit_permission()
        payment = create_manual_finance_payment(payload or {}, user)
        return json_response({"status": "success", "message": "收款已新建", "payment": payment}, 201)
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.delete("/payments/manual/{payment_id:int}")
def delete_manual_finance_payment_route(payment_id: int):
    try:
        require_claim_edit_permission()
        delete_manual_finance_payment(payment_id)
        return json_response({"status": "success", "message": "收款记录已移除"}, 200)
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.post("/payments/{payment_id:int}/status")
def update_finance_payment_status_route(payment_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        require_claim_edit_permission()
        # service 返回的是**响应对象**（不是数据），这里直接透传 —— 与 Flask 版一致。
        # ⚠️ form / membership / youth_class 三个 scope 目前会抛 RuntimeError，
        #    见模块 docstring 末尾那段。注意这条路由**没有** except Exception，
        #    所以那三个 scope 会冒成框架级 500（原来也是这样）。
        return update_finance_payment_status(payment_id, payload or {})
    except AccountError as exc:
        return _error_response(exc)


@router.post("/payments/report")
def download_payment_report(payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_claim_list_permission()
        data = payload or {}
        payments = build_payment_report_context(data.get("payment_ids") or [], user)
        pdf_buffer = build_payment_report_pdf(payments)
        return _pdf_attachment_response(pdf_buffer, f"PaymentReport_{len(payments)}.pdf")
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        # 注意这一支**没有** db.session.rollback()（原文如此）：这条路由只读不写。
        return json_response({"status": "error", "message": str(exc)}, 500)


# --------------------------------------------------------------------------- #
# 报销单：AI 读单 / 批量导出
# --------------------------------------------------------------------------- #
# ⚠️ ``/claim/read_bill`` 与 ``/claim/report`` 必须排在 ``/claim/{request_id:int}``
#    **之前**，见模块头 ③。
@router.post("/claim/read_bill")
def read_claim_bill(parsed=Depends(form_and_files)):
    form, files = parsed
    try:
        require_claim_submit_permission()
        payload = read_bill_from_file(
            files.get("file"),
            form.get("model"),
            form.get("debug"),
            form.get("bypass"),
        )
        # ``**payload`` 把 AI 返回的 data/meta 平铺到顶层（不是塞进 "data"）——
        # 前端 readBillFill.ts 直接读 ``json.data`` / ``json.meta``，别加一层。
        return json_response({"status": "success", **payload}, 200)
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.post("/claim/report")
def download_claim_report(payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_claim_list_permission()
        data = payload or {}
        claims = build_claim_report_context(data.get("claim_ids") or [], user)
        pdf_buffer = build_claim_report_pdf(claims)
        return _pdf_attachment_response(pdf_buffer, f"ClaimReport_{len(claims)}.pdf")
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        return json_response({"status": "error", "message": str(exc)}, 500)


# --------------------------------------------------------------------------- #
# 报销单：审批 / 撤回 / 删除 / 编辑 / 附件 / 关联活动
# --------------------------------------------------------------------------- #
@router.post("/claim_decision/{request_id:int}")
def claim_decision(request_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_claim_edit_permission()
        request_obj = record_claim_decision(request_id, payload or {}, user)
        return json_response(
            {
                "status": "success",
                "message": "操作成功",
                "data": serialize_request_data(request_obj, with_children=True),
            },
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.post("/claim/{request_id:int}/withdraw_decision")
def withdraw_claim_decision_route(request_id: int):
    try:
        # ★ 这里只要求**登录**，不要求 account_edit —— 撤回的是「自己的」签名，
        #   service 里按 user.id 过滤审批行，查不到就 404。别顺手加权限校验。
        user = require_authenticated_user()
        request_obj = withdraw_claim_decision(request_id, user)
        return json_response(
            {
                "status": "success",
                "message": "已撤回你的审批签名",
                "data": serialize_request_data(request_obj, with_children=True),
            },
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.delete("/delete_claim/{request_id:int}")
def delete_claim_route(request_id: int):
    try:
        user = require_claim_edit_permission()
        delete_claim(request_id, user)
        return json_response({"status": "success", "message": "申请已删除"}, 200)
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.put("/claim/{request_id:int}")
def update_claim_route(request_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        user = require_claim_edit_permission()
        request_obj = update_claim(request_id, payload or {}, user)
        return json_response(
            {
                "status": "success",
                "message": "申请已更新",
                "data": serialize_request_data(request_obj, with_children=True),
            },
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.post("/claim/{request_id:int}/attachments")
def add_claim_attachments_route(request_id: int, parsed=Depends(form_and_files)):
    _form, files = parsed
    try:
        # ★ 这里是 list 权限（不是 edit）：申请人自己也要能补附件。
        #   真正的「是不是这张单的申请人」判断在 service 里。
        user = require_claim_list_permission()
        request_obj = add_claim_attachments(request_id, files, user)
        return json_response(
            {
                "status": "success",
                "message": "附件已上传",
                "data": serialize_request_data(request_obj, with_children=True),
            },
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.delete("/claim/attachments/{attachment_id:int}")
def delete_claim_attachment_route(attachment_id: int):
    try:
        user = require_claim_list_permission()
        request_obj = delete_claim_attachment(attachment_id, user)
        return json_response(
            {
                "status": "success",
                "message": "附件已删除",
                "data": serialize_request_data(request_obj, with_children=True),
            },
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.put("/claim/{request_id:int}/event")
def update_claim_event_route(request_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        # 同 withdraw：只要求登录。「关联活动」只改记账归属，不动金额/明细，
        # 所以已批准的单也允许改（service 里有注释）。
        user = require_authenticated_user()
        request_obj = update_claim_event(request_id, payload or {}, user)
        return json_response(
            {
                "status": "success",
                "message": "活动已更新",
                "data": serialize_request_data(request_obj, with_children=True),
            },
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


# --------------------------------------------------------------------------- #
# Payment Voucher（原 payment_voucher_bp，挂在 /account/print_payment_voucher）
#
# 下面 5 条的路径里自带 "/print_payment_voucher" 这一段，拼上 router 的 prefix
# 之后与原来的两层蓝图前缀**逐字一致**。改这里的任何一段路径 = 改前端。
# --------------------------------------------------------------------------- #
@router.api_route("/print_payment_voucher/download_payment_voucher/{request_id:int}", methods=["GET", "HEAD"])
def download_payment_voucher(request_id: int):
    try:
        user = require_authenticated_user()
        # 访问控制在 service 里：有 account_read/account_edit，**或者**自己批准过这张单。
        data, approver_list = build_payment_voucher_context(request_id, user)
        pdf_buffer = build_payment_voucher_pdf(data, approver_list)
        return _pdf_attachment_response(pdf_buffer, f"PaymentVoucher_{data['id']}.pdf")
    except AccountError as exc:
        return _error_response(exc)


@router.get("/print_payment_voucher/share_payment_voucher/{request_id:int}")
def share_payment_voucher(request_id: int):
    try:
        user = require_authenticated_user()
        # 原文没有显式写 200（Flask 的 jsonify 默认 200），json_response 同默认。
        return json_response(
            {
                "status": "success",
                "data": get_payment_voucher_share_data(request_id, user),
            }
        )
    except AccountError as exc:
        return _error_response(exc)


@router.get("/print_payment_voucher/public/{token}")
def get_public_payment_voucher(token: str):
    # ★ 这三条 public 路由**没有任何鉴权**：凭 token 就能看 / 签 / 下载。
    #   token 是建单时生成的 uuid4().hex，这是设计（要发给供应商签收），不是漏配。
    try:
        return json_response(
            {
                "status": "success",
                "data": get_public_payment_voucher_data(token),
            }
        )
    except AccountError as exc:
        return _error_response(exc)


@router.post("/print_payment_voucher/public/{token}/sign")
def sign_public_payment_voucher(token: str, payload: Optional[dict] = _JSON_BODY):
    try:
        return json_response(
            {
                "status": "success",
                "data": submit_public_payment_voucher_signature(token, payload or {}),
            }
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


@router.api_route("/print_payment_voucher/public/{token}/download", methods=["GET", "HEAD"])
def download_public_payment_voucher(token: str):
    try:
        data, approver_list = build_public_payment_voucher_context(token)
        pdf_buffer = build_payment_voucher_pdf(data, approver_list)
        return _pdf_attachment_response(pdf_buffer, f"PaymentVoucher_{data['id']}.pdf")
    except AccountError as exc:
        return _error_response(exc)
