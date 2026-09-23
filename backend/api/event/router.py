"""活动：列表 / 编辑 / 流程 / 待办 / 预算 / 附件 / 签到 / AI Agent。

原 backend/app/event/routes.py（Flask Blueprint ``event_data_bp``，挂在
``{API_PREFIX}/event_data``）。只做框架适配：装饰器、参数提取、响应构造。
校验顺序、状态码、中文文案、响应体的键名与嵌套形状全部逐字照搬 ——
活动页 / 报名页 / 财政页 / 签到终端四处前端都在按这些键和 message 分支。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了（BASE_PATH 已经区分项目），``/event_data`` 保持不变
（README 里那句「外部前缀保持 /event_data 以兼容」仍然成立）：

    /api/event_data/get_event_by_month              → /event_data/get_event_by_month
    /api/event_data/get_all_event_sort              → /event_data/get_all_event_sort
    /api/event_data/get_all_event                   → /event_data/get_all_event
    /api/event_data/place/autocomplete              → /event_data/place/autocomplete
    /api/event_data/place/detail                    → /event_data/place/detail
    /api/event_data/maps/config                     → /event_data/maps/config
    /api/event_data/check_in/save                   → /event_data/check_in/save
    /api/event_data/check_in/qr/create|scan         → /event_data/check_in/qr/create|scan
    /api/event_data/check_in/delete/<id>            → /event_data/check_in/delete/{check_in_id:int}
    /api/event_data/event_flow/*                    → /event_data/event_flow/*
    /api/event_data/event_task/*                    → /event_data/event_task/*
    /api/event_data/event_budget/*                  → /event_data/event_budget/*
    /api/event_data/agent/chat|apply/<id>           → /event_data/agent/chat|apply/{event_id:int}
    /api/event_data/delete_event/<id>               → /event_data/delete_event/{event_id:int}
    /api/event_data/set_poster/<id>/<file_id>       → /event_data/set_poster/{event_id:int}/{file_id:int}
    /api/event_data/new_event                       → /event_data/new_event
    /api/event_data/units/save|reorder|delete/<id>  → /event_data/units/...
    /api/event_data/set_album/<id>                  → /event_data/set_album/{event_id:int}
    /api/event_data/upload_brochure/<id>            → /event_data/upload_brochure/{event_id:int}
    /api/event_data/set_brochure/<id>               → /event_data/set_brochure/{event_id:int}
    /api/event_data/event_file/upload/<id>          → /event_data/event_file/upload/{event_id:int}
    /api/event_data/event_file/delete/<id>          → /event_data/event_file/delete/{file_id:int}

★ 命名空间是和 api/public_api 共用的 —— 那边已经有
  ``GET /event_data/{event_id:int}``（原 ``/api/api/get_event/<id>``，那次搬迁顺手改的名）。
  本模块的 ``/event_data/get_all_event`` 这类具名路径和它同处一个前缀下。
  **靠 Starlette 的 ``:int`` 转换器在匹配阶段就只认数字**，所以两边谁先注册都不会
  互相抢（public_api/router.py 末尾也记了同一件事，已实测）。
  ⚠️ 推论：谁把哪一边的 ``:int`` 转换器去掉，``/event_data/get_all_event`` 就会被
  ``{event_id}`` 吃掉并回 422。别只靠 include_router 的顺序来保这件事。

── 四条搬迁硬约束（违反会启动即失败或线上事故）────────────────────────

  ① 本文件**不能写 ``from __future__ import annotations``**。core.auth 的装饰器用
     functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了这一行会在那里找不到 ``Optional`` 而**启动即 NameError**。

  ② 路由函数一律 ``def``（同步）。底下全是同步 ORM / 文件 IO / requests /
     reportlab，写成 async def 会把 worker 的事件循环焊死。FastAPI 会自动把 def
     丢线程池。

  ③ 装饰器顺序保持 Flask 原样：``@login_required`` 在外、``@permission_required``
     在内。反过来会把「未登录」的响应从 401 变成 permission_required 的 500
     （core.auth 契约 2），前端的重新登录跳转就失效了。

  ④ 路径参数写 ``{xxx:int}``（Starlette 转换器），不是只靠 ``: int`` 注解。
     Flask 的 ``<int:xxx>`` 在参数不是整数时是**不匹配** → 404；只靠注解会先匹配
     上再校验失败 → 422，前端的 404 分支会失效。何况这里还要靠它和 public_api
     的 ``/event_data/{event_id:int}`` 分家（见上）。

── 请求体：``request.json or request.form or {}`` 到底是什么行为 ──────────
原 ``services.get_json_payload()`` 写的是这个表达式，读起来像「JSON 不行就退回表单」，
**但在 Flask 3.1 下 ``request.form`` 那一支是死代码**：``request.json`` 是
``get_json()``（silent=False），Content-Type 不是 JSON 时直接抛 415，
body 不是合法 JSON 时抛 400，两种都走不到 ``or`` 的右边。
所以这里统一用 ``Optional[dict] = Body(default=None)`` + ``payload or {}``，
与 Flask 的**可达**行为一致。差异只出现在畸形请求上，记录如下：

  · 没有 body / body 是 ``null``：Flask 400 HTML，这里 ``{}`` → 落到各自的
    「xxx 必填」400 JSON。比原来更好，且状态码相同。
  · body 是合法 JSON 但不是对象（例如 ``[1,2]``）：Flask 会走到 ``data.get(...)``
    抛 AttributeError → 500；这里 FastAPI 回 422。两边都是失败。
  · Content-Type 不是 JSON：Flask 415 HTML，这里 422 JSON。没有调用方在这么发。

── 查询参数：为什么全声明成 ``str = ""`` 再手工 int() ───────────────────
Flask 的 ``request.args.get(k, default, type=int)`` 是「**转不动就当没传**」
（静默回 default）。声明成 ``int`` 会让 ``?page_num=abc`` 从「按默认值 1 查」
变成 422。``?year=`` （空串）同理要落回 None。见下面的 ``_int_arg``。

── 「看着像 bug、故意保留」（service.py 里还有一份更长的清单）────────────
  · ``/check_in/qr/create`` 和 ``/check_in/qr/scan`` 只有 ``@login_required``，
    **没有** event_edit 权限 —— 签到码是给普通会员互扫的，不是笔误。
  · ``/event_flow/*`` 的写操作只有 ``@login_required``，真正的授权在
    ``service._can_edit_event_flow``（event_edit 权限 **或** 该活动的组织者）。
    和 ``/event_task/*``、``/event_budget/*`` 要 event_edit 不一样，别对齐。
  · ``/event_budget/report/<id>`` 只有 ``@login_required``，而同一份数据的
    ``/event_budget/list/<id>`` 是**完全公开**的。照搬。
  · ``upload_brochure`` / ``event_file/upload`` 里那句 400「请选择文件」原本返回的是
    ``{...}, 400`` 的裸 dict（Flask 会自动 jsonify），这里换成 json_response，
    响应体一字不差。
"""

