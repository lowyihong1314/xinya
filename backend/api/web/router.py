"""网页外壳：发 SPA、静态资源、favicon。

原 backend/app/web.py 的一部分（那是 Flask 的 register_web_routes，
Flask 下线后它**一条都没注册**，所以 dev 站访问 / 一直是 404）。

── 路由分流的规则 ──────────────────────────────────────────────────
nginx 把 {BASE}/* 全部转给本应用，不做 API/SPA 分流。分流由**本应用的路由表**
自己完成：能匹配到业务路由的走业务路由，匹配不到的落到本文件最后那条 catch-all，
返回 SPA 外壳。前端是路径路由（createBrowserRouter），它需要的正是这个兜底。

⚠️ 因此 **catch-all 必须最后注册**（见 backend/api/router.py 的顺序说明），
  提前注册会把后面所有业务路由吃掉。

⚠️ 前端路由的第一段不能和业务路由的第一段重名，重名的那条前端路由永远到不了
  浏览器。前端侧有 scripts/check-route-collisions.mjs 在构建前拦这件事。

── 尚未搬过来的 ────────────────────────────────────────────────────
分享页的 og:image 注入（/event/{id}、/image/{id}）还在 backend/app/web.py 里，
它依赖 app/media/services.py，而那个文件还 import 着 flask —— 一起搬会把 Flask
拉回进程。等 media / event 模块搬迁时一并处理，见 docs/00-迁移进度.md。
在那之前这两条路径走 catch-all，功能正常（前端会自己取数渲染），
只是分享到微信/WhatsApp 时没有缩略图 —— 与 dev 站**当前**状态一致，没有退化。
"""

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse

from backend.core.config import settings
from backend.core.paths import STATIC_ROOT

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


def _spa_response() -> HTMLResponse | FileResponse:
    """发 SPA 外壳。没构建过就给一句人话，而不是 500 或者空白页。"""
    if not SPA_INDEX.is_file():
        return HTMLResponse(_MISSING_HINT, status_code=503)
    # no-cache 而不是 no-store：外壳本身必须每次校验（否则发版后用户拿到旧的
    # index.html，它引用的带 hash 的 js 已经不存在，表现是白屏）；
    # 带 hash 的静态资源由下面的 /static 挂载长缓存。
    return FileResponse(SPA_INDEX, media_type="text/html", headers={"Cache-Control": "no-cache"})


@router.get("/favicon.ico")
def favicon():
    """浏览器会主动请求它。不给的话每个页面都多一条 404 日志。"""
    icon = Path(STATIC_ROOT) / "images" / "logo" / "logo.png"
    if not icon.is_file():
        return HTMLResponse("", status_code=404)
    return FileResponse(icon, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/{spa_path:path}")
def spa_fallback(spa_path: str):
    """SPA 兜底。

    ★ 只接 GET。POST 到一个不存在的路径应当是 405/404，返回 HTML 会让调用方
      把一份 HTML 当成 JSON 去解析，报出来的错和真正的原因毫无关系。
      （APIRouter 的 get 装饰器已经保证了这点，这里写明是怕后来的人加上 api_route。）
    """
    return _spa_response()
