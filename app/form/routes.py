from flask import Blueprint, jsonify, request

from models.form import RegisForm

from app.common import council_sign
from . import ai_grouping, form_agent, services
from .permissions import (
    FORM_EDIT_PERMISSION_NAMES,
    FORM_LIST_PERMISSION_NAMES,
    FORM_MEMBER_DETAIL_PERMISSION_NAMES,
    FORM_PAYMENT_EDIT_PERMISSION_NAMES,
    FORM_PAYMENT_READ_PERMISSION_NAMES,
    FORM_READ_PERMISSION_NAMES,
    YOUTH_CLASS_COUNCIL_PERMISSION_NAMES,
    YOUTH_CLASS_EDIT_PERMISSION_NAMES,
    YOUTH_CLASS_READ_PERMISSION_NAMES,
    current_user_has_any_permission,
    permission_required_any,
)


form_bp = Blueprint("form", __name__)


def _serialize_form_base(form):
    data = form.to_dict_event(is_public=True)
    data["member_count"] = len(form.members or [])
    return data


def _serialize_form_list_item(form, include_payments=False):
    data = _serialize_form_base(form)
    if include_payments:
        data["payments"] = [payment.to_dict() for payment in form.payments]
    return data


def _serialize_form_detail(form, include_members=False):
    data = _serialize_form_base(form)
    data["members"] = [member.to_dict(form_id=form.id) for member in form.members] if include_members else []
    return data


@form_bp.route("/index/<form_id>", methods=["GET"])
def form_index(form_id):
    return services.form_index_response(form_id)


@form_bp.route("/pay_register/<form_id>", methods=["GET"])
def pay_register_page(form_id):
    return services.pay_register_page_response(form_id)


@form_bp.route("/parental_sign", methods=["GET"])
def parental_sign_page():
    return services.parental_sign_page()


@form_bp.route("/parental_sign_share", methods=["POST"])
def parental_sign_share():
    return services.create_parental_sign_share(request.get_json(silent=True) or {})


@form_bp.route("/event_poster/<int:form_id>/<type>", methods=["GET"])
def event_poster(form_id, type="base"):
    del type
    return services.event_poster_response(form_id)


