"""总账 / 现金日记账（原 backend/app/gl/routes.py 的 Flask Blueprint）。

只做框架适配：装饰器、参数提取、响应构造。校验顺序、状态码、中文文案、响应体的
键名与嵌套形状全部逐字照搬 —— 前端 GL 页面在按这些键和 message 分支。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了（BASE_PATH 已经区分项目，见 docs/flask_to_fastAPI/11），
其余路径一个字符没动：

    /api/gl/dashboard                          → /gl/dashboard
    /api/gl/accounts                （GET/POST）→ /gl/accounts
    /api/gl/accounts/<id>       （PUT/DELETE）  → /gl/accounts/{account_id}
    /api/gl/journal-entries         （GET/POST）→ /gl/journal-entries
    /api/gl/journal-entries/by-source          → /gl/journal-entries/by-source
    /api/gl/journal-entries/source-map         → /gl/journal-entries/source-map
    /api/gl/journal-entries/from-source        → /gl/journal-entries/from-source
    /api/gl/journal-entries/<id>（GET/PUT/DELETE）→ /gl/journal-entries/{entry_id}
    /api/gl/journal-entries/<id>/post          → /gl/journal-entries/{entry_id}/post
    /api/gl/journal-entries/<id>/void          → /gl/journal-entries/{entry_id}/void
    /api/gl/cash-summary                       → /gl/cash-summary
    /api/gl/reports/trial-balance              → /gl/reports/trial-balance
    /api/gl/reports/account-ledger/<id>        → /gl/reports/account-ledger/{account_id}

── 三件搬迁时必须这么写的事 ──────────────────────────────────────────

① **本文件不能写 ``from __future__ import annotations``。**
   core.auth 的装饰器用 functools.wraps 包过，FastAPI 求值注解时用的是
   core/auth.py 的命名空间；开了这行注解全变字符串，会跑去那边找 ``Optional``
   而 NameError（启动即挂）。本模块虽然没用那些装饰器，仍然统一遵守这条。

② **路由函数一律 ``def``（同步），不写 async def。**
   下面每一条最终都落到同步的 SQLAlchemy 查询 + commit，写成 async 会把 worker
   的事件循环焊死。FastAPI 会自动把 def 路由丢进线程池。

③ **路径参数写 ``{entry_id:int}``（Starlette 转换器），不是只靠 ``: int`` 注解。**
   这是行为问题不是风格问题：Flask 的 ``<int:entry_id>`` 在参数不是整数时是
   **不匹配** → 404；只靠注解的话 FastAPI 会先匹配上再校验失败 → **422**，
   前端的 404 分支会失效。带上转换器后，``/journal-entries/by-source`` 这种
   具名路径在**匹配阶段**就不会被 ``{entry_id:int}`` 吃掉。
   即便如此，下面仍把 by-source / source-map / from-source 三条**写在带 {entry_id}
   的路由之前** —— Starlette 是先注册先匹配、不回溯，这个顺序是第二道保险，
   谁以后把转换器删了也不会立刻出事。

── 鉴权为什么不用 @login_required ──────────────────────────────────
本模块所有出口（含 401/403）都长成 ``{"status": "error", "message": "<中文句子>"}``，
而 core.auth 装饰器的拒绝出口是它自己写死的响应体。换过去就等于换掉
「请先登录」/「没有总账读取权限」/「没有 account_edit 权限」这三句话。
所以照搬原结构：每条路由**函数体第一行**显式调 require_gl_*_permission()，
抛出的 GLError 由 try/except 统一转成响应。
⚠️ 后果是「权限检查在路由体内」——请求会先被 FastAPI 解析完 body/query 才被拒。
   Flask 时代同样如此（装饰器也在视图内部调），不算行为变更。
"""

from typing import Optional

from fastapi import APIRouter, Body

from backend.api.gl.exceptions import GLError
from backend.api.gl.permissions import require_gl_edit_permission, require_gl_read_permission
from backend.api.gl.service import (
    create_account,
    create_journal_entry,
    delete_account,
    delete_journal_entry,
    find_entry_by_source,
    get_journal_entry,
    list_accounts,
    list_journal_entries,
    map_entries_by_source,
    load_account_ledger,
    load_cash_summary,
    load_gl_dashboard,
    load_trial_balance,
    post_journal_entry,
    post_journal_from_source,
    update_account,
    update_journal_entry,
    void_journal_entry,
)
from backend.core.config import settings
from backend.core.responses import json_response

# prefix 用 settings.api_prefix 拼而不是写死 "/gl"：api_prefix 今天是空串，
# 但配置项留着是为了需要时还能整体把前缀加回来 —— 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/gl", tags=["gl"])


