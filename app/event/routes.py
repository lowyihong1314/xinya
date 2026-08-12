from flask import Blueprint, request
from flask_login import login_required

from app.auth import permission_required
from . import agent, services


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


@event_data_bp.route("/place/autocomplete", methods=["GET"])
@login_required
@permission_required("event_edit")
def place_autocomplete():
    return services.place_autocomplete_response(request.args.get("q", "", type=str))


@event_data_bp.route("/place/detail", methods=["GET"])
@login_required
@permission_required("event_edit")
def place_detail():
    return services.place_detail_response(request.args.get("place_id", "", type=str))


@event_data_bp.route("/maps/config", methods=["GET"])
def maps_config():
    # 公开：报名页/成员终端等匿名页面显示地图也需要 embed key。
    return services.maps_config_response()


@event_data_bp.route("/check_in/save", methods=["POST"])
@login_required
@permission_required("event_edit")
def check_in_save():
    return services.save_event_check_in(services.get_json_payload())


@event_data_bp.route("/check_in/qr/create", methods=["POST"])
@login_required
def check_in_qr_create():
    return services.create_event_check_in_qr(services.get_json_payload())


@event_data_bp.route("/check_in/qr/scan", methods=["POST"])
@login_required
def check_in_qr_scan():
    return services.scan_event_check_in_qr(services.get_json_payload())


@event_data_bp.route("/check_in/delete/<int:check_in_id>", methods=["POST", "DELETE"])
@login_required
@permission_required("event_edit")
def check_in_delete(check_in_id):
    return services.delete_event_check_in(check_in_id)


@event_data_bp.route("/event_flow/list/<int:event_id>", methods=["GET"])
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


# -------- 活动待办事项 --------
@event_data_bp.route("/event_task/list/<int:event_id>", methods=["GET"])
def event_task_list(event_id):
    return services.event_task_list_response(event_id)


@event_data_bp.route("/event_task/new", methods=["POST"])
@login_required
@permission_required("event_edit")
def event_task_new():
    return services.create_event_task(services.get_json_payload())


@event_data_bp.route("/event_task/update/<int:task_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def event_task_update(task_id):
    return services.update_event_task(task_id, services.get_json_payload())


@event_data_bp.route("/event_task/delete/<int:task_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def event_task_delete(task_id):
    return services.delete_event_task(task_id)


# -------- 活动财政预算 --------
@event_data_bp.route("/event_budget/list/<int:event_id>", methods=["GET"])
def event_budget_list(event_id):
    return services.event_budget_list_response(event_id)


@event_data_bp.route("/event_budget/report/<int:event_id>", methods=["GET"])
@login_required
def event_budget_report(event_id):
    return services.event_budget_report_pdf_response(event_id)


@event_data_bp.route("/event_budget/new", methods=["POST"])
@login_required
@permission_required("event_edit")
def event_budget_new():
    return services.create_event_budget(services.get_json_payload())


@event_data_bp.route("/event_budget/update/<int:item_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def event_budget_update(item_id):
    return services.update_event_budget(item_id, services.get_json_payload())


@event_data_bp.route("/event_budget/delete/<int:item_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def event_budget_delete(item_id):
    return services.delete_event_budget(item_id)


# -------- 活动 AI Agent --------
@event_data_bp.route("/agent/chat/<int:event_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def event_agent_chat(event_id):
    return agent.event_agent_chat(event_id, services.get_json_payload())


@event_data_bp.route("/agent/apply/<int:event_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def event_agent_apply(event_id):
    return agent.apply_event_agent_plan(event_id, services.get_json_payload())


@event_data_bp.route("/delete_event/<int:event_id>", methods=["DELETE"])
@login_required
@permission_required("event_edit")
def delete_event(event_id):
    return services.delete_event_by_id(event_id)


@event_data_bp.route("/set_poster/<int:event_id>/<int:file_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def set_poster(event_id, file_id):
    return services.set_event_poster(event_id, file_id)


@event_data_bp.route("/new_event", methods=["POST"])
@login_required
@permission_required("event_edit")
def new_or_edit_event():
    return services.save_event(request.json or request.form or {})


@event_data_bp.route("/units/save", methods=["POST"])
@login_required
@permission_required("event_edit")
def save_event_unit():
    return services.save_event_unit(request.form, request.files)


@event_data_bp.route("/units/delete/<int:unit_id>", methods=["POST", "DELETE"])
@login_required
@permission_required("event_edit")
def delete_event_unit(unit_id):
    return services.delete_event_unit(unit_id)


@event_data_bp.route("/set_album/<int:event_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def set_album(event_id):
    data = request.get_json(silent=True) or {}
    return services.set_event_album(event_id, data.get("album"))


@event_data_bp.route("/upload_brochure/<int:event_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def upload_brochure(event_id):
    uploaded_file = request.files.get("file")
    if not uploaded_file:
        return {"status": "error", "message": "请选择文件"}, 400
    return services.upload_event_brochure(event_id, uploaded_file)


@event_data_bp.route("/set_brochure/<int:event_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def set_brochure(event_id):
    data = request.get_json(silent=True) or {}
    return services.set_event_brochure(event_id, data.get("file_id"))


@event_data_bp.route("/event_file/upload/<int:event_id>", methods=["POST"])
@login_required
@permission_required("event_edit")
def upload_event_file(event_id):
    uploaded_file = request.files.get("file")
    if not uploaded_file:
        return {"status": "error", "message": "请选择文件"}, 400
    return services.upload_event_file(event_id, uploaded_file)


@event_data_bp.route("/event_file/delete/<int:file_id>", methods=["POST", "DELETE"])
@login_required
@permission_required("event_edit")
def remove_event_file(file_id):
    return services.delete_event_file(file_id)
