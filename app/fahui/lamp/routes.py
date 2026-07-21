from flask import Blueprint, request

from app.form.permissions import permission_required_any

from . import services


lamp_registration_bp = Blueprint("lampRegistration_API", __name__)


def _json_payload():
    return request.get_json(silent=True) or {}


def _payload_with_optional_id(record_id=None):
    payload = _json_payload()
    if record_id is not None:
        payload["id"] = record_id
    return payload


@lamp_registration_bp.route("/ping", methods=["GET"])
@lamp_registration_bp.route("/health", methods=["GET"])
def healthcheck_route():
    return services.ping()


@lamp_registration_bp.route("/registrations", methods=["POST"])
@lamp_registration_bp.route("/register", methods=["POST"])
def create_registration_route():
    return services.create_registration(_json_payload())


@lamp_registration_bp.route("/registrations/<int:registration_id>", methods=["PATCH"])
@lamp_registration_bp.route("/registrations/update", methods=["POST"])
@lamp_registration_bp.route("/edit", methods=["POST"])
@permission_required_any("account_edit")
def update_registration_route(registration_id=None):
    return services.update_registration(_payload_with_optional_id(registration_id))


@lamp_registration_bp.route("/registrations/<int:registration_id>", methods=["DELETE"])
@lamp_registration_bp.route("/registrations/delete", methods=["POST"])
@lamp_registration_bp.route("/delete", methods=["POST"])
@permission_required_any("account_edit")
def delete_registration_route(registration_id=None):
    return services.delete_registration(_payload_with_optional_id(registration_id))


@lamp_registration_bp.route("/payments/review", methods=["GET"])
@lamp_registration_bp.route("/payments", methods=["GET"])
@lamp_registration_bp.route("/get_all_register_by_payment", methods=["GET"])
@permission_required_any("account_read", "account_edit")
def list_payment_reviews_route():
    return services.list_payments_with_registrations()


@lamp_registration_bp.route("/registrations", methods=["GET"])
@lamp_registration_bp.route("/get_all_register", methods=["GET"])
def list_registrations_route():
    return services.list_registrations()


@lamp_registration_bp.route("/registrations/query", methods=["POST"])
@lamp_registration_bp.route("/registrations/by-ids", methods=["POST"])
@lamp_registration_bp.route("/get_by_ids", methods=["POST"])
def list_registrations_by_ids_route():
    return services.get_registrations_by_ids(_json_payload())


@lamp_registration_bp.route("/payments", methods=["POST"])
@lamp_registration_bp.route("/make_payment", methods=["POST"])
def create_payment_route():
    return services.create_payment(request.form, request.files)


@lamp_registration_bp.route("/payments/<int:payment_id>", methods=["DELETE"])
@lamp_registration_bp.route("/payments/delete", methods=["POST"])
@lamp_registration_bp.route("/remove_payment", methods=["POST"])
@permission_required_any("account_edit")
def delete_payment_route(payment_id=None):
    return services.delete_payment(_payload_with_optional_id(payment_id))


@lamp_registration_bp.route("/payments/<int:payment_id>/file", methods=["GET"])
@lamp_registration_bp.route("/payment_file/<int:payment_id>", methods=["GET"])
@permission_required_any("account_read", "account_edit")
def get_payment_file_route(payment_id):
    return services.get_payment_file(payment_id)


@lamp_registration_bp.route("/payments/<int:payment_id>/approve", methods=["POST"])
@lamp_registration_bp.route("/payments/approve", methods=["POST"])
@lamp_registration_bp.route("/approve_payment", methods=["POST"])
@permission_required_any("account_edit")
def approve_payment_route(payment_id=None):
    return services.approve_payment_record(_payload_with_optional_id(payment_id))


@lamp_registration_bp.route("/payments/<int:payment_id>/revoke", methods=["POST"])
@lamp_registration_bp.route("/payments/revoke", methods=["POST"])
@permission_required_any("account_edit")
def revoke_payment_route(payment_id=None):
    return services.revoke_payment_record(_payload_with_optional_id(payment_id))
