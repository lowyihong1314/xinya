"""网页外壳：发 SPA、favicon、分享页（og:image 注入）。

原 backend/app/web.py（Flask 的 register_web_routes）。那边只有两类路由值得搬：

  · ``/`` 与 favicon —— 发外壳，落到本文件最后那条 catch-all / favicon 路由。
  · ``/event/<id>`` 与 ``/image/<id>`` —— 分享页，**本文件下半部分**。

其余的（``/changyou-room/<id>``、``/music-portal``、``/privacy``、几条 ``/template/*``
模板页、以及 ``/quiz`` ``/game`` ``/mirror`` 那几条 hash 短链跳转）一条都没搬：
前端已经改成单页应用 + 路径路由，这些路径由下面的 catch-all 发外壳、前端自己接管。

── 路由分流的规则 ──────────────────────────────────────────────────
nginx 把 {BASE}/* 全部转给本应用，不做 API/SPA 分流。分流由**本应用的路由表**
自己完成：能匹配到业务路由的走业务路由，匹配不到的落到本文件最后那条 catch-all，
返回 SPA 外壳。前端是路径路由（createBrowserRouter），它需要的正是这个兜底。

⚠️ 因此 **catch-all 必须最后注册**（见 backend/api/router.py 的顺序说明），
  提前注册会把后面所有业务路由吃掉。

⚠️ **本文件内部也有顺序约束**：``/event/{event_id:int}`` 和 ``/image/{file_id:int}``
  必须写在 ``spa_fallback`` **之前**。``/{spa_path:path}`` 匹配一切路径，
  排在它后面的路由永远不会被命中（症状：分享出去的链接没有缩略图，
  而且看不出任何报错 —— 外壳照发，只是没 og 标签）。
  所以新增路由一律加在「分享页」那一段之后、catch-all 之前。

⚠️ 前端路由的第一段不能和业务路由的第一段重名，重名的那条前端路由永远到不了
  浏览器。前端侧有 scripts/check-route-collisions.mjs 在构建前拦这件事。
"""

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse
from starlette.requests import Request

from backend.api.web import share
from backend.core.paths import STATIC_ROOT
from backend.models.event_data import AlbumFiles, EventData

router = APIRouter(include_in_schema=False)  # 这些不是 API，别混进 /docs

# vite 的构建产物。outDir 是 frontend/vite.config.ts 里的 "../static/vite"。
SPA_DIR = Path(STATIC_ROOT) / "vite"
SPA_INDEX = SPA_DIR / "index.html"

# 开发时 index.html 由 vite dev server（5173）发，本应用只管 API；
# 生产/预览时才由这里发构建产物。两种情况下前端拿到的 HTML 不同是正常的。
_MISSING_HINT = (
    "<!doctype html><meta charset=utf-8><title>未构建</title>"
    "<body style='font-family:system-ui;padding:2rem;line-height:1.7'>"
    "<h1>前端还没构建</h1>"
    "<p>在 <code>frontend/</code> 下执行 <code>npm run build</code>，"
    "产物会落到 <code>static/vite/</code>。</p>"
    "<p>开发时请直接访问 vite dev server（默认 5173），它会把后端请求代理到这里。</p>"
)

# 外壳本身必须每次校验（否则发版后用户拿到旧的 index.html，它引用的带 hash 的 js
# 已经不存在，表现是白屏）；带 hash 的静态资源由 /static 挂载长缓存。
_SHELL_CACHE_CONTROL = "no-cache"


def _spa_response() -> HTMLResponse | FileResponse:
    """发 SPA 外壳。没构建过就给一句人话，而不是 500 或者空白页。"""
    if not SPA_INDEX.is_file():
        return HTMLResponse(_MISSING_HINT, status_code=503)
    # no-cache 而不是 no-store：理由见 _SHELL_CACHE_CONTROL。
    return FileResponse(SPA_INDEX, media_type="text/html", headers={"Cache-Control": _SHELL_CACHE_CONTROL})


def _share_response(head_html: str, cache_seconds: int) -> HTMLResponse:
    """发注了 og 标签的 SPA 外壳。

    没构建过时**沿用 _spa_response 的 503 分支** —— 同一个原因就该是同一个响应，
    不要在这里另编一个 500，否则排查的人会以为是分享逻辑自己挂了。

    Cache-Control 用 ``public, max-age=300``（与旧版一致，不是外壳的 no-cache）：
    爬虫会反复抓同一个链接，让它们缓存五分钟能省掉重复的 ffmpeg 抽帧。
    代价是活动名改了以后最多五分钟内分享出去还是旧标题，可以接受。
    """
    if not SPA_INDEX.is_file():
        return HTMLResponse(_MISSING_HINT, status_code=503)
    shell = SPA_INDEX.read_text(encoding="utf-8")
    return HTMLResponse(
        share.inject_head(shell, head_html),
        headers={"Cache-Control": f"public, max-age={cache_seconds}"},
    )


