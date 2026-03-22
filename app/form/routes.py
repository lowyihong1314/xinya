from flask import Blueprint, request

from app.auth import permission_required
from . import services


form_bp = Blueprint("form", __name__)


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
@permission_required("member_edit")
def create_form():
    return services.create_form(request.get_json(silent=True) or {})


@form_bp.route("/remove_form", methods=["POST"])
@permission_required("member_edit")
def remove_form():
    return services.remove_form(request.get_json(silent=True) or {})


@form_bp.route("/register/<int:form_id>", methods=["POST"])
def register_member(form_id):
    return services.register_member(form_id, request.get_json(silent=True) or {})


@form_bp.route("/get_form/<int:form_id>", methods=["GET"])
def get_form_detail(form_id):
    return services.get_form_detail(form_id)


@form_bp.route("/payment_quote/<int:form_id>", methods=["GET"])
def get_payment_quote(form_id):
    return services.get_payment_quote(form_id, request.args.get("nric"))


@form_bp.route("/payment/create/<int:form_id>", methods=["POST"])
def create_payment(form_id):
    return services.create_payment(form_id, request.form, request.files.get("proof_image"))


@form_bp.route("/payment/update_status/<int:payment_id>", methods=["POST"])
@permission_required("member_edit")
def update_payment_status(payment_id):
    return services.update_payment_status(payment_id, request.get_json(silent=True) or {})


@form_bp.route("/get_all_form", methods=["GET"])
def get_all_form():
    return services.get_all_form()


@form_bp.route("/extra_field/add/<int:form_id>", methods=["POST"])
@permission_required("member_edit")
def add_extra_field(form_id):
    return services.add_extra_field(form_id, request.get_json() or {})


@form_bp.route("/extra_field/edit/<int:field_id>", methods=["PUT"])
@permission_required("member_edit")
def edit_extra_field(field_id):
    return services.edit_extra_field(field_id, request.get_json() or {})


@form_bp.route("/extra_field/delete/<int:field_id>", methods=["DELETE"])
@permission_required("member_edit")
def delete_extra_field(field_id):
    return services.delete_extra_field(field_id)


@form_bp.route("/extra_field/list/<int:form_id>", methods=["GET"])
def list_extra_fields(form_id):
    return services.list_extra_fields(form_id)


@form_bp.route("/fee/add/<int:form_id>", methods=["POST"])
@permission_required("member_edit")
def add_fee(form_id):
    return services.add_fee(form_id, request.get_json() or {})


@form_bp.route("/fee/upload_image", methods=["POST"])
@permission_required("member_edit")
def upload_fee_image():
    return services.upload_fee_image(request.files.get("image"))


@form_bp.route("/fee/edit/<int:fee_id>", methods=["PUT"])
@permission_required("member_edit")
def edit_fee(fee_id):
    return services.edit_fee(fee_id, request.get_json() or {})


@form_bp.route("/fee/delete/<int:fee_id>", methods=["DELETE"])
@permission_required("member_edit")
def delete_fee(fee_id):
    return services.delete_fee(fee_id)


@form_bp.route("/fee/list/<int:form_id>", methods=["GET"])
def list_fees(form_id):
    return services.list_fees(form_id)


@form_bp.route("/add_event/<int:form_id>", methods=["POST"])
@permission_required("member_edit")
def add_event_to_form(form_id):
    return services.add_event_to_form(form_id, request.get_json() or {})


@form_bp.route("/remove_event/<int:form_id>", methods=["DELETE"])
@permission_required("member_edit")
def remove_event_from_form(form_id):
    return services.remove_event_from_form(form_id, request.get_json() or {})


@form_bp.route("/remove_regis_form_member", methods=["POST"])
@permission_required("member_edit")
def remove_regis_form_member():
    return services.remove_regis_form_member(request.get_json() or {})


@form_bp.route("/edit_member", methods=["POST"])
@permission_required("member_edit")
def edit_member():
    return services.edit_member(request.get_json() or {})


@form_bp.route("/get_nric_detail", methods=["GET"])
@permission_required("member")
def get_nric_detail():
    return services.get_nric_detail(request.args.get("nric"))


@form_bp.route("/edit_form/<int:form_id>", methods=["POST"])
def edit_form(form_id):
    return services.edit_form(form_id, request.get_json(silent=True) or {})


@form_bp.route("/html_to_pdf", methods=["POST"])
def html_to_pdf():
    return services.html_to_pdf()


@form_bp.route("/youth-class-registration/submit", methods=["POST"])
def submit_youth_class_registration_route():
    return services.submit_youth_class_registration(request.get_json(silent=True) or {})


@form_bp.route("/youth-class-registration/entries", methods=["GET"])
@permission_required("member_edit")
def get_youth_class_registration_entries():
    return services.get_youth_class_registrations()


@form_bp.route("/youth-class-registration/nric-check", methods=["GET"])
def get_youth_class_nric_check_route():
    return services.get_youth_class_nric_check(request.args.get("nric"))
