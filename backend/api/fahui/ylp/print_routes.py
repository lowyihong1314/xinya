"""牌位打印：坐标配置、模板上传、预览图、按模板/订单出 PDF、异步导出任务。
挂在 ``/print_paiwei/*``。

原 backend/app/fahui/YLP/print_routes.py（Flask Blueprint ``print_paiwei``，
挂在 ``{API_PREFIX}/print_paiwei``）。只做框架适配：装饰器、参数提取、响应构造。
校验顺序、状态码、中文文案、响应体的键名全部逐字照搬 ——
打印弹窗按 ``empty_order_ids`` / ``unknown_pdf_ids`` 分组提示，公开登记页按
``tablets`` / ``truncated`` 渲染预览，两边都咬死了这些键。

规范路径与旧别名一起搬（30 条），对照表见 app/fahui/route_contracts.py 的
ylp_print 组。URL 只去掉了 ``/api`` 这一段。

── 四条搬迁硬约束 ────────────────────────────────────────────────────
  ① 本文件**不能写 ``from __future__ import annotations``**（core.auth 的装饰器
     用 functools.wraps 包过，FastAPI 会去 core/auth.py 的命名空间求值注解）。
  ② 路由函数一律 ``def``（同步）：底下是 PyMuPDF 渲染、reportlab 画版、
     几十 MB 的 PDF 合并 —— 这些是**真正重**的活儿，放进事件循环等于卡死整个 worker。
  ③ ``@router.*`` 在上、``@login_required`` / ``@permission_required_any`` 在下。
  ④ 路径参数 ``{order_id:int}`` / ``{print_pdf_id:int}``；``{job_id}``、
     ``{filename}`` 用默认的 str 转换器（对应 Flask 的 ``<job_id>`` / ``<filename>``，
     两者都**不吃斜杠**，正好挡住 ``/files/../../etc/passwd`` 这类写法）。

── 路由排布：谁会和谁撞 ──────────────────────────────────────────────
  · ``POST /jobs/by-template`` 与 ``GET /jobs/{job_id}`` 方法不同，撞不上。
  · ``GET /jobs/{job_id}`` 与 ``GET /jobs/{job_id}/download`` 形状不同。
  · ``POST /orders/paiwei-preview`` 与 ``GET /orders/{order_id:int}/preview``
    方法不同，且 ``:int`` 也挡着。
  声明顺序照抄了 Flask 原文件。

── 鉴权：四种形状，都不要对齐 ─────────────────────────────────────────
  · ``@login_required``：坐标配置页、点位读写、模板上传、任务状态/下载、取文件。
    **只要登录，不看法会权限** —— 照搬。
  · ``@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)``：列 PDF、取 PDF、
    按订单/模板出预览、scope、起导出任务。
  · **完全公开**：``/app-download``（装 APK 的页面本来就没登录）。
  · **鉴权在函数体里**：``/print-pdfs/<id>/preview-image``（法会读权限**或**
    看板终端 session）、``/orders/<id>/preview`` 与 ``/orders/paiwei-preview``
    （走 user_can_view_order，OTP 验证过手机号的访客看得到自己的单）。

★ ``/config-page`` 这条在**今天的仓库里是死代码**：``templates/paiwei_config_page.html``
  并不存在，所以它恒定走 404 那一支。搬迁保留了两条分支和那句中文文案，
  模板真的被加回来时行为才会变。见 ``render_config_page_route`` 里的 TODO。
"""

import base64
import os
from typing import Optional

from fastapi import APIRouter, Body, Depends
from starlette.responses import HTMLResponse

from backend.api.fahui.downloads import send_file
from backend.core.uploads import form_and_files
from backend.core.auth import login_required, permission_required_any
from backend.core.config import settings
from backend.core.files import secure_filename
from backend.core.paths import TEMPLATE_ROOT
from backend.core.responses import json_response
from backend.models import db
from backend.models.fahui import FahuiOrder, FahuiOrderItem, FahuiPdfPageData, FahuiPrintPdf

