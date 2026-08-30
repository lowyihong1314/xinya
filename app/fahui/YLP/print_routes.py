from __future__ import annotations

import base64
import os

from flask import Blueprint, jsonify, render_template, request, send_file
from flask_login import login_required
from werkzeug.utils import secure_filename

from app.form.permissions import permission_required_any
from .services import user_can_view_order
from app.paths import TEMPLATE_ROOT
from models import db
from models.fahui import FahuiOrder, FahuiOrderItem, FahuiPdfPageData, FahuiPrintPdf

from ..common.access import FAHUI_READ_PERMISSION_NAMES
from ..common.ylp_storage import preferred_dir, resolve_existing_path
from .paiwei_job import get_job_state, resolve_template, start_paiwei_job
from .print_generator import (
    generate_paiwei_pdf_by_source,
    generate_paiwei_preview_cells,
    generate_paiwei_using_order_ids,
    generate_paiwei_using_order_item_ids,
)
from .print_points import PAIWEI_PDF_DIR, SOURCE_NAME_BY_PAIWEI_TYPE, load_point_json, save_point_json
from .shared import normalize_version


print_paiwei_bp = Blueprint("print_paiwei", __name__)
PAIWEI_TEMPLATE_UPLOAD_DIR = PAIWEI_PDF_DIR


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
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
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
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
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
    # 管理端法会读权限，或看板终端 session（token 验证后打标）都可读预览图。
    from ..common.access import has_fahui_read
    from .board_terminal import terminal_session_granted

    if not (has_fahui_read() or terminal_session_granted()):
        return jsonify({"status": "error", "message": "未登录或没有权限"}), 403
    cache_dir = preferred_dir("paiwei_result", "paiweicache")
    cache_file = cache_dir / f"{print_pdf_id}.png"

    # 订单改过之后这张图就过期了，但磁盘缓存不会自己失效（浏览器那头还压着 30 天）。
    # 带 refresh=1 就强制重渲一次，并且这次的响应不许缓存，
    # 否则「刷新用的那个 URL」又被浏览器存下来，下次还是旧图。
    force_refresh = str(request.args.get("refresh") or "").strip() in {"1", "true", "yes"}
    if force_refresh and cache_file.exists():
        try:
            cache_file.unlink()
        except OSError:
            pass

    # 命中缓存：直接返回，不再重新生成 PDF / 渲染（浏览器也缓存 30 天）。
    if cache_file.exists():
        return send_file(cache_file, mimetype="image/png", max_age=2592000)

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

    return send_file(cache_file, mimetype="image/png", max_age=0 if force_refresh else 2592000)


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


# 公开登记页「预览牌位」：裁出来的单张牌位统一渲染成长边约 1100px，
# 张数封顶防止一次拉太多图。
PREVIEW_TARGET_PIXELS = 1100
PREVIEW_IMAGE_QUALITY = 72
PREVIEW_MAX_TABLETS = 40


def _preview_dpi(rect_height_pt: float) -> int:
    # 裁完的格子有大有小（整版 A4 vs 10 联的一条），按长边反推 DPI，
    # 出来的图高度才会差不多，前端排起来才整齐。
    inches = max(float(rect_height_pt), 1.0) / 72.0
    return max(90, min(220, int(PREVIEW_TARGET_PIXELS / inches)))


