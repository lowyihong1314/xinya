from __future__ import annotations

import os

from flask import Blueprint, jsonify, render_template, request, send_file
from flask_login import login_required
from werkzeug.utils import secure_filename

from .services import user_can_view_order
from app.paths import PROJECT_ROOT, TEMPLATE_ROOT
from models.fahui import FahuiOrder, FahuiOrderItem, FahuiPdfPageData, FahuiPrintPdf

from ..common.ylp_storage import preferred_dir, resolve_existing_path
from .paiwei_job import get_job_state, resolve_template, start_paiwei_job
from .print_generator import (
    generate_paiwei_pdf_by_source,
    generate_paiwei_using_order_ids,
    generate_paiwei_using_order_item_ids,
)
from .print_points import load_point_json, save_point_json


print_paiwei_bp = Blueprint("print_paiwei", __name__)
PAIWEI_TEMPLATE_UPLOAD_DIR = PROJECT_ROOT / "paiwei_template" / "pdf"


def _build_order_paiwei_response(order_id: int, *, as_attachment: bool):
    order = FahuiOrder.query.get(order_id)
    if not order:
        return jsonify({"status": "error", "message": f"Order {order_id} 不存在"}), 404
    if not user_can_view_order(order):
        return jsonify({"status": "error", "message": "未登录或没有权限查看此订单"}), 403

    order_items = FahuiOrderItem.query.filter_by(order_id=order_id).all()
    if not order_items:
        return jsonify({"status": "error", "message": "没有找到对应的 OrderItem"}), 404

    order_item_ids = [item.id for item in order_items]
    buffer = generate_paiwei_using_order_item_ids(order_item_ids)
    if not buffer:
        return jsonify({"status": "error", "message": "没有可生成的牌位 PDF"}), 404

    filename = f"order_{order_id}_paiwei.pdf"
    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=as_attachment,
        download_name=filename,
    )


@print_paiwei_bp.route("/config-page", methods=["GET"])
@print_paiwei_bp.route("/paiwei_config_page", methods=["GET"])
@login_required
def render_config_page_route():
    template_path = TEMPLATE_ROOT / "paiwei_config_page.html"
    if template_path.exists():
        return render_template("paiwei_config_page.html")
    return jsonify({"error": "缺少 paiwei_config_page.html 模板"}), 404


@print_paiwei_bp.route("/points", methods=["GET"])
@print_paiwei_bp.route("/get_point_json", methods=["GET"])
@login_required
def get_point_json_route():
    return jsonify(load_point_json())


@print_paiwei_bp.route("/points", methods=["POST"])
@print_paiwei_bp.route("/update_point_json", methods=["POST"])
@login_required
def update_point_json_route():
    try:
        save_point_json(request.get_json(silent=True) or {})
        return jsonify({"success": True, "message": "location_json 更新成功"})
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 500


@print_paiwei_bp.route("/app-download", methods=["GET"])
@print_paiwei_bp.route("/download_app", methods=["GET"])
def download_app_route():
    folder = resolve_existing_path("fahui_app")
    if not folder or not folder.exists():
        return jsonify({"error": "目录不存在"}), 404

    apk_files = [file for file in os.listdir(folder) if file.lower().endswith(".apk")]
    if not apk_files:
        return jsonify({"error": "未找到 APK 文件"}), 404

    apk_files.sort(key=lambda file: os.path.getmtime(os.path.join(folder, file)), reverse=True)
    apk_path = os.path.join(folder, apk_files[0])
    return send_file(apk_path, as_attachment=True, download_name=apk_files[0])


@print_paiwei_bp.route("/pdf-files", methods=["GET"])
@print_paiwei_bp.route("/get_all_pdf_name", methods=["GET"])
def list_pdf_files_route():
    all_pdf_path = resolve_existing_path("pdf_view")
    if not all_pdf_path or not all_pdf_path.exists():
        return jsonify([])

    result = []
    for file in os.listdir(all_pdf_path):
        full_path = os.path.join(all_pdf_path, file)
        if os.path.isfile(full_path):
            result.append({"type": "file", "name": file})
    return jsonify(result)


