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

bcrypt = Bcrypt()

class Permission(db.Model):
    __tablename__ = "permission"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    ref = db.Column(db.String(100), nullable=True)

    # ✅ 多对多关联 Department
    departments = db.relationship(
        "Department",
        secondary="department_permission",
        back_populates="permissions"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "ref": self.ref
        }

department_permission = db.Table(
    "department_permission",
    db.Column("department_id", db.Integer, db.ForeignKey("department.id", ondelete="CASCADE"), primary_key=True),
    db.Column("permission_id", db.Integer, db.ForeignKey("permission.id", ondelete="CASCADE"), primary_key=True)
)

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
        "Permission",
        secondary="department_permission",
        back_populates="departments"
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
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id', ondelete='CASCADE', onupdate='CASCADE'), nullable=False, index=True)
    renewal_date = db.Column(db.Date, nullable=False, index=True)
    proof_path = db.Column(db.String(255), nullable=True)
    proof_name = db.Column(db.String(255), nullable=True)
    proof_mime = db.Column(db.String(120), nullable=True)
    note = db.Column(db.String(255), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user_data.id', ondelete='SET NULL', onupdate='CASCADE'), nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship('User', foreign_keys=[user_id], back_populates='member_renewals')
    creator = db.relationship('User', foreign_keys=[created_by])

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'renewal_date': self.renewal_date.isoformat() if self.renewal_date else None,
            'proof_path': self.proof_path,
            'proof_name': self.proof_name,
            'proof_mime': self.proof_mime,
            'note': self.note,
            'created_by': self.created_by,
            'created_by_name': getattr(self.creator, 'display_name', None) or getattr(self.creator, 'username', None),
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

class User(db.Model, UserMixin):
    __tablename__ = 'user_data'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username = db.Column(db.String(255), unique=True, nullable=True)
    password_hash = db.Column(db.Text, nullable=True)
    phone = db.Column(db.String(255), unique=True, nullable=True)
    email = db.Column(db.String(255), unique=True, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user_data.id'))
    name_NRIC = db.Column(db.String(100), nullable=True)
    display = db.Column(db.Boolean, nullable=True)
    NRIC = db.Column(db.String(20), nullable=True)
    gender = db.Column(db.String(10), nullable=True)
    parent_1 = db.Column(db.String(100), nullable=True)
    parent_1_phone = db.Column(db.String(20), nullable=True)
    medical = db.Column(db.Text, nullable=True)
    allergy = db.Column(db.Text, nullable=True)
    display_name = db.Column(db.String(100), nullable=True)
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
        return bcrypt.check_password_hash(self.password_hash, password)
    
    # ----------------------------------------------------------
    def increment_login_version(self):
        self.login_version += 1

    def to_dict(self):
        reject_local = self.reject_local
        reject_date = self.reject_date

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
            "email": self.email,
            "phone": self.phone,
            "name_NRIC": self.name_NRIC,
            "display": self.display,
            "NRIC": self.NRIC,
            "gender": self.gender,
            "parent_1": self.parent_1,
            "parent_1_phone": self.parent_1_phone,
            "medical": self.medical,
            "allergy": self.allergy,
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