from ..common.access import FAHUI_READ_PERMISSION_NAMES
from ..common.ylp_storage import preferred_dir, resolve_existing_path
from .services import user_can_view_order
from .paiwei_job import get_job_state, resolve_template, start_paiwei_job
from .print_generator import (
    generate_paiwei_pdf_by_source,
    generate_paiwei_preview_cells,
    generate_paiwei_using_order_ids,
    generate_paiwei_using_order_item_ids,
)
from .print_points import PAIWEI_PDF_DIR, SOURCE_NAME_BY_PAIWEI_TYPE, load_point_json, save_point_json
from .shared import normalize_version

# prefix 用 settings.api_prefix 拼而不是写死 "/print_paiwei"：api_prefix 今天是空串。
router = APIRouter(prefix=f"{settings.api_prefix}/print_paiwei", tags=["fahui-print"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}``。
_JSON_BODY = Body(default=None)

PAIWEI_TEMPLATE_UPLOAD_DIR = PAIWEI_PDF_DIR


def _build_order_paiwei_response(order_id: int, *, as_attachment: bool):
    order = FahuiOrder.query.get(order_id)
    if not order:
        return json_response({"status": "error", "message": f"Order {order_id} 不存在"}, 404)
    if not user_can_view_order(order):
        return json_response({"status": "error", "message": "未登录或没有权限查看此订单"}, 403)

    order_items = FahuiOrderItem.query.filter_by(order_id=order_id).all()
    if not order_items:
        return json_response({"status": "error", "message": "没有找到对应的 OrderItem"}, 404)

    order_item_ids = [item.id for item in order_items]
    buffer = generate_paiwei_using_order_item_ids(order_item_ids)
    if not buffer:
        return json_response({"status": "error", "message": "没有可生成的牌位 PDF"}, 404)

    filename = f"order_{order_id}_paiwei.pdf"
    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=as_attachment,
        download_name=filename,
    )


@router.get("/config-page")
@router.get("/paiwei_config_page")
@login_required
def render_config_page_route():
    template_path = TEMPLATE_ROOT / "paiwei_config_page.html"
    if template_path.exists():
        # TODO(照搬现状): 原来是 Flask 的 ``render_template("paiwei_config_page.html")``。
        #   FastAPI 侧没有 Flask 的模板环境，这里用裸 Jinja2 渲一份 ——
        #   **两者只在模板不用 Flask 全局时等价**（url_for / config / request /
        #   session / g 这些 Flask 会自动注入，裸 Jinja2 没有）。
        #   今天 templates/ 下**根本没有这个文件**，这一支是死代码，所以先这么放着；
        #   真要把配置页加回来，请一并决定是给它一套模板全局，还是改成前端路由。
        from jinja2 import Environment, FileSystemLoader, select_autoescape

        environment = Environment(
            loader=FileSystemLoader(str(TEMPLATE_ROOT)),
            autoescape=select_autoescape(["html", "xml"]),
        )
        return HTMLResponse(environment.get_template("paiwei_config_page.html").render())
    return json_response({"error": "缺少 paiwei_config_page.html 模板"}, 404)


@router.get("/points")
@router.get("/get_point_json")
@login_required
def get_point_json_route():
    return json_response(load_point_json())


@router.post("/points")
@router.post("/update_point_json")
@login_required
def update_point_json_route(payload: Optional[dict] = _JSON_BODY):
    try:
        save_point_json(payload or {})
        return json_response({"success": True, "message": "location_json 更新成功"})
    except Exception as exc:
        return json_response({"success": False, "message": str(exc)}, 500)


@router.get("/app-download")
@router.get("/download_app")
def download_app_route():
    folder = resolve_existing_path("fahui_app")
    if not folder or not folder.exists():
        return json_response({"error": "目录不存在"}, 404)

    apk_files = [file for file in os.listdir(folder) if file.lower().endswith(".apk")]
    if not apk_files:
        return json_response({"error": "未找到 APK 文件"}, 404)

    apk_files.sort(key=lambda file: os.path.getmtime(os.path.join(folder, file)), reverse=True)
    apk_path = os.path.join(folder, apk_files[0])
    return send_file(apk_path, as_attachment=True, download_name=apk_files[0])


