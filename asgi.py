"""asgi.py —— FastAPI 的进程入口。

部署（08-部署与回滚.md §2）：

    gunicorn -k uvicorn.workers.UvicornWorker -w 4 -b 127.0.0.1:5006 asgi:app

这个文件只做**装配**：造 FastAPI 实例、按顺序装中间件、注册异常处理器、挂三样
不属于任何业务模块的东西（/healthz、/api/time、SSE 端点），以及启停钩子。
业务路由一律不在这里写 —— 见文件末尾的「业务路由注册位」。

── 为什么装配顺序值得逐条写注释 ────────────────────────────────────────

这个文件里每一处顺序都在挡一类「不报错的故障」：

  · 中间件顺序错 → 带 Cookie 的请求全 500，或者更糟：静默串号（见 core/middleware.py）
  · CORS 写成 allow_origins=["*"] → APK 和跨域页面整片失败（02 文档 R9）
  · 异常处理器注册到 fastapi.HTTPException 而不是 starlette 的 → 404/405 漏网
  · root_path 没喂 → 分享链接、二维码全部少一段前缀

改这个文件之前，请先读懂它要挡的是什么。
"""

from __future__ import annotations

import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from starlette.middleware.cors import CORSMiddleware

from core.auth import AuthError, auth_error_handler, get_current_user_optional
from core.config import settings
from core.db import engine, load_model_modules
from core.middleware import (
    AuthContextMiddleware,
    BodySizeLimitMiddleware,
    DBSessionMiddleware,
    ProxyHeadersMiddleware,
)
from core.realtime import (
    make_realtime_router,
    now_ms,
    set_user_resolver,
    start_fanout,
    stop_fanout,
)
from core.responses import (
    StarletteHTTPException,
    fail,
    json_response,
    make_http_exception_handler,
)

log = logging.getLogger("asgi")


# ═══════════════════════════ 1. CORS 放行名单 ═══════════════════════════
#
# ★★★ 这一段漏了，APK 和所有跨域页面会**整片**报错（02 文档 §6.4 / R9）。★★★
#
# 现状是 Flask-CORS：`CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)`。
# `origins="*"` 配 `supports_credentials=True` 在 CORS 规范上是**非法组合** ——
# 浏览器不接受 `Access-Control-Allow-Origin: *` 与 `Allow-Credentials: true` 同时出现。
# Flask-CORS 偷偷替我们兜住了：它发现要带凭据时，就把请求的 Origin **原样回显**回去，
# 于是一直能用，也就一直没人发现配置本身是错的。
#
# Starlette 的 CORSMiddleware **严格按规范办**：allow_origins=["*"] + allow_credentials=True
# 时它就发 `*`，浏览器随即拒绝整个响应。症状是**所有**跨域请求失败（包括登录），
# 而服务端日志里全是 200 —— 从后端看不出任何问题。
#
# 所以必须用 allow_origin_regex（它会回显匹配到的 Origin，等价于 Flask-CORS 的行为）。
#
# 名单来源与各自的理由：
#   1) settings.socket_allowed_origin_regex —— 搬自 app/extensions.py 的
#      socket_origin_allowed()：utbabuddha.com 及**任意层级**子域（开发隧道
#      yukang.utbabuddha.com、终端页、公开页都从这些域名过来）+ 本地 vite 的 5173。
#   2) https://localhost —— Capacitor 的 androidScheme="https"，**正式 APK 的 Origin
#      就是它**（见 frontend/capacitor.config.ts）。漏了这一条 = 所有安卓用户白屏。
#   3) http://localhost —— CAP_CLEARTEXT=true 的模拟器构建。
#   4) capacitor://localhost、ionic://localhost —— iOS WKWebView 的默认 scheme。
#
# ⚠️ 这里只拼串、不重写 settings 里那条正则：两处各写一份，早晚会漂移，
#    而漂移的症状是「socket 能连、HTTP 跨域不行」这种极难定位的半瘫。
# ⚠️ Starlette 用 fullmatch 匹配，settings 里每个分支自带 ^…$，拼接后仍然正确。
_APK_WEBVIEW_ORIGINS = (
    r"^https://localhost$"
    r"|^http://localhost$"
    r"|^capacitor://localhost$"
    r"|^ionic://localhost$"
)
CORS_ORIGIN_REGEX = f"{settings.socket_allowed_origin_regex}|{_APK_WEBVIEW_ORIGINS}"