@router.api_route("/favicon.ico", methods=["GET", "HEAD"])
def favicon():
    """浏览器会主动请求它。不给的话每个页面都多一条 404 日志。"""
    icon = Path(STATIC_ROOT) / "images" / "logo" / "logo.png"
    if not icon.is_file():
        return HTMLResponse("", status_code=404)
    return FileResponse(icon, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


# ─────────────────────────── 分享页 ───────────────────────────
#
# ★ 必须在下面的 catch-all 之前注册（理由见模块 docstring 的第二条 ⚠️）。
#
# ★ 两条都写 ``api_route(methods=["GET", "HEAD"])`` 而不是 ``@router.get``：
#   链接预览爬虫（WhatsApp、微信、Telegram 的一部分）**先发 HEAD 探一下**再发 GET。
#   FastAPI 的 ``.get()`` 不自动补 HEAD（Flask/werkzeug 是补的），少了它爬虫拿到
#   405 就直接放弃，缩略图就没了 —— 而且用浏览器点开一切正常，极难查。
#   写法与 backend/api/music/router.py 的 download / album_cover 一致。
#
# ★ 一律 ``def``（同步）：底下有同步 ORM 查询、PIL 裁图、``subprocess.run`` 跑 ffmpeg
#   抽视频封面帧（最长 25 秒超时）。写成 async def 会把整个 worker 的事件循环焊死。
#   FastAPI 会自动把 def 丢进线程池。
#
# ★ 路径参数写 ``{event_id:int}``（Starlette 转换器）而不是只靠 ``: int`` 注解：
#   Flask 的 ``<int:event_id>`` 在参数不是整数时是**不匹配**（于是落到 catch-all
#   发 SPA 外壳）；只靠注解的话 FastAPI 会先匹配上再校验失败 → 422。
#   ``/event/abc`` 这种链接应该进前端而不是回一坨 JSON 报错。


@router.api_route("/event/{event_id:int}", methods=["GET", "HEAD"])
def event_share(event_id: int, request: Request):
    """活动分享链接。发 SPA 外壳 + 注入 og 标签。

    ★ 这里**不再是**旧版那个独立中间页（templates/event_share.html，已删）。
      那个页面上的「打开活动详情」按钮链到 ``/#/event/{id}``；新前端是路径路由，
      ``/events/{id}`` 就是应用本身的地址，中间页的按钮会指向自己，原地死循环。
      现在：爬虫读 head 拿缩略图，真人直接落进应用。详见 share.py 的 docstring。

    ``get_or_404`` 用的是 core/db.py 的垫片，活动不存在时抛 HTTPException(404)，
    由 main.py 的处理器渲染成 JSON。分享一个已删除的活动就该是 404，不该发外壳。
    """
    event = EventData.query.get_or_404(event_id)
    head_html = share.event_share_head(event, request)
    return _share_response(head_html, share.EVENT_SHARE_CACHE_SECONDS)


@router.api_route("/image/{file_id:int}", methods=["GET", "HEAD"])
def image_share(file_id: int, request: Request):
    """单张媒体（图片 / 视频）的分享链接。

    ⚠️ 前端目前**没有** ``/image/{id}`` 这个页面，所以真人点进来会落到前端的 404。
      og 标签仍然是对的（爬虫要的缩略图正常），canonical 也仍指向本地址。
      前端补上图片详情页后，要同步改 share.image_share_head 里的 canonical。
    """
    album_file = AlbumFiles.query.get_or_404(file_id)
    # event 可能为空（历史数据里有 event_id 为 NULL 的行），下游全用 getattr 取值。
    event = EventData.query.get(album_file.event_id) if album_file.event_id else None
    head_html = share.image_share_head(album_file, event, request)
    return _share_response(head_html, share.IMAGE_SHARE_CACHE_SECONDS)


# ─────────────────────────── SPA 兜底（必须最后）───────────────────────────


@router.get("/{spa_path:path}")
def spa_fallback(spa_path: str):
    """SPA 兜底。

    ★ 只接 GET。POST 到一个不存在的路径应当是 405/404，返回 HTML 会让调用方
      把一份 HTML 当成 JSON 去解析，报出来的错和真正的原因毫无关系。
      （APIRouter 的 get 装饰器已经保证了这点，这里写明是怕后来的人加上 api_route。）

    ★ 本文件里**没有任何路由可以加在它后面**。见模块 docstring。
    """
    return _spa_response()
