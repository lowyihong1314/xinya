from flask_login import LoginManager
from flask_migrate import Migrate
from flask_socketio import SocketIO

login_manager = LoginManager()
migrate = Migrate(compare_type=True)
socketio = SocketIO(
    cors_allowed_origins="*",
    message_queue="redis://localhost:6379",
    async_mode="eventlet",
    manage_session=True,
)
