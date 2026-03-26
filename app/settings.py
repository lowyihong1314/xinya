from datetime import timedelta

from _token import DB_HOST, DB_NAME, DB_PASSWORD, DB_USER, SECRET_KEY


class DefaultConfig:
    SECRET_KEY = SECRET_KEY
    SQLALCHEMY_DATABASE_URI = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}/{DB_NAME}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    MAX_CONTENT_LENGTH = 1024 * 1024 * 5000
    API_PREFIX = "/api"
    # Persist login state for the APK WebView and allow the cookies to flow on
    # cross-origin requests from https://localhost -> https://utbabuddha.com.
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "None"
    SESSION_COOKIE_SECURE = True
    REMEMBER_COOKIE_DURATION = timedelta(days=7)
    REMEMBER_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_SAMESITE = "None"
    REMEMBER_COOKIE_SECURE = True
    REMEMBER_COOKIE_REFRESH_EACH_REQUEST = True
