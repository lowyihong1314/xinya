import mimetypes
import os
from datetime import date, datetime

from models import db
from sqlalchemy import and_, asc, desc, or_
from sqlalchemy.dialects.mysql import LONGTEXT

event_organizer = db.Table(
    "event_organizer",
    db.Column("id", db.Integer, primary_key=True),
    db.Column("event_id", db.Integer, db.ForeignKey("event_data.id", ondelete="CASCADE")),
    db.Column("user_id", db.Integer, db.ForeignKey("user_data.id", ondelete="CASCADE")),
    db.Column("created_at", db.DateTime, default=datetime.utcnow),
    db.UniqueConstraint("event_id", "user_id", name="uq_event_user")
)


class EventData(db.Model):
    __tablename__ = 'event_data'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    datetime = db.Column(db.DateTime, nullable=True)
    end_datetime = db.Column(db.DateTime, nullable=True)

    event_name = db.Column(db.String(255), nullable=True)
    # 地点名称（场地叫什么，如「地南佛学会」）；location 是详细地址。
    location_name = db.Column(db.String(255), nullable=True)
    location = db.Column(db.Text, nullable=True)
    # Google 地点：强制通过 Google 选择，存 place_id + 经纬度用于地图显示。
    place_id = db.Column(db.String(255), nullable=True)
    lat = db.Column(db.Float, nullable=True)
    lng = db.Column(db.Float, nullable=True)

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True
    )
    user = db.relationship("User", backref="events")

    regis_forms = db.relationship(
        "RegisForm",
        secondary="regis_form_event",
        back_populates="events",
        lazy="joined"
    )
    organizers = db.relationship(
        "User",
        secondary=event_organizer,
        backref="organized_events",
        lazy="joined"
    )
    target = db.Column(db.Text, nullable=True)  # 对象
    # 简章 = 被选中的某个活动附件（event_file）。指向 event_file.id。
    brochure_file_id = db.Column(
        db.Integer,
        db.ForeignKey(
            "event_file.id",
            name="fk_event_brochure_file",
            use_alter=True,
            ondelete="SET NULL",
            onupdate="CASCADE",
        ),
        nullable=True,
    )
    brochure_file = db.relationship(
        "EventFile",
        foreign_keys=[brochure_file_id],
        post_update=True,
    )
    purpose = db.Column(db.Text, nullable=True)
    folder_name = db.Column(db.String(255), nullable=True)
    image_path = db.Column(db.String(255), nullable=True)
    type = db.Column(db.String(100), nullable=True)
    event_code = db.Column(db.String(100), nullable=True)
    album = db.Column(db.Boolean, nullable=True)
    # 是否对外公开：未登录访客只看得到公开的活动。默认公开 —— 这套系统的活动本来就是
    # 全部对外的，加这个开关是为了偶尔藏起内部筹备中的活动，而不是反过来。
    is_public = db.Column(db.Boolean, nullable=False, default=True, server_default="1")

    event_image_id = db.Column(
        db.Integer,
        db.ForeignKey(
            'album_files.id',
            name='fk_event_image',
            use_alter=True,
            ondelete="SET NULL",
            onupdate="CASCADE",
        ),
        nullable=True
    )
    event_image = db.relationship(
        "AlbumFiles",
        foreign_keys=[event_image_id],
        post_update=True,
    )

    album_files = db.relationship(
        "AlbumFiles",
        back_populates="event",
        cascade="all, delete-orphan",
        foreign_keys="[AlbumFiles.event_id]"
    )
    event_files = db.relationship(
        "EventFile",
        back_populates="event",
        cascade="all, delete-orphan",
        foreign_keys="[EventFile.event_id]",
        order_by="desc(EventFile.created_at), desc(EventFile.id)",
    )

    # -----------------------------------------------------

    def to_dict(self):
        return {
            "id": self.id,
            "datetime": self.datetime.isoformat() if self.datetime else None,
            "end_datetime": self.end_datetime.isoformat() if self.end_datetime else None,
            "organizers": [
                {
                    "id": u.id,
                    "username": u.username,
                    "display_name": u.display_name
                }
                for u in self.organizers
            ],
            "event_name": self.event_name,
            "location_name": self.location_name,
            "location": self.location,
            "place_id": self.place_id,
            "lat": self.lat,
            "lng": self.lng,
            "purpose": self.purpose,
            "target": self.target,   # ⭐ 对象
            # 简章 = 被选中的活动附件；派生字段保持向后兼容（前端仍读 brochure_path/name/mime）
            "brochure_file_id": self.brochure_file_id,
            "brochure_path": self.brochure_file.file_path if self.brochure_file else None,
            "brochure_name": self.brochure_file.file_name if self.brochure_file else None,
            "brochure_mime": self.brochure_file.mime_type if self.brochure_file else None,
            "folder_name": self.folder_name,

            "type": self.type,
            "event_code": self.event_code,
            "album": self.album,
            "is_public": bool(self.is_public),
            "event_image": self.event_image.to_dict() if self.event_image else None,
            "event_files": [file.to_dict() for file in self.event_files[:12]],

            "organizing_units": [unit.to_dict() for unit in (self.organizing_units or [])],

            "user_id": self.user_id,
            "username": getattr(self.user, "username", None),
            "display_name": getattr(self.user, "display_name", None)
        }

    def to_dict_full(self, max_file=1000):
        data = self.to_dict()

        data["max_file"] = max_file

        data["album_files"] = [
            file.to_dict()
            for file in self.album_files[:max_file]
        ]
        data["event_files"] = [
            file.to_dict()
            for file in self.event_files[:max_file]
        ]

        if not self.datetime:
            data["next_event_id"] = None
            data["prev_event_id"] = None
        else:
            prev_event = (
                EventData.query
                .filter(EventData.datetime.isnot(None))
                .filter(
                    or_(
                        EventData.datetime < self.datetime,
                        and_(EventData.datetime == self.datetime, EventData.id < self.id)
                    )
                )
                .order_by(desc(EventData.datetime), desc(EventData.id))
                .first()
            )

            next_event = (
                EventData.query
                .filter(EventData.datetime.isnot(None))
                .filter(
                    or_(
                        EventData.datetime > self.datetime,
                        and_(EventData.datetime == self.datetime, EventData.id > self.id)
                    )
                )
                .order_by(asc(EventData.datetime), asc(EventData.id))
                .first()
            )

            data["next_event_id"] = next_event.id if next_event else None
            data["prev_event_id"] = prev_event.id if prev_event else None

        data["event_flows"] = [
            f.to_dict()
            for f in sorted(
                self.event_flows,
                key=lambda x: (x.no or 0, (x.minutes is None), x.minutes or 0, x.id)
            )
        ]

        data["check_ins"] = [
            item.to_dict()
            for item in sorted(
                self.check_ins,
                key=lambda x: (
                    x.check_in_date or date.min,
                    x.check_in_time or datetime.min,
                    x.id or 0,
                ),
                reverse=True,
            )
        ]

        data["regis_forms"] = [form.to_dict() for form in self.regis_forms]
        return data



