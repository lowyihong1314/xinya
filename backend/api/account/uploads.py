"""multipart 表单的 Flask 垫片 —— 只给本模块的三条上传路由用。

**搬迁时新增的文件，Flask 那边没有对应物。** 存在的唯一理由：
service.py 里三个函数的参数长得就是 Flask 的 ``request.form`` / ``request.files``：

    create_claim_from_form(form, files, user)   form.get(...) / files.getlist("files")
    add_claim_attachments(request_id, files, user)              files.getlist("files")
    read_bill_from_file(files.get("file"), form.get("model"), …)

而 ``_save_claim_attachment`` 又在用 werkzeug ``FileStorage`` 的四个成员
（``.filename`` / ``.mimetype`` / ``.read()`` / ``.save(path)``）。把这些调用点
一个个改成 starlette 的写法，等于在 1800 行业务代码里散布几十处框架细节；
在这里补一层薄垫片，service.py 就能**逐字照搬**，日后跟旧文件对拍也容易。

── 四个必须自己动手的细节（不处理就和 Flask 有出入）────────────────

① **文件部分不能出现在 form 里。** Flask 把文件放 request.files、文本放
   request.form，两者不相交；starlette 的 FormData 把它们混在同一个多值映射里。

② **同名字段取第一个。** werkzeug ``MultiDict.get`` 取**第一个**，
   starlette ``ImmutableMultiDict.get`` 取**最后一个**。前端不会发重名字段，
   但差异是真的，照 werkzeug 来。

③ **``mimetype`` 要是小写、去掉参数、缺失时是空串**（不是 None）。
   werkzeug 的实现是 ``parse_options_header(content_type)[0].lower()``。
   这个值会被直接写进 ``ReimbursementAttachment.mime_type`` 列，
   也会被 ``_guess_extension`` 拿去猜扩展名 —— 给 None 会让落盘的文件名变样。

④ **``save()`` 从流的当前位置开始拷**，werkzeug 也是这样（它不 seek(0)）。
   本模块的调用顺序里文件都还没被读过，所以位置就是 0；这里显式回 0 更稳，
   免得以后有人在保存前先 ``.read()`` 了一次、落盘变成 0 字节。

── 为什么依赖写成 async，路由仍是 sync ─────────────────────────────
``await request.form()`` 必须在事件循环里跑。写成 async 依赖（FastAPI 在循环里
执行它），路由本体保持 ``def`` 被丢进线程池 —— 这样底下那堆同步 DB / OCR 调用
不会把 worker 的循环焊死。generator 依赖的 ``finally`` 在响应生成之后才跑，
正好用来关表单（不关的话 spooled 临时文件要等 GC 才释放）。
"""

import shutil

from starlette.datastructures import UploadFile
from starlette.requests import Request


class UploadedFile:
    """werkzeug ``FileStorage`` 的最小替身：只包含本模块真正用到的四个成员。"""

    __slots__ = ("_upload",)

    def __init__(self, upload):
        self._upload = upload

    @property
    def filename(self):
        # werkzeug 在「选了文件框但没选文件」时给的是空串（浏览器发 filename=""），
        # starlette 同样给空串。调用方普遍写 ``if not (f and f.filename)``，
        # 所以这里必须原样透出空串，不要 ``or None``。
        return self._upload.filename

    @property
    def mimetype(self):
        """等价 ``FileStorage.mimetype``：去掉 ``; charset=…`` 参数并小写，缺失为 ""。"""
        raw = self._upload.content_type or ""
        return raw.split(";")[0].strip().lower()

    def read(self):
        """同步读全部字节 —— 对应 ``FileStorage.read()``。

        不能写 ``await upload.read()``：调用点（read_bill_from_file）是同步函数，
        底层 SpooledTemporaryFile 本来就是同步对象，直接读它即可。
        """
        return self._upload.file.read()

    def save(self, dst):
        """等价 ``FileStorage.save(path)``。dst 可以是 str 或 Path。"""
        source = self._upload.file
        try:
            source.seek(0)
        except (OSError, ValueError):
            # spooled 文件在某些状态下不支持 seek；忽略，照 werkzeug 的「从当前位置拷」走。
            pass
        with open(dst, "wb") as target:
            shutil.copyfileobj(source, target)


class FormFiles:
    """``request.files`` 的替身：只有 ``get`` 和 ``getlist`` 两个方法。"""

    __slots__ = ("_items",)

    def __init__(self, items):
        # items: [(field_name, UploadedFile), ...]，保持 multipart 里的原始顺序
        self._items = items

    def get(self, name, default=None):
        for key, value in self._items:
            if key == name:
                return value
        return default

    def getlist(self, name):
        return [value for key, value in self._items if key == name]


def _split_form(form):
    """starlette FormData → (纯文本字段 dict, FormFiles)。细节见模块 docstring ①②。"""
    fields = {}
    files = []
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            files.append((key, UploadedFile(value)))
        elif key not in fields:
            fields[key] = value
    return fields, FormFiles(files)


async def multipart_form(request: Request):
    """FastAPI 依赖：把 multipart 请求拆成 ``(form, files)``。

    ★ 不用 ``= Form(...)`` / ``= File(...)`` 参数声明，是为了守住**非 multipart
      请求**这条分支：Flask 那边 ``request.form`` / ``request.files`` 对一个
      JSON body 就是两个空映射，于是请求会一路走到业务校验（「缺少必要字段」/
      「请先选择图片或 PDF 附件」，都是 400）。一旦声明了 Form 参数，FastAPI 会
      在进路由之前判 422，那些 400 分支就没了 —— 前端在按文案弹提示。
    """
    content_type = request.headers.get("content-type") or ""
    if "multipart/form-data" not in content_type:
        yield {}, FormFiles([])
        return

    try:
        form = await request.form()
    except Exception:  # noqa: BLE001
        # 畸形 multipart：werkzeug 默认是**静默**给一个空表单（不抛），照着来 ——
        # 往下走会自然落到业务层的 400。不照办的话 starlette 的 MultiPartException
        # 会冒成 500。
        yield {}, FormFiles([])
        return

    try:
        yield _split_form(form)
    finally:
        await form.close()
