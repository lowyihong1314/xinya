"""点灯法会登记的业务逻辑（原 backend/app/fahui/lamp/services.py，逐行照搬）。

搬迁只动了四类 import，函数体**一个字节没改**：

    flask.jsonify                 → core.responses.json_response（``jsonify(d), 400`` 这种
                                    元组写法 FastAPI 不认，逐处改成 json_response(d, 400)）
    flask_login.current_user      → core.auth.current_user（ContextVar 代理，同名同语义）
    backend.models.db             → backend.core.db.db（同一个对象，少走一层包初始化）
    ..common.*                    → .fahui_common（延迟 import 桥，理由在那个文件里）

校验顺序、状态码、中文文案、响应体的键名与嵌套形状全部是前端在按着分支的契约。

★ 几处「看着像 bug、故意保留」的地方，改之前先想清楚：

  ① ``create_registration`` 的开放窗口只挡**未登录**请求：CRM 后台（已登录）任何时候
     都能补录。所以「登记已关闭」不是一个全局开关，而是只对公开页生效。

  ② 新建登记写死 ``status="draft"``，而模型 ``LampRegistration.status`` 的默认值是
     ``"submitted"``。两个值都在用（``update_registration`` 只认
     draft/confirm/cancel 三个），前端的筛选按钮按 draft 来，保持。

  ③ ``_resolve_lamp_amount`` 里随缘供斋的金额**不做 quantize**（用户填 88.888 就存
     88.888，由 Numeric(10,2) 列去截），而 ``_parse_payment_amount``（付款金额）
     quantize 到两位。两条路径不一致，但都是线上既有行为，不要「顺手对齐」。

  ④ ``delete_payment`` / ``review_payment_record`` 里的 ``int(payment_id)`` **没有
     try**：``{"id": "abc"}`` 会抛 ValueError → 500（Flask 时代同样是 500）。
     TODO(点灯): 真要修就在这里补一个 400「id 格式错误」，但那是行为变更，得同时改前端。

  ⑤ 五处 500 出口都把 ``str(exc)`` 原样放进响应体的 ``error`` 键 —— 会把 SQL 片段
     泄露给调用方。照搬（前端的错误弹窗在显示它，运维也在靠它定位）。
     TODO(收尾): 统一改成只记日志，需要和前端一起改。

  ⑥ ``get_registrations_by_ids`` 在「公开访客」模式下先查库再按手机号过滤，过滤后为空
     和「这些 id 本来就不存在」共用同一个 404 出口。这是**故意的**：两者回同一句话，
     访客就没法拿 id 去探测某条登记存不存在。

  ⑦ ``create_payment`` 只要 ``reg_ids`` 里**有一条**登记存在就建付款，不存在的那些
     id 被静默丢掉（``in_()`` 查出几条算几条），金额也不与登记总额核对。保持。
"""

from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

# current_user 从 flask_login 换成 core.auth 的 ContextVar 代理：同名同语义
# （.is_authenticated），create_registration 里那一行不用改。
from backend.core.auth import current_user

# 原来是 from backend.models import db —— 那是 core.db 同一个对象的再导出。
from backend.core.db import db
from backend.core.paths import DATA_ROOT
from backend.core.responses import json_response
from backend.models.fahui import FahuiPayment
from backend.models.lamp_registration import (
    Lamp,
    LampRegistration,
    lamp_payment_registration,
)

# 共用件全部走桥（真正的 import 在调用时才发生，见 fahui_common.py 的说明）。
# 原文件里 can_access_phone_records 是写在函数体内 import 的（躲 app.fahui 的包初始化），
# 桥本身没有这个问题，所以提到顶层；调用时机与原来一样，都是请求进来之后。
from backend.api.lamp.fahui_common import (
    PAYMENT_TYPE_LAMP,
    can_access_phone_records,
    delete_payment_record,
    get_payment_document as get_review_payment_document,
    is_open as open_window_is_open,
    list_review_payments,
    save_payment_upload as save_common_payment_upload,
    update_payment_review,
)
from backend.api.lamp.serializers import serialize_registration


LAMP_PAYMENT_DIR = DATA_ROOT / "lamp_payment_images"


def ping():
    # 返回的是裸字符串，由 router 包成 text 响应（Flask 那边是 return "pong"）。
    return "pong"


def _parse_registration_ids(raw_value):
    if not raw_value:
        raise ValueError("缺少 registration_ids")
    try:
        registration_ids = [int(item) for item in str(raw_value).split(",") if item]
    except Exception as exc:
        raise ValueError("registration_ids 格式错误") from exc
    if not registration_ids:
        raise ValueError("registration_ids 格式错误")
    return registration_ids


