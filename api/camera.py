"""摄像头 / CCTV（原 app/camera/move_camera.py 的 Flask Blueprint move_camera_bp）。

只做框架适配：装饰器、参数提取、响应构造。状态码、响应体键名、错误分支逐字照搬 ——
frontend/src/CRM/CCTV/CCTVPage.tsx 按 ``data.ok`` / ``data.items`` / ``data.error`` 分支，
nginx 按 /authz 的状态码放行视频流，两边都不能动。

URL 变化（BASE_PATH 由 nginx 剥掉，应用内部一律写裸路径）：

    /api/move_camera/ping        → /move_camera/ping
    /api/move_camera/authz       → /move_camera/authz
    /api/move_camera/recordings  → /move_camera/recordings
    /api/move_camera/ptz/move    → /move_camera/ptz/move
    /api/move_camera/ptz/stop    → /move_camera/ptz/stop

★★★ /authz 是 nginx ``auth_request /cctv_authz`` 的后端，它**只看状态码**：
    2xx = 放行，401/403 = 拒绝。现状是 **204 / 401 / 403**，三个码一个都不许改。
    改错了不会有人收到报错 —— 结果是监控画面要么谁都能看（越权），
    要么谁都看不了（go2rtc 的 WS 和录像 mp4 一起 403）。
    /etc/nginx/conf.d/flaskapp_http.conf 里 `location = /cctv_authz` 指着这条路由，
    换 URL 必须同步改 nginx（见 §迁移交接）。

★ 路由一律 ``def``（同步）。ONVIF 是阻塞的 socket 往返（连不上时要等到超时），
  os.listdir / getsize 也是阻塞 IO，写成 ``async def`` 会把整个 worker 的事件循环焊死。
  FastAPI 会自动把 def 路由丢进线程池。

★ 本文件不能写 ``from __future__ import annotations``：core.auth.permission_required
  用 functools.wraps 包了一层，FastAPI 求值注解时用的是**包装函数的 __globals__**
  （core/auth.py 的命名空间）。开了 future annotations，注解会变成字符串跑去那边找名字，
  启动即 NameError。（api/permission_mgmt.py 顶上有同一条说明。）

迁移时丢掉的东西（都是原文件里**一次都没用到**的 import）：
  flask / flask_socketio / flask_login、app.extensions.socketio、models.db、
  EventData / AlbumFiles、sqlalchemy.text。留着它们等于把 Flask 那一整套
  拖进 FastAPI 进程，而这个模块压根不碰数据库。
"""

import json
import os
import threading
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from onvif import ONVIFCamera
from starlette.responses import PlainTextResponse, Response

from core.auth import current_user, get_current_user_permissions, permission_required
from core.config import settings
from core.responses import json_response

# prefix 用 settings.api_prefix 拼而不是写死：api_prefix 今天是空串（BASE_PATH 已经
# 区分了项目，不必再套一层 /api，见 11-BASE_PATH.md），配置项留着是为了需要时能整体加回来。
# 与 asgi.py 里 make_realtime_router(prefix=settings.api_prefix) 的写法保持一致。
router = APIRouter(prefix=f"{settings.api_prefix}/move_camera", tags=["camera"])


# ─────────────────────────── 1. ONVIF 连接（照搬） ───────────────────────────
#
# 摄像头连接是**进程级**的懒加载单例：gunicorn 开 4 个 worker 就有 4 条 ONVIF 会话，
# 这是 Flask 时代就有的现状，不在这次迁移里改。

_ptz_stop_timer = None
cam = None
media = None
ptz = None
profile = None

# ★ 这把锁是**框架适配必须加的**，不是顺手重构：
#   Flask 时代每个 gunicorn sync worker 一次只处理一个请求，上面那几个全局变量
#   天然是串行访问的。FastAPI 把 def 路由丢进线程池后，同一个 worker 里
#   move / stop 可以真并发（前端按住方向键就是连发），双重初始化会造出两个
#   ONVIFCamera，其中一个连着的 socket 谁也不管，表现是「偶尔一次 PTZ 没反应」。
#   只锁懒加载这一段，不锁 ONVIF 调用本身 —— 锁住调用会让「松开即停」排在移动指令后面。
#   TODO(迁移): zeep 客户端本身是否线程安全没有验证过；PTZ 真出现并发怪象时先查这里。
_camera_init_lock = threading.Lock()


