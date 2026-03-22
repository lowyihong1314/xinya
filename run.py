def _build_app():
    if __name__ == "__main__":
        import eventlet

        eventlet.monkey_patch()

    from app import create_app, socketio

    return create_app(socket=True), socketio


app, socketio = _build_app()


if __name__ == "__main__":
    from _token import DEBUG, DEBUG_PORT

    socketio.run(app, host="0.0.0.0", port=DEBUG_PORT, debug=DEBUG)