# ═══════════════════════════ 2. 启停钩子 ═══════════════════════════


@asynccontextmanager
async def lifespan(app: FastAPI):
    """进程生命周期。用 lifespan 而不是 on_event（后者已废弃）。

    ⚠️ gunicorn 开 4 个 worker，这段代码就会跑 4 次（每个 worker 各一份）。
       别在这里做「全局只该做一次」的事 —— 建表、数据迁移、发通知都不行，
       那些属于 alembic 或一次性脚本。
    """
    # ① 先把 models 全部 import 一遍，让 SQLAlchemy 的 metadata / mapper 配置齐全。
    #    放在最前面是为了**启动即失败**：映射配错（关系写错、字段名打错）会在这里炸，
    #    而不是等到某个冷门接口第一次被访问时才炸在用户脸上。
    #    ⚠️ 过渡期实情：models/__init__.py 现在仍然是 `db = SQLAlchemy()`（Flask-SQLAlchemy），
    #       所以这一步填的是 FSA 的 metadata，core.db 的 metadata 依旧是空的。
    #       等 models/__init__.py 切到 core.db 之后，这一行才同时给 alembic 用上。
    #    ★ 同一个原因导致的现状（实测）：**带有效登录 Cookie 的请求现在一律 500**。
    #       认证要走 `User.query`，而那还是 FSA 的 query，没有 Flask app context 就抛
    #       `RuntimeError: Working outside of application context`。匿名请求不受影响
    #       （core/auth.py 会先看有没有凭据，没有就不查库），所以 /healthz 之类一切正常，
    #       很容易误以为已经能用了。**切 models/__init__.py 是登录能用的前置条件。**
    load_model_modules()

    # ② 拉起 Redis 扇出循环（每 worker 一条 psubscribe rt:*，进程内再分发）。
    #    不显式拉也能跑（第一个 SSE 订阅者会自动拉起），显式拉的好处是：
    #    Redis 挂了在启动日志里就能看见，而不是等第一个用户连 SSE 时才发现。
    await start_fanout()

    log.info("xinya v3 启动完成：env=%s base_path=%r", settings.app_env, settings.app_base_path)
    try:
        yield
    finally:
        # ③ 先踢 SSE 客户端、收 Redis 连接，再还数据库连接池。
        #    顺序反了的话，扇出循环可能在池子已经 dispose 之后还想查一次库。
        await stop_fanout()
        # ★ engine.dispose() 不能省。PG 的每条连接在服务端是一个**进程**，
        #   默认 max_connections 只有 100。不还池子的话，systemd 重启 / gunicorn 优雅重载
        #   会在 PG 侧留下一批悬挂连接，反复几次就会「新 worker 起不来，报 too many clients」。
        engine.dispose()
        log.info("xinya v3 已关闭")


# ═══════════════════════════ 3. 应用实例 ═══════════════════════════

# 生产环境关掉 /docs 与 /openapi.json：这套 API 是内部系统，把完整接口清单挂在公网上
# 等于免费给人一份攻击面地图。开发/staging 留着，调试和对拍都要用。
_DOCS_ENABLED = not settings.is_production

app = FastAPI(
    title=settings.app_name,
    # ★ root_path = 本项目挂在域名下的哪一段（/UTBA_DEMO）。
    #   nginx 用 `proxy_pass http://127.0.0.1:5006/;`（末尾斜杠）把前缀剥掉再转进来，
    #   所以**路由表里一律写裸路径**，前缀只影响 url_for / openapi 里生成的地址。
    #   运行时还会被 ProxyHeadersMiddleware 按 X-Forwarded-Prefix 覆盖一次
    #   （同一份代码被灰度和生产两条 location 同时代理时，各回各的前缀）。
    root_path=settings.app_base_path,
    lifespan=lifespan,
    docs_url="/docs" if _DOCS_ENABLED else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _DOCS_ENABLED else None,
    debug=settings.app_debug,
)


