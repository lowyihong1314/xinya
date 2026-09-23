"""到 ``backend/app/form/services.py`` 的**延迟 import 桥**。

── 为什么需要这个文件 ───────────────────────────────────────────────

user_control 有 11 个符号住在 form 模块里（NRIC 年龄推算、成员 NRIC 换号、
长期开放报名的费用设置与付款截图落盘…）。form 还没搬，而
``app/form/services.py`` 顶上写着 ``from flask import ...`` /
``from flask_login import ...`` / ``from werkzeug.utils import secure_filename``
—— 在 router.py 顶层直接 import 它，等于 FastAPI 一启动就把整个 Flask 栈
（实测 120+ 个模块）拉进进程，违反本轮迁移的硬约束「进程内 Flask 系模块 = 0」。

三条路摆在面前，这里选的是第三条：

  ① 顶层 import          → 启动即把 Flask 拉回进程。否决。
  ② 把这 11 个函数抄进本包 → 约 450 行重复代码。form 模块搬家时两份必然分叉，
                            而分叉的表现是「同一个 NRIC 在会员页和报名页算出
                            不同年龄」这种没人会怀疑到代码重复上的 bug。否决。
  ③ **函数体内 import**   → import 期干净（验收脚本查的就是这个），
                            真正走到这些路由时才把 form.services 拉起来。

③ 的代价必须说清楚：**这些路由第一次被调用时，Flask 会被 import 进进程。**
它们本身不需要 app context（下面 11 个函数都只碰 models / 文件系统 / 纯计算），
所以功能是好的，只是进程里会多出一堆用不上的模块。
这不是新发明的做法 —— ``api/public_api/router.py`` 对 ``app.fahui.common``
用的就是同一招，注释也在那里。

★ TODO(form 模块搬完时)：把下面每个函数体里的
  ``from backend.api.form.service import X`` 改成
  ``from backend.api.form.service import X``，然后这个文件就只剩一层没必要的转发，
  可以整个删掉、调用点直接 import。**删之前先确认 form 那边的函数名没变。**

── 符号对照表（本文件 ↔ app/form/services.py）────────────────────────
  _calc_age_from_nric                  :304   NRIC → 年龄（只按出生年份，不看生日）
  _apply_member_nric_change            :1769  成员换 NRIC（可能合并到已存在的成员行）
  _get_or_create_member_by_nric        :1053  按 NRIC 取/建 NRIC_Asset
  _serialize_long_term_payment_settings:598   长期开放报名的费用设置 payload
  _replace_scoped_registration_fees    :570   整组替换某 scope 的费用选项
  _collect_long_term_fee_images        :561   收集费用选项里的图片路径
  _delete_register_fee_image           :376   删一张费用说明图
  _get_scoped_regis_payment_or_404     :669   按 scope 取付款记录（查不到抛 404）
  _resolve_register_payment_proof      :402   付款截图的公开路径 → 磁盘路径
  _save_register_payment_proof         :386   付款截图落盘（要 FileStorage 形状的入参）
"""

import shutil

# ``MEMBERSHIP_FEE_SCOPE`` 是 app/form/services.py:66 的字面量 "membership"，
# 这里复制而不是延迟 import：它出现在 8 处调用的关键字实参位置上，
# 每处都包一层函数调用会让 membership.py 难读一倍。
# 复制它是安全的 —— 这个值已经写进 regis_payment.payment_scope 列的历史数据里，
# 改它等于要写一条数据迁移，不可能「不小心漂移」。
MEMBERSHIP_FEE_SCOPE = "membership"


# ─────────────────────────── 纯计算 / ORM ───────────────────────────


def _calc_age_from_nric(nric):
    from backend.api.form.service import _calc_age_from_nric as impl

    return impl(nric)


def _apply_member_nric_change(member, new_nric):
    from backend.api.form.service import _apply_member_nric_change as impl

    return impl(member, new_nric)


def _get_or_create_member_by_nric(nric, *, name_nric=None):
    from backend.api.form.service import _get_or_create_member_by_nric as impl

    return impl(nric, name_nric=name_nric)