def _error_response(exc):
    """GLError → 响应。等价于 Flask 版的 ``jsonify({...}), exc.status_code``。

    状态码来自异常类本身（401/403/404/422/400），见 exceptions.py 的那张表。
    """
    return json_response({"status": "error", "message": exc.message}, exc.status_code)


# 请求体的取法对应 Flask 的 ``request.get_json(silent=True) or {}``：
#   · ``Optional[dict]`` + ``Body(default=None)`` = 「整个 JSON 体就是这个参数」，
#     不带 embed，前端发什么形状进来就是什么形状。
#   · 没有 body / body 是 null 时落到 None，路由里 ``payload or {}`` 补成空字典，
#     后面的校验分支自然抛 ValidationError（422），与 silent=True 时一致。
#   · body 不是合法 JSON 时 FastAPI 回 422；Flask 的 silent=True 会当成 {} 继续走，
#     最终也是 422（「凭证至少需要两条分录」之类）。状态码相同、message 不同，
#     这是本次搬迁唯一的可见差异，记在交付说明里。
_JSON_BODY = Body(default=None)


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #
@router.get("/dashboard")
def get_dashboard():
    try:
        require_gl_read_permission()
        return json_response({"status": "success", "data": load_gl_dashboard()})
    except GLError as exc:
        return _error_response(exc)


# --------------------------------------------------------------------------- #
# Chart of accounts
# --------------------------------------------------------------------------- #
@router.get("/accounts")
def get_accounts(include_inactive: str = "1"):
    try:
        require_gl_read_permission()
        # 原式是 ``request.args.get("include_inactive", "1") != "0"``：
        # **只有字面量 "0" 才算关掉**，"false"/"no"/"" 都仍然是 True。
        # 所以这里必须按字符串比，不能声明成 bool ——
        # 声明 bool 的话 FastAPI 会把 "false"/"0" 都解析成 False，行为就变了。
        include_all = include_inactive != "0"
        return json_response({"status": "success", "data": list_accounts(include_all)})
    except GLError as exc:
        return _error_response(exc)


@router.post("/accounts")
def post_account(payload: Optional[dict] = _JSON_BODY):
    try:
        require_gl_edit_permission()
        return json_response({"status": "success", "data": create_account(payload or {})})
    except GLError as exc:
        return _error_response(exc)