# ═══════════════════════════ 4. 中间件 ═══════════════════════════
#
# ★ 顺序规则：Starlette 的 add_middleware 是 `insert(0, ...)`，
#   **后加的包在外面、先执行**。所以下面是从内往外写的，读的时候倒着读。
#
# 最终的洋葱（外 → 内）：
#
#     ProxyHeadersMiddleware     修 scheme / root_path / client IP
#     CORSMiddleware             预检直接返回；给所有响应贴 CORS 头
#     BodySizeLimitMiddleware    超大请求体 → 413
#     DBSessionMiddleware        开/关数据库会话作用域
#     AuthContextMiddleware      解析 current_user（要查库）
#     ── 路由 ──
#
# 每一层为什么在那个位置：
#
#   · ProxyHeaders 最外：后面所有人（CORS 记日志、URL 拼装、审计）看到的都得是
#     真实的协议和客户端 IP，它必须第一个把 scope 修好。
#   · CORS 在 body 限制之外：这样 413 / 401 / 500 这些失败响应也能带上 CORS 头。
#     少了头，浏览器只会报一句 CORS 错误，把真正的状态码和 message 全藏起来 ——
#     前端拿到的是「Failed to fetch」，排查起来极其痛苦。
#     顺带：OPTIONS 预检在这一层就返回了，不会白白开一次 DB 作用域、查一次用户。
#   · BodySizeLimit 在 DB / Auth 之外：一个 5GB 的恶意请求不该先把数据库连接
#     和一次用户查询消耗掉再被拒。
#   · ★ DBSession 必须在 Auth **之外**：认证要查 users 表，那次查询得落在已打开的
#     作用域里。顺序反了的症状是「所有带 Cookie 的请求 500、匿名请求一切正常」，
#     很容易被误判成会话 Cookie 坏了。（core/middleware.py 里有完整说明。）
#
# ⚠️ 还有一层看不见的：ServerErrorMiddleware 在**所有**用户中间件之外，
#   ExceptionMiddleware（认 HTTPException 的那层）在**所有**用户中间件之内。
#   也就是说，中间件里抛 HTTPException 不会被渲染成 JSON，只会变成 500。
#   中间件要返回错误，得自己造 Response（BodySizeLimitMiddleware 就是这么做的）。

app.add_middleware(AuthContextMiddleware)
app.add_middleware(DBSessionMiddleware)
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    # 必须 True：会话和 remember_token 都走 Cookie，APK 是跨站请求（https://localhost
    # → https://utbabuddha.com），不带凭据就等于没登录。
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # ★ 跨域时浏览器默认只暴露 6 个安全头，Content-Disposition 不在其中。
    #   frontend/src/js/browserActions.ts:320 读它取下载文件名 —— 不暴露的话，
    #   APK 里所有下载的文件名都会退化成一串 URL 尾巴或 "download"。
    expose_headers=["Content-Disposition"],
    max_age=600,
)
app.add_middleware(ProxyHeadersMiddleware)


# ═══════════════════════════ 5. 异常处理器 ═══════════════════════════


def _uses_new_envelope(request: Request) -> bool:
    """这条请求该用新信封 ``{"error": {...}}`` 还是旧形状 ``{"status","message"}``？

    规则：只有 ``/v1/...`` 下的新接口用新信封（13 文档 §2 定的新路径形状）。
    老路由继续发旧形状 —— 前端 400 个调用点还在按 message 分支，
    在 R1 还没推到的模块上换形状，表现是「转圈不停」或「错误提示是空白」。

    ⚠️ 这里**不能**用 core.urls.base_path() 去拼前缀再比。nginx 是剥掉前缀再转进来的，
      应用看到的 path 本来就是 ``/v1/claims``；拼上 /UTBA_DEMO 去比会永远不匹配，
      于是新接口悄悄发着旧形状，没人会注意到。
      这里改为：把 scope 里的 root_path 剥掉（万一哪条 location 没剥前缀），再判断。
    """
    path = request.url.path
    root = request.scope.get("root_path") or ""
    if root and path.startswith(root):
        path = path[len(root):] or "/"
    return path == "/v1" or path.startswith("/v1/")


# ★ 一定注册在 starlette 的 HTTPException 上，不是 fastapi 的。
#   路由层找不到路径（404）、方法不匹配（405）时抛的是 starlette 版；
#   fastapi.HTTPException 是它的子类，注册父类两边都覆盖得到，反过来会漏掉 404/405。
app.add_exception_handler(
    StarletteHTTPException,
    make_http_exception_handler(_uses_new_envelope),
)

