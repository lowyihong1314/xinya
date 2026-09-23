"""media 的磁盘路径助手（原 backend/app/media/paths.py）。

DATA_PATH / STATIC_PATH 等一字未改，只多了一个 ``safe_join`` ——
原来从 ``werkzeug.utils`` 引入，现在自己实现（进程里不能再有 werkzeug）。

目录结构（全部在 DATA_ROOT 下，nginx 的 ``location /media_file/`` 就 alias 到这里）：

    NAS/UTBA/event_photo/<event_code>/<file>        原始上传文件
    CACHE/UTBA/event_photo/<event_code>/<stem>.jpeg 缩略/预览用的 JPEG 缓存
    CACHE/UTBA/event_photo/<event_code>/<stem>.mp4  15 秒预览转码
    MP4/UTBA/event_photo/<event_code>/<stem>_web.mp4 完整转码
"""

import os
import posixpath

from backend.core.paths import DATA_ROOT, STATIC_ROOT

DATA_PATH = str(DATA_ROOT)
STATIC_PATH = str(STATIC_ROOT)
BROKEN_IMAGE_PATH = os.path.join(STATIC_PATH, "images", "file_icon", "broken-image.png")

# werkzeug 里的 _os_alt_seps：除 "/" 之外的系统路径分隔符（Windows 的 "\"）。
# Linux 上 os.sep == "/"、os.path.altsep is None，所以这个列表恒为空 —— 照抄是为了
# 这份实现换个平台也不比 werkzeug 弱，不是为了在这里生效。
_OS_ALT_SEPS = [sep for sep in (os.sep, os.path.altsep) if sep is not None and sep != "/"]


def safe_join(directory, *untrusted):
    """把不可信的路径片段安全地拼到基目录下；逃出基目录就返回 None。

    ★★★ 这是 ``/media_file/<path>`` 的**唯一**目录穿越护栏 ★★★
    这条路由不带鉴权、path 直接来自 URL，写错就是「任意文件读取」——
    ``/media_file/../../../etc/passwd`` 会把系统文件发出去。改它之前先跑
    ``./venv/bin/python scripts/verify_media_safe_join.py``（与 werkzeug 逐条对拍）。

    照抄 werkzeug 3.1.6 ``werkzeug.utils.safe_join`` 的语义，逐条对齐：

      · 基目录为空 → 当成 "."，否则第一个不可信片段会变成"可信基目录"。
      · 空片段直接跳过（不是 join 一个空串）—— 3.1 改过这个行为，
        决定了 ``safe_join(base, "")`` 的结果是 ``base`` 而不是 ``base/``。
      · 先 ``posixpath.normpath`` 再判断：这样 ``a/../../b`` 会先折叠成 ``../b``，
        被下面的 ``startswith("../")`` 抓住。**顺序反过来就等于没防护。**
      · 绝对路径、``..``、``../`` 开头、含 Windows 分隔符 → 一律 None。

    唯一**没有**复制的是 werkzeug 3.1.4+ 的 Windows 设备名检查
    （CON / PRN / NUL…），它包在 ``os.name == "nt"`` 里，我们跑 Linux 永远不走。
    真要上 Windows，那张表在 backend/core/files.py 里已经有一份现成的。

    注意它只做**字符串**层面的防护，不解析符号链接：DATA_ROOT 下如果有指向外部的
    软链，照样能顺着读出去。这也是原行为，不在本次迁移范围内。
    """
    if not directory:
        # 保证 directory="" 时得到 "./path" 而不是让第一个不可信片段变成基目录。
        directory = "."

    parts = [directory]

    for part in untrusted:
        if not part:
            continue

        part = posixpath.normpath(part)

        if (
            os.path.isabs(part)
            # ntpath.isabs 抓不到这条，单独补
            or part.startswith("/")
            or part == ".."
            or part.startswith("../")
            or any(sep in part for sep in _OS_ALT_SEPS)
        ):
            return None

        parts.append(part)

    return posixpath.join(*parts)


def abs_data_path(*parts):
    return os.path.join(DATA_PATH, *parts)


def event_photo_base_dir(event_code):
    return abs_data_path("NAS", "UTBA", "event_photo", event_code)


def event_photo_cache_dir(event_code):
    return abs_data_path("CACHE", "UTBA", "event_photo", event_code)


def event_photo_mp4_dir(event_code):
    return abs_data_path("MP4", "UTBA", "event_photo", event_code)


def to_short_data_path(full_path):
    # 把绝对路径还原成 DATA_ROOT 下的相对路径 —— 前端把它拼到 /media_file/ 后面。
    # 只替换**第一个** DATA_PATH + 分隔符，路径里再出现同名目录不受影响。
    return full_path.replace(DATA_PATH + os.sep, "", 1)
