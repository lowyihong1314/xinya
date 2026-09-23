"""表单 / 上传文件的 Flask 垫片 —— **全仓公用**。

**搬迁时新增的文件，Flask 那边没有对应物。** 存在的理由：业务函数的参数长得就是
Flask 的 ``request.form`` / ``request.files``，


    payment_services.create_payment_record   payload.get("payment_mode") / payload.getlist("order_ids")
    payment_channel_services._apply_fields   form.get("bank_name") / files.get("qr_image")
    raw_docs.save_uploaded_raw_docs          uploaded.filename / uploaded.read()

而这些函数又在用 werkzeug ``FileStorage``
的四个成员（``.filename`` / ``.read()`` / ``.save(path)`` / 真值判断）。把这些调用点
一个个改成 starlette 的写法，等于在服务层里散布几十处框架细节；在这里补一层薄垫片，
service 那边就能**逐字照搬**，日后跟旧文件对拍也容易。

**不 import werkzeug**（那会把整个 Flask 栈请回进程）。下面几条行为是照抄的，
每一条在本包里都真的会被踩到：

  ① **``FileStorage.__bool__`` 就是 ``bool(self.filename)``。**
     浏览器在「没选文件」时仍会发一个 filename 为空的 part，Flask 那边
     ``request.files.get("file")`` 拿到的是一个**假值**对象，于是
     调用方的 ``if not uploaded_file: return 400 …`` 命中。
     不复刻这条，空文件会一路走到下一个分支，**错误文案就漂了**
     （fahui 会变成「Only PDF files are allowed」、form 会落盘一个空名文件）。

  ② **文件部分不能出现在 form 里。** Flask 把文件放 request.files、文本放
     request.form，两者不相交；starlette 的 FormData 把它们混在同一个多值映射里。

  ③ **同名字段取第一个。** werkzeug ``MultiDict.get`` 取**第一个**，
     starlette ``ImmutableMultiDict.get`` 取**最后一个**。前端不会发重名文本字段，
     但 ``order_ids`` / ``file_ids`` 这种就是靠 ``getlist`` 收多值的，顺序必须是原始顺序。

  ④ **``MultiDict`` 空时是假值。** payment_services 的
     ``payload = request.form if request.form else (request.get_json(...) or {})``
     整条分支全靠这个真值判断 —— 见 ``form_files_and_json``。

  ⑤ **``MultiDict.get(key, type=int)`` 转不动时静默回 default**（只吞
     ValueError / TypeError），不是抛。照 werkzeug 留着接口。

★ 本文件由 api/{form,account,event,fahui}/uploads.py 四份近乎相同的实现合并而来。
  合并时统一了一处**实质差异**：``filename`` 原来 account 版直接透出（可能是 None），
  其余三版 ``or ""``。核过 account 的全部调用点都是 ``if not (f and f.filename)``，
  两者等价，所以统一成 ``or ""`` —— 免得 ``os.path.splitext(None)`` 炸。

── 为什么依赖写成 async，路由仍是 sync ─────────────────────────────
``await request.form()`` 必须在事件循环里跑。写成 async 依赖（FastAPI 在循环里
执行它），路由本体保持 ``def`` 被丢进线程池 —— 这样底下那堆同步 DB / 落盘调用
不会把 worker 的循环焊死。generator 依赖的 ``finally`` 在响应生成之后才跑，
正好用来关表单（不关的话 spooled 临时文件要等 GC 才释放）。

── 为什么不用 ``= File(...)`` / ``= Form(...)`` 声明参数 ──────────────
那样 FastAPI 会在进路由之前判 422，而 Flask 对一个非表单请求是给两个**空映射**、
让请求一路走到业务校验（「缺少 payment_mode」/「没有收到文件」，都是 400）。
前端在按这些中文文案分支，422 会让提示变成空白。
"""

import json
import shutil

from starlette.datastructures import UploadFile
from starlette.requests import Request


class UploadedFile:
    """包一层 starlette 的 ``UploadFile``，对外长得像 werkzeug 的 ``FileStorage``。"""

    __slots__ = ("_upload",)

    def __init__(self, upload):
        self._upload = upload

    @property
    def filename(self):
        # starlette 在 part 没带 filename 时给 None，werkzeug 给 ""。
        # 调用方有 ``Path(str(getattr(uploaded, "filename", "") or "")).name`` 这种写法，
        # 两者等价；这里仍统一成 "" 免得 os.path.splitext(None) 炸。
        return self._upload.filename or ""

    @property
    def mimetype(self):
        """等价 ``FileStorage.mimetype``：只取主值、去空白、小写，缺失时是 ""（不是 None）。"""
        raw = self._upload.content_type or ""
        return raw.split(";")[0].strip().lower()

    def __bool__(self):
        """见模块头 ①。"""
        return bool(self.filename)

    def read(self):
        """同步读全部字节 —— 对应 ``FileStorage.read()``。

        不能写 ``await upload.read()``：调用点（raw_docs.save_uploaded_raw_docs）
        是同步函数，底层 SpooledTemporaryFile 本来就是同步对象，直接读它即可。
        """
        return self._upload.file.read()

    def save(self, dst):
        """等价 ``FileStorage.save(dst)``：把整个上传流写到 dst（str 或 Path 都行）。

        werkzeug 是从**当前游标**开始 copy 的；这里显式 seek(0) 再拷 ——
        本进程里这个 UploadFile 只有我们一个消费者，回到 0 更稳
        （spooled 临时文件在少数情况下不支持 seek，忽略即可）。
        """
        source = self._upload.file
        try:
            source.seek(0)
        except (OSError, ValueError):
            pass
        with open(dst, "wb") as target:
            shutil.copyfileobj(source, target)