# AuthError 是 fastapi.HTTPException 的子类，本该被上面那条覆盖；但它自带 payload，
# 要的是**逐字节**与 Flask 时代一致的 {"status":"error","message":"unauthorized"}。
# Starlette 查处理器时按 type(exc).__mro__ 从具体到宽泛找，所以这条更具体的会先命中。
app.add_exception_handler(AuthError, auth_error_handler)


async def _validation_error_handler(request: Request, exc: RequestValidationError):
    """pydantic 参数校验失败（422）。

    FastAPI 默认发 ``{"detail": [...]}``，又是第三种形状。老前端一个都不认，
    所以这里跟着 HTTPException 用同一套新旧切换逻辑。

    ⚠️ 老路由还没上 pydantic 模型之前基本不会走到这里；一旦某个老接口开始 422，
      多半是新写的依赖注入漏了默认值，去看日志里的 errors。
    """
    if _uses_new_envelope(request):
        return fail(
            "unprocessable_entity",
            "请求参数不合法",
            status=422,
            # errors() 里可能夹着 ValueError 实例，直接 json.dumps 会炸，先过一遍编码器。
            detail=jsonable_encoder(exc.errors()),
        )
    log.info("参数校验失败 %s %s: %s", request.method, request.url.path, exc.errors())
    return json_response({"status": "error", "message": "请求参数不合法"}, status_code=422)


app.add_exception_handler(RequestValidationError, _validation_error_handler)


async def _unhandled_error_handler(request: Request, exc: Exception):
    """兜底 500。

    不装它的话，Starlette 发的是 ``Internal Server Error`` 这一串**纯文本**，
    前端 21 个 parseJson 会在 `res.json()` 那一步抛 SyntaxError，把真正的
    「服务器 500 了」盖成一个莫名其妙的前端异常。

    ⚠️ 这个处理器归 ServerErrorMiddleware 调用，而它在所有用户中间件**之外** ——
      也就是说这条响应**不会经过 CORSMiddleware，没有 CORS 头**。跨域场景下浏览器
      仍然只会显示一句 CORS 错误。这是 Starlette 的既有行为，改不了；
      真正的解法是别让 500 发生，以及看服务端日志。
      （ServerErrorMiddleware 调完处理器还会把异常重新抛出去，所以 traceback 照样进日志。）

    ⚠️ 还有一点：``APP_DEBUG=1`` 时 ServerErrorMiddleware 走的是自己的调试页面，
      **根本不会调用这个处理器**（开发机现在就是 APP_DEBUG=1）。所以「500 返回 JSON」
      这件事只在生产成立，本地调试时看到的是一页 traceback —— 那是对的，别去改它。
    """
    return json_response({"status": "error", "message": "服务器内部错误"}, status_code=500)


app.add_exception_handler(Exception, _unhandled_error_handler)


# ═══════════════════════════ 6. 基础设施端点 ═══════════════════════════


@app.get("/healthz", include_in_schema=False)
async def healthz():
    """存活探针。deploy 脚本与 nginx 都打这条（08 文档 §5）。

    ★ **不鉴权、不查库、不碰 Redis。** 这是刻意的：
      健康检查一旦依赖数据库，数据库抖一下 → 探针失败 → systemd 重启进程 /
      负载均衡摘节点 → 连接风暴 → 数据库更慢。故障被探针本身放大。
      这条接口回答的问题只有一个：「这个 Python 进程还在喘气吗」。
      要看依赖的死活，另写一条 /readyz，别改这里。
    """
    return json_response(
        {"status": "ok", "app": settings.app_name, "env": settings.app_env},
        # 探针结果被任何一层缓存住都等于探针失效。
        headers={"cache-control": "no-store"},
    )


@app.get("/api/time", include_in_schema=False)
async def api_time(request: Request):
    """服务器时钟，替掉 socket 的 ``quiz:time:ping`` / ``game:time:ping``（12 文档 §3.1）。

    响应体与旧的 pong 帧**逐键一致**：``{"client_sent_at_ms", "server_now_ms"}``。
    前端现成的 handlePong 函数（quiz / game / mirror 共 6 处）算的是
    ``server_now_ms + roundTrip/2 - receivedAt``，形状不变就只用改「怎么拿到它」。

    ⚠️ 故意不套 ok() 的新信封：这是给已有前端代码直接消费的，多包一层 data
      就得同步改那 6 处。等 R1 推到 quiz 模块时一起换。

    client_sent_at_ms 手工解析、解不出就当没传，不用 FastAPI 的类型转换 ——
    参数脏一点（老客户端发了个空串）就回 422 的话，抢答页面的时钟同步会整个失效，
    而这条接口的可用性比参数严谨重要得多。

    now_ms() 取自 core.realtime，和 SSE 信封里的 ts、抢答判定用的是**同一个时钟函数**。
    抢答名次由服务器收到请求的时刻决定，两边时钟一致才谈得上公平。
    """
    raw = request.query_params.get("client_sent_at_ms")
    try:
        echoed = int(raw) if raw else None
    except (TypeError, ValueError):
        echoed = None
    return json_response(
        {"client_sent_at_ms": echoed, "server_now_ms": now_ms()},
        # 时间接口被缓存 = 客户端拿到一个过期时刻算偏移，比不同步还糟。
        headers={"cache-control": "no-store"},
    )


