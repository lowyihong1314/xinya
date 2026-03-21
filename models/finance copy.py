from datetime import datetime
from sqlalchemy import func

from models import db


class FinanceReport(db.Model):
    __tablename__ = 'finance_report'

    id = db.Column(db.Integer, primary_key=True)
    event_code = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.String(100), nullable=False)
    report_name = db.Column(db.String(255), nullable=False)
    table_link_id = db.Column(db.String(255), nullable=True)  

class Finance_table(db.Model):
    __tablename__ = 'finance_table'

    table_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    table_user = db.Column(db.String(64), nullable=False)
    
    table_name = db.Column(db.String(128), nullable=False)
    department = db.Column(db.String(64), nullable=True)

    datetime = db.Column(db.DateTime, default=datetime.utcnow)
    edit_datetime = db.Column(db.DateTime, onupdate=func.now())

    remove_code = db.Column(db.String(64), nullable=True)  # 明文确认码
    link_point = db.Column(db.String(256), nullable=True)
    view_permissions = db.Column(db.String(128), nullable=True)
    mount_user = db.Column(db.String(64), nullable=True)
    public = db.Column(db.Boolean, default=False)
    status = db.Column(db.String(32), default='draft')

    is_locked = db.Column(db.Boolean, default=False)

    def set_remove_code(self, code):
        self.remove_code = code

    def check_remove_code(self, code):
        return self.remove_code == code

    def to_dict(self, with_child=False):
        data = {
            "table_id": self.table_id,
            "table_user": self.table_user,
            "table_name": self.table_name,
            "department": self.department,
            "datetime": self.datetime.isoformat() if self.datetime else None,
            "edit_datetime": self.edit_datetime.isoformat() if self.edit_datetime else None,
            "public": self.public,
            "status": self.status,
            "is_locked": self.is_locked,
        }
        if with_child:
            data["income_records"] = [i.to_dict() for i in self.income_records]
            data["records"] = [r.to_dict() for r in self.records]
        return data
    
class Finance_expenses_record(db.Model):
    __tablename__ = 'finance_expenses_record'

    item_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    table_id = db.Column(db.Integer, db.ForeignKey('finance_table.table_id'), nullable=False)

    datetime = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.String(64), nullable=False)

    img_path = db.Column(db.String(256))  # 图片路径（如上传的发票截图）
    unit_price = db.Column(db.Float, nullable=False)
    unit = db.Column(db.String(16))       # 单位，如 "元"、"件"、"小时" 等
    item_name = db.Column(db.String(128), nullable=False)
    detail = db.Column(db.Text)      # 可选的详细描述
    quantity = db.Column(db.Integer, default=1)

    # 可选：建立反向引用（让 finance_table.records 可访问它的记录）
    finance_table = db.relationship('Finance_table', backref=db.backref('records', lazy=True))
    def to_dict(self):
        return {
            "item_id": self.item_id,
            "table_id": self.table_id,
            "datetime": self.datetime.isoformat() if self.datetime else None,
            "user_id": self.user_id,
            "img_path": self.img_path,
            "item_name": self.item_name,
            "unit_price": self.unit_price,
            "unit": self.unit,
            "quantity": self.quantity,
            "detail": self.detail,
        }
        
class Finance_income_record(db.Model):
    __tablename__ = 'finance_income_record'

    item_id = db.Column(db.Integer, primary_key=True, autoincrement=True)  # 改为 item_id
    table_id = db.Column(db.Integer, db.ForeignKey('finance_table.table_id'), nullable=False)

    datetime = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.String(64), nullable=False)

    item_name = db.Column(db.String(128), nullable=False)  # 收入来源
    unit_price = db.Column(db.Float, nullable=False)     # 改为 unit_price
    detail = db.Column(db.Text)                          # 可选备注
    confirmed = db.Column(db.Boolean, default=False)

    img_path = db.Column(db.String(256), nullable=True)  # 🆕 收入凭证图片路径

    quantity = db.Column(db.Integer, nullable=False, default=1)  # 新增 quantity 字段
    unit = db.Column(db.String(32), nullable=True)                # 新增 unit 字段

    finance_table = db.relationship('Finance_table', backref=db.backref('income_records', lazy=True))
    
    def to_dict(self):
        return {
            "item_id": self.item_id,
            "table_id": self.table_id,
            "datetime": self.datetime.isoformat() if self.datetime else None,
            "user_id": self.user_id,
            "item_name": self.item_name,
            "unit_price": self.unit_price,
            "quantity": self.quantity,
            "unit": self.unit,
            "confirmed": self.confirmed,
            "detail": self.detail,
            "img_path": self.img_path,
        }
