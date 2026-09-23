"""报销申请 → JSON（原 backend/app/account/serializers.py，一字未改）。

前端报销列表 / 详情页、PDF 生成（pdf.py 吃的就是这份字典）、Payment Voucher
公开页三处共用这一个函数。**每一个键名都是契约，改名即线上故障。**

★ 五处容易被「顺手优化」掉的地方：

  ① ``with_children=False`` 时 ``status`` 硬写成 ``"0/0"``，不是真实审批数。
     列表接口走的就是这一支 —— 前端列表页显示的审批进度因此永远是 0/0，
     真实进度只在详情里有。TODO(行为，勿顺手修): 想修就要一并改前端列表的取值。

  ② ``"department_id": None`` 是**写死的 None**。表里没有这个外键了（只留
     department_name 快照），但键必须在 —— 前端有 ``data.department_id ?? ...``
     这类读法，删键会让它变成 undefined 而不是 null。

  ③ ``approver_data`` 先按 user_id 去重「只留每人最后一条」，再倒序输出。
     ``status`` 的 ``a/r`` 计数也基于去重后的集合 —— 同一个人反复审批只算一次。
     这是有意的，别改回「全量计数」。

  ④ ``approval_sort_key`` 返回 ``(decided_at or created_at or 0, id or 0)``。
     当同一张单上**有的审批行两个时间都为空、有的不为空**时，datetime 和 int
     会被放在一起比较 → TypeError → 500。实际数据里两列都有 NOT NULL 默认值，
     所以走不到。TODO(潜在 bug，本次不修): 真要修是把 0 换成 ``datetime.min``。

  ⑤ ``change_logs`` 的排序 key 把时间 ``isoformat()`` 成字符串再比 —— 字符串
     字典序对 ISO 时间恰好等价于时间序，所以它是对的，只是绕。别改成比 datetime
     对象：空值那一支给的是 ``""``，换成对象就会踩上 ④ 的同一个坑。
"""


def serialize_request_data(request_obj, with_children=True):
    if not request_obj:
        return None

    data = {
        "id": request_obj.id,
        "applicant_user_id": request_obj.applicant_user_id,
        "applicant_name": request_obj.applicant_name,
        "request_date": request_obj.request_date.isoformat()
        if request_obj.request_date
        else None,
        "amount": request_obj.amount,
        "department_id": None,
        "department_name": request_obj.department_name,
        "purpose": request_obj.purpose,
        # 逐项明细（line item）：整单金额 = 各行 amount 合计
        "line_items": [line.to_dict() for line in (request_obj.lines or [])],
        "vendor_name": request_obj.vendor_name,
        "vendor_address": request_obj.vendor_address,
        "vendor_contact_number": request_obj.vendor_contact_number,
        "purchase_datetime": request_obj.purchase_datetime.isoformat()
        if request_obj.purchase_datetime
        else None,
        # 收款资料（表头）
        "bank_name": request_obj.bank_name,
        "bank_account": request_obj.bank_account,
        "account_name": request_obj.account_name,
        "public_token": request_obj.public_token,
        "sign_json_data": request_obj.sign_json_data,
        "voucher_recipient_name": request_obj.voucher_recipient_name,
        "voucher_recipient_sign_json": request_obj.voucher_recipient_sign_json,
        "voucher_signed_at": request_obj.voucher_signed_at.isoformat()
        if request_obj.voucher_signed_at
        else None,
        "event_id": request_obj.event_id,
        "event_name": request_obj.event.event_name if request_obj.event else None,
        "created_at": request_obj.created_at.isoformat()
        if request_obj.created_at
        else None,
        "updated_at": request_obj.updated_at.isoformat()
        if request_obj.updated_at
        else None,
        "is_locked": request_obj.is_locked,
    }

    if not with_children:
        data["status"] = "0/0"
        return data

    data["attachments"] = [
        {
            "id": att.id,
            "file_path": att.file_path,
            "file_name": att.file_name,
            "mime_type": att.mime_type,
            "created_at": att.created_at.isoformat() if att.created_at else None,
        }
        for att in (request_obj.attachments or [])
    ]

    data["change_logs"] = [
        {
            "id": log.id,
            "field_name": log.field_name,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "changed_by_user_id": log.changed_by_user_id,
            "changed_by_name": (
                getattr(log.changed_by, "display_name", None)
                or getattr(log.changed_by, "name_NRIC", None)
                or getattr(log.changed_by, "username", None)
            ),
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in sorted(
            (request_obj.change_logs or []),
            key=lambda item: (item.created_at.isoformat() if item.created_at else "", item.id or 0),
            reverse=True,
        )
    ]

    latest_by_user = {}

    def approval_sort_key(approver):
        decided_or_created = getattr(approver, "decided_at", None) or getattr(
            approver, "created_at", None
        )
        return (decided_or_created or 0, approver.id or 0)

    for approver in request_obj.approver_data or []:
        current = latest_by_user.get(approver.user_id)
        if current is None or approval_sort_key(approver) > approval_sort_key(current):
            latest_by_user[approver.user_id] = approver

    unique_approvers = sorted(
        latest_by_user.values(), key=approval_sort_key, reverse=True
    )

    data["approver_data"] = [
        {
            "id": approver.id,
            "user_id": approver.user_id,
            "dep_id": approver.dep_id,
            "reject": approver.reject,
            "sign_json_data": approver.sign_json_data,
            "decided_at": approver.decided_at.isoformat()
            if approver.decided_at
            else None,
        }
        for approver in unique_approvers
    ]

    approve_count = sum(1 for approver in unique_approvers if not approver.reject)
    reject_count = sum(1 for approver in unique_approvers if approver.reject)
    data["status"] = f"{approve_count}/{reject_count}"

    return data
