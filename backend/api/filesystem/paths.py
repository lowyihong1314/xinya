"""文件管理器的两个存储根（原 backend/app/filesystem/paths.py，一字未改）。

``STORAGE_ROOT`` 是「逻辑路径 → 磁盘路径」的唯一映射基准：库里 files.path 存的是
``/部门/2026/报销.pdf`` 这种逻辑路径，落盘位置就是 ``STORAGE_ROOT`` 拼上去。
``TRASH_ROOT`` 下面是**按 trash 表主键命名的一个个条目**（``storage_trash/137``），
不是原目录结构 —— 所以回收站里同名文件不会互相覆盖，恢复时靠 FileTrash.path 还原。

★ 这两个常量的值改掉 = 线上所有已上传文件立刻「消失」（库里有行、盘上找不到）。
  DATA_ROOT 本身由环境变量 XINYA_DATA_ROOT 决定，见 backend/core/paths.py。
"""

from pathlib import Path

from backend.core.paths import DATA_ROOT

STORAGE_ROOT = DATA_ROOT / "storage"
TRASH_ROOT = DATA_ROOT / "storage_trash"