from typing import Optional

from fastapi import APIRouter, Body, File, Form, UploadFile

from backend.core.auth import login_required, permission_required
from backend.core.config import settings
from backend.core.responses import json_response

from . import agent, service
from .uploads import FormValues, wrap_upload

# prefix 用 settings.api_prefix 拼而不是写死 "/event_data"：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目），但配置项留着是为了需要时还能整体把 /api 加回来 ——
# 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/event_data", tags=["event"])

# 对应 Flask 的 ``request.json or request.form or {}`` / ``request.get_json(silent=True) or {}``
# 中**可达**的那一支，见模块头。不带 embed，前端发什么形状进来就是什么形状。
_JSON_BODY = Body(default=None)


def _int_arg(raw, default=None):
    """对应 Flask 的 ``request.args.get(k, default, type=int)``。

    关键是「转不动就当没传」：空串、``abc``、``12.5`` 全部静默回 default。
    ``"0"`` 要转成 0 而不是 default —— ``/get_all_event?page_num=0`` 在 Flask 下
    拿到的就是 0（然后 paginate(error_out=False) 回空页），不是 1。
    """
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- #
# 活动列表 / 日历
# --------------------------------------------------------------------------- #
@router.get("/get_event_by_month")
def get_event_by_month(year: str = "", month: str = ""):
    # 两个参数缺省都是 None（不是 0）：service 那边第一句就是
    # ``if not year or not month or month < 1 or month > 12`` —— None 走 ``not`` 分支，
    # 所以「没传」和「传了非法值」都回同一句 400 "Invalid year or month"。
    return service.month_events_response(_int_arg(year), _int_arg(month))


@router.get("/get_all_event_sort")
def get_all_event_sort():
    return service.all_event_sort_response()


@router.get("/get_all_event")
def get_all_event(page_num: str = "", per_page: str = "", search_value: str = ""):
    # 默认值给在 _int_arg 里（1 / 10），对齐 ``args.get("page_num", 1, type=int)``。
    # search_value 原式是 ``args.get("search_value", "", type=str)``，缺省即空串。
    return service.all_event_response(
        _int_arg(page_num, 1),
        _int_arg(per_page, 10),
        search_value,
    )


# --------------------------------------------------------------------------- #
# Google 地点 / 地图
# --------------------------------------------------------------------------- #
@router.get("/place/autocomplete")
@login_required
@permission_required("event_edit")
def place_autocomplete(q: str = ""):
    return service.place_autocomplete_response(q)


