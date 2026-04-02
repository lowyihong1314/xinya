import mimetypes
from datetime import datetime, timedelta

from models import db


class File(db.Model):
    __tablename__ = 'files'
    id = db.Column(db.Integer, primary_key=True)
    path = db.Column(db.String(1024), unique=True, nullable=False)  # 逻辑路径 = 实际磁盘路径
    owner_id = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=False)
    is_folder = db.Column(db.Boolean, default=False, nullable=False)
    file_size = db.Column(db.BigInteger, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    owner = db.relationship("User", backref="files")  # ✅ 这一行
    def to_detail(self):
        from models.user_data import User
        histories = (FileHistory.query
                     .filter_by(file_id=self.id)
                     .order_by(FileHistory.timestamp.desc())
                     .limit(10)
                     .all())
        permissions = FilePermission.query.filter_by(file_id=self.id).all()

        file_type = "folder" if self.is_folder else mimetypes.guess_type(self.path)[0] or "unknown"

        def resolve_user_name(user_id):
            user = User.query.get(user_id)
            return user.display_name or user.username if user else None

        return {
            "id": self.id,
            "path": self.path,
            "owner_id": self.owner_id,
            "is_folder": self.is_folder,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "file_type": file_type,
            "file_size": self.file_size if not self.is_folder else None,
            "permissions": [
                {
                    "id": p.id,
                    "user_id": p.user_id,
                    "user_name": resolve_user_name(p.user_id),
                    "permission": p.permission
                } for p in permissions
            ],
            "history": [
                {
                    "id": h.id,
                    "user_id": h.user_id,
                    "user_name": resolve_user_name(h.user_id),
                    "action": h.action,
                    "old_path": h.old_path,
                    "new_path": h.new_path,
                    "timestamp": h.timestamp.isoformat()
                } for h in histories
            ]
        }

class SharePublic(db.Model):
    __tablename__ = 'share_public'
    id = db.Column(db.Integer, primary_key=True)

    file_id = db.Column(db.Integer, db.ForeignKey('files.id'), nullable=False)
    created_user = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=False)  # 分享创建者

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expire_minutes = db.Column(db.Integer, nullable=False)   # 有效时间(分钟)
    token = db.Column(db.String(64), unique=True, nullable=False)
    credit = db.Column(db.Integer, nullable=False)  # 可下载次数
    used = db.Column(db.Integer, default=0)         # 已下载次数

    # 是否过期
    def is_expired(self):
        return datetime.utcnow() > self.created_at + timedelta(minutes=self.expire_minutes)

    # 是否还能下载
    def can_download(self):
        return not self.is_expired() and self.used < self.credit

class FilePermission(db.Model):
    __tablename__ = 'file_permissions'

    id = db.Column(db.Integer, primary_key=True)
    file_id = db.Column(db.Integer, db.ForeignKey('files.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=True)
    department_id = db.Column(db.Integer, db.ForeignKey('department.id'), nullable=True)
    permission = db.Column(
        db.Enum('read', 'read_write', 'read_public', name='file_permission_enum'),
        nullable=False
    )

class FileHistory(db.Model):
    __tablename__ = 'file_history'
    id = db.Column(db.Integer, primary_key=True)
    file_id = db.Column(db.Integer, db.ForeignKey('files.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=False)
    action = db.Column(db.Enum(
        'add_permission', 'remove_permission',
        'create', 'read', 'update', 'delete',
        'move', 'upload', 'restore', 'rename_dir',
        'set_permission',
        name='file_action_enum'
    ), nullable=False)
    old_path = db.Column(db.String(1024))
    new_path = db.Column(db.String(1024))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class FileTrash(db.Model):
    __tablename__ = 'file_trash'
    id = db.Column(db.Integer, primary_key=True)
    file_id = db.Column(
        db.Integer,
        db.ForeignKey('files.id', ondelete='SET NULL'),
        nullable=True,
    )
    owner_id = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=False)
    deleted_by = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=False)
    deleted_at = db.Column(db.DateTime, default=datetime.utcnow)

    path = db.Column(db.String(1024), nullable=False)   # 删除时的真实路径
    size = db.Column(db.BigInteger, default=0)

class ViewHistory(db.Model):
    __tablename__ = 'view_history'
    id = db.Column(db.Integer, primary_key=True)
    file_id = db.Column(db.Integer, db.ForeignKey('files.id'), nullable=True)  
    path = db.Column(db.String(1024), nullable=False)  # 逻辑路径
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=False)
    viewed_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "file_id": self.file_id,
            "path": self.path,
            "user_id": self.user_id,
            "viewed_at": self.viewed_at.isoformat()
        }
