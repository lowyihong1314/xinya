"""media 模块。路由在 router.py。"""

from .router import media_file_router, router

# media_file_router 是第二条路由器：原 Flask 的 nginx_media_router 蓝图，
# 挂在应用**根上**（/media_file/<path>），不跟 media 的 /media 前缀走。
# 接线（api/router.py）由上游统一做，这里只负责导出。
__all__ = ["router", "media_file_router"]
