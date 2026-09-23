"""werkzeug ``FileStorage`` 在 FastAPI 侧的最小替身 —— 只给付款凭证上传那条路由用。

service.py 的 ``create_payment`` 原来收的是 Flask 的 ``request.files``，用到
``FileStorage`` 的两个成员（``.filename`` / ``.save(path)``），而真正落盘的
``save_payment_upload`` 住在 fahui 的共用件里（``common/payment.py``，与 YLP 共用），
它对着传进来的对象调 ``.save(save_path)``。把这两样包出来，service.py 那一段就能
一个字不改地搬过来。**不 import werkzeug**（那会把整个 Flask 栈请回进程）。

每个搬完的模块都有自己的一份这种替身（api/account、api/event、api/music、
api/fahui 各一份）——它是**框架边界上的适配器**，属于路由层，不是可复用的业务件；
跨包 import 别人的那一份，只会为了 20 行代码把对方整个包的 __init__ 拉起来。

★ 与 fahui 的隐式契约：本类必须一直提供 ``.save(dst)``。理由与「改了会怎样」
  写在 fahui_common.save_payment_upload 的 docstring 里。

── 替身照抄了 FileStorage 的哪条行为 ────────────────────────────────

``FileStorage.__bool__`` 就是 ``bool(self.filename)``：浏览器在「有文件框但没选文件」
时仍然会发一个 filename 为空的 part，Flask 那边 ``request.files.get("file")`` 拿到的
是一个**假值对象**，于是 ``if upload and upload.filename:`` 这一支不成立、付款记录
照样建、只是没有凭证。不复刻这条，空文件会一路走到落盘，生成一个 0 字节的
``{payment.id}`` 文件并写进 document 列。
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
        # 调用点是 ``if upload and upload.filename``，两者等价；统一成 ""
        # 免得后面 ``Path(None)`` 炸。
        return self._upload.filename or ""

    def __bool__(self):
        """见模块头：空文件名 = 假值。"""
        return bool(self.filename)

    def save(self, dst):
        """等价 ``FileStorage.save(dst)``：把整个上传流写到 dst（可以是 str 或 Path）。

        werkzeug 是从**当前游标**开始拷的；这里显式 seek(0) 再拷 —— 本进程里这个
        UploadFile 只有我们一个消费者，回到 0 更稳（spooled 临时文件在少数状态下
        不支持 seek，忽略即可，与 api/event、api/music 两处的写法一致）。
        """
        source = self._upload.file
        try:
            source.seek(0)
        except (OSError, ValueError):
            pass
        with open(dst, "wb") as target:
            shutil.copyfileobj(source, target)


def wrap_upload(upload):
    """``UploadFile | None`` → ``UploadedFile | None``，对应 ``request.files.get(k)``。"""
    return UploadedFile(upload) if upload is not None else None
