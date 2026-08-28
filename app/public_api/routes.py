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
    return jsonify({"status": "success", "data": data})


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
