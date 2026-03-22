from importlib import import_module

from flask import Flask
from flask_cors import CORS

from app.blueprints import register_blueprints
from app.cli import register_cli
from app.extensions import (
    REDIS_URL,
    SOCKET_ALLOWED_ORIGINS,
    SOCKET_CHANNEL,
    login_manager,
    migrate,
    socketio,
)
from app.paths import STATIC_ROOT, TEMPLATE_ROOT
from app.settings import DefaultConfig
from app.web import register_web_routes
from models import db, load_model_modules


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
            cors_allowed_origins=SOCKET_ALLOWED_ORIGINS,
            message_queue=REDIS_URL,
            channel=SOCKET_CHANNEL,
            async_mode="eventlet",
            manage_session=True,
        )
        import_module("app.socket_events")

    register_blueprints(app)
    register_web_routes(app)
    return app
