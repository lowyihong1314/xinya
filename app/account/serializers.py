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
