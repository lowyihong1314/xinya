from flask_login import LoginManager
from flask_socketio import SocketIO

login_manager = LoginManager()
socketio = SocketIO(
    cors_allowed_origins="*",
    message_queue="redis://localhost:6379",
    async_mode="eventlet",
    manage_session=True,
)
