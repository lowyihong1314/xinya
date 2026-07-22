from datetime import datetime
from flask import send_file, current_app, Blueprint, jsonify,request
from models import db
from sqlalchemy import text
from flask_socketio import emit, join_room
from app.extensions import socketio
from models.event_data import EventData,AlbumFiles  # 确保导入你的 ORM
from flask_login import current_user
from onvif import ONVIFCamera
from app.auth import permission_required
from _token import CAM_IP, PORT, USER, PWD
import threading

_ptz_stop_timer = None
cam = None
media = None
ptz = None
profile = None


move_camera_bp = Blueprint('move_camera', __name__)


def ensure_camera_ready():
    global cam, media, ptz, profile

    if all([cam, media, ptz, profile]):
        return

    cam = ONVIFCamera(CAM_IP, PORT, USER, PWD)
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
@move_camera_bp.route("/ping", methods=["GET"])
def ping():
    return "pong"


@move_camera_bp.get("/authz")
def api_authz():
    """供 nginx auth_request 使用：有 cctv 权限返回 204，否则 401/403。"""
    from app.auth import get_current_user_permissions

    if not current_user.is_authenticated:
        return "", 401
    try:
        perms = get_current_user_permissions(current_user)
    except Exception:
        return "", 403
    if "cctv" not in perms:
        return "", 403
    return "", 204


import os

REC_DIR = "/srv/cctv/rec/cam1"
REC_PUBLIC_BASE = "/cctv_rec/cam1"


@move_camera_bp.get("/recordings")
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
        for name in playable:
            path = os.path.join(REC_DIR, name)
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            if size <= 0:
                continue
            start = None
            try:
                start = datetime.strptime(name[: len("2026-07-22_15-20-36")],
                                          "%Y-%m-%d_%H-%M-%S").isoformat()
            except ValueError:
                pass
            items.append({
                "name": name,
                "start": start,
                "size": size,
                "url": f"{REC_PUBLIC_BASE}/{name}",
            })
        items.reverse()  # 最新在前
        return jsonify(ok=True, items=items)
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 500

@move_camera_bp.post("/ptz/move")
@permission_required("cctv")
def api_ptz_move():
    try:
        data = request.json or {}
        ptz_move(
            x=float(data.get("x", 0)),
            y=float(data.get("y", 0)),
            z=float(data.get("z", 0)),
            duration=100.0,
        )
        return jsonify(ok=True)
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 503


@move_camera_bp.post("/ptz/stop")
@permission_required("cctv")
def api_ptz_stop():
    try:
        ptz_stop()
        return jsonify(ok=True)
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 503