def ensure_camera_ready():
    global cam, media, ptz, profile

    if all([cam, media, ptz, profile]):
        return

    with _camera_init_lock:
        # 双检：等锁期间可能已经有别的线程建好了。
        if all([cam, media, ptz, profile]):
            return
        # 连接参数从配置中心取。旧写法是 `from _token import CAM_IP, PORT, USER, PWD`，
        # 那三个短名字会被进程环境变量撞掉（systemd 的 User=、shell 的 PWD），
        # 所以 core/config.py 里一律改名成 CAM_ 前缀，见 10-配置中心.md。
        cam = ONVIFCamera(settings.cam_ip, settings.cam_port, settings.cam_user, settings.cam_password)
        media = cam.create_media_service()
        ptz = cam.create_ptz_service()
        profile = media.GetProfiles()[0]


def ptz_move(x=0, y=0, z=0, duration=100.0):
    global _ptz_stop_timer
    ensure_camera_ready()

    # 1️⃣ 发移动指令
    ptz.ContinuousMove({
        "ProfileToken": profile.token,
        "Velocity": {
            "PanTilt": {"x": x, "y": y},
            "Zoom": {"x": z}
        }
    })

    # 2️⃣ 取消上一次 stop
    if _ptz_stop_timer:
        _ptz_stop_timer.cancel()

    # 3️⃣ 定时 stop（必停版）
    _ptz_stop_timer = threading.Timer(duration, ptz_stop)
    _ptz_stop_timer.daemon = True
    _ptz_stop_timer.start()


def ptz_stop():
    ensure_camera_ready()
    ptz.Stop({
        "ProfileToken": profile.token,
        "PanTilt": True,
        "Zoom": True
    })


# 录像目录与对外路径。两者必须成对出现：nginx 里
# `location /cctv_rec/cam1/ { alias /srv/cctv/rec/cam1/; }` 把它们绑在一起。
# TODO(迁移): 这两个常量该进 core/config.py（换机器 / 换第二台摄像头时才不用改代码）。
REC_DIR = "/srv/cctv/rec/cam1"
REC_PUBLIC_BASE = "/cctv_rec/cam1"


# ─────────────────────────── 2. 请求体读取 ───────────────────────────


async def _read_body(request: Request) -> bytes:
    """在 async 侧把请求体读成裸字节，交给同步路由自己解析。

    为什么要这么绕：路由是 ``def``，拿不到 ``await``，而 Flask 的 ``request.json``
    在 FastAPI 里没有同步等价物。解析留在路由的 try 里，是为了让
    「body 为空 / 不是合法 JSON」照旧落进原来那个 503 分支 —— 若改用
    ``data: dict = Body(...)``，FastAPI 会在**进路由之前**回 422，
    状态码和响应体形状全变了（而且会绕过下面的权限检查）。
    """
    return await request.body()


# ─────────────────────────── 3. 路由 ───────────────────────────


@router.get("/ping")
def ping():
    # 存活自测用，无鉴权（与原实现一致）。
    # ⚠️ Flask 返回裸字符串时 Content-Type 是 text/html；这里用 PlainTextResponse
    #    发 text/plain。响应体仍是 "pong"，全项目没有调用点，取其一即可。
    #    （若直接 `return "pong"`，FastAPI 会序列化成带引号的 JSON ""pong""，那才是行为变更。）
    return PlainTextResponse("pong")


@router.get("/authz")
def api_authz():
    """供 nginx auth_request 使用：有 cctv 权限返回 204，否则 401/403。"""
    if not current_user.is_authenticated:
        return Response(status_code=401)
    try:
        perms = get_current_user_permissions(current_user)
    except Exception:
        # 读权限炸了一律当无权限（403），不往上抛 —— 这里抛异常会变成 500，
        # 而 nginx 的 auth_request 对 5xx 的处理与 403 不同（会把 500 透给用户）。
        return Response(status_code=403)
    if "cctv" not in perms:
        return Response(status_code=403)
    return Response(status_code=204)


