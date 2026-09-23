"""mirror 模块（「别人眼中的我」匿名互评）。路由在 router.py。

★ 导入这个包会顺带把 RealtimeApp 注册进 core.realtime 的 REGISTRY
  （register() 在 router.py 末尾），SSE 端点 GET {BASE}/mirror/realtime 才认这个 app 名。
"""

from .router import router

__all__ = ["router"]
