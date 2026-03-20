import os

from flask import send_from_directory

from app.paths import STATIC_ROOT


def register_web_routes(app):
    @app.route("/")
    def index():
        return send_from_directory(str(STATIC_ROOT), "index.html")

    @app.route("/favicon.ico")
    def favicon():
        return send_from_directory(
            os.path.join(STATIC_ROOT, "images", "logo"),
            "logo.png",
            mimetype="image/png",
        )