@router.get("/place/detail")
@login_required
@permission_required("event_edit")
def place_detail(place_id: str = ""):
    return service.place_detail_response(place_id)


@router.get("/maps/config")
def maps_config():
    # 公开：报名页/成员终端等匿名页面显示地图也需要 embed key。
    return service.maps_config_response()


# --------------------------------------------------------------------------- #
# 签到
# --------------------------------------------------------------------------- #
@router.post("/check_in/save")
@login_required
@permission_required("event_edit")
def check_in_save(payload: Optional[dict] = _JSON_BODY):
    return service.save_event_check_in(payload or {})


@router.post("/check_in/qr/create")
@login_required
def check_in_qr_create(payload: Optional[dict] = _JSON_BODY):
    # 只要登录即可生成自己的签到码（见模块头「故意保留」）。
    return service.create_event_check_in_qr(payload or {})


@router.post("/check_in/qr/scan")
@login_required
def check_in_qr_scan(payload: Optional[dict] = _JSON_BODY):
    return service.scan_event_check_in_qr(payload or {})


# 原来是一条 ``methods=["POST", "DELETE"]``，用 api_route 一比一对应 ——
# 拆成两个函数会让 OpenAPI 里多出一条同名路由，也更容易改漏一边。
@router.api_route("/check_in/delete/{check_in_id:int}", methods=["POST", "DELETE"])
@login_required
@permission_required("event_edit")
def check_in_delete(check_in_id: int):
    return service.delete_event_check_in(check_in_id)


# --------------------------------------------------------------------------- #
# 活动流程
# --------------------------------------------------------------------------- #
@router.get("/event_flow/list/{event_id:int}")
def event_flow_list(event_id: int):
    return service.event_flow_list_response(event_id)


@router.post("/event_flow/new")
@login_required
def event_flow_new(payload: Optional[dict] = _JSON_BODY):
    # 这里**只有** login_required：能不能改由 service._can_edit_event_flow 判
    # （event_edit 权限 或 该活动的组织者），拒绝时回 403「没有权限编辑此活动流程」。
    return service.create_event_flow(payload or {})


