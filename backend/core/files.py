"""文件名处理。

只为一个函数：``secure_filename``。原来从 ``werkzeug.utils`` 引入，而 werkzeug 是
Flask 栈的东西 —— 为一个纯字符串函数把整包（实测 32 个模块）拖进已经不用 Flask
的进程不划算。这里照抄 werkzeug 3.x 的实现，逐字节对拍过。

★ 它决定**上传文件的落盘名**，行为不能有一丝偏差：改了之后新旧文件名对不上，
  表现是「以前传的文件点开 404」。特别注意两个反直觉的既有行为，都要保留：
    · 中文文件名会被整个清空（NFKD 规范化后 encode("ascii","ignore") 把非 ASCII
      全丢掉），``"报销单.pdf"`` → ``".pdf"`` → strip("._") → ``"pdf"``。
      调用方普遍在结果为空时自己兜底，别在这里"顺手修"。
    · Windows 设备名（CON/PRN/AUX/NUL/COM0-9/LPT0-9）只在 os.name == "nt" 时加下划线
      前缀，Linux 上不加 —— 我们跑在 Linux，所以那一支实际不会走到。
"""

import os
import posixpath
import re
import unicodedata

_filename_ascii_strip_re = re.compile(r"[^A-Za-z0-9_.-]")
_windows_device_files = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(10)),
    *(f"LPT{i}" for i in range(10)),
}


def secure_filename(filename: str) -> str:
    """把用户提供的文件名变成可安全落盘的名字（照抄 werkzeug.utils.secure_filename）。"""
    filename = unicodedata.normalize("NFKD", filename)
    filename = filename.encode("ascii", "ignore").decode("ascii")

    for sep in os.sep, os.path.altsep, posixpath.sep:
        if sep:
            filename = filename.replace(sep, " ")

    filename = _filename_ascii_strip_re.sub("", "_".join(filename.split())).strip("._")

    # Windows 保留设备名：加前缀免得写出去变成往设备写。Linux 上 os.name 是 "posix"，不走。
    if os.name == "nt" and filename and filename.split(".")[0].upper() in _windows_device_files:
        filename = f"_{filename}"

    return filename
