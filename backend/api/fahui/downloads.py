"""``flask.send_file`` 的 FastAPI 替身 —— 本包 15 处文件下载共用。

**搬迁时新增的文件，Flask 那边没有对应物。** 存在的理由：法会这块有大量
「返回一个 PDF / PNG / APK / 字体」的出口，散落在 6 个文件里，每一处都带着
不同的 ``mimetype`` / ``as_attachment`` / ``download_name`` / ``max_age`` 组合。
逐处手写 ``Response(..., headers={"Content-Disposition": ...})`` 的话，
迟早有人少写一个头，而少写的症状是「下载下来的文件名变成一串乱码」或者
「牌位预览图每次都重新渲染，打印页卡住」——都属于事后很难定位的那种。

所以这里照着 **werkzeug 3.1 的 ``send_file``** 复刻一份同名函数，参数名和语义
逐个对齐。这样调用点的那一行 ``return send_file(buffer, mimetype=..., ...)``
**一个字都不用改**，只把 import 换个来源。**不 import werkzeug。**

── 逐条对齐了什么（都是实测对拍出来的）────────────────────────────

① **Content-Disposition。** 纯 ASCII 文件名 → ``attachment; filename=x.pdf``
   （werkzeug 只在文件名不是合法 token 时才加引号，例如含空格）。
   **非 ASCII 文件名**（本包真的有：``牌位清单_2024_YLP.pdf``）→
       ``attachment; filename=_2024_YLP.pdf; filename*=UTF-8''%E7%89%8C...``
   前半截是 NFKD + ``encode("ascii","ignore")`` 之后的残骸（中文会被整段丢掉），
   后半截才是浏览器真正用的那个。少了 ``filename*`` 那一段，Chrome 存下来的
   文件名就是 ``_2024_YLP.pdf``。
   ⚠️ 这也是为什么**不能**直接用 starlette ``FileResponse`` 的 ``filename=``
      参数：它走的是 ``filename*=utf-8''…``（小写、且不带 ASCII 兜底），
      和 werkzeug 不是同一串字节。

② **Cache-Control / Expires。**
       max_age is None → ``no-cache``
       max_age  >  0   → ``public, max-age=N`` + ``Expires``
       max_age == 0    → ``no-cache, max-age=0`` + ``Expires``（注意**没有** public）
   最后那条不是笔误，是 werkzeug 的真实分支（``if max_age > 0`` 才清掉 no-cache），
   而本包恰好有一处在用它：牌位预览图的 ``refresh=1`` 强制重渲。

③ **ETag 算法照抄** ``f'"{mtime}-{size}-{adler32(路径字符串)}"'``。
   算法一致 = 浏览器里已经缓存的牌位预览图在切到 FastAPI 之后仍然命中 304；
   换成 starlette 自己的 md5 格式的话，上线当天所有预览图会被重新渲一遍
   （那是几百次 PyMuPDF 渲染，打印页会当场卡住）。做法同 api/media/router.py。

④ **``conditional=True`` 才做 304。** werkzeug 只在传了这个参数时才
   ``make_conditional``；没传的那些出口即使带着 ETag 也照样回 200。照搬 ——
   把所有出口都改成会 304 是"顺手优化"，会改变现网的请求量分布。

── 三处**故意留下**的细微差别（都与前端无关，实测过）──────────────
  · ``Accept-Ranges``：werkzeug 只在 conditional 时才回，starlette 的 FileResponse
    总是带。多一句"我支持断点续传"的声明，没有副作用。
  · 文件对象（BytesIO）走 ``Response(buf.getvalue())``，是**整块读**而不是
    werkzeug 的"从当前游标流式发 + Content-Length 填满长度"。本包所有调用点
    在 send_file 之前都 ``seek(0)`` 过，两者字节相同；真有人忘了 seek，
    这边发的是完整文件，werkzeug 那边会发一个和 Content-Length 对不上的截断响应
    —— 也就是说这里只会更对，不会更错。
  · Range 请求：werkzeug 在非 conditional 时不处理，starlette 的 FileResponse
    会回 206。同样只影响大文件续传，没有调用方在发 Range。
"""

import mimetypes
import os
import unicodedata
import zlib
from email.utils import formatdate
from time import time
from urllib.parse import quote

from starlette.responses import FileResponse, Response

__all__ = ["send_file", "content_disposition"]


def content_disposition(disposition: str, download_name: str) -> str:
    """照抄 werkzeug ``send_file`` 里拼 Content-Disposition 的那一段（见模块头 ①）。"""
    try:
        download_name.encode("ascii")
    except UnicodeEncodeError:
        simple = unicodedata.normalize("NFKD", download_name)
        simple = simple.encode("ascii", "ignore").decode("ascii")
        # safe = RFC 5987 的 attr-char 集合，一个字符都不能加减
        quoted = quote(download_name, safe="!#$&+-.^_`|~")
        names = {"filename": simple, "filename*": f"UTF-8''{quoted}"}
    else:
        names = {"filename": download_name}

    parts = [disposition]
    for key, value in names.items():
        parts.append(f"{key}={_quote_header_value(value)}")
    return "; ".join(parts)


