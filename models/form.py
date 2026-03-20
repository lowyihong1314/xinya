from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
from sqlalchemy.dialects.mysql import JSON
import json

from models import db
import os
import mimetypes

# 1️⃣ 中间表
regis_form_member = db.Table(
    "regis_form_member",
    db.Column("form_id", db.Integer, db.ForeignKey("regis_form.id", ondelete="CASCADE"), primary_key=True),
    db.Column("member_id", db.Integer, db.ForeignKey("regis_member.id", ondelete="CASCADE"), primary_key=True),
    db.Column("created_at", db.DateTime, default=datetime.utcnow)
)

regis_form_event = db.Table(
    'regis_form_event',
    db.Column('id', db.Integer, primary_key=True),
    db.Column('form_id', db.Integer, db.ForeignKey('regis_form.id', ondelete='CASCADE', onupdate='CASCADE')),
    db.Column('event_id', db.Integer, db.ForeignKey('event_data.id', ondelete='CASCADE', onupdate='CASCADE')),
    db.UniqueConstraint('form_id', 'event_id', name='unique_form_event')
)

class RegisForm(db.Model):
    __tablename__ = "regis_form"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    events = db.relationship(
        "EventData",
        secondary="regis_form_event",
        back_populates="regis_forms"
    )

    title = db.Column(db.String(255), nullable=False)
    detail = db.Column(db.Text, nullable=False)

    fees = db.relationship(
        "RegistrationFee",
        back_populates="form",
        cascade="all, delete-orphan",
        lazy=True
    )

    expired = db.Column(db.Date, nullable=False)

    # 配置字段
    email = db.Column(db.Boolean, nullable=False, default=True)
    parental_form = db.Column(db.Boolean, nullable=False, default=False)
    parent_1 = db.Column(db.Boolean, nullable=False, default=True)
    parent_2 = db.Column(db.Boolean, nullable=False, default=False)
    parent_1_phone = db.Column(db.Boolean, nullable=False, default=True)
    parent_2_phone = db.Column(db.Boolean, nullable=False, default=False)
    medical = db.Column(db.Boolean, nullable=False, default=False)
    allergy = db.Column(db.Boolean, nullable=False, default=False)
    address = db.Column(db.Boolean, nullable=False, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # ✅ 多对多：报名成员
    members = db.relationship(
        "RegisMember",
        secondary="regis_form_member",
        back_populates="forms"
    )

    # ✅ 一对多：扩展字段配置
    extra_field_configs = db.relationship(
        "RegisFormExtraFieldConfig",
        back_populates="form",
        cascade="all, delete-orphan",
        lazy=True
    )
    payments = db.relationship("RegisPayment", backref="form", lazy=True)

    def field_switches_dict(self):
        return {
            "email": bool(self.email),
            "parental_form": bool(self.parental_form),
            "parent_1": bool(self.parent_1),
            "parent_2": bool(self.parent_2),
            "parent_1_phone": bool(self.parent_1_phone),
            "parent_2_phone": bool(self.parent_2_phone),
            "medical": bool(self.medical),
            "allergy": bool(self.allergy),
            "address": bool(self.address),
        }

    def to_dict(self, is_public=False):
        field_switches = self.field_switches_dict()
        data = {
            "id": self.id,
            "title": self.title,
            "detail": self.detail,
            "fees": [f.to_dict() for f in self.fees],
            "expired": self.expired.isoformat() if self.expired else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "field_switches": field_switches,
            **field_switches,
        }

        # ✅ 扩展字段配置（公开也需要）
        data["extra_field_configs"] = [
            f.to_dict() for f in self.extra_field_configs
        ]

        # ✅ 非公开模式才返回敏感关联
        if not is_public:
            data["members"] = [m.to_dict(form_id=self.id) for m in self.members]
            data["payments"] = [p.to_dict() for p in self.payments]

        return data

    
    def to_dict_event(self, is_public=False, include_event_flows=True):
        """在原有 to_dict 基础上添加关联的多个 event 信息（可选包含 event_flows）"""
        data = self.to_dict(is_public=is_public)

        data["events"] = []

        if hasattr(self, "events") and self.events:
            for ev in self.events:
                # 1) event 基础 dict
                if hasattr(ev, "to_dict"):
                    ev_data = ev.to_dict()
                else:
                    ev_data = {
                        "id": ev.id,
                        "event_name": getattr(ev, "event_name", None),
                        "datetime": getattr(ev, "datetime", None),
                        "end_datetime": getattr(ev, "end_datetime", None),
                        "event_code": getattr(ev, "event_code", None),
                    }

                # 2) 注入 flows
                if include_event_flows:
                    flows = (
                        getattr(ev, "event_flows", None)
                        or getattr(ev, "flows", None)
                        or getattr(ev, "event_flow_data", None)
                    )

                    if flows:
                        ev_data["event_flows"] = []
                        for f in flows:
                            if hasattr(f, "to_dict"):
                                ev_data["event_flows"].append(f.to_dict())
                            else:
                                ev_data["event_flows"].append({
                                    "id": getattr(f, "id", None),
                                    "title": getattr(f, "title", None),
                                    "detail": getattr(f, "detail", None),
                                    "minutes": getattr(f, "minutes", None),
                                    "no": getattr(f, "no", None),
                                })
                    else:
                        ev_data["event_flows"] = []

                data["events"].append(ev_data)

        return data

    
class RegistrationFee(db.Model):
    __tablename__ = "registration_fee"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    regis_form_id = db.Column(
        db.Integer,
        db.ForeignKey("regis_form.id", ondelete="CASCADE"),
        nullable=False
    )

    # 收费类型，例如 “成人”、“儿童”、“学生”等
    category = db.Column(db.String(100), nullable=False)

    # 适用年龄区间
    age_range_from = db.Column(db.Integer, nullable=True)
    age_range_to = db.Column(db.Integer, nullable=True)

    # 金额
    amount = db.Column(db.Numeric(10, 2), nullable=False)

    # 说明（可选，比如“含住宿”）
    description = db.Column(db.String(255), nullable=True)
    image_path = db.Column(db.String(255), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    form = db.relationship("RegisForm", back_populates="fees")

    def to_dict(self):
        return {
            "id": self.id,
            "regis_form_id": self.regis_form_id,
            "category": self.category,
            "age_range_from": self.age_range_from,
            "age_range_to": self.age_range_to,
            "amount": float(self.amount),
            "description": self.description,
            "image_path": self.image_path,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class RegisMember(db.Model):
    __tablename__ = "regis_member"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    nric = db.Column(db.String(20), nullable=False, unique=True)

    # 一对多关系：数据版本
    datas = db.relationship(
        "RegisMemberData",
        back_populates="member",
        cascade="all, delete-orphan",
        lazy=True
    )

    # 多对多：成员所属表单
    forms = db.relationship(
        "RegisForm",
        secondary="regis_form_member",
        back_populates="members"
    )

    def latest_data(self):
        """获取最新资料版本"""
        if not self.datas:
            return None
        # 按 edit_at 排序
        return sorted(self.datas, key=lambda d: d.edit_at or datetime.min)[-1]

    def to_dict(self, form_id=None):
        """返回带最新资料的 dict"""
        latest = self.latest_data()
        data = {
            "id": self.id,
            "nric": self.nric,
        }

        if latest:
            data.update(latest.to_dict())

        payment_query = RegisPayment.query.filter_by(nric=self.nric)
        if form_id is not None:
            payment_query = payment_query.filter_by(regis_form_id=form_id)

        data["payments"] = [
            payment.to_dict()
            for payment in payment_query.order_by(RegisPayment.id.desc()).all()
        ]

        return data


class RegisMemberData(db.Model):
    __tablename__ = "regis_member_data"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    member_id = db.Column(
        db.Integer,
        db.ForeignKey("regis_member.id", ondelete="CASCADE"),
        nullable=False
    )

    # 个人资料
    name_cn = db.Column(db.Text, nullable=False)
    name = db.Column(db.Text, nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    gender = db.Column(db.Text, nullable=False)
    email = db.Column(db.Text, nullable=True)
    address = db.Column(db.Text, nullable=True)

    parental_form = db.Column(db.Boolean, default=False)
    parent_1 = db.Column(db.Text, nullable=True)
    parent_2 = db.Column(db.Text, nullable=True)
    parent_1_phone = db.Column(db.String(20), nullable=True)
    parent_2_phone = db.Column(db.String(20), nullable=True)
    medical = db.Column(db.Text, nullable=True)
    allergy = db.Column(db.Text, nullable=True)
    # ⭐ 新增：可用时间段（JSON）
    available_time_slot_json = db.Column(JSON, nullable=True)

    # 修改时间
    edit_at = db.Column(db.DateTime, default=datetime.utcnow)

    # 关系
    member = db.relationship("RegisMember", back_populates="datas")
    
    parental_data = db.relationship(
        "RegisParentalData",
        uselist=False,
        cascade="all, delete-orphan",
        back_populates="member_data"
    )

    # 自定义扩展字段
    extra_fields = db.relationship(
        "RegisMemberFieldValue",
        cascade="all, delete-orphan",
        back_populates="member_data"
    )
    def to_dict(self):
        data = {
            "name_cn": self.name_cn,
            "name": self.name,
            "phone": self.phone,
            "gender": self.gender,
            "email": self.email,
            "address": self.address,
            "parent_1": self.parent_1,
            "parent_2": self.parent_2,
            "parent_1_phone": self.parent_1_phone,
            "parent_2_phone": self.parent_2_phone,
            "medical": self.medical,
            "allergy": self.allergy,
            "available_time_slot_json": self.available_time_slot_json,
            "edit_at": self.edit_at.isoformat() if self.edit_at else None,
        }

        # =========================
        # parental_data 一对一
        # =========================
        data["parental_data"] = (
            self.parental_data.to_dict()
            if self.parental_data
            else None
        )

        # =========================
        # extra_fields
        # =========================
        if self.extra_fields:
            extra_map = {}
            for ef in self.extra_fields:
                field_config_id = ef.field_config.id if ef.field_config else None
                if field_config_id is None:
                    continue

                raw = ef.field_value_json

                if raw is None:
                    fval = ""
                elif isinstance(raw, str):
                    fval = raw.strip()
                else:
                    fval = json.dumps(raw, ensure_ascii=False)

                extra_map.setdefault(field_config_id, []).append(fval)

            for field_config_id, values in extra_map.items():
                key = f"extra_field_{field_config_id}"
                data[key] = ",".join([v for v in values if v != ""])

            data["extra_fields"] = [ef.to_dict() for ef in self.extra_fields]
        else:
            data["extra_fields"] = []

        return data



class RegisParentalData(db.Model):
    __tablename__ = "regis_parental_data"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    # ✅ 一对一：每一份 member_data 对应一份 parental_data（可为空）
    regis_member_data_id = db.Column(
        db.Integer,
        db.ForeignKey("regis_member_data.id", ondelete="CASCADE"),
        nullable=False,
        unique=True
    )

    # 家长资料
    parent_cn = db.Column(db.String(100), nullable=True)
    parent_en = db.Column(db.String(100), nullable=True)
    parent_nric = db.Column(db.String(30), nullable=True)
    parent_phone = db.Column(db.String(30), nullable=True)

    # 孩子资料
    child_cn = db.Column(db.String(100), nullable=True)
    child_en = db.Column(db.String(100), nullable=True)
    child_nric = db.Column(db.String(30), nullable=True)
    child_phone = db.Column(db.String(30), nullable=True)

    # 签名相关
    sign = db.Column(db.String(30), nullable=True)               # 例如 "AD"
    sign_date = db.Column(db.Date, nullable=True)               # 2026-01-14
    sign_json_data = db.Column(JSON, nullable=True)             # strokes 大对象原样存

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # 关系
    member_data = db.relationship("RegisMemberData", back_populates="parental_data")

    def to_dict(self):
        return {
            "id": self.id,
            "regis_member_data_id": self.regis_member_data_id,
            "parent_cn": self.parent_cn,
            "parent_en": self.parent_en,
            "parent_nric": self.parent_nric,
            "parent_phone": self.parent_phone,
            "child_cn": self.child_cn,
            "child_en": self.child_en,
            "child_nric": self.child_nric,
            "child_phone": self.child_phone,
            "sign": self.sign,
            "sign_date": self.sign_date.isoformat() if self.sign_date else None,
            "sign_json_data": self.sign_json_data,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        
class RegisFormExtraFieldConfig(db.Model):
    """
    每个报名表的额外字段配置（例如：籍贯、职业、是否皈依）
    """
    __tablename__ = "regis_form_extra_field_config"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    # 所属报名表
    regis_form_id = db.Column(
        db.Integer,
        db.ForeignKey("regis_form.id", ondelete="CASCADE"),
        nullable=False
    )

    # 标签（中文显示名）
    label = db.Column(db.String(255), nullable=False)

    # 字段类型（text, select, checkbox 等）
    field_type = db.Column(db.String(50), nullable=False, default="text")

    # 选项（仅用于 select / checkbox）
    options = db.Column(db.JSON, nullable=True)

    # 排序
    order = db.Column(db.Integer, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    form = db.relationship("RegisForm", back_populates="extra_field_configs")

    # 关系：一个配置对应多个填写的值
    values = db.relationship(
        "RegisMemberFieldValue",
        back_populates="field_config",
        cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "regis_form_id": self.regis_form_id,
            "label": self.label,
            "field_type": self.field_type,
            "options": self.options,
            "order": self.order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

from sqlalchemy.dialects.mysql import JSON

class RegisMemberFieldValue(db.Model):
    __tablename__ = "regis_member_field_value"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    regis_member_data_id = db.Column(
        db.Integer,
        db.ForeignKey("regis_member_data.id", ondelete="CASCADE"),
        nullable=False
    )

    field_config_id = db.Column(
        db.Integer,
        db.ForeignKey("regis_form_extra_field_config.id", ondelete="CASCADE"),
        nullable=False
    )

    # ✅ 新的 JSON 欄位
    field_value_json = db.Column(JSON, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    member_data = db.relationship(
        "RegisMemberData", back_populates="extra_fields"
    )

    field_config = db.relationship(
        "RegisFormExtraFieldConfig", back_populates="values"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "regis_member_data_id": self.regis_member_data_id,
            "field_config_id": self.field_config_id,
            "label": self.field_config.label if self.field_config else None,
            "field_type": self.field_config.field_type if self.field_config else None,
            "field_value": self.field_value_json,  # ✅ 直接回 dict / list
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }



class RegisPayment(db.Model):
    __tablename__ = "regis_payment"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    
    # ✅ 改用 regis_form_id 外键
    regis_form_id = db.Column(db.Integer, db.ForeignKey("regis_form.id"), nullable=False)
    
    nric = db.Column(db.String(20), db.ForeignKey("regis_member.nric"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    payment_mode = db.Column(db.String(20), nullable=False)
    price = db.Column(db.Numeric(10, 2), nullable=False)
    date = db.Column(db.Date, default=datetime.utcnow, nullable=False)
    time = db.Column(db.Time, default=datetime.utcnow, nullable=False)
    status = db.Column(db.Enum("fail", "process", "checked"), default="process", nullable=False)
    counter = db.Column(db.String(50), nullable=True)
    proof_image_path = db.Column(db.String(255), nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "regis_form_id": self.regis_form_id,
            "nric": self.nric,
            "name": self.name,
            "phone": self.phone,
            "payment_mode": self.payment_mode,
            "price": float(self.price),
            "date": self.date.isoformat() if self.date else None,
            "time": self.time.isoformat() if self.time else None,
            "status": self.status,
            "counter": self.counter,
            "proof_image_path": self.proof_image_path,
        }