class EventFlowData(db.Model):
    __tablename__ = "event_flow_data"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True
    )

    # Event 关系
    event = db.relationship(
        "EventData",
        backref=db.backref("event_flows", passive_deletes=True)
    )

    # ⭐ 流程序号（用于排序）
    no = db.Column(db.Integer, nullable=False, default=0, index=True)

    # 分钟（用于时间推算）
    minutes = db.Column(db.Integer, nullable=True, index=True)

    creator_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True
    )
    creator = db.relationship("User", foreign_keys=[creator_id])

    handler_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True
    )
    handler = db.relationship("User", foreign_keys=[handler_id])

    title = db.Column(db.String(255), nullable=True)
    detail = db.Column(db.Text, nullable=True)
    note = db.Column(db.Text, nullable=True)
    notice = db.Column(db.Text, nullable=True)
    # 仅登陆可见：打钩后该环节对公开/终端隐藏，只有登陆用户能看到。
    login_only = db.Column(db.Boolean, nullable=False, default=False)

    def to_dict(self):
        return {
            "id": self.id,
            "event_id": self.event_id,

            "no": self.no,
            "minutes": self.minutes,

            "title": self.title,
            "detail": self.detail,
            "note": self.note,
            "notice": self.notice,
            "login_only": bool(self.login_only),

            "creator_id": self.creator_id,
            "creator_name": getattr(self.creator, "display_name", None),

            "handler_id": self.handler_id,
            "handler_name": getattr(self.handler, "display_name", None),
        }


