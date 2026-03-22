import eventlet

eventlet.monkey_patch()

from app import create_app, socketio
from _token import DEBUG, DEBUG_PORT

app = create_app(socket=True)

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=DEBUG_PORT, debug=DEBUG)
