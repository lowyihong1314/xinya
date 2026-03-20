from flask import Blueprint, request
from flask_login import login_required

from . import services


lamp_registration_bp = Blueprint("lampRegistration_API", __name__)


@lamp_registration_bp.route("/ping", methods=["GET"])
def ping():
    return services.ping()


@lamp_registration_bp.route("/register", methods=["POST"])
def register():
    return services.register_lamp(request.get_json(silent=True) or {})


@lamp_registration_bp.route("/edit", methods=["POST"])
def edit_register():
    return services.edit_register(request.get_json(silent=True) or {})


@lamp_registration_bp.route("/delete", methods=["POST"])
def delete_register():
    return services.delete_register(request.get_json(silent=True) or {})


@lamp_registration_bp.route("/get_all_register_by_payment", methods=["GET"])
def get_all_register_by_payment():
    return services.get_all_register_by_payment()


@lamp_registration_bp.route("/get_all_register", methods=["GET"])
def get_all_register():
    return services.get_all_register()


@lamp_registration_bp.route("/get_by_ids", methods=["POST"])
def get_registers_by_ids():
    return services.get_registers_by_ids(request.get_json() or {})


@lamp_registration_bp.route("/make_payment", methods=["POST"])
def make_payment():
    return services.make_payment(request.form, request.files)


@lamp_registration_bp.route("/remove_payment", methods=["POST"])
@login_required
def remove_payment():
    return services.remove_payment(request.get_json() or {})


@lamp_registration_bp.route("/payment_file/<int:payment_id>", methods=["GET"])
@login_required
def get_payment_file(payment_id):
    return services.get_payment_file(payment_id)


@lamp_registration_bp.route("/approve_payment", methods=["POST"])
@login_required
def approve_payment():
    return services.approve_payment(request.get_json() or {})
