from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from models import db
import os
import mimetypes


class AboutUs(db.Model):
    __tablename__ = 'about_us'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    text = db.Column(db.Text, nullable=False)

class OurHistory(db.Model):
    __tablename__ = 'our_history'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    date = db.Column(db.Date, nullable=False)
    text = db.Column(db.Text, nullable=False)
    img = db.Column(db.String(255), nullable=True)

class DorpMessage(db.Model):
    __tablename__ = 'dorp_message'
    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    message = db.Column(db.Text, nullable=False)
    ip = db.Column(db.String(45), nullable=False)
    phone = db.Column(db.String(20), nullable=False)  # 新增的 phone 列
    is_spam = db.Column(db.Boolean, default=False)
    display = db.Column(db.Boolean, default=True)