@print_paiwei_bp.route("/pdf-file", methods=["GET"])
@print_paiwei_bp.route("/get_pdf_file", methods=["GET"])
def get_pdf_file_route():
    filename = request.args.get("filename")
    if not filename:
        return jsonify({"error": "缺少 filename 参数"}), 400

    file_path = resolve_existing_path("pdf_view", filename)
    if not file_path or not file_path.is_file() or not str(file_path).lower().endswith(".pdf"):
        return jsonify({"error": "文件不存在或不是 PDF"}), 404

    return send_file(file_path, mimetype="application/pdf", as_attachment=False)


@print_paiwei_bp.route("/templates", methods=["POST"])
@print_paiwei_bp.route("/upload_paiwei_template", methods=["POST"])
@login_required
def upload_template_route():
    uploaded_file = request.files.get("file")
    if not uploaded_file:
        return jsonify({"error": "No file uploaded"}), 400
    if uploaded_file.filename == "":
        return jsonify({"error": "No file selected"}), 400
    if not uploaded_file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are allowed"}), 400

    filename = secure_filename(uploaded_file.filename)
    PAIWEI_TEMPLATE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    save_path = PAIWEI_TEMPLATE_UPLOAD_DIR / filename
    uploaded_file.save(save_path)
    return jsonify({"message": "File uploaded successfully", "path": str(save_path)}), 200


@print_paiwei_bp.route("/print-pdfs/<int:print_pdf_id>/preview-image", methods=["GET"])
@print_paiwei_bp.route("/print_paiwei_order_item/<int:print_pdf_id>", methods=["GET"])
def preview_print_pdf_image_route(print_pdf_id):
    pdf_obj = FahuiPrintPdf.query.get(print_pdf_id)
    if not pdf_obj:
        return jsonify({"status": "error", "message": f"PrintPDF {print_pdf_id} 不存在"}), 404

    page_data = FahuiPdfPageData.query.filter_by(print_pdf_id=print_pdf_id).all()
    if not page_data:
        return jsonify({"status": "error", "message": "没有找到对应的 OrderItem"}), 404

    order_item_ids = [page.order_item_id for page in page_data]
    buffer = generate_paiwei_using_order_item_ids(order_item_ids)
    if not buffer:
        return jsonify({"status": "error", "message": "生成 PDF 失败"}), 500

    cache_dir = preferred_dir("paiwei_result", "paiweicache")
    cache_file = cache_dir / f"{print_pdf_id}.png"

    if not cache_file.exists():
        try:
            import fitz  # PyMuPDF：渲染 PDF 首页为图片，无需 poppler

            doc = fitz.open(stream=buffer.getvalue(), filetype="pdf")
            if doc.page_count == 0:
                return jsonify({"status": "error", "message": "PDF 无内容"}), 500
            pix = doc.load_page(0).get_pixmap(dpi=110)
            pix.save(str(cache_file))
            doc.close()
        except Exception as exc:
            return jsonify({"status": "error", "message": str(exc)}), 500

    return send_file(cache_file, mimetype="image/png")


@print_paiwei_bp.route("/preview/test", methods=["POST"])
@print_paiwei_bp.route("/test_paiwei_image", methods=["POST"])
def preview_test_image_route():
    data = request.get_json(silent=True) or {}
    paiwei_type = data.get("paiwei_type")
    paiwei_code = data.get("paiwei_code")
    if not paiwei_type or not paiwei_code:
        return jsonify({"status": "error", "message": "缺少 paiwei_type 或 paiwei_code"}), 400

    try:
        limit = int(str(paiwei_type).split("_")[1])
    except (IndexError, ValueError):
        limit = 1

    order_items = FahuiOrderItem.query.filter_by(code=paiwei_code).all()
    if not order_items:
        return jsonify({"status": "error", "message": f"没有找到 code={paiwei_code} 的 OrderItem"}), 404

    order_item_ids = [item.id for item in order_items[:limit]]
    buffer = generate_paiwei_using_order_item_ids(order_item_ids)
    if not buffer:
        return jsonify({"status": "error", "message": "生成 PDF 失败"}), 500

    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=False,
        download_name=f"{paiwei_type}_{paiwei_code}.pdf",
    )


