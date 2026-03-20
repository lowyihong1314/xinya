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

    playlists = db.relationship('Playlist', backref='creator', lazy=True)

    departments = db.relationship(
        "Department",
        secondary="user_department",
        back_populates="users"
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
        }

        # ✅ 改进部门输出 — 使用 Department.to_dict()
        data["departments"] = [
            d.to_dict()
            for d in self.departments
        ]

        return data
