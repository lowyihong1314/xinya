import os
import re
import secrets
import unicodedata
from datetime import date, datetime, timedelta

from flask import current_app, jsonify, request
from flask_login import current_user
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import and_, asc, or_
from app.media.paths import DATA_PATH, to_short_data_path
from app.paths import DATA_ROOT
from models import db
from models.event_data import (
    AlbumFiles,
    EventBudgetData,
    EventCheckIn,
    EventData,
    EventFile,
    EventFlowData,
    EventTaskData,
)
from models.user_data import User

BROCHURE_EXTENSIONS = {
    ".pdf",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".doc",
    ".docx",
    ".dox",
}
BROCHURE_STORAGE_ROOT = DATA_ROOT / "NAS" / "UTBA" / "event_brochure"
EVENT_FILE_STORAGE_ROOT = DATA_ROOT / "NAS" / "UTBA" / "event_file"
CHECK_IN_QR_SALT = "xinya-event-check-in-qr-v1"
CHECK_IN_QR_SECONDS = 5 * 60
CHECK_IN_QR_PREFIX = "xinya-checkin:"


def get_json_payload():
    return request.json or request.form or {}


def as_int(value):
    try:
        return int(value) if value is not None and str(value).strip() != "" else None
    except Exception:
        return None


def parse_datetime(value):
    if value is None:
        return None

    parsed = str(value).strip()
    if not parsed:
        return None

    parsed = parsed.replace("T", " ")

    if len(parsed) == 10 and parsed.count("-") == 2:
        parsed = parsed + " 00:00:00"
    elif len(parsed) == 16 and " " in parsed:
        parsed = parsed + ":00"
    elif len(parsed) == 13 and " " in parsed:
        parsed = parsed + ":00:00"

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(parsed, fmt)
        except ValueError:
            continue

    return None


def parse_date(value):
    if value is None:
        return None

    parsed = str(value).strip()
    if not parsed:
        return None

    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(parsed, fmt).date()
        except ValueError:
            continue

    dt = parse_datetime(parsed)
    return dt.date() if dt else None


def _check_in_qr_serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=CHECK_IN_QR_SALT)


def _current_event_check_in_date(event):
    today = date.today()
    start_date = event.datetime.date() if event.datetime else today
    end_date = event.end_datetime.date() if event.end_datetime else start_date
    if today < start_date:
        return start_date
    if today > end_date:
        return end_date
    return today


def _upsert_event_check_in(event, user, check_in_date, check_in_time, valid_user_id):
    record = EventCheckIn.query.filter_by(
        event_id=event.id,
        user_id=user.id,
        check_in_date=check_in_date,
    ).first()

    if record:
        record.check_in_time = check_in_time
        record.valid_user_id = valid_user_id
    else:
        record = EventCheckIn(
            event_id=event.id,
            user_id=user.id,
            check_in_date=check_in_date,
            check_in_time=check_in_time,
            valid_user_id=valid_user_id,
        )
        db.session.add(record)

    db.session.commit()
    return record


def month_events_response(year, month):
    if not year or not month or month < 1 or month > 12:
        return jsonify({"status": "error", "message": "Invalid year or month"}), 400

    month_start = datetime(year, month, 1)
    if month == 12:
        month_end = datetime(year + 1, 1, 1) - timedelta(seconds=1)
    else:
        month_end = datetime(year, month + 1, 1) - timedelta(seconds=1)

    events = (
        EventData.query.filter(
            or_(
                and_(
                    EventData.end_datetime.is_(None),
                    EventData.datetime >= month_start,
                    EventData.datetime <= month_end,
                ),
                and_(
                    EventData.end_datetime.isnot(None),
                    EventData.datetime <= month_end,
                    EventData.end_datetime >= month_start,
                ),
            )
        )
        .order_by(EventData.datetime.asc())
        .all()
    )

    return jsonify(
        {
            "status": "success",
            "login": current_user.is_authenticated,
            "year": year,
            "month": month,
            "count": len(events),
            "data": [event.to_dict_full(10) for event in events],
        }
    )


def all_event_sort_response():
    events = EventData.query.order_by(EventData.datetime.desc()).all()
    return jsonify(
        {
            "status": "success",
            "login": current_user.is_authenticated,
            "total": len(events),
            "data": [event.to_dict() for event in events],
        }
    )