@print_paiwei_bp.route("/orders/<int:order_id>/preview", methods=["GET"])
@print_paiwei_bp.route("/preview_order/<int:order_id>", methods=["GET"])
def preview_order_route(order_id):
    return _build_order_paiwei_response(order_id, as_attachment=False)


@print_paiwei_bp.route("/preview/by-orders", methods=["POST"])
@print_paiwei_bp.route("/generate_by_orders", methods=["POST"])
@login_required
def generate_preview_by_orders_route():
    data = request.get_json(silent=True) or {}
    return generate_paiwei_using_order_ids(
        data.get("order_ids", []),
        need_barcode=data.get("need_barcode", False),
    )


# 牌位类型 → 模板文件名
_PAIWEI_TEMPLATE_ALIASES = {
    "large": "paiwei_1",
    "big": "paiwei_1",
    "paiwei_1": "paiwei_1",
    "small": "paiwei_5",
    "paiwei_5": "paiwei_5",
    "creditor": "paiwei_10",
    "yuanqin": "paiwei_10",
    "paiwei_10": "paiwei_10",
}


@print_paiwei_bp.route("/preview/by-template", methods=["POST"])
@login_required
def generate_preview_by_template_route():
    data = request.get_json(silent=True) or {}
    order_ids = data.get("order_ids", []) or []
    source_name = _PAIWEI_TEMPLATE_ALIASES.get(str(data.get("template") or "").strip())
    if not source_name:
        return jsonify({"status": "error", "message": "无效的牌位类型"}), 400
    if not order_ids:
        return jsonify({"status": "error", "message": "请选择订单"}), 400

    output = generate_paiwei_pdf_by_source(
        order_ids,
        source_name,
        need_barcode=data.get("need_barcode", False),
    )
    if output is None:
        return jsonify({"status": "error", "message": "所选订单没有该类型的牌位"}), 400

    return send_file(
        output,
        mimetype="application/pdf",
        as_attachment=False,
        download_name=f"{source_name}.pdf",
    )


@print_paiwei_bp.route("/jobs/by-template", methods=["POST"])
@login_required
def start_paiwei_job_route():
    data = request.get_json(silent=True) or {}
    order_ids = data.get("order_ids", []) or []
    source_name = resolve_template(data.get("template"))
    if not source_name:
        return jsonify({"status": "error", "message": "无效的牌位类型"}), 400
    if not order_ids:
        return jsonify({"status": "error", "message": "请选择订单"}), 400

    job_id = start_paiwei_job(order_ids, source_name)
    return jsonify({"status": "success", "job_id": job_id, "room": f"paiwei_job:{job_id}"})


@print_paiwei_bp.route("/jobs/<job_id>", methods=["GET"])
@login_required
def paiwei_job_status_route(job_id):
    state = get_job_state(job_id)
    if not state:
        return jsonify({"status": "error", "message": "任务不存在或已过期"}), 404
    return jsonify({"status": "success", "data": state})


@print_paiwei_bp.route("/jobs/<job_id>/download", methods=["GET"])
@login_required
def download_paiwei_job_route(job_id):
    state = get_job_state(job_id)
    if not state or state.get("status") != "done":
        return jsonify({"status": "error", "message": "任务未完成"}), 404
    file_path = resolve_existing_path("paiwei_result", f"job_{job_id}.pdf")
    if not file_path or not file_path.exists():
        return jsonify({"status": "error", "message": "文件不存在或已过期"}), 404
    return send_file(
        file_path,
        mimetype="application/pdf",
        as_attachment=False,
        download_name=f"paiwei_{job_id}.pdf",
    )


@print_paiwei_bp.route("/files/<filename>", methods=["GET"])
@print_paiwei_bp.route("/download/<filename>", methods=["GET"])
@login_required
def download_generated_file_route(filename):
    file_path = resolve_existing_path("paiwei_result", filename)
    if not file_path or not file_path.exists():
        return jsonify({"error": "文件不存在"}), 404
    return send_file(file_path, as_attachment=False)
