# models/user_data.py
from models import db
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin,current_user,login_required
from datetime import datetime
from sqlalchemy.ext.declarative import declared_attr
from sqlalchemy import Enum
from sqlalchemy.ext.mutable import MutableList
from flask_bcrypt import Bcrypt
from sqlalchemy.inspection import inspect
from sqlalchemy import desc
from sqlalchemy.orm import synonym

bcrypt = Bcrypt()

# 权限清单是代码的一部分（见 app/auth.py 的 permission_names），DB 只存
# 「部门 ↔ 权限名」的分配关系；行对象带 .name / .to_dict()，兼容旧的遍历写法。
class DepartmentPermission(db.Model):
    __tablename__ = "department_permission"

    department_id = db.Column(
        db.Integer,
        db.ForeignKey("department.id", ondelete="CASCADE"),
        primary_key=True,
    )
    name = db.Column("permission_name", db.String(100), primary_key=True)

    department = db.relationship("Department", back_populates="permissions")

    def to_dict(self):
        return {
            "id": self.name,
            "name": self.name,
            "ref": self.name,
        }


class Department(db.Model):
    __tablename__ = "department"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), unique=True, nullable=False)

    users = db.relationship(
        "User",
        secondary="user_department",
        back_populates="departments"
    )

    permissions = db.relationship(
        "DepartmentPermission",
        back_populates="department",
        cascade="all, delete-orphan",
        lazy=True,
    )

    def to_dict(self):
        data = {
            "id": self.id,
            "name": self.name,
        }
        data["permissions"] = [p.to_dict() for p in self.permissions]
        return data


user_department = db.Table(
    'user_department',
    db.Column('user_id', db.Integer, db.ForeignKey('user_data.id'), primary_key=True),
    db.Column('department_id', db.Integer, db.ForeignKey('department.id'), primary_key=True)
)

class MemberRenewal(db.Model):
    __tablename__ = 'member_renewal'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    # user_id 可空：手工名册导入的老会员可能没有登录账号，身份锚定在 nric_asset_id 上。
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id', ondelete='CASCADE', onupdate='CASCADE'), nullable=True, index=True)
    nric_asset_id = db.Column(
        db.Integer,
        db.ForeignKey('nric_asset.id', ondelete='SET NULL', onupdate='CASCADE'),
        nullable=True,
        index=True,
    )
    renewal_date = db.Column(db.Date, nullable=False, index=True)
    proof_path = db.Column(db.String(255), nullable=True)
    proof_name = db.Column(db.String(255), nullable=True)
    proof_mime = db.Column(db.String(120), nullable=True)
    note = db.Column(db.String(255), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user_data.id', ondelete='SET NULL', onupdate='CASCADE'), nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship('User', foreign_keys=[user_id], back_populates='member_renewals')
    creator = db.relationship('User', foreign_keys=[created_by])
    nric_asset = db.relationship('NRIC_Asset', foreign_keys=[nric_asset_id])

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'nric_asset_id': self.nric_asset_id,
            'renewal_date': self.renewal_date.isoformat() if self.renewal_date else None,
            'proof_path': self.proof_path,
            'proof_name': self.proof_name,
            'proof_mime': self.proof_mime,
            'note': self.note,
            'created_by': self.created_by,
            'created_by_name': getattr(self.creator, 'display_name', None) or getattr(self.creator, 'username', None),
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

class MobileSession(db.Model):
    __tablename__ = "mobile_session"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user_data.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = db.Column(db.String(120), nullable=True, index=True)
    refresh_token_hash = db.Column(db.String(64), nullable=False, unique=True)
    user_agent = db.Column(db.String(255), nullable=True)
    platform = db.Column(db.String(50), nullable=True)
    login_version = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    refreshed_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)
    revoked_at = db.Column(db.DateTime, nullable=True, index=True)

    user = db.relationship("User", backref=db.backref("mobile_sessions", lazy=True, cascade="all, delete-orphan"))

