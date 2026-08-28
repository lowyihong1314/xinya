from flask import Blueprint, jsonify
from flask_login import current_user

from app.auth import permission_required
from models.event_data import AlbumFiles, EventData
from models.form import NRIC_Asset, RegisForm, RegisPayment

api_bp = Blueprint("api", __name__)


@api_bp.get("/ping")
def ping():
    return "pong"


@api_bp.get("/get_event/<int:event_id>")
def get_event(event_id):
    event = EventData.query.get_or_404(event_id)
    # 未公开的活动对访客等于不存在（回 404 而不是 403：别让链接本身泄露有这么个活动）
    if not event.is_public and not current_user.is_authenticated:
        return jsonify({"status": "error", "message": "活动不存在"}), 404

    data = event.to_dict_full()
    # 公开接口：非登陆用户隐藏「仅登陆可见」的环节。
    if not current_user.is_authenticated:
        data["event_flows"] = [f for f in (data.get("event_flows") or []) if not f.get("login_only")]
    data["login"] = current_user.is_authenticated
    data["fahui_registration"] = _fahui_registration_for(event)
    return jsonify({"status": "success", "data": data})


# 法会工作区 → 公开登记页
_FAHUI_REGISTRATION_ROUTES = {"ylp": "/ylp-registration", "lamp": "/lamp-registration"}
_FAHUI_REGISTRATION_LABELS = {"ylp": "盂兰盆法会 · 牌位登记", "lamp": "点灯法会 · 供灯登记"}


def _fahui_registration_for(event):
    """活动绑定了某个法会版本时，给活动页一个「去登记」的入口。

    绑定关系就是 CRM 法会工作区那条「绑定活动」（fahui_version_event），
    收入也是靠它进活动预算的，这里顺带拿来在活动页挂报名入口。
    """
    from app.fahui.common import open_window
    from models.fahui import FahuiVersionEvent

    binding = (
        FahuiVersionEvent.query.filter_by(event_id=event.id)
        .order_by(FahuiVersionEvent.id.desc())
        .first()
    )
    if not binding:
        return None

    workspace = str(binding.workspace or "").strip() or "ylp"
    path = _FAHUI_REGISTRATION_ROUTES.get(workspace)
    if not path:
        return None

    # 登记页永远只写当年，所以往年的活动（例：2025 那场绑的是 2025_YLP）不给入口，
    # 免得访客从旧活动点进去、结果报了今年的名。
    if workspace == "ylp":
        from app.fahui.YLP.shared import active_order_version

        if str(binding.version or "") != active_order_version():
            return None

    try:
        is_open = open_window.is_open(workspace)
    except Exception:  # noqa: BLE001
        is_open = False

    return {
        "workspace": workspace,
        "version": binding.version,
        "path": path,
        "label": _FAHUI_REGISTRATION_LABELS.get(workspace, "法会登记"),
        "is_open": bool(is_open),
    }


@api_bp.get("/get_file_data/<int:file_id>")
def get_file_data(file_id):
    file = AlbumFiles.query.get_or_404(file_id)
    event = EventData.query.get(file.event_id) if file.event_id else None

    file_data = file.to_dict()
    file_data["login"] = current_user.is_authenticated
    event_data = event.to_dict() if event else None

    return jsonify(
        {
            "status": "success",
            "data": {"file": file_data, "event": event_data},
        }
    )


@api_bp.get("/forms")
@permission_required("member_edit")
def get_forms():
    forms = RegisForm.query.all()
    return jsonify([form.to_dict(with_child=True) for form in forms])


@api_bp.get("/members")
def get_members():
    members = NRIC_Asset.query.all()
    return jsonify([member.to_dict() for member in members])


@api_bp.get("/payments")
def get_payments():
    payments = RegisPayment.query.all()
    return jsonify([payment.to_dict() for payment in payments])
