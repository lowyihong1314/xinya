from app.extensions import socketio


def create_app(*args, **kwargs):
    from app.factory import create_app as app_create_app

    return app_create_app(*args, **kwargs)


__all__ = ["create_app", "socketio"]