@router.post("/event_flow/update/{flow_id:int}")
@login_required
def event_flow_update(flow_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.update_event_flow(flow_id, payload or {})


@router.post("/event_flow/delete/{flow_id:int}")
@login_required
def event_flow_delete(flow_id: int):
    return service.delete_event_flow(flow_id)


@router.post("/event_flow/reorder")
@login_required
def event_flow_reorder(payload: Optional[dict] = _JSON_BODY):
    return service.reorder_event_flow(payload or {})


# --------------------------------------------------------------------------- #
# 活动待办事项
# --------------------------------------------------------------------------- #
@router.get("/event_task/list/{event_id:int}")
def event_task_list(event_id: int):
    return service.event_task_list_response(event_id)


@router.post("/event_task/new")
@login_required
@permission_required("event_edit")
def event_task_new(payload: Optional[dict] = _JSON_BODY):
    return service.create_event_task(payload or {})


@router.post("/event_task/update/{task_id:int}")
@login_required
@permission_required("event_edit")
def event_task_update(task_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.update_event_task(task_id, payload or {})


@router.post("/event_task/delete/{task_id:int}")
@login_required
@permission_required("event_edit")
def event_task_delete(task_id: int):
    return service.delete_event_task(task_id)


# --------------------------------------------------------------------------- #
# 活动财政预算
# --------------------------------------------------------------------------- #
@router.get("/event_budget/list/{event_id:int}")
def event_budget_list(event_id: int):
    return service.event_budget_list_response(event_id)


@router.get("/event_budget/report/{event_id:int}")
@login_required
def event_budget_report(event_id: int):
    # 返回的是 PDF 附件（starlette Response），不是 JSON —— 见
    # service._attachment_disposition 里那段「为什么自己拼 Content-Disposition」。
    return service.event_budget_report_pdf_response(event_id)


@router.post("/event_budget/new")
@login_required
@permission_required("event_edit")
def event_budget_new(payload: Optional[dict] = _JSON_BODY):
    return service.create_event_budget(payload or {})


@router.post("/event_budget/update/{item_id:int}")
@login_required
@permission_required("event_edit")
def event_budget_update(item_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.update_event_budget(item_id, payload or {})


@router.post("/event_budget/delete/{item_id:int}")
@login_required
@permission_required("event_edit")
def event_budget_delete(item_id: int):
    return service.delete_event_budget(item_id)


# --------------------------------------------------------------------------- #
# 活动 AI Agent
# --------------------------------------------------------------------------- #
@router.post("/agent/chat/{event_id:int}")
@login_required
@permission_required("event_edit")
def event_agent_chat(event_id: int, payload: Optional[dict] = _JSON_BODY):
    # 立刻返回 {job_id, room}，真正的回答由子进程算完后经 Redis 推到 room。
    return agent.event_agent_chat(event_id, payload or {})


@router.post("/agent/apply/{event_id:int}")
@login_required
@permission_required("event_edit")
def event_agent_apply(event_id: int, payload: Optional[dict] = _JSON_BODY):
    return agent.apply_event_agent_plan(event_id, payload or {})


# --------------------------------------------------------------------------- #
# 活动本体 / 海报 / 相册
# --------------------------------------------------------------------------- #
@router.delete("/delete_event/{event_id:int}")
@login_required
@permission_required("event_edit")
def delete_event(event_id: int):
    return service.delete_event_by_id(event_id)


@router.post("/set_poster/{event_id:int}/{file_id:int}")
@login_required
@permission_required("event_edit")
def set_poster(event_id: int, file_id: int):
    return service.set_event_poster(event_id, file_id)


@router.post("/new_event")
@login_required
@permission_required("event_edit")
def new_or_edit_event(payload: Optional[dict] = _JSON_BODY):
    # 原式是 ``request.json or request.form or {}``（表单那支是死代码，见模块头）。
    return service.save_event(payload or {})


@router.post("/set_album/{event_id:int}")
@login_required
@permission_required("event_edit")
def set_album(event_id: int, payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    # 注意传的是 ``data.get("album")``：缺字段 → None → service 回 400「missing album」。
    return service.set_event_album(event_id, data.get("album"))


# --------------------------------------------------------------------------- #
# 进行单位（主催/主办/承办/协办/协调）
# --------------------------------------------------------------------------- #
@router.post("/units/save")
@login_required
@permission_required("event_edit")
def save_event_unit(
    # 原来是 ``services.save_event_unit(request.form, request.files)``。
    # 四个字段全部声明成带默认值的 ``Form``（不是必填）：必填会让缺字段的请求回 422，
    # 而原来是 400「单位名称必填」/「role 必须是 …」。
    # 类型全用 str，int 转换留给 FormValues.get(type=int) —— 它在转不动时静默回 None，
    # 那正是 ``/units/save?event_id=abc`` 走到「Event 不存在」404 的原因。
    event_id: Optional[str] = Form(default=None),
    unit_id: Optional[str] = Form(default=None),
    role: Optional[str] = Form(default=None),
    unit_name: Optional[str] = Form(default=None),
    logo: Optional[UploadFile] = File(default=None),
):
    return service.save_event_unit(
        FormValues(
            {
                "event_id": event_id,
                "unit_id": unit_id,
                "role": role,
                "unit_name": unit_name,
            }
        ),
        # service 只做 ``files.get("logo")``，普通字典就够；值包成 FileStorage 的替身。
        {"logo": wrap_upload(logo)},
    )


@router.post("/units/reorder")
@login_required
@permission_required("event_edit")
def reorder_event_units(payload: Optional[dict] = _JSON_BODY):
    return service.reorder_event_units(payload or {})


@router.api_route("/units/delete/{unit_id:int}", methods=["POST", "DELETE"])
@login_required
@permission_required("event_edit")
def delete_event_unit(unit_id: int):
    return service.delete_event_unit(unit_id)


# --------------------------------------------------------------------------- #
# 简章 / 活动附件
# --------------------------------------------------------------------------- #
@router.post("/upload_brochure/{event_id:int}")
@login_required
@permission_required("event_edit")
def upload_brochure(event_id: int, file: Optional[UploadFile] = File(default=None)):
    uploaded_file = wrap_upload(file)
    # ``if not uploaded_file`` 同时挡住「没有 file 这一部分」和「有但 filename 为空」——
    # 后者靠 UploadedFile.__bool__（照抄 werkzeug FileStorage），见 uploads.py ①。
    if not uploaded_file:
        return json_response({"status": "error", "message": "请选择文件"}, 400)
    return service.upload_event_brochure(event_id, uploaded_file)


@router.post("/set_brochure/{event_id:int}")
@login_required
@permission_required("event_edit")
def set_brochure(event_id: int, payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    # file_id 为空（None/""/0/"0"）在 service 里是「取消简章」，不是报错。
    return service.set_event_brochure(event_id, data.get("file_id"))


@router.post("/event_file/upload/{event_id:int}")
@login_required
@permission_required("event_edit")
def upload_event_file(event_id: int, file: Optional[UploadFile] = File(default=None)):
    uploaded_file = wrap_upload(file)
    if not uploaded_file:
        return json_response({"status": "error", "message": "请选择文件"}, 400)
    return service.upload_event_file(event_id, uploaded_file)


@router.api_route("/event_file/delete/{file_id:int}", methods=["POST", "DELETE"])
@login_required
@permission_required("event_edit")
def remove_event_file(file_id: int):
    return service.delete_event_file(file_id)
