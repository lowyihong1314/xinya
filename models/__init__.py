from importlib import import_module

# v3：从 Flask-SQLAlchemy 换成自己的垫片 core.db。
# 这样 models/ 下 100 个模型类、2500+ 个 db.* 调用点一个字都不用改，
# 而应用可以脱离 Flask 运行（见 docs/flask_to_fastAPI/04-兼容层设计.md）。
# 过渡期 Flask 仍在跑，靠 db.init_app() 补上每请求的会话作用域。
from core.db import db

MODEL_MODULES = (
    "models.user_data",
    "models.info",
    "models.event_data",
    "models.form",
    "models.membership_registration",
    "models.file_manager_DB",
    "models.music",
    "models.finance",
    "models.gl",
    "models.asset",
    "models.lampRegistration",
    "models.fahui",
    "models.songbook",
    "models.songbook_user_edit",
    "models.youth_class_registration",
    "models.email_log",
    "models.quiz_game",
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
