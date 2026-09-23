"""app 包 —— Flask 时代的应用代码，正在按模块搬去 api/ + core/。

v3 起这个文件**不在模块级 import 任何东西**。原来第一行是
``from app.extensions import socketio``，后果是：api/ 下的路由只要
``from app.mobile.session_service import ...`` 复用一下 services，
就会连锁拉起 app.extensions → flask_socketio → eventlet，
把整个 Flask 栈（实测 78 个模块）请回已经下线 Flask 的 FastAPI 进程里。

create_app / socketio 仍可用，但改成惰性访问 —— 只有真正去取的人才付这个代价。
等 app/ 全部搬空，这个文件连同 factory.py、extensions.py 一起删。
"""

__all__ = ["create_app", "socketio"]


def __getattr__(name):
    # PEP 562 的模块级 __getattr__：访问才 import，不访问就不付 Flask 的代价。
    if name == "create_app":
        from app.factory import create_app as _create_app

        return _create_app
    if name == "socketio":
        from app.extensions import socketio as _socketio

        return _socketio
    raise AttributeError(f"module 'app' has no attribute {name!r}")