@router.get("/recordings")
@permission_required("cctv")
def api_recordings():
    """回放：列出已保存、可播放的录像片段（排除正在写入的最新一段）。"""
    try:
        items = []
        try:
            names = sorted(n for n in os.listdir(REC_DIR) if n.endswith(".mp4"))
        except FileNotFoundError:
            names = []
        # 最新一段正在写入，moov 未落盘、无法播放，排除
        playable = names[:-1] if len(names) >= 1 else []

        def parse_start(fname):
            try:
                # 文件名是服务器时间（UTC），标记时区让前端正确换算本地时间
                return datetime.strptime(
                    fname[: len("2026-07-22_15-20-36")], "%Y-%m-%d_%H-%M-%S"
                ).replace(tzinfo=timezone.utc)
            except ValueError:
                return None

        starts = {name: parse_start(name) for name in names}
        for idx, name in enumerate(playable):
            path = os.path.join(REC_DIR, name)
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            if size <= 0:
                continue
            start_dt = starts.get(name)
            # 片段时长 ≈ 下一段开始 − 本段开始（最后一段用文件修改时间兜底）
            duration = None
            if start_dt is not None:
                next_start = starts.get(names[idx + 1]) if idx + 1 < len(names) else None
                end_dt = next_start
                if end_dt is None:
                    try:
                        end_dt = datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)
                    except OSError:
                        end_dt = None
                if end_dt is not None:
                    seconds = (end_dt - start_dt).total_seconds()
                    if 0 < seconds <= 3600 * 6:
                        duration = int(seconds)
            items.append({
                "name": name,
                "start": start_dt.isoformat() if start_dt else None,
                "duration": duration,
                "size": size,
                # ★ 这里**故意不过 core.urls.public_url()**。/cctv_rec/cam1/ 是 nginx 在
                #   域名**根目录**上的 location（alias /srv/cctv/rec/cam1/），不在
                #   BASE_PATH 底下；拼成 /UTBA_DEMO/cctv_rec/... 会 404，
                #   前端拿它直接当 <video src> 和下载链接用。
                "url": f"{REC_PUBLIC_BASE}/{name}",
            })
        items.reverse()  # 最新在前
        return json_response({"ok": True, "items": items})
    except Exception as exc:
        # 原来是 `return jsonify(ok=False, error=str(exc)), 500`；FastAPI 不认元组，
        # 只能显式造响应。键名和状态码不变。
        return json_response({"ok": False, "error": str(exc)}, status_code=500)


@router.post("/ptz/move")
@permission_required("cctv")
def api_ptz_move(raw: bytes = Depends(_read_body)):
    try:
        # 等价于 Flask 的 `request.json or {}`：body 空或不是合法 JSON 时抛异常，
        # 与原来一样落进下面的 503 分支（Flask 那边是 415/400 被 except 吞掉）。
        data = json.loads(raw) or {}
        ptz_move(
            x=float(data.get("x", 0)),
            y=float(data.get("y", 0)),
            z=float(data.get("z", 0)),
            duration=100.0,
        )
        return json_response({"ok": True})
    except Exception as exc:
        return json_response({"ok": False, "error": str(exc)}, status_code=503)


@router.post("/ptz/stop")
@permission_required("cctv")
def api_ptz_stop():
    try:
        ptz_stop()
        return json_response({"ok": True})
    except Exception as exc:
        return json_response({"ok": False, "error": str(exc)}, status_code=503)


# ═══════════════════════════ 迁移交接 ═══════════════════════════
#
# asgi.py 里（「业务路由注册位」那一段）：
#     from api import camera
#     app.include_router(camera.router)
#
# 同时要做的三件事（都不是本文件的活）：
#
#   1. 摘掉 app/blueprints.py 里的
#      ("app.camera", "move_camera_bp", "/move_camera", "api")，并删掉 app/camera/。
#
#   2. ★ nginx：/etc/nginx/conf.d/flaskapp_http.conf 的
#          location = /cctv_authz { proxy_pass http://127.0.0.1:5006/api/move_camera/authz; }
#      指的还是 Flask 时代的端口和 /api 前缀。切到 FastAPI 后要改成新的上游与路径
#      （v3 走 /UTBA_DEMO 时是 .../UTBA_DEMO/move_camera/authz，由那条 location 自己剥前缀）。
#      **改之前先备份**，改完用 `curl -I` 验一遍 200/401/403 三种情况：
#      这条链路断了的症状是「登录了也看不到画面」或者「没登录也能看」。
#
#   3. 前端 frontend/src/CRM/CCTV/CCTVPage.tsx 的三处 /api/move_camera/... 要去掉 /api。
#
# dev 机现状（顺手记一笔，不是代码问题）：system_config.env 里 CAM_USER / CAM_PASSWORD
# 是空的，所以本机跑 /ptz/move 只会得到 503 —— 这是配置没填，不是迁移搬坏了。
