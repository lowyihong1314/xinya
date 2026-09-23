"""到 ``backend/api/fahui/common/`` 的**延迟 import 桥**。

── 为什么需要这个文件 ───────────────────────────────────────────────

点灯登记自己那三个文件（routes / serializers / services）是自成一体的，但
「付款」那一层是和 YLP 共用的：付款记录的序列化、审核、删除、凭证下载全都住在
``app/fahui/common/payment_review.py``，点灯只是带着 ``payment_type="lamp"`` 去调它。
访问控制（``common/access.py``）和报名开放时间（``common/open_window.py``）同理。

这些文件属于 fahui 模块，**和点灯是同一轮里分头搬的**（落点 ``backend/api/fahui/common/*``
与旧目录一一对应）。摆在面前的三条路：

  ① 顶层 ``from backend.api.fahui.common.payment_review import ...``
     → import 一个子模块会先执行父包的 ``__init__``。``backend/api/fahui/__init__.py``
       按本仓库的惯例会写成 ``from .router import router``，于是只为九个函数 import 它，
       就把整棵 YLP 路由树（连着 PDF / OCR 那一串）一起拉起来 —— api/event/storage.py
       为同一件事实测过一次：+732 个模块。何况两边同时在动，谁先写完谁后写完不该决定
       对方 import 得成 import 不成。否决。
  ② 把 payment_review 抄进本包 → 370 行，而且是**和 YLP 共用的同一套审核逻辑**。
     两份必然分叉，分叉的表现是「同一笔付款在点灯页显示已批准、在法会页显示待审核」，
     没人会怀疑到代码重复上。否决。
  ③ **函数体内 import** → import 期干净（搬迁自检查的就是这个），真正走到这些路由时
     才把 fahui 那边拉起来。← 选它。

同一招在 ``api/user_control/form_services.py``（桥到还没搬的 form）和
``api/public_api/router.py``（桥到 app.fahui.common.open_window）已经用过两次，
注释也在那两处。

★ 跨包路径**只出现在本文件里**。fahui 那边最后落到哪个模块名，只改这一处。
★ 代价必须说清楚：路径写错不会在启动时暴露，而是**第一次调用该路由时** 500。
  下面九个目标在交付时逐个核对过（模块存在、函数名与签名一致）；fahui 那边再动
  这几个函数的话，请回来把对照表也改了。

── 签名对照（本文件 ↔ app/fahui/common/*）────────────────────────────
  open_window.is_open(fahui_key)                                    报名开放窗口
  access.has_fahui_read()                                           管理端读权限
  access.can_access_phone_records(phone)                            公开端「这号是不是你的」
  payment.save_payment_upload(upload, save_dir=, save_name=)        付款凭证落盘
  payment_review.serialize_lamp_registration(reg, include_payments=)  登记 → dict
  payment_review.list_review_payments(payment_type=)                → 响应
  payment_review.update_payment_review(id, status=, payment_type=)  → 响应
  payment_review.delete_payment_record(id, payment_type=)           → 响应
  payment_review.get_payment_document(id, payment_type=)            → 文件响应

⚠️ payment_review 的后四个（list / update / delete / get_document）**返回的是响应对象
   本身**（Flask 时代是 ``jsonify(...)`` 或 ``(body, code)`` 元组，搬完之后是 starlette
   的 Response）。点灯这边只是原样 return，不解包、不改形状 —— 响应体长什么样由 fahui
   那边定，两个模块共用同一份契约，这正是不抄的理由。
"""


# ── 两个必须在 import 期就有值的常量：从 fahui 复制，不走延迟 import ──────

# 用在 router.py 的装饰器实参位置（``@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)``）。
# 装饰器在 import 期就要求值，延迟 import 给不了。
# 复制是安全的：三个名字都在 core/permissions.py 的权威清单里，改名等于要跑一条权限数据
# 迁移，不可能「不小心漂移」。⚠️ 真要改，两处一起改（本文件 + api/fahui/common/access.py）。
FAHUI_READ_PERMISSION_NAMES = ("fahui_read", "account_read", "account_edit")

# ``payment_data.payment_type`` 列里存的字面量。同上：它已经写进历史数据，改它要带数据迁移。
PAYMENT_TYPE_LAMP = "lamp"


# ─────────────────────────── 报名开放时间 ───────────────────────────


def is_open(fahui_key):
    """该法会现在是否在报名开放窗口内（按大马当地日期的 MM-DD 循环区间判断）。"""
    from backend.api.fahui.common.open_window import is_open as impl

    return impl(fahui_key)


# ─────────────────────────── 访问控制 ───────────────────────────


def has_fahui_read():
    """当前用户是否有法会数据的管理端读权限（fahui_read / account_read / account_edit 任一）。"""
    from backend.api.fahui.common.access import has_fahui_read as impl

    return impl()


def can_access_phone_records(phone):
    """是否可读取该手机号名下的法会记录：管理权限 / OTP 已验证该号 / 登录账号绑定的就是该号。"""
    from backend.api.fahui.common.access import can_access_phone_records as impl

    return impl(phone)


# ─────────────────────────── 付款（与 YLP 共用）───────────────────────────


def serialize_lamp_registration(registration, *, include_payments=False):
    """点灯登记 → 响应字典。``include_payments`` 为真时带上 ``payments`` 列表。"""
    from backend.api.fahui.common.payment_review import serialize_lamp_registration as impl

    return impl(registration, include_payments=include_payments)


def list_review_payments(*, payment_type=None):
    """付款审核列表（**返回响应对象**）。"""
    from backend.api.fahui.common.payment_review import list_review_payments as impl

    return impl(payment_type=payment_type)


def update_payment_review(payment_id, *, status, payment_type=None):
    """改一笔付款的审核状态（**返回响应对象**）。"""
    from backend.api.fahui.common.payment_review import update_payment_review as impl

    return impl(payment_id, status=status, payment_type=payment_type)


def delete_payment_record(payment_id, *, payment_type=None):
    """删一笔付款，连同磁盘上的凭证文件（**返回响应对象**）。"""
    from backend.api.fahui.common.payment_review import delete_payment_record as impl

    return impl(payment_id, payment_type=payment_type)


def get_payment_document(payment_id, *, payment_type=None):
    """下载付款凭证（**返回文件响应**；查不到时由那边抛 404）。"""
    from backend.api.fahui.common.payment_review import get_payment_document as impl

    return impl(payment_id, payment_type=payment_type)


def save_payment_upload(upload, *, save_dir, save_name):
    """付款凭证落盘，返回**写进 ``payment_data.document`` 列的字符串**（绝对路径）。

    ★ ``upload`` 必须是「有 ``.save(path)`` 的对象」—— 也就是 werkzeug ``FileStorage``
      的替身，本包的 ``uploads.UploadedFile`` 就是干这个的。fahui 那边的实现是
      ``mkdir(parents=True, exist_ok=True)`` + ``upload.save(save_path)`` +
      ``return str(save_path)``，与 Flask 时代逐字一致。

    ⚠️ 这个函数的入参约定是**两个模块之间唯一的隐式契约**：哪天 fahui 改成直接收
      starlette 的 ``UploadFile``（自己 copyfileobj），这里传过去的替身就会
      AttributeError，而且只在有人真的上传凭证时才炸。改那边的人请连带改
      ``api/lamp/uploads.py``。落盘路径的形状同样不能变（绝对路径字符串），
      凭证下载靠 payment_review 的 PAYMENT_FILE_ROOTS 去解析它。
    """
    from backend.api.fahui.common.payment import save_payment_upload as impl

    return impl(upload, save_dir=save_dir, save_name=save_name)
