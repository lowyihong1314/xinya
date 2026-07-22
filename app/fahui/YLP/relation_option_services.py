from sqlalchemy import func

from models import db
from models.fahui import FahuiItemFormData, FahuiRelationOption


def _clean(value):
    return str(value or "").strip()


def list_relation_options():
    options = (
        FahuiRelationOption.query.filter_by(is_active=True)
        .order_by(FahuiRelationOption.sort_order.asc(), FahuiRelationOption.id.asc())
        .all()
    )
    return {"status": "success", "data": [o.to_dict() for o in options]}, 200


def create_relation_option(payload):
    label = _clean(payload.get("label"))
    if not label:
        return {"status": "error", "message": "请填写关系名称"}, 400
    existing = FahuiRelationOption.query.filter(func.lower(FahuiRelationOption.label) == label.lower()).first()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            db.session.commit()
        return {"status": "success", "message": "已存在", "data": existing.to_dict()}, 200
    max_order = db.session.query(func.max(FahuiRelationOption.sort_order)).scalar() or 0
    option = FahuiRelationOption(label=label, sort_order=max_order + 1, is_active=True)
    db.session.add(option)
    db.session.commit()
    return {"status": "success", "message": "已添加关系", "data": option.to_dict()}, 200


def delete_relation_option(option_id):
    option = FahuiRelationOption.query.get(option_id)
    if not option:
        return {"status": "error", "message": "关系不存在"}, 404
    db.session.delete(option)
    db.session.commit()
    return {"status": "success", "message": "已删除关系"}, 200


def import_relation_options_from_history():
    """把历史订单里出现过的『关系』去重导入为选项。"""
    rows = (
        db.session.query(FahuiItemFormData.field_value, func.count().label("c"))
        .filter(
            FahuiItemFormData.field_name == "relation",
            FahuiItemFormData.field_value.isnot(None),
            func.trim(FahuiItemFormData.field_value) != "",
        )
        .group_by(FahuiItemFormData.field_value)
        .order_by(func.count().desc())
        .all()
    )
    existing = {o.label.lower(): o for o in FahuiRelationOption.query.all()}
    max_order = db.session.query(func.max(FahuiRelationOption.sort_order)).scalar() or 0
    added = 0
    for value, _count in rows:
        label = _clean(value)
        if not label or label.lower() in existing:
            continue
        max_order += 1
        option = FahuiRelationOption(label=label, sort_order=max_order, is_active=True)
        db.session.add(option)
        existing[label.lower()] = option
        added += 1
    db.session.commit()
    payload, _ = list_relation_options()
    payload["message"] = f"已导入 {added} 个关系"
    return payload, 200
