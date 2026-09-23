from importlib import import_module

# v3：从 Flask-SQLAlchemy 换成自己的垫片 core.db。
# 这样 models/ 下 100 个模型类、2500+ 个 db.* 调用点一个字都不用改，
# 而应用可以脱离 Flask 运行（见 docs/flask_to_fastAPI/04-兼容层设计.md）。
# 过渡期 Flask 仍在跑，靠 db.init_app() 补上每请求的会话作用域。
from backend.core.db import db

MODEL_MODULES = (
    "backend.models.user_data",
    "backend.models.info",
    "backend.models.event_data",
    "backend.models.form",
    "backend.models.membership_registration",
    "backend.models.file_manager",
    "backend.models.music",
    "backend.models.finance",
    "backend.models.gl",
    "backend.models.asset",
    "backend.models.lamp_registration",
    "backend.models.fahui",
    "backend.models.songbook",
    "backend.models.songbook_user_edit",
    "backend.models.youth_class_registration",
    "backend.models.email_log",
    "backend.models.quiz_game",
)


def load_model_modules():
    for module_path in MODEL_MODULES:
        import_module(module_path)


def get_shell_context():
    load_model_modules()
    shell_context = {"db": db}

    for name, model in db.Model.registry._class_registry.items():
        if isinstance(name, str) and isinstance(model, type):
            shell_context[name] = model

    return shell_context
