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

@move_camera_bp.post("/ptz/move")
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
def api_ptz_stop():
    try:
        ptz_stop()
        return jsonify(ok=True)
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 503
