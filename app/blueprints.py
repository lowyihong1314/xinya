from importlib import import_module


BLUEPRINT_SPECS = [
    ("app.app_release", "app_release_bp", "/app", "api"),
    ("app.account", "account_bp", "/account", "api"),
    ("app.account", "payment_voucher_bp", "/account/print_payment_voucher", "api"),
    ("app.asset", "asset_bp", "/asset", "api"),
    ("app.public_api", "api_bp", "/api", "api"),
    ("app.twilio", "twilio_bp", "/twilio", "api"),
    ("app.user_control", "user_control_bp", "/user_control", "api"),
    ("app.media", "media_bp", "/media", "root"),
    ("app.media", "nginx_media_router", "/media_file", "root"),
    ("app.fahui.common.payment_routes", "fahui_payment_bp", "/payment", "api"),
    ("app.fahui.YLP.payment_routes", "payment_bp", "/payment", "api"),
    ("app.fahui.YLP.board_routes", "board_router_bp", "/board_router", "api"),
    ("app.fahui.YLP.print_routes", "print_paiwei_bp", "/print_paiwei", "api"),
    ("app.event", "event_data_bp", "/event_data", "api"),
    ("app.filesystem", "files_bp", "/files", "api"),
    ("app.content", "info_bp", "/info", "api"),
    ("app.music", "music_bp", "/music", "api"),
    ("app.form", "form_bp", "/form", "api"),
    ("app.fahui.YLP.routes", "fahui_bp", "/fahui_router", "api"),
    ("app.songbook", "songbook_bp", "/songbook", "api"),
    ("app.changyou_room", "changyou_room_bp", "/changyou_room", "api"),
    ("app.permission_mgmt", "permission_bp", "/permission", "api"),
    ("app.fahui.lamp.routes", "lamp_registration_bp", "/lampRegistration_API", "api"),
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
