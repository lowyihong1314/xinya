"""``request.form`` / ``request.files`` 在 FastAPI 侧的垫片 —— 给本模块 5 条上传路由用。

**搬迁时新增的文件，Flask 那边没有对应物。** service.py / pdf.py 里那几个函数的
入参长得就是 Flask 的两个属性：

    create_payment(form_id, data, proof_image)          data.get("nric") / proof_image.save(…)
    replace_payment_proof_image(payment_id, proof_image) proof_image.filename
    upload_fee_image(file_storage)                       file_storage.save(…)
    submit_youth_class_payment(token, data, proof_image)
    html_to_pdf(files, filename)                         files 是 getlist("files")，逐个 .read()

把这几样包出来，service.py 的函数体就能**逐字照搬**，日后跟旧文件对拍也容易。

⚠️ 和 ``backend/api/account/uploads.py`` / ``backend/api/event/uploads.py`` 是三份
   实现几乎相同的代码。**故意不互相 import**：那两个包的 ``__init__.py`` 都是
   ``from .router import router``，为一个 80 行的垫片 import 它们会把对方整个路由器
   （连同 service、ffmpeg、reportlab 那一串）拉进本模块的 import 期。
   event/storage.py 的模块头记的是同一件事。
   TODO(收尾): 三处合并成 ``backend/core/uploads.py``。合并前改一处要改三处 ——
   它们决定上传文件的落盘名与 mime 记录，漂了的表现是「以前传的文件点开 404」。

── 五个必须自己动手的细节（不处理就和 Flask 有出入）────────────────

  ① **文件部分不能出现在 form 里。** Flask 把文件放 request.files、文本放
     request.form，两者不相交；starlette 的 FormData 把它们混在同一个多值映射里。
     不拆的话 ``data.get("nric")`` 有可能拿到一个 UploadFile。

  ② **同名字段取第一个。** werkzeug ``MultiDict.get`` 取**第一个**，
     starlette ``ImmutableMultiDict.get`` 取**最后一个**。前端不会发重名字段，
     但差异是真的，照 werkzeug 来。

  ③ **``FileStorage.__bool__`` 就是 ``bool(self.filename)``。**
     浏览器在「文件框没选文件」时仍会发一个 filename 为空的 part，Flask 那边
     ``request.files.get("proof_image")`` 拿到的是一个**假值**对象，于是
     ``_save_register_payment_proof`` 里 ``if not file_storage or not …filename``
     命中 → 400「请上传付款截图」。不复刻这条，空文件会一路走到
     ``os.path.splitext("")`` 再落盘，400 变成一个乱七八糟的 500。

  ④ **``mimetype`` 只取主值、小写、缺失时是空串**（不是 None）。
     本模块今天没人读它（form 不往库里写 mime），但垫片要长得像 FileStorage，
     少一个成员的代价是将来某次照搬代码时莫名 AttributeError。

  ⑤ **``save()`` 要能接受 ``Path``**：``_save_register_payment_proof`` 传的是
     ``REGISTER_PAYMENT_PROOF_DIR / filename``（pathlib.Path），不是 str。

── 为什么不用 ``= Form(...)`` / ``= File(...)`` 参数声明 ───────────────
Flask 那边 ``request.form`` / ``request.files`` 对一个 JSON body 就是两个**空映射**，
于是请求会一路走到业务校验（「缺少 nric」/「请上传付款截图」，都是 400）。
一旦声明了 Form/File 参数，FastAPI 会在进路由之前判 **422**，那些 400 分支就没了 ——
前端在按这些文案弹提示。所以统一走下面这个 async 依赖，行为与 Flask 对齐。

── 为什么依赖写成 async，路由仍是 sync ─────────────────────────────
``await request.form()`` 必须在事件循环里跑。写成 async 依赖（FastAPI 在循环里执行它），
路由本体保持 ``def`` 被丢进线程池 —— 底下那堆同步 DB / 文件 IO / weasyprint
不会把 worker 的循环焊死。generator 依赖的 ``finally`` 在响应生成之后才跑，
正好用来关表单（不关的话 spooled 临时文件要等 GC 才释放）。
"""

import shutil

from starlette.datastructures import UploadFile
from starlette.requests import Request


class UploadedFile:
    """werkzeug ``FileStorage`` 的最小替身。"""

    __slots__ = ("_upload",)

    def __init__(self, upload):
        self._upload = upload

    @property
    def filename(self):
        # starlette 在 part 没带 filename 时给 None，werkzeug 给 ""。
        # 调用方写的是 ``getattr(file_storage, "filename", "")`` 再 ``or ""``，
        # 两者等价；这里统一成 "" 免得 os.path.splitext(None) 炸。
        return self._upload.filename or ""

    @property
    def mimetype(self):
        """等价 ``FileStorage.mimetype``：去掉 ``; charset=…`` 参数并小写，缺失为 ""（见模块头 ④）。"""
        raw = self._upload.content_type or ""
        return raw.split(";")[0].strip().lower()

    def __bool__(self):
        """见模块头 ③。"""
        return bool(self.filename)

    def read(self):
        """同步读全部字节 —— 对应 ``FileStorage.read()``。

        不能写 ``await upload.read()``：调用点（pdf.merge_html_files_to_pdf）是同步
        函数，底层 SpooledTemporaryFile 本来就是同步对象，直接读它即可。
        """
        return self._upload.file.read()

    def save(self, dst):
        """等价 ``FileStorage.save(dst)``；dst 可以是 str 或 Path（见模块头 ⑤）。

        werkzeug 是从**当前游标**开始 copy 的；这里显式 seek(0) 再拷 ——
        本进程里这个 UploadFile 只有我们一个消费者，回到 0 更稳。
        """
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
    """starlette FormData → (纯文本字段 dict, FormFiles)。细节见模块头 ①②。"""
    fields = {}
    files = []
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            files.append((key, UploadedFile(value)))
        elif key not in fields:
            fields[key] = value
    return fields, FormFiles(files)


# 非文件字段的单条上限。starlette 默认 1 MB，而 werkzeug/Flask **没有**这个概念
# （那边只有 max_content_length，真正拦大请求的是 nginx 的 client_max_body_size）。
# 本模块用 multipart 的是付款截图与 html_to_pdf —— 后者的文本字段只有一个 filename，
# 但同一个依赖将来可能被别的路由借走，所以统一放宽到 16 MB。
# ⚠️ 文件部分不受这个值影响（starlette 只对没有 filename 的部分计数）。
_MAX_PART_SIZE = 16 * 1024 * 1024


async def form_and_files(request: Request):
    """FastAPI 依赖：把请求体拆成 ``(fields, files)``，对齐 Flask 的两个属性。"""
    try:
        form = await request.form(max_part_size=_MAX_PART_SIZE)
    except Exception:  # noqa: BLE001
        # 畸形 multipart：werkzeug 默认是**静默**给一个空表单（不抛），照着来 ——
        # 往下走会自然落到业务层的 400。不照办的话 starlette 会把它变成一个
        # detail 是英文的 HTTPException(400)，和本模块的中文错误信封对不上。
        yield {}, FormFiles([])
        return

    try:
        yield _split_form(form)
    finally:
        await form.close()
