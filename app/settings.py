from _token import DB_HOST, DB_NAME, DB_PASSWORD, DB_USER, SECRET_KEY


class DefaultConfig:
    SECRET_KEY = SECRET_KEY
    SQLALCHEMY_DATABASE_URI = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}/{DB_NAME}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    MAX_CONTENT_LENGTH = 1024 * 1024 * 5000
    API_PREFIX = "/api"
    # Allow session cookie in Capacitor cross-origin WebView requests
    SESSION_COOKIE_SAMESITE = "None"
    SESSION_COOKIE_SECURE = True
