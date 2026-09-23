"""twilio —— 路由已搬到 api/twilio.py（FastAPI）。

这里改成惰性导出：包级 ``from .routes import twilio_bp`` 会把 Flask 拉进
已经不用 Flask 的进程（api/ 下的路由还要复用本包的 services）。
Blueprint 本身留着只为让尚未清理的 app/blueprints.py 不报错，
等 app/ 搬空后连同本文件一起删。
"""

__all__ = ["twilio_bp"]


def __getattr__(attr):
    if attr == "twilio_bp":
        from .routes import twilio_bp as _bp

        return _bp
    raise AttributeError(f"module 'app.twilio' has no attribute {attr!r}")