@router.get("/pdf-files")
@router.get("/get_all_pdf_name")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_pdf_files_route():
    all_pdf_path = resolve_existing_path("pdf_view")
    if not all_pdf_path or not all_pdf_path.exists():
        # ★ 顶层是**数组**不是对象，前端直接当列表用。别顺手包一层 {"data": []}。
        return json_response([])

    result = []
    for file in os.listdir(all_pdf_path):
        full_path = os.path.join(all_pdf_path, file)
        if os.path.isfile(full_path):
            result.append({"type": "file", "name": file})
    return json_response(result)


@router.get("/pdf-file")
@router.get("/get_pdf_file")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def get_pdf_file_route(filename: Optional[str] = None):
    if not filename:
        return json_response({"error": "缺少 filename 参数"}, 400)

    file_path = resolve_existing_path("pdf_view", filename)
    if not file_path or not file_path.is_file() or not str(file_path).lower().endswith(".pdf"):
        return json_response({"error": "文件不存在或不是 PDF"}, 404)

    return send_file(file_path, mimetype="application/pdf", as_attachment=False)


@router.post("/templates")
@router.post("/upload_paiwei_template")
@login_required
def upload_template_route(parsed=Depends(form_and_files)):
    _form, files = parsed
    uploaded_file = files.get("file")
    # ★ ``if not uploaded_file`` 命中的是「发了 part 但 filename 为空」那种，
    #   靠的是 uploads.UploadedFile 复刻的 ``__bool__``（= bool(filename)）。
    #   下面那条 ``filename == ""`` 因此其实是死分支 —— 和 Flask 一样，照搬。
    if not uploaded_file:
        return json_response({"error": "No file uploaded"}, 400)
    if uploaded_file.filename == "":
        return json_response({"error": "No file selected"}, 400)
    if not uploaded_file.filename.lower().endswith(".pdf"):
        return json_response({"error": "Only PDF files are allowed"}, 400)

    filename = secure_filename(uploaded_file.filename)
    PAIWEI_TEMPLATE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    save_path = PAIWEI_TEMPLATE_UPLOAD_DIR / filename
    uploaded_file.save(save_path)
    return json_response({"message": "File uploaded successfully", "path": str(save_path)}, 200)


@router.get("/print-pdfs/{print_pdf_id:int}/preview-image")
@router.get("/print_paiwei_order_item/{print_pdf_id:int}")
def preview_print_pdf_image_route(print_pdf_id: int, refresh: str = ""):
    # 管理端法会读权限，或看板终端 session（token 验证后打标）都可读预览图。
    from ..common.access import has_fahui_read
    from .board_terminal import terminal_session_granted

    if not (has_fahui_read() or terminal_session_granted()):
        return json_response({"status": "error", "message": "未登录或没有权限"}, 403)
    cache_dir = preferred_dir("paiwei_result", "paiweicache")
    cache_file = cache_dir / f"{print_pdf_id}.png"

    # 订单改过之后这张图就过期了，但磁盘缓存不会自己失效（浏览器那头还压着 30 天）。
    # 带 refresh=1 就强制重渲一次，并且这次的响应不许缓存，
    # 否则「刷新用的那个 URL」又被浏览器存下来，下次还是旧图。
    force_refresh = str(refresh or "").strip() in {"1", "true", "yes"}
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
        return json_response({"status": "error", "message": f"PrintPDF {print_pdf_id} 不存在"}, 404)

    page_data = FahuiPdfPageData.query.filter_by(print_pdf_id=print_pdf_id).all()
    if not page_data:
        return json_response({"status": "error", "message": "没有找到对应的 OrderItem"}, 404)

    order_item_ids = [page.order_item_id for page in page_data]
    buffer = generate_paiwei_using_order_item_ids(order_item_ids)
    if not buffer:
        return json_response({"status": "error", "message": "生成 PDF 失败"}, 500)

    try:
        import fitz  # PyMuPDF：渲染 PDF 首页为图片，无需 poppler

        doc = fitz.open(stream=buffer.getvalue(), filetype="pdf")
        if doc.page_count == 0:
            return json_response({"status": "error", "message": "PDF 无内容"}, 500)
        pix = doc.load_page(0).get_pixmap(dpi=110)
        pix.save(str(cache_file))
        doc.close()
    except Exception as exc:
        return json_response({"status": "error", "message": str(exc)}, 500)

    # ★ max_age=0 不是「不缓存」的同义词：werkzeug 在 0 这个值上**不会**清掉 no-cache
    #   也不会加 public，最终是 ``no-cache, max-age=0``。downloads.send_file 复刻了
    #   这条分支，别改成 max_age=None（那会少一个 max-age=0 和 Expires）。
    return send_file(cache_file, mimetype="image/png", max_age=0 if force_refresh else 2592000)