def _delete_event_brochure_file(brochure_path):
    normalized = str(brochure_path or "").strip()
    if not normalized:
        return

    full_path = os.path.join(DATA_PATH, normalized)
    try:
        if os.path.isfile(full_path):
            os.remove(full_path)
    except OSError:
        pass


def _normalize_brochure_base_name(raw_name):
    normalized = unicodedata.normalize("NFKC", str(raw_name or "").strip())
    base_name = os.path.splitext(os.path.basename(normalized))[0]
    # Keep Unicode names such as Chinese while removing path-breaking characters.
    base_name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", base_name)
    base_name = re.sub(r"\s+", " ", base_name).strip().strip(".")
    return base_name or "brochure"


def _save_event_brochure_file(event, uploaded_file):
    if not uploaded_file or not getattr(uploaded_file, "filename", ""):
        raise ValueError("请选择 brochure 文件")

    raw_name = os.path.basename((uploaded_file.filename or "").strip())
    extension = os.path.splitext(raw_name)[1].lower()
    if extension not in BROCHURE_EXTENSIONS:
        raise ValueError("brochure 仅支持 PDF、PPT、PPTX、XLS、XLSX、DOC、DOCX、DOX")

    folder_name = event.event_code or f"event_{event.id}"
    target_dir = BROCHURE_STORAGE_ROOT / folder_name
    target_dir.mkdir(parents=True, exist_ok=True)

    base_name = _normalize_brochure_base_name(raw_name)
    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(6)}_{base_name}{extension}"
    target_path = target_dir / filename
    uploaded_file.save(target_path)
    return to_short_data_path(str(target_path))


def _delete_event_file_path(file_path):
    normalized = str(file_path or "").strip()
    if not normalized:
        return

    full_path = os.path.join(DATA_PATH, normalized)
    try:
        if os.path.isfile(full_path):
            os.remove(full_path)
    except OSError:
        pass


def _save_event_attachment_file(event, uploaded_file):
    if not uploaded_file or not getattr(uploaded_file, "filename", ""):
        raise ValueError("请选择活动附件")

    raw_name = os.path.basename((uploaded_file.filename or "").strip())
    extension = os.path.splitext(raw_name)[1].lower()
    base_name = _normalize_brochure_base_name(raw_name)
    folder_name = event.event_code or f"event_{event.id}"
    target_dir = EVENT_FILE_STORAGE_ROOT / folder_name
    target_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(6)}_{base_name}{extension}"
    target_path = target_dir / filename
    uploaded_file.save(target_path)

    short_path = to_short_data_path(str(target_path))
    file_size = None
    try:
        file_size = target_path.stat().st_size
    except OSError:
        file_size = None

    return {
        "file_path": short_path,
        "file_name": raw_name or filename,
        "mime_type": uploaded_file.mimetype or None,
        "file_size": file_size,
    }


def save_event_check_in(data):
    event_id = as_int(data.get("event_id"))
    user_id = as_int(data.get("user_id"))
    valid_user_id = as_int(data.get("valid_user_id"))
    check_in_time = parse_datetime(data.get("check_in_time")) or datetime.utcnow()
    check_in_date = parse_date(data.get("check_in_date")) or check_in_time.date()

    if not event_id:
        return jsonify({"status": "error", "message": "event_id 必填"}), 400
    if not user_id:
        return jsonify({"status": "error", "message": "user_id 必填"}), 400
    if current_user.id == user_id:
        return jsonify({"status": "error", "message": "不可以帮自己 check-in"}), 400
    if valid_user_id is not None and valid_user_id == user_id:
        return jsonify({"status": "error", "message": "valid_user_id 不可以和 user_id 相同"}), 400

    event = EventData.query.get_or_404(event_id)
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "user 不存在"}), 404

    validator = None
    if valid_user_id is not None:
        validator = User.query.get(valid_user_id)
        if not validator:
            return jsonify({"status": "error", "message": "valid_user 不存在"}), 404

    existing = EventCheckIn.query.filter_by(
        event_id=event_id,
        user_id=user_id,
        check_in_date=check_in_date,
    ).first()
    record = _upsert_event_check_in(event, user, check_in_date, check_in_time, valid_user_id)
    message = "Check-in 已更新" if existing else "Check-in 已创建"
    return jsonify({"status": "success", "message": message, "data": record.to_dict()})