@form_bp.route("/create", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def create_form():
    return services.create_form(request.get_json(silent=True) or {})


@form_bp.route("/remove_form", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def remove_form():
    return services.remove_form(request.get_json(silent=True) or {})


@form_bp.route("/register/<int:form_id>", methods=["POST"])
def register_member(form_id):
    return services.register_member(form_id, request.get_json(silent=True) or {})


@form_bp.route("/parental/complete/<int:form_id>", methods=["POST"])
def complete_parental_consent(form_id):
    return services.complete_parental_consent(form_id, request.get_json(silent=True) or {})


@form_bp.route("/get_form/<int:form_id>", methods=["GET"])
@permission_required_any(*FORM_READ_PERMISSION_NAMES)
def get_form_detail(form_id):
    form = RegisForm.query.get_or_404(form_id)
    include_members = current_user_has_any_permission(FORM_MEMBER_DETAIL_PERMISSION_NAMES)
    return jsonify({"status": "success", "form": _serialize_form_detail(form, include_members=include_members)})


@form_bp.route("/payment_quote/<int:form_id>", methods=["GET"])
def get_payment_quote(form_id):
    return services.get_payment_quote(form_id, request.args.get("nric"))


@form_bp.route("/payment/create/<int:form_id>", methods=["POST"])
def create_payment(form_id):
    return services.create_payment(form_id, request.form, request.files.get("proof_image"))


@form_bp.route("/payment/proof_image/<int:payment_id>", methods=["GET"])
@permission_required_any(*FORM_PAYMENT_READ_PERMISSION_NAMES)
def get_payment_proof_image(payment_id):
    return services.get_payment_proof_image(payment_id)


@form_bp.route("/payment/update_status/<int:payment_id>", methods=["POST"])
@permission_required_any(*FORM_PAYMENT_EDIT_PERMISSION_NAMES)
def update_payment_status(payment_id):
    return services.update_payment_status(payment_id, request.get_json(silent=True) or {})


@form_bp.route("/payment/proof_image/<int:payment_id>/replace", methods=["POST"])
@permission_required_any(*FORM_PAYMENT_EDIT_PERMISSION_NAMES)
def replace_payment_proof_image(payment_id):
    return services.replace_payment_proof_image(payment_id, request.files.get("proof_image"))


@form_bp.route("/payment/<int:payment_id>", methods=["DELETE"])
@permission_required_any(*FORM_PAYMENT_EDIT_PERMISSION_NAMES)
def delete_payment_record(payment_id):
    return services.delete_payment_record(payment_id)


@form_bp.route("/get_all_form", methods=["GET"])
@permission_required_any(*FORM_LIST_PERMISSION_NAMES)
def get_all_form():
    forms = RegisForm.query.order_by(RegisForm.created_at.desc()).all()
    include_payments = current_user_has_any_permission({"account_read", "account_edit"})
    return jsonify(
        {
            "status": "success",
            "forms": [
                _serialize_form_list_item(form, include_payments=include_payments)
                for form in forms
            ],
        }
    )


@form_bp.route("/extra_field/add/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def add_extra_field(form_id):
    return services.add_extra_field(form_id, request.get_json() or {})


@form_bp.route("/extra_field/edit/<int:field_id>", methods=["PUT"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def edit_extra_field(field_id):
    return services.edit_extra_field(field_id, request.get_json() or {})


@form_bp.route("/extra_field/delete/<int:field_id>", methods=["DELETE"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def delete_extra_field(field_id):
    return services.delete_extra_field(field_id)


@form_bp.route("/extra_field/list/<int:form_id>", methods=["GET"])
@permission_required_any(*FORM_READ_PERMISSION_NAMES)
def list_extra_fields(form_id):
    return services.list_extra_fields(form_id)


@form_bp.route("/fee/add/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def add_fee(form_id):
    return services.add_fee(form_id, request.get_json() or {})


@form_bp.route("/fee/upload_image", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def upload_fee_image():
    return services.upload_fee_image(request.files.get("image"))


@form_bp.route("/fee/edit/<int:fee_id>", methods=["PUT"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def edit_fee(fee_id):
    return services.edit_fee(fee_id, request.get_json() or {})


@form_bp.route("/fee/delete/<int:fee_id>", methods=["DELETE"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def delete_fee(fee_id):
    return services.delete_fee(fee_id)


@form_bp.route("/fee/list/<int:form_id>", methods=["GET"])
@permission_required_any(*FORM_READ_PERMISSION_NAMES)
def list_fees(form_id):
    return services.list_fees(form_id)


@form_bp.route("/add_event/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def add_event_to_form(form_id):
    return services.add_event_to_form(form_id, request.get_json() or {})


@form_bp.route("/remove_event/<int:form_id>", methods=["DELETE"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def remove_event_from_form(form_id):
    return services.remove_event_from_form(form_id, request.get_json() or {})


@form_bp.route("/remove_regis_form_member", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def remove_regis_form_member():
    return services.remove_regis_form_member(request.get_json() or {})


# -------- 报名成员分组（小组）--------
@form_bp.route("/group/list/<int:form_id>", methods=["GET"])
@permission_required_any(*FORM_READ_PERMISSION_NAMES)
def list_form_groups(form_id):
    return services.list_form_groups(form_id)


@form_bp.route("/group/create/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def create_form_group(form_id):
    return services.create_form_group(form_id, request.get_json(silent=True) or {})


@form_bp.route("/group/rename/<int:group_id>", methods=["PUT"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def rename_form_group(group_id):
    return services.rename_form_group(group_id, request.get_json(silent=True) or {})


@form_bp.route("/group/delete/<int:group_id>", methods=["DELETE"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def delete_form_group(group_id):
    return services.delete_form_group(group_id)


@form_bp.route("/group/assign", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def assign_member_group():
    return services.assign_member_group(request.get_json(silent=True) or {})


@form_bp.route("/group/ai_chat/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def group_ai_chat(form_id):
    return ai_grouping.ai_group_chat(form_id, request.get_json(silent=True) or {})


@form_bp.route("/group/apply_plan/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def group_apply_plan(form_id):
    return ai_grouping.apply_group_plan(form_id, request.get_json(silent=True) or {})


# -------- 报名表 AI Agent --------
@form_bp.route("/agent/chat/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def form_agent_chat(form_id):
    return form_agent.form_agent_chat(form_id, request.get_json(silent=True) or {})


@form_bp.route("/agent/apply/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def form_agent_apply(form_id):
    return form_agent.apply_form_agent_plan(form_id, request.get_json(silent=True) or {})


# -------- 点名（出席快照）--------
@form_bp.route("/attendance/list/<int:form_id>", methods=["GET"])
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def list_form_attendances(form_id):
    return services.list_form_attendances(form_id)


@form_bp.route("/attendance/get/<int:attendance_id>", methods=["GET"])
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def get_form_attendance(attendance_id):
    return services.get_form_attendance(attendance_id)


@form_bp.route("/attendance/create/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def create_form_attendance(form_id):
    return services.create_form_attendance(form_id, request.get_json(silent=True) or {})


@form_bp.route("/attendance/delete/<int:attendance_id>", methods=["DELETE"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def delete_form_attendance(attendance_id):
    return services.delete_form_attendance(attendance_id)


@form_bp.route("/edit_member", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def edit_member():
    return services.edit_member(request.get_json() or {})


@form_bp.route("/preview_member_nric_change", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def preview_member_nric_change():
    return services.preview_member_nric_change(request.get_json() or {})


@form_bp.route("/get_nric_detail", methods=["GET"])
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def get_nric_detail():
    return services.get_nric_detail(request.args.get("nric"))


@form_bp.route("/edit_form/<int:form_id>", methods=["POST"])
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def edit_form(form_id):
    return services.edit_form(form_id, request.get_json(silent=True) or {})


@form_bp.route("/html_to_pdf", methods=["POST"])
def html_to_pdf():
    return services.html_to_pdf()


@form_bp.route("/youth-class-registration/submit", methods=["POST"])
def submit_youth_class_registration_route():
    return services.submit_youth_class_registration(request.get_json(silent=True) or {})


@form_bp.route("/youth-class-registration/entries", methods=["GET"])
@permission_required_any(*YOUTH_CLASS_READ_PERMISSION_NAMES)
def get_youth_class_registration_entries():
    return services.get_youth_class_registrations()


@form_bp.route("/youth-class-registration/settings", methods=["GET"])
@permission_required_any(*YOUTH_CLASS_READ_PERMISSION_NAMES)
def get_youth_class_registration_settings():
    return services.get_youth_class_payment_settings()


@form_bp.route("/youth-class-registration/settings", methods=["PUT"])
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def update_youth_class_registration_settings():
    return services.update_youth_class_payment_settings(request.get_json(silent=True) or {})


@form_bp.route("/youth-class-registration/entries/<int:entry_id>/status", methods=["POST"])
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def update_youth_class_registration_status_route(entry_id):
    return services.update_youth_class_registration_status(entry_id, request.get_json(silent=True) or {})


@form_bp.route("/youth-class-registration/nric-check", methods=["GET"])
def get_youth_class_nric_check_route():
    return services.get_youth_class_nric_check(request.args.get("nric"))


@form_bp.route("/youth-class-registration/payment/<token>", methods=["GET"])
def get_youth_class_payment_context_route(token):
    return services.get_youth_class_payment_context(token)


@form_bp.route("/youth-class-registration/payment/<token>/submit", methods=["POST"])
def submit_youth_class_payment_route(token):
    return services.submit_youth_class_payment(token, request.form, request.files.get("proof_image"))


@form_bp.route("/youth-class-registration/payment/proof_image/<int:payment_id>", methods=["GET"])
@permission_required_any(*YOUTH_CLASS_READ_PERMISSION_NAMES)
def get_youth_class_payment_proof_image_route(payment_id):
    return services.get_youth_class_payment_proof_image(payment_id)


@form_bp.route("/youth-class-registration/payment/<int:payment_id>/status", methods=["POST"])
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def update_youth_class_payment_status_route(payment_id):
    return services.update_youth_class_payment_status(payment_id, request.get_json(silent=True) or {})


@form_bp.route("/youth-class-registration/<int:entry_id>/council-sign", methods=["POST"])
@permission_required_any(*YOUTH_CLASS_COUNCIL_PERMISSION_NAMES)
def add_youth_class_council_signature_route(entry_id):
    return council_sign.add_council_signature("youth_class", entry_id, request.get_json(silent=True) or {})


@form_bp.route("/youth-class-registration/council-sign/batch-url", methods=["POST"])
@permission_required_any(*YOUTH_CLASS_READ_PERMISSION_NAMES)
def create_youth_class_council_batch_url():
    payload = request.get_json(silent=True) or {}
    return council_sign.batch_sign_url_response("youth_class", payload.get("registration_ids"))


@form_bp.route("/youth-class-registration/<int:entry_id>", methods=["PUT"])
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def update_youth_class_registration_fields_route(entry_id):
    return services.update_youth_class_registration_fields(entry_id, request.get_json(silent=True) or {})


@form_bp.route("/youth-class-registration/<int:entry_id>/remove", methods=["POST"])
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def remove_youth_class_registration_route(entry_id):
    return services.remove_youth_class_registration(entry_id)


@form_bp.route("/youth-class-registration/<int:entry_id>/upgrade-to-membership", methods=["POST"])
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def upgrade_youth_to_membership_route(entry_id):
    return services.upgrade_youth_to_membership(entry_id)
