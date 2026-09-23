"""活动附件落盘路径的两个助手。

原 ``backend/app/event/services.py`` 顶部是
``from backend.api.media.paths import DATA_PATH, to_short_data_path``。
**这一行不能照搬**，而且两个可选的 import 源现在都不行：

  · ``backend.app.media.paths``（Flask 那份）：``import`` 它会先执行
    ``backend/app/media/__init__.py``，那一行 ``from backend.app.media.routes import
    media_bp`` 一路把 flask、flask_login、werkzeug 三个顶层包拉回进程（实测三个全中）。
  · ``backend.api.media.paths``（已搬好的那份，实现与下面**逐字相同**）：
    它所在的包 ``backend/api/media/__init__.py`` 里是 ``from .router import ...``，
    所以只为两个字符串函数 import 它，会连带把整个 media 路由器拉起来
    ——实测 +732 个模块（router → service → video_tasks → ffmpeg 那一串）。
    没有 flask 了，但这个代价同样不该由 event 的 import 期来付。

所以这里照抄那两行实现，语义逐字一致（DATA_PATH 同样是 str，不是 Path）。

TODO(收尾): 哪天 ``backend/api/media/__init__.py`` 改成惰性导出（PEP 562 的模块级
``__getattr__``，做法见 ``backend/app/__init__.py``），就把本文件删掉，
改成 ``from backend.api.media.paths import DATA_PATH, to_short_data_path``。
在那之前，这两份实现改一处就要改两处 —— 它们决定库里 ``file_path`` 存的形状。
"""

import os

from backend.core.paths import DATA_ROOT

# 注意是 str 不是 Path：调用方拿它去 os.path.join 和字符串 replace。
DATA_PATH = str(DATA_ROOT)


def to_short_data_path(full_path):
    """绝对路径 → 去掉 DATA_ROOT 前缀的短路径（库里 file_path 存的就是这种）。

    只替换**第一处**且必须带路径分隔符 —— 不在 DATA_ROOT 下的路径原样返回，
    这也是原实现的行为（不校验、不抛错）。
    """
    return full_path.replace(DATA_PATH + os.sep, "", 1)