def create_event_check_in_qr(data):
    event_id = as_int(data.get("event_id"))
    if not event_id:
        return jsonify({"status": "error", "message": "event_id 必填"}), 400

    event = EventData.query.get_or_404(event_id)
    now = datetime.utcnow()
    token = _check_in_qr_serializer().dumps(
        {
            "event_id": event.id,
            "user_id": current_user.id,
            "nonce": secrets.token_urlsafe(8),
            "iat": int(now.timestamp()),
        }
    )
    expires_at = now + timedelta(seconds=CHECK_IN_QR_SECONDS)
    return jsonify(
        {
            "status": "success",
            "data": {
                "token": token,
                "code": f"{CHECK_IN_QR_PREFIX}{token}",
                "event_id": event.id,
                "owner_id": current_user.id,
                "owner_name": getattr(current_user, "display_name", None) or getattr(current_user, "username", None),
                "expires_in": CHECK_IN_QR_SECONDS,
                "expires_at": expires_at.isoformat() + "Z",
            },
        }
    )


def scan_event_check_in_qr(data):
    event_id = as_int(data.get("event_id"))
    raw_token = str(data.get("token") or data.get("code") or "").strip()
    if raw_token.startswith(CHECK_IN_QR_PREFIX):
        raw_token = raw_token[len(CHECK_IN_QR_PREFIX):]
    if not raw_token:
        return jsonify({"status": "error", "message": "缺少签到 QR code"}), 400

    try:
        payload = _check_in_qr_serializer().loads(raw_token, max_age=CHECK_IN_QR_SECONDS)
    except SignatureExpired:
        return jsonify({"status": "error", "message": "签到 QR code 已过期，请对方重新生成"}), 400
    except BadSignature:
        return jsonify({"status": "error", "message": "无效的签到 QR code"}), 400

    token_event_id = as_int(payload.get("event_id"))
    owner_id = as_int(payload.get("user_id"))
    if not token_event_id or not owner_id:
        return jsonify({"status": "error", "message": "签到 QR code 内容不完整"}), 400
    if event_id and event_id != token_event_id:
        return jsonify({"status": "error", "message": "这个 QR code 不属于当前活动"}), 400
    if owner_id == current_user.id:
        return jsonify({"status": "error", "message": "不可以扫描自己的签到码"}), 400

    event = EventData.query.get_or_404(token_event_id)
    owner = User.query.get(owner_id)
    if not owner:
        return jsonify({"status": "error", "message": "签到码拥有者不存在"}), 404

    check_in_time = datetime.utcnow()
    check_in_date = _current_event_check_in_date(event)
    record = _upsert_event_check_in(event, current_user, check_in_date, check_in_time, owner.id)
    return jsonify(
        {
            "status": "success",
            "message": "签到成功",
            "data": record.to_dict(),
        }
    )


def delete_event_check_in(check_in_id):
    record = EventCheckIn.query.get_or_404(check_in_id)
    db.session.delete(record)
    db.session.commit()
    return jsonify({"status": "success", "message": "Check-in 已删除", "id": check_in_id})


def all_event_response(page_num, per_page, search_value):
    per_page = min(per_page, 100)
    query = EventData.query

    if search_value:
        like_value = f"%{search_value}%"
        query = query.filter(
            or_(
                EventData.event_name.ilike(like_value),
                EventData.location.ilike(like_value),
                EventData.info.ilike(like_value),
            )
        )

    pagination = query.order_by(EventData.datetime.desc()).paginate(
        page=page_num,
        per_page=per_page,
        error_out=False,
    )

    return jsonify(
        {
            "status": "success",
            "login": current_user.is_authenticated,
            "page_num": page_num,
            "per_page": per_page,
            "total": pagination.total,
            "total_pages": pagination.pages,
            "has_next": pagination.has_next,
            "has_prev": pagination.has_prev,
            "search_value": search_value,
            "data": [event.to_dict_full(10) for event in pagination.items],
        }
    )


def event_flow_list_response(event_id):
    EventData.query.get_or_404(event_id)
    flows = (
        EventFlowData.query.filter_by(event_id=event_id)
        .order_by(asc(EventFlowData.no), asc(EventFlowData.minutes), asc(EventFlowData.id))
        .all()
    )
    return jsonify({"status": "success", "data": [flow.to_dict() for flow in flows]})