@print_paiwei_bp.route("/orders/paiwei-preview", methods=["POST"])
def preview_order_images_route():
    """把订单的牌位逐张转成 JPEG 回给前端（公开登记页用）。

    5 联 / 10 联的版面会按模板格心裁成单张，不会带着一排空位一起给。
    权限和单张预览 PDF 那条一样走 user_can_view_order：OTP 验证过手机号的访客
    看得到自己名下的订单，不需要后台权限。
    """
    data = request.get_json(silent=True) or {}
    order_ids = []
    for raw in data.get("order_ids") or []:
        try:
            order_ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    if not order_ids:
        return jsonify({"status": "error", "message": "请选择订单"}), 400

    try:
        import fitz  # PyMuPDF：渲染 PDF 为图片，无需 poppler
    except ImportError:
        return jsonify({"status": "error", "message": "服务器缺少 PDF 渲染组件"}), 500

    tablets = []
    truncated = False
    for order_id in dict.fromkeys(order_ids):  # 去重且保持顺序
        order = FahuiOrder.query.get(order_id)
        if not order:
            return jsonify({"status": "error", "message": f"订单 {order_id} 不存在"}), 404
        if not user_can_view_order(order):
            return jsonify({"status": "error", "message": "未登录或没有权限查看此订单"}), 403

        item_ids = [item.id for item in FahuiOrderItem.query.filter_by(order_id=order_id).all()]
        if not item_ids:
            continue

        buffer, cells = generate_paiwei_preview_cells(item_ids)
        if not buffer or not cells:
            continue

        document = fitz.open(stream=buffer.getvalue(), filetype="pdf")
        try:
            for cell in cells:
                if len(tablets) >= PREVIEW_MAX_TABLETS:
                    truncated = True
                    break
                if cell["page"] >= document.page_count:
                    continue

                page = document.load_page(cell["page"])
                rect = page.rect
                box = cell["box"]
                if box:
                    clip = fitz.Rect(
                        rect.x0 + box[0] * rect.width,
                        rect.y0 + box[1] * rect.height,
                        rect.x0 + box[2] * rect.width,
                        rect.y0 + box[3] * rect.height,
                    )
                else:
                    clip = None

                pixmap = page.get_pixmap(dpi=_preview_dpi(clip.height if clip else rect.height), clip=clip)
                encoded = base64.b64encode(
                    pixmap.tobytes("jpeg", jpg_quality=PREVIEW_IMAGE_QUALITY)
                ).decode("ascii")
                tablets.append(
                    {
                        "order_id": cell["order_id"] or order_id,
                        "item_id": cell["item_id"],
                        "code": cell["code"],
                        "width": pixmap.width,
                        "height": pixmap.height,
                        "image": f"data:image/jpeg;base64,{encoded}",
                    }
                )
        finally:
            document.close()

        if truncated:
            break

    if not tablets:
        return jsonify({"status": "error", "message": "这些订单还没有可预览的牌位"}), 404

    return jsonify({"status": "success", "data": {"tablets": tablets, "truncated": truncated}}), 200