@router.post("/preview/test")
@router.post("/test_paiwei_image")
def preview_test_image_route(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    paiwei_type = data.get("paiwei_type")
    paiwei_code = data.get("paiwei_code")
    if not paiwei_type or not paiwei_code:
        return json_response({"status": "error", "message": "缺少 paiwei_type 或 paiwei_code"}, 400)

    try:
        limit = int(str(paiwei_type).split("_")[1])
    except (IndexError, ValueError):
        limit = 1

    order_items = FahuiOrderItem.query.filter_by(code=paiwei_code).all()
    if not order_items:
        return json_response(
            {"status": "error", "message": f"没有找到 code={paiwei_code} 的 OrderItem"}, 404
        )

    order_item_ids = [item.id for item in order_items[:limit]]
    buffer = generate_paiwei_using_order_item_ids(order_item_ids)
    if not buffer:
        return json_response({"status": "error", "message": "生成 PDF 失败"}, 500)

    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=False,
        download_name=f"{paiwei_type}_{paiwei_code}.pdf",
    )


@router.get("/orders/{order_id:int}/preview")
@router.get("/preview_order/{order_id:int}")
def preview_order_route(order_id: int):
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


@router.post("/orders/paiwei-preview")
def preview_order_images_route(payload: Optional[dict] = _JSON_BODY):
    """把订单的牌位逐张转成 JPEG 回给前端（公开登记页用）。

    5 联 / 10 联的版面会按模板格心裁成单张，不会带着一排空位一起给。
    权限和单张预览 PDF 那条一样走 user_can_view_order：OTP 验证过手机号的访客
    看得到自己名下的订单，不需要后台权限。
    """
    data = payload or {}
    order_ids = []
    for raw in data.get("order_ids") or []:
        try:
            order_ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    if not order_ids:
        return json_response({"status": "error", "message": "请选择订单"}, 400)

    try:
        import fitz  # PyMuPDF：渲染 PDF 为图片，无需 poppler
    except ImportError:
        return json_response({"status": "error", "message": "服务器缺少 PDF 渲染组件"}, 500)

    tablets = []
    truncated = False
    for order_id in dict.fromkeys(order_ids):  # 去重且保持顺序
        order = FahuiOrder.query.get(order_id)
        if not order:
            return json_response({"status": "error", "message": f"订单 {order_id} 不存在"}, 404)
        if not user_can_view_order(order):
            return json_response({"status": "error", "message": "未登录或没有权限查看此订单"}, 403)

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
        return json_response({"status": "error", "message": "这些订单还没有可预览的牌位"}, 404)

    return json_response({"status": "success", "data": {"tablets": tablets, "truncated": truncated}}, 200)