@router.put("/accounts/{account_id:int}")
def put_account(account_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        require_gl_edit_permission()
        return json_response(
            {"status": "success", "data": update_account(account_id, payload or {})}
        )
    except GLError as exc:
        return _error_response(exc)


@router.delete("/accounts/{account_id:int}")
def remove_account(account_id: int):
    try:
        require_gl_edit_permission()
        return json_response({"status": "success", "data": delete_account(account_id)})
    except GLError as exc:
        return _error_response(exc)


# --------------------------------------------------------------------------- #
# Journal entries
# --------------------------------------------------------------------------- #
@router.get("/journal-entries")
def get_journal_entries(
    status: str = "",
    source: str = "",
    start: str = "",
    end: str = "",
    # limit 的默认值是**字符串** "200"，不是 int 200，也不能写成 ``int = 200``：
    #   · Flask 那边是 ``request.args.get("limit", 200)``，service 里统一 ``int(limit)``，
    #     所以传字符串和传整数等价。
    #   · 但 ``?limit=`` （空串）在 Flask 里会走进 ``if limit:`` 的假分支 → **不加 limit，
    #     全量返回**。声明成 int 的话空串会被 FastAPI 判成 422，那条分支就没了。
    #   · 声明成 int 还会让 ``?limit=abc`` 从「500」变成「422」。原样保留 500（见交付说明）。
    limit: str = "200",
):
    try:
        require_gl_read_permission()
        return json_response(
            {
                "status": "success",
                "data": list_journal_entries(
                    # ``or None``：Flask 的 args.get(k) 缺参数时是 None、``?k=`` 时是 ""，
                    # 两者都要落到 None（service 里 ``if status:`` 才会跳过该过滤条件）。
                    status=status or None,
                    source=source or None,
                    start=start or None,
                    end=end or None,
                    # limit 故意**不加 or**：空串要原样传进去走「不限条数」那条分支。
                    limit=limit,
                ),
            }
        )
    except GLError as exc:
        return _error_response(exc)


# ⚠️ 下面三条具名路径必须排在 ``/journal-entries/{entry_id:int}`` **之前**，见模块头 ③。
@router.get("/journal-entries/by-source")
def get_journal_entry_by_source(ref_type: Optional[str] = None, ref_id: Optional[str] = None):
    try:
        require_gl_read_permission()
        # 两个参数都声明成 Optional[str]=None，对齐 args.get() 缺参数时返回 None。
        # service 里 ``if not source_ref_type or not source_ref_id: return None``，
        # 所以缺参数时是 200 + data:null，**不是 400** —— 前端靠这个判断「还没记账」。
        entry = find_entry_by_source(ref_type, ref_id)
        return json_response({"status": "success", "data": entry})
    except GLError as exc:
        return _error_response(exc)


@router.get("/journal-entries/source-map")
def get_journal_entry_source_map(ref_type: Optional[str] = None, ref_ids: Optional[str] = None):
    try:
        require_gl_read_permission()
        # ref_ids 是逗号分隔串。空串 / 缺参数 → None，service 里等于「该 ref_type 下全查」；
        # 传了但全是空段（如 ",,"）→ service 清洗后返回 {}。两条分支不一样，别合并。
        ids = ref_ids.split(",") if ref_ids else None
        return json_response(
            {"status": "success", "data": map_entries_by_source(ref_type, ids)}
        )
    except GLError as exc:
        return _error_response(exc)


@router.post("/journal-entries/from-source")
def post_journal_entry_from_source(payload: Optional[dict] = _JSON_BODY):
    try:
        require_gl_edit_permission()
        body = payload or {}
        entry = post_journal_from_source(
            # source 缺省 "manual"；注意这里是 ``or``，空串也会变 manual。
            source=body.get("source") or "manual",
            source_ref_type=body.get("source_ref_type"),
            source_ref_id=body.get("source_ref_id"),
            lines=body.get("lines") or [],
            entry_date=body.get("entry_date"),
            memo=body.get("memo"),
            reference=body.get("reference"),
        )
        return json_response({"status": "success", "data": entry})
    except GLError as exc:
        return _error_response(exc)


@router.post("/journal-entries")
def post_journal_entry_create(payload: Optional[dict] = _JSON_BODY):
    try:
        require_gl_edit_permission()
        return json_response(
            {"status": "success", "data": create_journal_entry(payload or {})}
        )
    except GLError as exc:
        return _error_response(exc)


@router.get("/journal-entries/{entry_id:int}")
def get_journal_entry_detail(entry_id: int):
    try:
        require_gl_read_permission()
        return json_response({"status": "success", "data": get_journal_entry(entry_id)})
    except GLError as exc:
        return _error_response(exc)


@router.put("/journal-entries/{entry_id:int}")
def put_journal_entry(entry_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        require_gl_edit_permission()
        return json_response(
            {"status": "success", "data": update_journal_entry(entry_id, payload or {})}
        )
    except GLError as exc:
        return _error_response(exc)


@router.post("/journal-entries/{entry_id:int}/post")
def post_journal_entry_action(entry_id: int):
    try:
        require_gl_edit_permission()
        return json_response({"status": "success", "data": post_journal_entry(entry_id)})
    except GLError as exc:
        return _error_response(exc)


@router.post("/journal-entries/{entry_id:int}/void")
def void_journal_entry_action(entry_id: int):
    try:
        require_gl_edit_permission()
        return json_response({"status": "success", "data": void_journal_entry(entry_id)})
    except GLError as exc:
        return _error_response(exc)


@router.delete("/journal-entries/{entry_id:int}")
def remove_journal_entry(entry_id: int):
    try:
        require_gl_edit_permission()
        return json_response({"status": "success", "data": delete_journal_entry(entry_id)})
    except GLError as exc:
        return _error_response(exc)


# --------------------------------------------------------------------------- #
# Cash book
# --------------------------------------------------------------------------- #
@router.get("/cash-summary")
def get_cash_summary():
    try:
        require_gl_read_permission()
        return json_response({"status": "success", "data": load_cash_summary()})
    except GLError as exc:
        return _error_response(exc)


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #
@router.get("/reports/trial-balance")
def get_trial_balance(start: str = "", end: str = ""):
    try:
        require_gl_read_permission()
        return json_response(
            {
                "status": "success",
                "data": load_trial_balance(start=start or None, end=end or None),
            }
        )
    except GLError as exc:
        return _error_response(exc)


@router.get("/reports/account-ledger/{account_id:int}")
def get_account_ledger(account_id: int, start: str = "", end: str = ""):
    try:
        require_gl_read_permission()
        return json_response(
            {
                "status": "success",
                "data": load_account_ledger(
                    account_id,
                    start=start or None,
                    end=end or None,
                ),
            }
        )
    except GLError as exc:
        return _error_response(exc)