def _parse_payment_amount(raw_amount):
    if raw_amount in ("", None):
        raise ValueError("缺少 amount")
    try:
        amount = Decimal(str(raw_amount))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("amount 格式错误") from exc
    if amount <= 0:
        raise ValueError("amount 必须大于 0")
    return amount.quantize(Decimal("0.01"))


def create_registration(data):
    # 开放时间之外拒绝公开报名；已登录用户（CRM 后台）不受限制。
    if not current_user.is_authenticated and not open_window_is_open("lamp"):
        return json_response({"status": "error", "message": "点灯法会登记目前未开放"}, 403)
    try:
        devotee_name = (data.get("devotee_name") or "").strip()
        if not devotee_name:
            return json_response({"status": "error", "message": "请填写祈福者姓名"}, 400)

        lamps = data.get("lamps") or []
        if not lamps or not isinstance(lamps, list):
            return json_response({"status": "error", "message": "请至少选择一盏供灯"}, 400)

        registration = LampRegistration(
            devotee_name=devotee_name,
            address=data.get("address"),
            phone=data.get("phone"),
            total_amount=Decimal("0.00"),
            status="draft",
        )
        db.session.add(registration)
        db.session.flush()

        total_amount = Decimal("0.00")
        for item in lamps:
            amount = _resolve_lamp_amount(item)
            lamp = Lamp(
                registration_id=registration.id,
                lamp_type=item.get("lamp_type"),
                amount=amount,
                note=item.get("note"),
            )
            db.session.add(lamp)
            total_amount += amount

        registration.total_amount = total_amount
        db.session.commit()
        return json_response(
            {
                "status": "success",
                "message": "报名成功",
                "data": {
                    "id": registration.id,
                    "devotee_name": registration.devotee_name,
                    "total_amount": str(registration.total_amount),
                },
            }
        )
    except ValueError as exc:
        # _resolve_lamp_amount 抛的那几句（「不合法的供灯类型：…」等）就是从这里出去的，
        # 所以供灯类型写错是 400 不是 500。
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 400)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": "服务器错误", "error": str(exc)}, 500)