class EventTaskData(db.Model):
    """活动待办事项（准备清单）。"""
    __tablename__ = "event_task_data"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    event = db.relationship("EventData", backref=db.backref("event_tasks", passive_deletes=True))

    no = db.Column(db.Integer, nullable=False, default=0, index=True)
    title = db.Column(db.String(255), nullable=False)
    assignee = db.Column(db.String(120), nullable=True)   # 负责人（自由文本）
    status = db.Column(db.String(20), nullable=False, default="todo")  # todo / doing / done
    due_date = db.Column(db.Date, nullable=True)
    remark = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "event_id": self.event_id,
            "no": self.no,
            "title": self.title,
            "assignee": self.assignee,
            "status": self.status,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "remark": self.remark,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class EventBudgetData(db.Model):
    """活动财政预算明细。"""
    __tablename__ = "event_budget_data"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    event = db.relationship("EventData", backref=db.backref("event_budgets", passive_deletes=True))

    no = db.Column(db.Integer, nullable=False, default=0, index=True)
    # 收支类型：expense（支出，可提交报销）/ income（收入）
    type = db.Column(db.String(16), nullable=False, default="expense")
    category = db.Column(db.String(255), nullable=False)
    budget_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    actual_amount = db.Column(db.Numeric(10, 2), nullable=True)
    remark = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "event_id": self.event_id,
            "no": self.no,
            "type": self.type or "expense",
            "category": self.category,
            "budget_amount": float(self.budget_amount or 0),
            "actual_amount": float(self.actual_amount) if self.actual_amount is not None else None,
            "remark": self.remark,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class EventOrganizingUnit(db.Model):
    """活动的进行单位（主催/主办/承办/协办/协调），一个活动可挂多个，各带名称与 logo，sort_order 决定展示顺序。"""

    __tablename__ = "event_organizing_unit"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event_data.id", name="fk_event_unit_event", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 主催单位 / 主办单位 / 承办单位 / 协办单位 / 协调单位（服务层 EVENT_UNIT_ROLES 为准）
    role = db.Column(db.String(20), nullable=False, default="主办单位")
    unit_name = db.Column(db.String(200), nullable=False)
    logo_path = db.Column(db.String(255), nullable=True)  # media 短路径；地南佛学会走硬编码 logo
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    event = db.relationship(
        "EventData",
        backref=db.backref(
            "organizing_units",
            lazy="selectin",
            cascade="all, delete-orphan",
            passive_deletes=True,
            order_by="EventOrganizingUnit.sort_order, EventOrganizingUnit.id",
        ),
    )

    # 地南佛学会（自己）的 logo 硬编码用站点素材，无需上传。
    OWN_UNIT_NAME = "地南佛学会"
    OWN_LOGO_URL = "/static/images/logo/logo.png"

    def logo_url(self):
        if (self.unit_name or "").strip() == self.OWN_UNIT_NAME:
            return self.OWN_LOGO_URL
        return f"/media_file/{self.logo_path}" if self.logo_path else None

    def to_dict(self):
        return {
            "id": self.id,
            "event_id": self.event_id,
            "role": self.role,
            "unit_name": self.unit_name,
            "logo_url": self.logo_url(),
            "sort_order": self.sort_order,
        }


class EventFile(db.Model):
    __tablename__ = "event_file"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    file_path = db.Column(db.String(255), nullable=False)
    file_name = db.Column(db.String(255), nullable=False)
    mime_type = db.Column(db.String(120), nullable=True)
    file_size = db.Column(db.BigInteger, nullable=True)
    note = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, server_default=db.func.current_timestamp(), index=True)

    event = db.relationship("EventData", back_populates="event_files", foreign_keys=[event_id])
    user = db.relationship("User", foreign_keys=[user_id])

    def to_dict(self):
        return {
            "id": self.id,
            "event_id": self.event_id,
            "user_id": self.user_id,
            "file_path": self.file_path,
            "file_name": self.file_name,
            "mime_type": self.mime_type,
            "file_size": self.file_size,
            "note": self.note,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "user_name": getattr(self.user, "display_name", None) or getattr(self.user, "username", None),
        }


