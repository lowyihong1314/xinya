from importlib import import_module

from flask import Flask
from flask_cors import CORS

from backend.core.permissions import ensure_known_permissions
from backend.app.blueprints import register_blueprints
from backend.app.cli import register_cli
from backend.app.extensions import (
    REDIS_URL,
    socket_origin_allowed,
    SOCKET_CHANNEL,
    login_manager,
    migrate,
    socketio,
)
from backend.core.paths import STATIC_ROOT, TEMPLATE_ROOT
from backend.app.settings import DefaultConfig
from backend.models import db, load_model_modules


def create_app(socket=False):
    app = Flask(
        __name__,
        static_folder=str(STATIC_ROOT),
        template_folder=str(TEMPLATE_ROOT),
    )
    app.config.from_object(DefaultConfig)
    load_model_modules()

    CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    register_cli(app)

    if socket:
        socketio.init_app(
            app,
            cors_allowed_origins=socket_origin_allowed,
            message_queue=REDIS_URL,
            channel=SOCKET_CHANNEL,
            async_mode="eventlet",
            manage_session=True,
        )
        import_module("backend.app.socket_events")

    register_blueprints(app)
    # backend/app/web.py 已删除：SPA 外壳 / favicon / 分享页（/event、/image）
    # 全部搬到 backend/api/web/（FastAPI）。这个 Flask 工厂只剩历史包袱，
    # 已经没有任何入口在跑它。
    with app.app_context():
        ensure_known_permissions()
    return app
