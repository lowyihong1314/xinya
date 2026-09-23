from importlib import import_module


BLUEPRINT_SPECS = [
    ("backend.app.account", "account_bp", "/account", "api"),
    ("backend.app.account", "payment_voucher_bp", "/account/print_payment_voucher", "api"),
    ("backend.app.asset", "asset_bp", "/asset", "api"),
    ("backend.app.gl", "gl_bp", "/gl", "api"),
    ("backend.app.user_control", "user_control_bp", "/user_control", "api"),
    ("backend.app.media", "media_bp", "/media", "root"),
    ("backend.app.media", "nginx_media_router", "/media_file", "root"),
    ("backend.app.fahui.common.payment_routes", "fahui_payment_bp", "/payment", "api"),
    ("backend.app.fahui.YLP.payment_routes", "payment_bp", "/payment", "api"),
    ("backend.app.fahui.YLP.board_routes", "board_router_bp", "/board_router", "api"),
    ("backend.app.fahui.YLP.print_routes", "print_paiwei_bp", "/print_paiwei", "api"),
    ("backend.app.fahui.YLP.diy_paiwei", "diy_paiwei_bp", "/diy_paiwei", "api"),
    ("backend.app.event", "event_data_bp", "/event_data", "api"),
    ("backend.app.filesystem", "files_bp", "/files", "api"),
    ("backend.app.content", "info_bp", "/info", "api"),
    ("backend.app.music", "music_bp", "/music", "api"),
    ("backend.app.quiz", "quiz_bp", "/quiz", "api"),
    ("backend.app.quiz_game", "quiz_game_bp", "/quiz_game", "api"),
    ("backend.app.mirror", "mirror_bp", "/mirror", "api"),
    ("backend.app.form", "form_bp", "/form", "api"),
    ("backend.app.fahui.YLP.routes", "fahui_bp", "/fahui_router", "api"),
    ("backend.app.songbook", "songbook_bp", "/songbook", "api"),
    ("backend.app.changyou_room", "changyou_room_bp", "/changyou_room", "api"),
    ("backend.app.fahui.lamp.routes", "lamp_registration_bp", "/lampRegistration_API", "api"),
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