class User(db.Model, UserMixin):
    __tablename__ = 'user_data'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username = db.Column(db.String(255), unique=True, nullable=True)
    password_hash = db.Column(db.Text, nullable=True)
    phone = db.Column(db.String(255), unique=True, nullable=True)
    email = db.Column(db.String(255), unique=True, nullable=True)
    # email 是否已通过验证（老用户的历史邮箱默认为未验证，可点「验证」补验证）。
    email_verified = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    # 待验证的新邮箱：改邮箱后先存这里，点击验证链接后才写入 email 并配置转发。
    pending_email = db.Column(db.String(255), nullable=True)
    # Cloudflare Email Routing 规则 id（{username}@utba.my -> email 的转发规则）。
    email_forward_rule_id = db.Column(db.String(255), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user_data.id'))
    display = db.Column(db.Boolean, nullable=True)
    nric_asset_id = db.Column(
        db.Integer,
        db.ForeignKey('nric_asset.id', ondelete='SET NULL', onupdate='CASCADE'),
        nullable=True,
        index=True,
    )
    gender = db.Column(db.String(10), nullable=True)
    parent_1 = db.Column(db.String(100), nullable=True)
    parent_1_phone = db.Column(db.String(20), nullable=True)
    medical = db.Column(db.Text, nullable=True)
    allergy = db.Column(db.Text, nullable=True)
    display_name = db.Column(db.String(100), nullable=True)
    bank_name = db.Column(db.String(100), nullable=True)
    account_name = db.Column(db.String(120), nullable=True)
    bank_account = db.Column(db.String(100), nullable=True)
    tng_number = db.Column(db.String(40), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user_theme = db.Column(db.String(20), nullable=False, default='light')
    login_version = db.Column(db.Integer, default=0)
    reject_local = db.Column(db.Boolean, nullable=False, default=False)
    reject_date = db.Column(db.DateTime, nullable=True)
    is_member = db.Column(db.Boolean, nullable=False, default=False)

    playlists = db.relationship('Playlist', backref='creator', lazy=True)

    departments = db.relationship(
        "Department",
        secondary="user_department",
        back_populates="users"
    )
    nric_data_id = synonym("nric_asset_id")
    nric_asset = db.relationship(
        "NRIC_Asset",
        back_populates="linked_users",
        foreign_keys=[nric_asset_id],
        lazy="joined",
    )
    nric_data = synonym("nric_asset")
    member_renewals = db.relationship(
        "MemberRenewal",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="[MemberRenewal.user_id]",
        order_by="desc(MemberRenewal.renewal_date), desc(MemberRenewal.id)",
    )
    # ✅ 密码管理方法
    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        if not self.password_hash:
            return False
        return bcrypt.check_password_hash(self.password_hash, password)
    
    # ----------------------------------------------------------
    def increment_login_version(self):
        self.login_version += 1

    def to_dict(self):
        reject_local = self.reject_local
        reject_date = self.reject_date
        member_name_nric = getattr(self.nric_asset, "name_nric", None)
        member_nric = getattr(self.nric_asset, "nric", None)

        # 处理每日限制逻辑
        if reject_date:
            today = datetime.utcnow().date()
            if reject_date.date() != today:
                reject_local = False
                reject_date = None

        # ✅ 输出用户基础信息
        data = {
            "id": self.id,
            "username": self.username,
            "display_name": self.display_name,
            "has_password": bool(self.password_hash),
            "email": self.email,
            "email_verified": bool(self.email_verified),
            "pending_email": self.pending_email,
            "phone": self.phone,
            "name_NRIC": member_name_nric,
            "display": self.display,
            "NRIC": member_nric,
            "nric_asset_id": self.nric_asset_id,
            "nric_data_id": self.nric_asset_id,
            "gender": self.gender,
            "parent_1": self.parent_1,
            "parent_1_phone": self.parent_1_phone,
            "medical": self.medical,
            "allergy": self.allergy,
            "bank_name": self.bank_name,
            "account_name": self.account_name,
            "bank_account": self.bank_account,
            "tng_number": self.tng_number,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "user_theme": self.user_theme,
            "login_version": self.login_version,
            "reject_local": reject_local,
            "reject_date": reject_date.isoformat() if reject_date else None,
            "is_member": bool(self.is_member),
            "member_renewals": [item.to_dict() for item in self.member_renewals[:20]],
        }

        # ✅ 改进部门输出 — 使用 Department.to_dict()
        data["departments"] = [
            d.to_dict()
            for d in self.departments
        ]

        return data