# ═══════════════════════════ 7. 实时（SSE）═══════════════════════════

# 把身份解析器显式注入 realtime：SSE 走 Cookie 认证（D8：EventSource 不能自定义请求头）。
# core.realtime 自己也会回落到这个函数，但显式注入有两个好处：
#   ① 接线关系写在装配处，一眼看得见，不必去读 realtime 的回落逻辑；
#   ② 省掉每进程第一次连接时那次「try import 失败就 warning」的探测。
# 用 optional 版而不是 get_current_user：SSE 的准入由各模块自己的 authorize 回调决定，
# 公开页（法会终端、活动大屏）本来就是匿名连的。
set_user_resolver(get_current_user_optional)

# GET {BASE}/{app}/realtime?room=a&room=b
# api_prefix 现在是空串 —— BASE_PATH（/UTBA_DEMO）已经区分了项目，再套一层 /api
# 不带信息量（11 文档 §2）。留着这个配置项是为了需要时还能加回来。
app.include_router(make_realtime_router(prefix=settings.api_prefix))


# ═══════════════════════════ 8. 业务路由注册位 ═══════════════════════════
#
# ★ 这里**故意是空的**。阶段 1 只交付地基（05 文档的模块迁移顺序还没开始），
#   现在往这儿挂路由等于把「框架能不能跑起来」和「某个模块搬得对不对」两件事绑在一起，
#   出问题时无法归因 —— 和「PG 迁移与 FastAPI 迁移分两次切机」是同一个理由。
#
# 阶段 2 开始搬业务时，在下面按模块逐条加，每加一条都要能单独回滚：
#
#     from app.routers import register_routers
#     register_routers(app)            # 574 条路由分模块注册，见 05 文档
#
# 另外两件同样等阶段 2 的事，一并记在这里免得散落：
#
#   · 静态文件。Flask 的 static_folder 会自动挂 /static，FastAPI 不会（02 文档 §6.6）：
#         from fastapi.staticfiles import StaticFiles
#         from app.paths import STATIC_ROOT
#         app.mount("/static", StaticFiles(directory=str(STATIC_ROOT)), name="static")
#     ⚠️ 生产上 /static 与 /media_file 都是 nginx 直接发的，应用这一层只在
#        开发直连端口时才用得着；挂之前先确认不会盖掉同名路由。
#
#   · MCP 服务（14 文档 §6）：
#         app.mount(f"{settings.app_base_path}/mcp", mcp.streamable_http_app())
#     ⚠️ mount 的路径要不要带 app_base_path，取决于那条 nginx location 剥不剥前缀，
#        落地时按实际配置核对，别照抄。


# ═══════════════════════════ 9. 本地直起 ═══════════════════════════

if __name__ == "__main__":
    # 仅供本机调试：`python asgi.py`。
    # 生产走 gunicorn + UvicornWorker（08 文档 §2），不走这条路径。
    #
    # 端口用 DEV_PORT=5102 —— 对上 frontend/vite.config.js 里那几条 proxy target。
    # ⚠️ 想「过一遍 nginx」测 /UTBA_DEMO 前缀的话，得起在 5006：
    #    scripts/nginx_v3.patch.conf 里那条 location 指的是 127.0.0.1:5006。
    import uvicorn

    uvicorn.run(
        "asgi:app",
        host="127.0.0.1",
        port=settings.dev_port,
        reload=settings.app_debug,
        # root_path 不在这里传：已经由 FastAPI(root_path=...) 喂进去了，
        # 两处都写的话，改配置时容易只改一处。
    )