@print_paiwei_bp.route("/preview/by-orders", methods=["POST"])
@print_paiwei_bp.route("/generate_by_orders", methods=["POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def generate_preview_by_orders_route():
    data = request.get_json(silent=True) or {}
    return generate_paiwei_using_order_ids(
        data.get("order_ids", []),
        need_barcode=data.get("need_barcode", False),
    )


# 牌位类型 → 模板文件名
_PAIWEI_TEMPLATE_ALIASES = {
    "super": "paiwei_SS",
    "paiwei_SS": "paiwei_SS",
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
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
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


def _int_list(raw) -> list[int]:
    values = []
    for entry in raw or []:
        try:
            values.append(int(entry))
        except (TypeError, ValueError):
            continue
    return list(dict.fromkeys(values))  # 去重且保持顺序


@print_paiwei_bp.route("/scope", methods=["POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def paiwei_print_scope_route():
    """打印弹窗的取数接口：给一批订单号或牌位单号，回「这个模板下到底有哪些牌位」。

    每条牌位带上订单号、订单状态和已注册的牌位单号（没注册就是 null），
    弹窗据此按状态分组、算张数、筛「只印未注册的」，最后把 item_ids 原样提交回来打印。
    """
    data = request.get_json(silent=True) or {}
    raw_template = data.get("template") or "all"
    source_name = resolve_template(raw_template)
    if not source_name:
        return jsonify({"status": "error", "message": f"无效的牌位类型：{raw_template}"}), 400

    order_ids = _int_list(data.get("order_ids"))
    pdf_ids = _int_list(data.get("pdf_ids"))
    version = normalize_version(data.get("version"))
    if not order_ids and not pdf_ids and not version:
        return jsonify({"status": "error", "message": "请给版本、订单号或牌位单号"}), 400

    unknown_pdf_ids: list[int] = []
    if pdf_ids:
        found_pdf_ids = {
            row[0]
            for row in db.session.query(FahuiPdfPageData.print_pdf_id)
            .filter(FahuiPdfPageData.print_pdf_id.in_(pdf_ids))
            .distinct()
            .all()
        }
        unknown_pdf_ids = [pdf_id for pdf_id in pdf_ids if pdf_id not in found_pdf_ids]
        item_id_rows = (
            db.session.query(FahuiPdfPageData.order_item_id)
            .filter(FahuiPdfPageData.print_pdf_id.in_(pdf_ids))
            .all()
        )
        query = FahuiOrderItem.query.join(FahuiOrder).filter(
            FahuiOrderItem.id.in_([row[0] for row in item_id_rows])
        )
    elif order_ids:
        query = FahuiOrderItem.query.join(FahuiOrder).filter(FahuiOrder.id.in_(order_ids))
    else:
        # 整个版本：状态一概不筛，草稿 / 已取消都算进来，要不要印交给弹窗上的勾选。
        # 软删除的订单是被移去 DELETE 版本的，按版本取自然就不在里面。
        query = FahuiOrderItem.query.join(FahuiOrder).filter(FahuiOrder.version == version)

    items = query.all()
    # 只留属于这个模板的牌位（D / D1 这类没有模板的自然被排除）。
    # template=all（不选类型，按单号打印时用）就留下所有认得的类型。
    if source_name == "all":
        items = [item for item in items if SOURCE_NAME_BY_PAIWEI_TYPE.get(str(item.code or ""))]
    else:
        items = [item for item in items if SOURCE_NAME_BY_PAIWEI_TYPE.get(str(item.code or "")) == source_name]

    pdf_id_by_item: dict[int, int] = {}
    if items:
        for page in (
            db.session.query(FahuiPdfPageData)
            .filter(FahuiPdfPageData.order_item_id.in_([item.id for item in items]))
            .all()
        ):
            # 同一个 item 理论上只会在一页里；真有重复就取最小的单号，显示稳定。
            current = pdf_id_by_item.get(page.order_item_id)
            if current is None or page.print_pdf_id < current:
                pdf_id_by_item[page.order_item_id] = page.print_pdf_id

    orders = {}
    if items:
        for order in FahuiOrder.query.filter(
            FahuiOrder.id.in_({item.order_id for item in items})
        ).all():
            orders[order.id] = order

    rows = []
    for item in sorted(items, key=lambda entry: entry.id or 0):
        order = orders.get(item.order_id)
        rows.append(
            {
                "item_id": item.id,
                "order_id": item.order_id,
                "order_status": (order.status if order else None) or "Draft",
                "code": item.code,
                "pdf_id": pdf_id_by_item.get(item.id),
            }
        )

    covered_order_ids = {row["order_id"] for row in rows}
    return jsonify(
        {
            "status": "success",
            "data": {
                "items": rows,
                # 给了单号但一张该模板的牌位都没有（订单不存在、或只有别的类型）
                "empty_order_ids": [order_id for order_id in order_ids if order_id not in covered_order_ids],
                "unknown_pdf_ids": unknown_pdf_ids,
            },
        }
    )


@print_paiwei_bp.route("/jobs/by-template", methods=["POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def start_paiwei_job_route():
    data = request.get_json(silent=True) or {}
    order_ids = _int_list(data.get("order_ids"))
    item_ids = _int_list(data.get("item_ids"))
    pdf_ids = _int_list(data.get("pdf_ids"))
    # 没给类型 = 不挑类型，三种一起印。指名道姓给了 item_ids / pdf_ids 的时候，
    # 「印哪些」已经说死了，再因为少了 template 就报「无效的牌位类型」是死路。
    raw_template = data.get("template") or "all"
    source_name = resolve_template(raw_template)
    if not source_name:
        return jsonify({"status": "error", "message": f"无效的牌位类型：{raw_template}"}), 400
    if not order_ids and not item_ids and not pdf_ids:
        return jsonify({"status": "error", "message": "请选择订单"}), 400

    job_id = start_paiwei_job(
        order_ids,
        source_name,
        need_barcode=bool(data.get("need_barcode")),
        item_ids=item_ids or None,
        pdf_ids=pdf_ids or None,
    )
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