def _get_scoped_regis_payment_or_404(payment_id, payment_scope):
    """查不到时抛 **404**（底下是 core.db 的 ``first_or_404``）。

    ⚠️ Flask 时代这里抛的是 werkzeug NotFound，响应体是 **HTML 错误页**；
    core/db.py 的垫片改抛 fastapi.HTTPException(404)，响应体变成
    ``{"detail": "..."}``。这是 core/db.py 已登记在案的框架级差异，不是本次改的。
    """
    from backend.api.form.service import _get_scoped_regis_payment_or_404 as impl

    return impl(payment_id, payment_scope)


# ─────────────────────────── 费用设置 ───────────────────────────


def _serialize_long_term_payment_settings(*, age=None, fee_scope=None, fee_source=None):
    from backend.api.form.service import _serialize_long_term_payment_settings as impl

    return impl(age=age, fee_scope=fee_scope, fee_source=fee_source)


def _replace_scoped_registration_fees(fee_scope, raw_options):
    from backend.api.form.service import _replace_scoped_registration_fees as impl

    return impl(fee_scope, raw_options)


def _collect_long_term_fee_images(items):
    from backend.api.form.service import _collect_long_term_fee_images as impl

    return impl(items)


def _delete_register_fee_image(image_path):
    from backend.api.form.service import _delete_register_fee_image as impl

    return impl(image_path)


# ─────────────────────────── 付款截图 ───────────────────────────


def _resolve_register_payment_proof(image_path):
    from backend.api.form.service import _resolve_register_payment_proof as impl

    return impl(image_path)


def _save_register_payment_proof(file_storage):
    """落盘一张付款截图。入参要长得像 werkzeug 的 FileStorage（见 UploadFileStorage）。"""
    from backend.api.form.service import _save_register_payment_proof as impl

    return impl(file_storage)


class UploadFileStorage:
    """把 starlette 的 ``UploadFile`` 包成 werkzeug ``FileStorage`` 的样子。

    ``_save_register_payment_proof`` 是照着 FileStorage 写的，只用到三件事：
    真假值、``.filename``、``.save(path)``。三件都要对齐，少一件就是行为变更：

      · ``__bool__``：werkzeug 的 FileStorage 是 ``bool(self.filename)``，
        而 starlette 的 UploadFile **没有** ``__bool__``（恒为真）。
        照搬 werkzeug 那条，``if not file_storage`` 这一支才会在「表单里有这个字段
        但没选文件」时走进去，回「请上传付款截图」而不是往下崩。
      · ``.filename``：None 要变成 ""，因为原代码写的是 ``getattr(x, "filename", "")``
        再 ``.strip()``，拿到 None 会 AttributeError。
      · ``.save(dst)``：werkzeug 是从**当前游标位置**拷到底；这里显式 seek(0)
        更稳（本进程里只有我们一个消费者，但依赖可能被别处读过的游标是定时炸弹）。

    ``.mimetype`` 也一并转发（UploadFile 那边叫 ``content_type``），
    因为会员续费凭证那条路径要读它。
    """

    __slots__ = ("_upload",)

    def __init__(self, upload):
        self._upload = upload

    @property
    def filename(self):
        return self._upload.filename or ""

    @property
    def mimetype(self):
        return self._upload.content_type or None

    def __bool__(self):
        return bool(self.filename)

    def save(self, dst):
        source = self._upload.file
        try:
            source.seek(0)
        except (OSError, ValueError):
            # spooled 临时文件在某些状态下不支持 seek，忽略即可（游标本来就在 0）。
            pass
        # dst 可能是 str 也可能是 Path —— werkzeug 的 save() 两者都吃。
        # 故意**不**在这里 mkdir：werkzeug 也不建目录，两个调用点都已经先建好了。
        # 补上 mkdir 看着更稳，实际是把「目录配错」从一个响亮的 500 变成静默写到别处。
        with open(dst, "wb") as target:
            shutil.copyfileobj(source, target)