@router.post("/preview/by-orders")
@router.post("/generate_by_orders")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def generate_preview_by_orders_route(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    # 这个服务函数自己就返回响应对象（成功是一个 zip，失败是 400 JSON），原样透传。
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


@router.post("/preview/by-template")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def generate_preview_by_template_route(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    order_ids = data.get("order_ids", []) or []
    source_name = _PAIWEI_TEMPLATE_ALIASES.get(str(data.get("template") or "").strip())
    if not source_name:
        return json_response({"status": "error", "message": "无效的牌位类型"}, 400)
    if not order_ids:
        return json_response({"status": "error", "message": "请选择订单"}, 400)

    output = generate_paiwei_pdf_by_source(
        order_ids,
        source_name,
        need_barcode=data.get("need_barcode", False),
    )
    if output is None:
        return json_response({"status": "error", "message": "所选订单没有该类型的牌位"}, 400)

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


@router.post("/scope")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def paiwei_print_scope_route(payload: Optional[dict] = _JSON_BODY):
    """打印弹窗的取数接口：给一批订单号或牌位单号，回「这个模板下到底有哪些牌位」。

    每条牌位带上订单号、订单状态和已注册的牌位单号（没注册就是 null），
    弹窗据此按状态分组、算张数、筛「只印未注册的」，最后把 item_ids 原样提交回来打印。
    """
    data = payload or {}
    raw_template = data.get("template") or "all"
    source_name = resolve_template(raw_template)
    if not source_name:
        return json_response({"status": "error", "message": f"无效的牌位类型：{raw_template}"}, 400)

    order_ids = _int_list(data.get("order_ids"))
    pdf_ids = _int_list(data.get("pdf_ids"))
    version = normalize_version(data.get("version"))
    if not order_ids and not pdf_ids and not version:
        return json_response({"status": "error", "message": "请给版本、订单号或牌位单号"}, 400)

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
    return json_response(
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


@router.post("/jobs/by-template")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def start_paiwei_job_route(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    order_ids = _int_list(data.get("order_ids"))
    item_ids = _int_list(data.get("item_ids"))
    pdf_ids = _int_list(data.get("pdf_ids"))
    # 没给类型 = 不挑类型，三种一起印。指名道姓给了 item_ids / pdf_ids 的时候，
    # 「印哪些」已经说死了，再因为少了 template 就报「无效的牌位类型」是死路。
    raw_template = data.get("template") or "all"
    source_name = resolve_template(raw_template)
    if not source_name:
        return json_response({"status": "error", "message": f"无效的牌位类型：{raw_template}"}, 400)
    if not order_ids and not item_ids and not pdf_ids:
        return json_response({"status": "error", "message": "请选择订单"}, 400)

    job_id = start_paiwei_job(
        order_ids,
        source_name,
        need_barcode=bool(data.get("need_barcode")),
        item_ids=item_ids or None,
        pdf_ids=pdf_ids or None,
    )
    return json_response({"status": "success", "job_id": job_id, "room": f"paiwei_job:{job_id}"})


@router.get("/jobs/{job_id}")
@login_required
def paiwei_job_status_route(job_id: str):
    state = get_job_state(job_id)
    if not state:
        return json_response({"status": "error", "message": "任务不存在或已过期"}, 404)
    return json_response({"status": "success", "data": state})


@router.get("/jobs/{job_id}/download")
@login_required
def download_paiwei_job_route(job_id: str):
    state = get_job_state(job_id)
    if not state or state.get("status") != "done":
        return json_response({"status": "error", "message": "任务未完成"}, 404)
    file_path = resolve_existing_path("paiwei_result", f"job_{job_id}.pdf")
    if not file_path or not file_path.exists():
        return json_response({"status": "error", "message": "文件不存在或已过期"}, 404)
    return send_file(
        file_path,
        mimetype="application/pdf",
        as_attachment=False,
        download_name=f"paiwei_{job_id}.pdf",
    )


@router.get("/files/{filename}")
@router.get("/download/{filename}")
@login_required
def download_generated_file_route(filename: str):
    # ``{filename}`` 是默认的 str 转换器（对应 Flask 的 ``<filename>``），不吃斜杠 ——
    # 这是这条路由唯一的目录穿越护栏，别换成 ``{filename:path}``。
    file_path = resolve_existing_path("paiwei_result", filename)
    if not file_path or not file_path.exists():
        return json_response({"error": "文件不存在"}, 404)
    return send_file(file_path, as_attachment=False)
