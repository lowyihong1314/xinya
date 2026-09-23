from importlib import import_module


BLUEPRINT_SPECS = [
    ("backend.app.fahui.common.payment_routes", "fahui_payment_bp", "/payment", "api"),
    ("backend.app.fahui.YLP.payment_routes", "payment_bp", "/payment", "api"),
    ("backend.app.fahui.YLP.board_routes", "board_router_bp", "/board_router", "api"),
    ("backend.app.fahui.YLP.print_routes", "print_paiwei_bp", "/print_paiwei", "api"),
    ("backend.app.fahui.YLP.diy_paiwei", "diy_paiwei_bp", "/diy_paiwei", "api"),
    ("backend.app.fahui.YLP.routes", "fahui_bp", "/fahui_router", "api"),
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