def create_event_flow(data):
    event_id = as_int(data.get("event_id"))
    if not event_id:
        return jsonify({"status": "error", "message": "event_id 必填"}), 400

    EventData.query.get_or_404(event_id)
    max_no = (
        db.session.query(db.func.max(EventFlowData.no))
        .filter(EventFlowData.event_id == event_id)
        .scalar()
    )

    flow = EventFlowData(
        event_id=event_id,
        no=(max_no or 0) + 1,
        minutes=as_int(data.get("minutes")),
        creator_id=current_user.id,
        handler_id=as_int(data.get("handler_id")),
        title=(data.get("title") or "").strip() or None,
        detail=(data.get("detail") or "").strip() or None,
        note=(data.get("note") or "").strip() or None,
        notice=(data.get("notice") or "").strip() or None,
    )
    db.session.add(flow)
    db.session.commit()
    return jsonify({"status": "success", "message": "Flow 已创建", "data": flow.to_dict()})


def update_event_flow(flow_id, data):
    flow = EventFlowData.query.get_or_404(flow_id)

    if "no" in data:
        flow.no = as_int(data.get("no")) or 0
    if "minutes" in data:
        flow.minutes = as_int(data.get("minutes"))
    if "handler_id" in data:
        flow.handler_id = as_int(data.get("handler_id"))
    if "title" in data:
        flow.title = (data.get("title") or "").strip() or None
    if "detail" in data:
        flow.detail = (data.get("detail") or "").strip() or None
    if "note" in data:
        flow.note = (data.get("note") or "").strip() or None
    if "notice" in data:
        flow.notice = (data.get("notice") or "").strip() or None

    db.session.commit()
    return jsonify(
        {"status": "success", "message": "Flow 已更新", "data": flow.event.to_dict_full()}
    )


