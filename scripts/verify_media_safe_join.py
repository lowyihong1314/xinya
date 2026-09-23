#!/usr/bin/env python3
"""对拍 backend/api/media/paths.py 的 safe_join 与 werkzeug 的实现。

为什么值得单独一个脚本：``/media_file/<path>`` 这条路由**不带鉴权**，path 直接
来自 URL，safe_join 是它唯一的目录穿越护栏。搬迁时它从 werkzeug 换成了自己写的
一份（进程里不能再有 werkzeug），所以必须证明两件事：

  ① 所有会逃出基目录的输入都被挡成 None；
  ② 合法输入的返回值与 werkzeug **逐字符一致**（值不一样 = 线上文件路径变了）。

用法：./venv/bin/python scripts/verify_media_safe_join.py
werkzeug 卸载之后 ② 会自动跳过，① 仍然会跑。
"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.api.media.paths import safe_join

BASE = "/srv/flaskapp/xinya/database"

# 必须被挡住（返回 None）的输入。每一条都对应一种真实的穿越写法。
MUST_BLOCK = [
    "../etc/passwd",
    "../../etc/passwd",
    "../",
    "..",
    "a/../../etc/passwd",          # normpath 折叠后变成 ../etc/passwd
    "a/b/../../../etc/passwd",
    "./../x",
    "/etc/passwd",                 # 绝对路径
    "//etc/passwd",                # normpath 之后仍以 / 开头
    "/",
    "NAS/../../../../root/.ssh/id_rsa",
]

# 必须**通过**的输入（正常业务路径）。值本身也要与 werkzeug 一致。
MUST_PASS = [
    "NAS/UTBA/event_photo/EV001/DSC_0001.JPG",
    "CACHE/UTBA/event_photo/EV001/DSC_0001.jpeg",
    "MP4/UTBA/event_photo/EV001/DSC_0001_web.mp4",
    "a/./b.jpg",                   # normpath 折叠成 a/b.jpg
    "a//b.jpg",
    "a/b/../c.jpg",                # 折叠成 a/c.jpg，没出基目录
    "....//x.jpg",                 # 看着像穿越，其实是名为 "...." 的目录
    "%2e%2e/x.jpg",                # URL 编码的 ..；解码由 ASGI 层做，到这里就是普通目录名
    "",                            # 空片段：直接跳过，结果就是基目录本身
    "中文目录/照片.jpg",
]


def main() -> int:
    failures = []

    for case in MUST_BLOCK:
        result = safe_join(BASE, case)
        if result is not None:
            failures.append(f"[穿越未拦住] {case!r} → {result!r}")

    for case in MUST_PASS:
        result = safe_join(BASE, case)
        if result is None:
            failures.append(f"[误杀合法路径] {case!r} → None")
        elif not (result == BASE or result.startswith(BASE + "/")):
            failures.append(f"[结果跑出基目录] {case!r} → {result!r}")

    try:
        from werkzeug.utils import safe_join as werkzeug_safe_join
    except ImportError:
        print("· werkzeug 未安装，跳过逐字符对拍（只跑了拦截用例）")
    else:
        for case in MUST_BLOCK + MUST_PASS:
            mine = safe_join(BASE, case)
            theirs = werkzeug_safe_join(BASE, case)
            if mine != theirs:
                failures.append(f"[与 werkzeug 不一致] {case!r} 我们={mine!r} werkzeug={theirs!r}")
        # 多段拼接（media 只用单段，但语义要一致）
        for parts in [("NAS", "UTBA", "x.jpg"), ("NAS", "..", "x.jpg"), ("", "a.jpg")]:
            mine = safe_join(BASE, *parts)
            theirs = werkzeug_safe_join(BASE, *parts)
            if mine != theirs:
                failures.append(f"[与 werkzeug 不一致] {parts!r} 我们={mine!r} werkzeug={theirs!r}")
        # 空基目录：werkzeug 会退化成 "."，别让第一个不可信片段变成可信基目录
        if safe_join("", "a.jpg") != werkzeug_safe_join("", "a.jpg"):
            failures.append("[与 werkzeug 不一致] 空基目录")
        print("· 与 werkzeug 逐字符对拍通过")

    if failures:
        print("\n".join(failures))
        print(f"\n❌ {len(failures)} 条不通过")
        return 1

    print(f"✅ safe_join 校验通过（拦截 {len(MUST_BLOCK)} 条 / 放行 {len(MUST_PASS)} 条）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