class FormValues:
    """``request.form`` 的替身：``get`` / ``getlist`` + 真值判断。行为见模块头 ③④⑤。"""

    __slots__ = ("_items",)

    def __init__(self, items):
        # items: [(field_name, value), ...]，保持 multipart / urlencoded 里的原始顺序
        self._items = list(items)

    def __bool__(self):
        return bool(self._items)

    def __len__(self):
        return len(self._items)

    def __contains__(self, name):
        return any(key == name for key, _ in self._items)

    def get(self, name, default=None, type=None):  # noqa: A002 - 名字要和 werkzeug 对齐
        for key, value in self._items:
            if key != name:
                continue
            if type is None:
                return value
            try:
                return type(value)
            except (ValueError, TypeError):
                # 见模块头 ⑤：转不动就当没传，不是抛。
                return default
        return default

    def getlist(self, name, type=None):  # noqa: A002
        values = []
        for key, value in self._items:
            if key != name:
                continue
            if type is None:
                values.append(value)
                continue
            try:
                values.append(type(value))
            except (ValueError, TypeError):
                continue
        return values


class FormFiles:
    """``request.files`` 的替身：只有 ``get`` / ``getlist`` 和真值判断。"""

    __slots__ = ("_items",)

    def __init__(self, items):
        self._items = list(items)

    def __bool__(self):
        return bool(self._items)

    def get(self, name, default=None):
        for key, value in self._items:
            if key == name:
                return value
        return default

    def getlist(self, name):
        return [value for key, value in self._items if key == name]


def _split_form(form):
    """starlette FormData → ``(FormValues, FormFiles)``。细节见模块头 ②③。"""
    fields = []
    files = []
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            files.append((key, UploadedFile(value)))
        else:
            fields.append((key, value))
    return FormValues(fields), FormFiles(files)


# 非文件字段的单条上限。starlette 默认 1 MB，而 werkzeug/Flask **没有**这个概念
# （那边只有 max_content_length，真正拦大请求的是 nginx 的 client_max_body_size）。
# 放宽到 16 MB：这是**新增**的限制（Flask 时代没有），但比默认值安全得多地远离业务量级。
# ⚠️ 文件部分不受这个值影响（starlette 只对没有 filename 的部分计数）。
_MAX_PART_SIZE = 16 * 1024 * 1024


async def _read_form(request: Request):
    try:
        return await request.form(max_part_size=_MAX_PART_SIZE)
    except Exception:  # noqa: BLE001
        # 畸形 multipart：werkzeug 默认是**静默**给一个空表单（不抛），照着来 ——
        # 往下走会自然落到业务层的 400。不照办的话 starlette 会把它变成一个
        # detail 是英文的 HTTPException(400)，和本包的中文错误信封对不上。
        return None


async def form_and_files(request: Request):
    """FastAPI 依赖：把请求体拆成 ``(form, files)``，对齐 Flask 的两个属性。"""
    form = await _read_form(request)
    if form is None:
        yield FormValues([]), FormFiles([])
        return
    try:
        yield _split_form(form)
    finally:
        await form.close()


async def form_files_and_json(request: Request):
    """FastAPI 依赖：``(form, files, json_payload)``。

    给 payment_services 那两条路由用，它们的第一句是

        payload = request.form if request.form else (request.get_json(silent=True) or {})

    所以三样都要：form 用来做**真值判断**并在非空时当 payload，json 是它的退路。

    ``request.form()`` 对非表单 content-type 会**不读 body** 直接返回空 FormData，
    所以之后还能把 body 当 JSON 解 —— 顺序反过来就不行了。
    """
    form = await _read_form(request)
    fields, files = (FormValues([]), FormFiles([])) if form is None else _split_form(form)

    payload = {}
    if not fields:
        # 等价 ``request.get_json(silent=True) or {}``：解不出来就当空字典，不抛。
        # 解出来不是对象（``[1,2]``）时 Flask 会在后面的 ``.get()`` 上抛 AttributeError → 500；
        # 这里统一收敛成空字典，效果与「缺参数」一致（落到 400「缺少 payment_mode」）。
        try:
            raw = await request.body()
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict):
                    payload = data
        except Exception:  # noqa: BLE001
            payload = {}

    try:
        yield fields, files, payload
    finally:
        if form is not None:
            await form.close()


def wrap_upload(upload):
    """``UploadFile | None`` → ``UploadedFile | None``，对应 ``request.files.get(k)``。

    给用 ``= File(None)`` 声明参数的路由用：那种写法拿到的是 starlette 的
    ``UploadFile``，业务函数要的是带 werkzeug 语义的 ``UploadedFile``。
    """
    return UploadedFile(upload) if upload is not None else None
