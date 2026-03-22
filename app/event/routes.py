from flask import Blueprint, request
from flask_login import login_required

from app.auth import permission_required
from . import services


event_data_bp = Blueprint("event_data", __name__)


@event_data_bp.route("/get_event_by_month", methods=["GET"])
def get_event_by_month():
    return services.month_events_response(
        request.args.get("year", type=int),
        request.args.get("month", type=int),
    )


@event_data_bp.route("/get_all_event_sort", methods=["GET"])
def get_all_event_sort():
    return services.all_event_sort_response()


@event_data_bp.route("/get_all_event", methods=["GET"])
def get_all_event():
    return services.all_event_response(
        request.args.get("page_num", 1, type=int),
        request.args.get("per_page", 10, type=int),
        request.args.get("search_value", "", type=str),
    )


@event_data_bp.route("/check_in/save", methods=["POST"])
@login_required
def check_in_save():
    return services.save_event_check_in(services.get_json_payload())


@event_data_bp.route("/check_in/delete/<int:check_in_id>", methods=["POST", "DELETE"])
@login_required
def check_in_delete(check_in_id):
    return services.delete_event_check_in(check_in_id)


@event_data_bp.route("/event_flow/list/<int:event_id>", methods=["GET"])
@login_required
def event_flow_list(event_id):
    return services.event_flow_list_response(event_id)


@event_data_bp.route("/event_flow/new", methods=["POST"])
@login_required
def event_flow_new():
    return services.create_event_flow(services.get_json_payload())


@event_data_bp.route("/event_flow/update/<int:flow_id>", methods=["POST"])
@login_required
def event_flow_update(flow_id):
    return services.update_event_flow(flow_id, services.get_json_payload())


@event_data_bp.route("/event_flow/delete/<int:flow_id>", methods=["POST"])
@login_required
def event_flow_delete(flow_id):
    return services.delete_event_flow(flow_id)


@event_data_bp.route("/event_flow/reorder", methods=["POST"])
@login_required
def event_flow_reorder():
    return services.reorder_event_flow(services.get_json_payload())


@event_data_bp.route("/delete_event/<int:event_id>", methods=["DELETE"])
@login_required
def delete_event(event_id):
    return services.delete_event_by_id(event_id)


@event_data_bp.route("/set_poster/<int:event_id>/<int:file_id>", methods=["POST"])
@login_required
def set_poster(event_id, file_id):
    return services.set_event_poster(event_id, file_id)


@event_data_bp.route("/new_event", methods=["POST"])
@login_required
def new_or_edit_event():
    return services.save_event(request.json or request.form or {})


@event_data_bp.route("/set_album/<int:event_id>", methods=["POST"])
@login_required
def set_album(event_id):
    data = request.get_json(silent=True) or {}
    return services.set_event_album(event_id, data.get("album"))


@event_data_bp.route("/upload_brochure/<int:event_id>", methods=["POST"])
@permission_required("event")
def upload_brochure(event_id):
    uploaded_file = request.files.get("file")
    if not uploaded_file:
        return {"status": "error", "message": "请选择文件"}, 400
    return services.upload_event_brochure(event_id, uploaded_file)


@event_data_bp.route("/event_file/upload/<int:event_id>", methods=["POST"])
@permission_required("event")
def upload_event_file(event_id):
    uploaded_file = request.files.get("file")
    if not uploaded_file:
        return {"status": "error", "message": "请选择文件"}, 400
    return services.upload_event_file(event_id, uploaded_file)


@event_data_bp.route("/event_file/delete/<int:file_id>", methods=["POST", "DELETE"])
@login_required
def remove_event_file(file_id):
    return services.delete_event_file(file_id)
