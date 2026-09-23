"""werkzeug ``FileStorage`` / ``MultiDict`` 在 FastAPI 侧的最小替身。

service.py 里三处上传逻辑（``_save_event_attachment_file`` / ``_save_unit_logo`` /
``save_event_unit``）原来收的是 Flask 的 ``request.files`` / ``request.form``，
用到 ``.filename`` / ``.mimetype`` / ``.save(path)`` / ``.get(k, type=int)``。
把这几样包出来，service.py 的函数体就能一个字不改地搬过来。

**不 import werkzeug**（那会把整个 Flask 栈请回进程），下面三条行为是照抄的，
每一条都真的会被踩到：

  ① ``FileStorage.__bool__`` 就是 ``bool(self.filename)``。
     浏览器在「没选文件」时仍会发一个 filename 为空的 part，Flask 那边
     ``request.files.get("file")`` 拿到的是一个**假值**对象，于是 routes.py 的
     ``if not uploaded_file: return 400 请选择文件`` 命中。
     不复刻这条，空文件会一路走到 ``os.path.splitext("")`` 再落盘，
     400 变成一个乱七八糟的 500。

  ② ``FileStorage.mimetype`` 只取 content-type 的**主值**（分号前那段、去空白），
     starlette 的 ``UploadFile.content_type`` 是原始整串。
     库里 EventFile.mime_type 存的是前者，混进 ``; charset=…`` 会让已有记录对不齐。

  ③ ``MultiDict.get(key, type=int)`` 在转换失败时**静默回 default**（只吞
     ValueError / TypeError），不是抛。``save_event_unit`` 的
     ``form.get("event_id", type=int)`` 传 "abc" 时必须是 None —— 那样才会走到
     「Event 不存在」的 404；声明成 ``int`` 让 FastAPI 去转就会变成 422。
"""

import shutil


class UploadedFile:
    """包一层 starlette 的 ``UploadFile``，对外长得像 werkzeug 的 ``FileStorage``。"""

    __slots__ = ("_upload",)

    def __init__(self, upload):
        self._upload = upload

    @property
    def filename(self):
        # starlette 在 part 没带 filename 时给 None，werkzeug 给 ""。
        # 调用方全是 ``(uploaded_file.filename or "")`` 这种写法，两者等价，
        # 这里仍统一成 "" 免得 os.path.basename(None) 炸。
        return self._upload.filename or ""

    @property
    def mimetype(self):
        """见模块头 ②：只要主值，且缺头时返回 ""（与 werkzeug 一致，不是 None）。"""
        raw = self._upload.content_type or ""
        return raw.split(";")[0].strip()

    def __bool__(self):
        """见模块头 ①。"""
        return bool(self.filename)

    def save(self, dst):
        """等价 ``FileStorage.save(dst)``：把整个上传流写到 dst。

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
    """``request.form`` 的最小替身：只实现 ``get(key, default=None, type=None)``。

    行为照抄 werkzeug ``MultiDict.get``（见模块头 ③）：取不到 → default；
    取到了但 ``type(value)`` 抛 ValueError/TypeError → **default**，不是抛。
    """

    __slots__ = ("_values",)

    def __init__(self, values):
        self._values = dict(values)

    def get(self, key, default=None, type=None):  # noqa: A002 - 名字要和 werkzeug 对齐
        value = self._values.get(key)
        # FastAPI 的 ``Form(default=None)`` 用 None 表示「这个字段没出现」，
        # 对应 werkzeug 里的 KeyError 分支。
        if value is None:
            return default
        if type is not None:
            try:
                value = type(value)
            except (ValueError, TypeError):
                return default
        return value


def wrap_upload(upload):
    """``UploadFile | None`` → ``UploadedFile | None``，对应 ``request.files.get(k)``。"""
    return UploadedFile(upload) if upload is not None else None
