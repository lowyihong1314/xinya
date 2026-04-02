import os

from flask import redirect, render_template, request, send_from_directory

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


    @app.route("/template/long-open-registration-form")
    def long_open_registration_form_template():
        return render_template("form/long_open_registration_form_public.html")

    @app.route("/template/youth-class-registration")
    def youth_class_registration_template():
        preferred = request.args.get("preferred") or "youth_class"
        return redirect(f"/template/long-open-registration-form?preferred={preferred}")

    @app.route("/template/youth-class-registration/payment")
    def youth_class_registration_payment_template():
        return render_template("form/youth_class_payment_public.html")

    @app.route("/template/membership-application")
    def membership_application_template():
        preferred = request.args.get("preferred") or "membership"
        source = request.args.get("source")
        target = f"/template/long-open-registration-form?preferred={preferred}"
        if source:
            target = f"{target}&source={source}"
        return redirect(target)

    @app.route("/template/membership-payment")
    def membership_payment_template():
        return render_template("form/membership_payment_public.html")
