from importlib import import_module


BLUEPRINT_SPECS = [
    ("app.app_release", "app_release_bp", "/app", "api"),
    ("app.account", "account_bp", "/account", "api"),
    ("app.account", "payment_voucher_bp", "/account/print_payment_voucher", "api"),
    ("app.public_api", "api_bp", "/api", "api"),
    ("app.twilio", "twilio_bp", "/twilio", "api"),
    ("app.user_control", "user_control_bp", "/user_control", "api"),
    ("app.media", "media_bp", "/media", "root"),
    ("app.media", "nginx_media_router", "/media_file", "root"),
    ("app.payment", "payment_bp", "/payment", "api"),
    ("app.event", "event_data_bp", "/event_data", "api"),
    ("app.filesystem", "files_bp", "/files", "api"),
    ("app.content", "info_bp", "/info", "api"),
    ("app.music", "music_bp", "/music", "api"),
    ("app.form", "form_bp", "/form", "api"),
    ("app.songbook", "songbook_bp", "/songbook", "api"),
    ("app.changyou_room", "changyou_room_bp", "/changyou_room", "api"),
    ("app.permission_mgmt", "permission_bp", "/permission", "api"),
    ("app.lamp_registration", "lamp_registration_bp", "/lampRegistration_API", "api"),
]

def _register_spec_blueprint(app, api_prefix, module_path, attr_name, suffix, scope):
    module = import_module(module_path)
    blueprint = getattr(module, attr_name)
    app.register_blueprint(blueprint, url_prefix=_build_url_prefix(api_prefix, suffix, scope))
def _build_url_prefix(api_prefix, suffix, scope):
    if scope == "root":
        return suffix
    return f"{api_prefix}{suffix}"


def register_blueprints(app):
    api_prefix = app.config["API_PREFIX"]

    for module_path, attr_name, suffix, scope in BLUEPRINT_SPECS:
        _register_spec_blueprint(app, api_prefix, module_path, attr_name, suffix, scope)