def update_registration(data):
    try:
        reg_id = data.get("id")
        if not reg_id:
            return json_response({"status": "error", "message": "缺少 id"}, 400)

        registration = LampRegistration.query.get(reg_id)
        if not registration:
            return json_response({"status": "error", "message": "记录不存在"}, 404)

        # 三个字段都是「键在就改」（值为 null 等于清空），不是「值非空才改」。
        if "devotee_name" in data:
            name = (data.get("devotee_name") or "").strip()
            if not name:
                return json_response({"status": "error", "message": "祈福者姓名不能为空"}, 400)
            registration.devotee_name = name

        if "address" in data:
            registration.address = data.get("address")
        if "phone" in data:
            registration.phone = data.get("phone")
        if "status" in data:
            if data["status"] not in ("draft", "confirm", "cancel"):
                return json_response({"status": "error", "message": "不合法的状态"}, 400)
            registration.status = data["status"]

        db.session.commit()
        return json_response(
            {"status": "success", "message": "修改成功", "data": {"id": registration.id}}
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": "服务器错误", "error": str(exc)}, 500)


def delete_registration(data):
    try:
        reg_id = data.get("id")
        if not reg_id:
            return json_response({"status": "error", "message": "缺少 id"}, 400)

        registration = LampRegistration.query.get(reg_id)
        if not registration:
            return json_response({"status": "error", "message": "记录不存在"}, 404)

        # 已经有人付过款的订单不给删：删了付款记录就挂空，对账时对不上。
        has_payment = (
            db.session.query(lamp_payment_registration)
            .filter(lamp_payment_registration.c.registration_id == registration.id)
            .first()
        )
        if has_payment:
            return json_response(
                {"status": "error", "message": "该订单已有付款记录，无法删除"}, 400
            )

        Lamp.query.filter(Lamp.registration_id == registration.id).delete(synchronize_session=False)
        db.session.delete(registration)
        db.session.commit()
        return json_response({"status": "success", "message": "删除成功"})
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": "服务器错误", "error": str(exc)}, 500)


def list_payments_with_registrations():
    # 响应对象由 fahui 那边造（形状是 {"success", "status", "data"} 三键，与 YLP 共用）。
    return list_review_payments(payment_type=PAYMENT_TYPE_LAMP)


def list_registrations():
    try:
        registrations = (
            db.session.query(LampRegistration).order_by(LampRegistration.created_at.desc()).all()
        )
        return json_response(
            {"status": "success", "data": [serialize_registration(reg) for reg in registrations]}
        )
    except Exception as exc:
        return json_response({"status": "error", "message": "服务器错误", "error": str(exc)}, 500)


def get_registrations_by_ids(data, restrict_to_verified_phone=False):
    try:
        ids = data.get("ids")
        if not ids or not isinstance(ids, list):
            return json_response({"status": "error", "message": "ids 参数无效"}, 400)

        registrations = (
            db.session.query(LampRegistration).filter(LampRegistration.id.in_(ids)).all()
        )
        if restrict_to_verified_phone:
            registrations = [r for r in registrations if can_access_phone_records(r.phone)]
        if not registrations:
            return json_response({"status": "error", "message": "找不到报名记录"}, 404)

        return json_response(
            {
                "status": "success",
                "data": [serialize_registration(registration) for registration in registrations],
            }
        )
    except Exception as exc:
        return json_response({"status": "error", "message": "服务器错误", "error": str(exc)}, 500)


def create_payment(form, files):
    try:
        try:
            reg_ids = _parse_registration_ids(form.get("registration_ids"))
            amount = _parse_payment_amount(form.get("amount"))
        except ValueError as exc:
            return json_response({"status": "error", "message": str(exc)}, 400)

        registrations = (
            db.session.query(LampRegistration).filter(LampRegistration.id.in_(reg_ids)).all()
        )
        if not registrations:
            return json_response({"status": "error", "message": "找不到报名记录"}, 404)

        payment = FahuiPayment(
            payment_type=PAYMENT_TYPE_LAMP,
            payer_name=form.get("payer_name"),
            phone=form.get("phone"),
            total_price=amount,
            payment_mode=form.get("method"),
            note=form.get("note"),
            paid_at=datetime.utcnow(),
            status="pending",
        )
        payment.lamp_registrations.extend(registrations)
        db.session.add(payment)
        # flush 是为了拿到 payment.id —— 落盘文件名就是它。
        db.session.flush()

        upload = files.get("file")
        if upload and upload.filename:
            # ``or "proof"`` 这一支进不来（上面的 if 已经保证 filename 非空），
            # 是原代码就有的死分支，照搬不删。
            filename = upload.filename or "proof"
            extension = Path(filename).suffix or ""
            payment.document = save_common_payment_upload(
                upload,
                save_dir=LAMP_PAYMENT_DIR,
                save_name=f"{payment.id}{extension}",
            )

        db.session.commit()
        return json_response({"status": "success", "data": {"payment_id": payment.id}})
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": "服务器错误", "error": str(exc)}, 500)


def delete_payment(data):
    payment_id = data.get("id")
    if not payment_id:
        return json_response({"status": "error", "message": "缺少 id"}, 400)
    return delete_payment_record(int(payment_id), payment_type=PAYMENT_TYPE_LAMP)


def get_payment_file(payment_id):
    return get_review_payment_document(payment_id, payment_type=PAYMENT_TYPE_LAMP)


def review_payment_record(data, approved=True):
    payment_id = data.get("id")
    if not payment_id:
        return json_response({"status": "error", "message": "缺少 id"}, 400)
    # 撤回写的是 "pending"（回到待审核），不是 "rejected" —— 前端「撤回」按钮就是这个意思。
    status = "approved" if approved else "pending"
    return update_payment_review(int(payment_id), status=status, payment_type=PAYMENT_TYPE_LAMP)


def approve_payment_record(data):
    return review_payment_record(data, approved=True)


def revoke_payment_record(data):
    return review_payment_record(data, approved=False)


def _resolve_lamp_amount(item):
    """一盏灯的金额：两种固定价 + 一种随缘价，别的类型一律抛。"""
    lamp_type = item.get("lamp_type")
    if lamp_type == "lamp_88":
        return Decimal("88.00")
    if lamp_type == "lamp_168":
        return Decimal("168.00")
    if lamp_type == "gong_zai":
        raw_amount = item.get("gong_zai_amount")
        if raw_amount is None:
            raise ValueError("随缘供斋金额不能为空")
        try:
            amount = Decimal(str(raw_amount))
        except (InvalidOperation, ValueError):
            raise ValueError("随缘供斋金额格式错误")
        if amount <= 0:
            raise ValueError("随缘供斋金额必须大于 0")
        return amount
    raise ValueError(f"不合法的供灯类型：{lamp_type}")
