"""活动附件落盘路径的两个助手。

原 ``backend/app/event/services.py`` 顶部是
``from backend.app.media.paths import DATA_PATH, to_short_data_path``。
**这一行不能照搬**：``import backend.app.media.paths`` 会先执行
``backend/app/media/__init__.py``，而它第一行是
``from backend.app.media.routes import media_bp`` —— 一路把 flask、flask_login、
werkzeug 三个顶层包拉回进程（实测三个全中）。media 模块还没搬，
所以这里照抄那两行实现，语义逐字一致（DATA_PATH 同样是 str，不是 Path）。

TODO(收尾): media 搬进 backend/api/ 之后删掉本文件，改回 import 那边的同名符号。
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
