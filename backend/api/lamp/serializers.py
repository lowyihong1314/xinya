"""点灯登记的响应整形（原 backend/app/fahui/lamp/serializers.py，逐字照搬）。

原文件就是这一行转发：真正的实现在 ``app/fahui/common/payment_review.py``，
因为那份序列化要和付款审核页共用（付款记录里会内嵌它关联的登记）。
这里保留这一层转发而不是让 service.py 直接调桥 —— 原模块的文件组织就是这样，
将来 fahui 那边如果给点灯单独拆一份序列化，改的也是这一个文件。

⚠️ ``include_payments`` 的默认值两边**不一样**，不是笔误：
   本函数默认 ``True``（列表页要带上付款记录），而 payment_review 那边的
   ``serialize_lamp_registration`` 默认 ``False``（付款详情里内嵌登记时不能再套一层付款，
   否则就是自引用）。照搬。
"""

from backend.api.lamp.fahui_common import serialize_lamp_registration


def serialize_registration(registration, include_payments=True):
    return serialize_lamp_registration(registration, include_payments=include_payments)
