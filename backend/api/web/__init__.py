"""网页外壳（SPA / favicon）与分享页（og:image 注入）。

路由全在 router.py —— **包括**分享页的两条，它们必须与 catch-all 同处一个文件
并排在它前面（``/{spa_path:path}`` 会吃掉一切排在它后面的路由）。
helper 在 share.py。
"""

from .router import router

__all__ = ["router"]
