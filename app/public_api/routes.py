import os

from flask import Blueprint, jsonify
from flask_login import current_user

from app.auth import permission_required
from app.paths import PROJECT_ROOT
from models.event_data import AlbumFiles, EventData
from models.form import RegisForm, RegisMember, RegisPayment

UPLOAD_FOLDER = os.path.join(PROJECT_ROOT, "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

api_bp = Blueprint("api", __name__)


@api_bp.get("/ping")
def ping():
    return "pong"


@api_bp.get("/get_event/<int:event_id>")
def get_event(event_id):
    event = EventData.query.get_or_404(event_id)
    data = event.to_dict_full()
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
    members = RegisMember.query.all()
    return jsonify([member.to_dict() for member in members])


@api_bp.get("/payments")
def get_payments():
    payments = RegisPayment.query.all()
    return jsonify([payment.to_dict() for payment in payments])