def delete_event_flow(flow_id):
    flow = EventFlowData.query.get_or_404(flow_id)
    event_id = flow.event_id

    try:
        db.session.delete(flow)
        db.session.flush()

        flows = (
            EventFlowData.query.filter_by(event_id=event_id)
            .order_by(asc(EventFlowData.no), asc(EventFlowData.id))
            .all()
        )
        for index, item in enumerate(flows, start=1):
            item.no = index

        db.session.commit()
        return jsonify({"status": "success", "message": "Flow 已删除并重新排序"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def reorder_event_flow(data):
    event_id = as_int(data.get("event_id"))
    flow_ids = data.get("flow_ids")

    if not event_id:
        return jsonify({"status": "error", "message": "event_id 必填"}), 400
    if not isinstance(flow_ids, list) or not flow_ids:
        return jsonify({"status": "error", "message": "flow_ids 必须是非空数组"}), 400

    EventData.query.get_or_404(event_id)
    flows = EventFlowData.query.filter(EventFlowData.event_id == event_id).all()
    flow_map = {flow.id: flow for flow in flows}

    for flow_id in flow_ids:
        if flow_id not in flow_map:
            return (
                jsonify({"status": "error", "message": f"flow_id 不属于该 event：{flow_id}"}),
                400,
            )

    try:
        for index, flow_id in enumerate(flow_ids, start=1):
            flow_map[flow_id].no = index

        remaining = [flow for flow in flows if flow.id not in set(flow_ids)]
        if remaining:
            start = len(flow_ids) + 1
            remaining.sort(key=lambda item: (item.no or 999999, item.id))
            for index, flow in enumerate(remaining, start=start):
                flow.no = index

        db.session.commit()

        sorted_flows = (
            EventFlowData.query.filter_by(event_id=event_id)
            .order_by(asc(EventFlowData.no), asc(EventFlowData.id))
            .all()
        )
        return jsonify(
            {
                "status": "success",
                "message": "已重新排序",
                "data": [flow.to_dict() for flow in sorted_flows],
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def delete_event_by_id(event_id):
    event = EventData.query.get_or_404(event_id)
    if event.album_files and len(event.album_files) > 0:
        return (
            jsonify({"status": "error", "message": "该活动仍有相册文件，不能删除"}),
            400,
        )

    try:
        db.session.delete(event)
        db.session.commit()
        return jsonify({"status": "success", "message": f"Event {event_id} 已删除"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def set_event_poster(event_id, file_id):
    event = EventData.query.get_or_404(event_id)
    file = AlbumFiles.query.get_or_404(file_id)

    try:
        event.event_image_id = file.id
        db.session.commit()
        return jsonify(
            {
                "status": "success",
                "message": f"文件 {file_id} 已设置为活动 {event_id} 的封面",
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def save_event(data):
    try:
        brochure_path_to_delete = None
        event_id = data.get("event_id")
        is_edit = bool(event_id)

        if is_edit:
            event = EventData.query.get(event_id)
            if not event:
                return jsonify({"status": "error", "message": "Event 不存在"}), 404
        else:
            if not data.get("event_name"):
                return jsonify({"status": "error", "message": "event_name 必填"}), 400

            now = datetime.now()
            prefix = now.strftime("EVT_%Y%m%d_")
            last_event = (
                EventData.query.filter(EventData.event_code.like(f"{prefix}%"))
                .order_by(EventData.event_code.desc())
                .first()
            )
            new_num = (
                int(last_event.event_code.split("_")[-1]) + 1
                if last_event and last_event.event_code
                else 1
            )

            event = EventData(
                event_code=f"{prefix}{new_num:03d}",
                user_id=current_user.id,
                album=False,
            )
            db.session.add(event)

        for legacy_field in ["date", "time", "end_date", "end_time", "start_datetime"]:
            if legacy_field in data and str(data.get(legacy_field)).strip():
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": f"旧字段已废弃：{legacy_field}，请改用 datetime / end_datetime",
                        }
                    ),
                    400,
                )

        if not is_edit:
            start_dt = parse_datetime(data.get("datetime"))
            if not start_dt:
                return jsonify({"status": "error", "message": "datetime 必填"}), 400
            event.datetime = start_dt
        elif "datetime" in data and str(data.get("datetime")).strip():
            start_dt = parse_datetime(data.get("datetime"))
            if not start_dt:
                return jsonify({"status": "error", "message": "datetime 格式错误"}), 400
            event.datetime = start_dt

        if "end_datetime" in data:
            raw = data.get("end_datetime")
            if raw is None or str(raw).strip() == "":
                event.end_datetime = None
            else:
                end_dt = parse_datetime(raw)
                if not end_dt:
                    return jsonify({"status": "error", "message": "end_datetime 格式错误"}), 400
                event.end_datetime = end_dt

        for field in [
            "event_name",
            "location",
            "purpose",
            "folder_name",
            "image_path",
            "type",
            "target",
        ]:
            if field in data:
                setattr(event, field, data.get(field))

        if "brochure_path" in data:
            raw_brochure_path = data.get("brochure_path")
            if raw_brochure_path is None or str(raw_brochure_path).strip() == "":
                brochure_path_to_delete = event.brochure_path
                event.brochure_path = None
            else:
                event.brochure_path = str(raw_brochure_path).strip()

        if "album" in data:
            event.album = str(data.get("album")).lower() in ["1", "true", "yes", "on"]

        if "organizers_ids" in data:
            ids = data.get("organizers_ids") or []
            if isinstance(ids, str):
                ids = [int(item) for item in ids.split(",") if item.strip()]
            else:
                ids = [int(item) for item in ids]

            users = User.query.filter(User.id.in_(ids)).all()
            event.organizers = users

        db.session.commit()
        if brochure_path_to_delete:
            _delete_event_brochure_file(brochure_path_to_delete)
        return jsonify({"status": "success", "message": "Event 已保存", "data": event.to_dict()})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def set_event_album(event_id, album):
    event = EventData.query.get_or_404(event_id)
    if album is None:
        return jsonify({"status": "error", "message": "missing album"}), 400

    try:
        event.album = bool(album)
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def upload_event_brochure(event_id, uploaded_file):
    try:
        event = EventData.query.get_or_404(event_id)
        brochure_path = _save_event_brochure_file(event, uploaded_file)
        old_path = event.brochure_path
        event.brochure_path = brochure_path
        db.session.commit()
        if old_path and old_path != brochure_path:
            _delete_event_brochure_file(old_path)
        return jsonify({"status": "success", "message": "Brochure 已上传", "data": event.to_dict()})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def upload_event_file(event_id, uploaded_file):
    try:
        event = EventData.query.get_or_404(event_id)
        saved = _save_event_attachment_file(event, uploaded_file)
        record = EventFile(
            event_id=event.id,
            user_id=current_user.id if current_user.is_authenticated else None,
            file_path=saved["file_path"],
            file_name=saved["file_name"],
            mime_type=saved["mime_type"],
            file_size=saved["file_size"],
        )
        db.session.add(record)
        db.session.commit()
        return jsonify({"status": "success", "message": "活动附件已上传", "data": record.to_dict()})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500



def delete_event_file(file_id):
    record = EventFile.query.get_or_404(file_id)
    file_path = record.file_path
    try:
        db.session.delete(record)
        db.session.commit()
        _delete_event_file_path(file_path)
        return jsonify({"status": "success", "message": "活动附件已删除", "id": file_id})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


# =========================
# 活动待办事项
# =========================
def _norm_task_status(value):
    value = str(value or "todo").strip().lower()
    return value if value in ("todo", "doing", "done") else "todo"


def _parse_task_date(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _parse_amount(value):
    from decimal import Decimal, InvalidOperation

    text = str(value if value is not None else "").strip()
    if text == "":
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def event_task_list_response(event_id):
    EventData.query.get_or_404(event_id)
    tasks = (
        EventTaskData.query.filter_by(event_id=event_id)
        .order_by(asc(EventTaskData.no), asc(EventTaskData.id))
        .all()
    )
    return jsonify({"status": "success", "data": [t.to_dict() for t in tasks]})


def create_event_task(data):
    event_id = as_int(data.get("event_id"))
    if not event_id:
        return jsonify({"status": "error", "message": "event_id 必填"}), 400
    EventData.query.get_or_404(event_id)
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"status": "error", "message": "事项不能为空"}), 400

    max_no = (
        db.session.query(db.func.max(EventTaskData.no))
        .filter(EventTaskData.event_id == event_id)
        .scalar()
    )
    task = EventTaskData(
        event_id=event_id,
        no=(max_no or 0) + 1,
        title=title[:255],
        assignee=(data.get("assignee") or "").strip() or None,
        status=_norm_task_status(data.get("status")),
        due_date=_parse_task_date(data.get("due_date")),
        remark=(data.get("remark") or "").strip() or None,
    )
    db.session.add(task)
    db.session.commit()
    return jsonify({"status": "success", "data": task.to_dict()})


def update_event_task(task_id, data):
    task = EventTaskData.query.get_or_404(task_id)
    if "title" in data:
        title = (data.get("title") or "").strip()
        if title:
            task.title = title[:255]
    if "assignee" in data:
        task.assignee = (data.get("assignee") or "").strip() or None
    if "status" in data:
        task.status = _norm_task_status(data.get("status"))
    if "due_date" in data:
        task.due_date = _parse_task_date(data.get("due_date"))
    if "remark" in data:
        task.remark = (data.get("remark") or "").strip() or None
    if "no" in data:
        task.no = as_int(data.get("no")) or 0
    db.session.commit()
    return jsonify({"status": "success", "data": task.to_dict()})


def delete_event_task(task_id):
    task = EventTaskData.query.get_or_404(task_id)
    db.session.delete(task)
    db.session.commit()
    return jsonify({"status": "success"})


# =========================
# 活动财政预算
# =========================
def event_budget_list_response(event_id):
    EventData.query.get_or_404(event_id)
    items = (
        EventBudgetData.query.filter_by(event_id=event_id)
        .order_by(asc(EventBudgetData.no), asc(EventBudgetData.id))
        .all()
    )
    return jsonify({"status": "success", "data": [i.to_dict() for i in items]})


def create_event_budget(data):
    event_id = as_int(data.get("event_id"))
    if not event_id:
        return jsonify({"status": "error", "message": "event_id 必填"}), 400
    EventData.query.get_or_404(event_id)
    category = (data.get("category") or "").strip()
    if not category:
        return jsonify({"status": "error", "message": "类别不能为空"}), 400

    max_no = (
        db.session.query(db.func.max(EventBudgetData.no))
        .filter(EventBudgetData.event_id == event_id)
        .scalar()
    )
    item = EventBudgetData(
        event_id=event_id,
        no=(max_no or 0) + 1,
        category=category[:255],
        budget_amount=_parse_amount(data.get("budget_amount")) or 0,
        actual_amount=_parse_amount(data.get("actual_amount")),
        remark=(data.get("remark") or "").strip() or None,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"status": "success", "data": item.to_dict()})


def update_event_budget(item_id, data):
    item = EventBudgetData.query.get_or_404(item_id)
    if "category" in data:
        category = (data.get("category") or "").strip()
        if category:
            item.category = category[:255]
    if "budget_amount" in data:
        item.budget_amount = _parse_amount(data.get("budget_amount")) or 0
    if "actual_amount" in data:
        item.actual_amount = _parse_amount(data.get("actual_amount"))
    if "remark" in data:
        item.remark = (data.get("remark") or "").strip() or None
    if "no" in data:
        item.no = as_int(data.get("no")) or 0
    db.session.commit()
    return jsonify({"status": "success", "data": item.to_dict()})


def delete_event_budget(item_id):
    item = EventBudgetData.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    return jsonify({"status": "success"})