class EventCheckIn(db.Model):
    __tablename__ = "event_check_in"
    __table_args__ = (
        db.UniqueConstraint("event_id", "user_id", "check_in_date", name="uq_event_check_in_event_user_date"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    check_in_date = db.Column(db.Date, nullable=False, default=date.today, index=True)
    check_in_time = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    valid_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )

    event = db.relationship(
        "EventData",
        backref=db.backref("check_ins", cascade="all, delete-orphan", passive_deletes=True),
        foreign_keys=[event_id],
    )
    user = db.relationship(
        "User",
        backref=db.backref("event_check_ins", passive_deletes=True),
        foreign_keys=[user_id],
    )
    valid_user = db.relationship(
        "User",
        foreign_keys=[valid_user_id],
    )

    def to_dict(self):
        return {
            "id": self.id,
            "event_id": self.event_id,
            "user_id": self.user_id,
            "check_in_date": self.check_in_date.isoformat() if self.check_in_date else None,
            "check_in_time": self.check_in_time.isoformat() if self.check_in_time else None,
            "valid_user_id": self.valid_user_id,
            "user_name": getattr(self.user, "display_name", None) or getattr(self.user, "username", None),
            "valid_user_name": getattr(self.valid_user, "display_name", None)
            or getattr(self.valid_user, "username", None),
        }

class AlbumFiles(db.Model):
    __tablename__ = 'album_files'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    folder_name = db.Column(db.String(100), nullable=False)
    event_id = db.Column(
        db.Integer,
        db.ForeignKey('event_data.id', ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True
    )
    file_name = db.Column(db.String(255), nullable=False)
    no = db.Column(db.Integer, nullable=False)
    name = db.Column(db.String(255), nullable=False)
    title = db.Column(db.String(255), default="Update Now!!")
    info = db.Column(db.String(255), default="Update Now!!")
    username = db.Column(db.String(100), nullable=False)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey('user_data.id', ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True
    )
    date = db.Column(db.String(8), nullable=True)
    is_public = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, server_default=db.func.current_timestamp())
    tags = db.Column(db.String(255), default="")
    category = db.Column(db.String(100), default="")
    extra_metadata = db.Column(LONGTEXT, nullable=True)
    file_type = db.Column(db.String(10), nullable=False)

    # 关系绑定
    event = db.relationship(
        "EventData",
        back_populates="album_files",
        foreign_keys=[event_id]
    )
    user = db.relationship(
        "User",
        backref="album_files",
        foreign_keys=[user_id]
    )
    @staticmethod
    def get_prev_next_ids(session, event_id, created_at, id):
        prev_id = session.scalar(
            db.select(AlbumFiles.id)
            .where(
                AlbumFiles.event_id == event_id,
                or_(
                    AlbumFiles.created_at < created_at,
                    and_(
                        AlbumFiles.created_at == created_at,
                        AlbumFiles.id < id
                    )
                )
            )
            .order_by(
                AlbumFiles.created_at.desc(),
                AlbumFiles.id.desc()
            )
            .limit(1)
        )

        next_id = session.scalar(
            db.select(AlbumFiles.id)
            .where(
                AlbumFiles.event_id == event_id,
                or_(
                    AlbumFiles.created_at > created_at,
                    and_(
                        AlbumFiles.created_at == created_at,
                        AlbumFiles.id > id
                    )
                )
            )
            .order_by(
                AlbumFiles.created_at.asc(),
                AlbumFiles.id.asc()
            )
            .limit(1)
        )

        return prev_id, next_id

    
    def to_dict(self):
        prev_id, next_id = self.get_prev_next_ids(
            db.session,
            self.event_id,
            self.created_at,
            self.id
        )
        return {
            "id": self.id,
            "event_id": self.event_id,
            "prev_id": prev_id,
            "next_id": next_id,
            "file_name": self.file_name,
            "no": self.no,
            "name": self.name,
            "title": self.title,
            "info": self.info,
            "username": self.user.username if self.user else None,
            "user_id": self.user_id,
            "user_display_name": self.user.display_name if self.user else None,
            "date": self.date,
            "is_public": self.is_public,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "tags": self.tags,
            "category": self.category,
            "extra_metadata": self.extra_metadata,
            "file_type": self.file_type
        }
