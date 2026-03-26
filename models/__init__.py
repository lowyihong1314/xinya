from importlib import import_module

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

MODEL_MODULES = (
    "models.user_data",
    "models.info",
    "models.event_data",
    "models.form",
    "models.membership_registration",
    "models.file_manager_DB",
    "models.music",
    "models.finance",
    "models.lampRegistration",
    "models.songbook",
    "models.songbook_user_edit",
    "models.youth_class_registration",
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
