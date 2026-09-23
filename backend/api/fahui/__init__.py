"""法会（FAHUI）模块。原 backend/app/fahui/ 的**六个** Flask Blueprint。

    common/payment_routes.py  fahui_payment_bp  → common_payment_router   /payment
    ylp/payment_routes.py     payment_bp        → ylp_payment_router      /payment
    ylp/board_routes.py       board_router_bp   → board_router            /board_router
    ylp/print_routes.py       print_paiwei_bp   → print_paiwei_router     /print_paiwei
    ylp/diy_paiwei.py         diy_paiwei_bp     → diy_paiwei_router       /diy_paiwei
    ylp/routes.py             fahui_bp          → fahui_router            /fahui_router

★★ **include 顺序：common_payment_router 必须排在 ylp_payment_router 前面。** ★★

  这两个 router **挂在同一个前缀 ``/payment`` 下**。Flask 那边它们是两个 Blueprint
  注册到同一个 url_prefix，共存靠的就是注册顺序 —— backend/app/blueprints.py 里
  common 那行在 YLP 那行上面（第 5 行 / 第 6 行），先注册的先匹配、路径撞车时先注册
  的胜出。Starlette 的路由表同样是**先注册先匹配、不回溯**，所以照抄这个顺序就等于
  照抄这个语义。

  今天两边其实**没有一条路径重叠**（common 全在 ``/payments`` ``/review``
  ``/get_payment_*`` ``/update_payment_status`` 下，YLP 全在 ``/orders``
  ``/make_payment`` ``/get_payment_data`` ``/calculate_amount`` ``/download_*``
  ``/print_receipt`` 下），所以顺序目前不改变任何可观察行为。
  但**以后谁在任一边加一条同名路径，胜出的那个必须是 common** —— 这是原有语义，
  不是巧合。所以这个顺序写在这里，并且在两个 router.py 的模块头各留了一条指针。

  ⚠️ 接线的人：请按下面 ``__all__`` 的**顺序**逐条 include_router，别按字母排。

★ 目录名 ``YLP`` 改成了小写 ``ylp``（包名一律小写），其余文件名一个没动，
  方便和旧文件逐个对拍。``lamp/`` 那个蓝图**不在本次搬迁范围内**，仍在
  backend/app/fahui/lamp/，由另一条线负责。

★ 六个 router 的 prefix 都写在各自的 router.py 里（``f"{settings.api_prefix}/xxx"``），
  这里不重复声明 —— 两处各写一份迟早漂移。

── 包内还有三个「搬迁时新增」的文件，Flask 那边没有对应物 ────────────
  uploads.py    werkzeug ``request.form`` / ``request.files`` / ``FileStorage`` 的垫片
  downloads.py  ``flask.send_file`` 的逐字节复刻（Content-Disposition / Cache-Control / ETag）
  realtime.py   出向推送的 app 名与房间名常量（Socket.IO → core.realtime）
  另外 common/session_state.py 被扩写成了「会话读 + 写回 Cookie」两件事，
  因为 FastAPI 没有 Flask 那种「改了 session 框架自动回写」的机制。
"""

from .common.payment_routes import router as common_payment_router
from .ylp.board_routes import router as board_router
from .ylp.diy_paiwei import router as diy_paiwei_router
from .ylp.payment_routes import router as ylp_payment_router
from .ylp.print_routes import router as print_paiwei_router
from .ylp.routes import router as fahui_router

# ★ 顺序即语义：common_payment_router 在 ylp_payment_router 之前（见上）。
#   其余四个各占独立前缀，彼此不可能撞，排在后面只是为了好读。
__all__ = [
    "common_payment_router",
    "ylp_payment_router",
    "board_router",
    "print_paiwei_router",
    "diy_paiwei_router",
    "fahui_router",
]
