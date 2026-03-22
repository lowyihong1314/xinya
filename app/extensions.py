import os

from flask_login import LoginManager
from flask_migrate import Migrate
from flask_socketio import SocketIO

login_manager = LoginManager()
migrate = Migrate(compare_type=True)
REDIS_URL = os.getenv("XINYA_REDIS_URL", "redis://localhost:6379/0")
SOCKET_CHANNEL = os.getenv("XINYA_SOCKET_CHANNEL", "xinya_socket")
SOCKET_ALLOWED_ORIGINS = [
    "https://utbabuddha.com",
    "https://v2.utbabuddha.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Delay Socket.IO server initialization until the Flask app exists, so the
# Redis manager is created once with the correct read/write settings.
socketio = SocketIO()
socket_broker = SocketIO(
    message_queue=REDIS_URL,
    channel=SOCKET_CHANNEL,
)