# werkzeug ``quote_header_value``：是合法 token 就裸着发，否则加双引号并转义。
# 不能无脑加引号 —— 那样 ``filename=app-1.0.apk`` 会变成 ``filename="app-1.0.apk"``，
# 虽然两种都合法，但我们的目标是**逐字节相同**，好在切换当天用 diff 对拍。
_TOKEN_CHARS = frozenset(
    "!#$%&'*+-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ^_`abcdefghijklmnopqrstuvwxyz|~"
)


def _quote_header_value(value: str) -> str:
    if value and all(char in _TOKEN_CHARS for char in value):
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _cache_headers(max_age):
    """见模块头 ②。max_age 为 None 时只有 no-cache，没有 Expires。"""
    if max_age is None:
        return {"Cache-Control": "no-cache"}
    if max_age > 0:
        control = f"public, max-age={max_age}"
    else:
        # ★ max_age == 0 时 werkzeug **不清掉** no-cache 也**不加** public，
        #   于是两个指令并存。牌位预览图的 refresh=1 走的就是这条。
        control = f"no-cache, max-age={max_age}"
    return {
        "Cache-Control": control,
        "Expires": formatdate(int(time()) + max_age, usegmt=True),
    }


def _is_not_modified(request, etag, last_modified) -> bool:
    """werkzeug ``make_conditional`` 的 304 判断（只实现本包用得到的两个头）。"""
    if request is None:
        return False
    if_none_match = request.headers.get("if-none-match")
    if if_none_match:
        # ``*`` 或者列表里有我们这个 etag 就算命中。W/ 前缀按弱比较去掉。
        candidates = [item.strip() for item in if_none_match.split(",")]
        for candidate in candidates:
            if candidate == "*":
                return True
            if candidate.startswith("W/"):
                candidate = candidate[2:]
            if candidate == etag:
                return True
        # 带了 If-None-Match 但对不上：按 RFC，If-Modified-Since 不再参与判断。
        return False
    if_modified_since = request.headers.get("if-modified-since")
    if if_modified_since:
        from email.utils import parsedate_to_datetime

        try:
            since = parsedate_to_datetime(if_modified_since).timestamp()
        except (TypeError, ValueError):
            return False
        # werkzeug 比的是整秒（Last-Modified 头本来就只有秒精度）
        return int(last_modified) <= int(since)
    return False


def send_file(
    path_or_file,
    mimetype=None,
    as_attachment=False,
    download_name=None,
    max_age=None,
    conditional=False,
    request=None,
):
    """等价 ``flask.send_file``（本包用到的那几个参数）。

    ``path_or_file`` 既可以是磁盘路径（str / Path），也可以是 BytesIO。
    ``request`` 是**新增**的可选参数：只有 ``conditional=True`` 时才需要它来判 304，
    不传就永远回 200（等价于 ``conditional=False``）。
    """
    path = None
    file_obj = None
    size = None
    mtime = None

    if isinstance(path_or_file, (str, os.PathLike)) or hasattr(path_or_file, "__fspath__"):
        path = os.path.abspath(os.fspath(path_or_file))
        stat_result = os.stat(path)
        size = stat_result.st_size
        mtime = stat_result.st_mtime
    else:
        file_obj = path_or_file

    if download_name is None and path is not None:
        download_name = os.path.basename(path)

    headers = {}

    if mimetype is None:
        if download_name is None:
            # werkzeug 在这里抛 TypeError；本包没有这种调用点，照抄以免静默走歪。
            raise TypeError(
                "Unable to detect the MIME type because a file name is"
                " not available. Either set 'download_name', pass a"
                " path instead of a file, or set 'mimetype'."
            )
        mimetype, encoding = mimetypes.guess_type(download_name)
        if mimetype is None:
            mimetype = "application/octet-stream"
        # 附件不带 Content-Encoding：带了会让浏览器把 tar.gz 自动解压再存。
        if encoding is not None and not as_attachment:
            headers["Content-Encoding"] = encoding

    if download_name is not None:
        headers["Content-Disposition"] = content_disposition(
            "attachment" if as_attachment else "inline", download_name
        )
    elif as_attachment:
        raise TypeError(
            "No name provided for attachment. Either set"
            " 'download_name' or pass a path instead of a file."
        )

    headers.update(_cache_headers(max_age))

    if path is None:
        # 内存里的文件（BytesIO）：没有 mtime / 路径，也就没有 ETag 和 Last-Modified
        # —— werkzeug 在这种情况下同样一个都不发（见模块头第三条差异说明）。
        return Response(content=file_obj.getvalue(), media_type=mimetype, headers=headers)

    etag = f'"{mtime}-{size}-{zlib.adler32(path.encode()) & 0xFFFFFFFF}"'
    headers["ETag"] = etag
    headers["Last-Modified"] = formatdate(mtime, usegmt=True)

    if conditional and _is_not_modified(request, etag, mtime):
        # 304 不能带正文，所以走 Response 而不是 FileResponse。
        return Response(status_code=304, headers={**headers, "Accept-Ranges": "bytes"})

    return FileResponse(path, media_type=mimetype, headers=headers)
