import os
import secrets
from datetime import datetime

from werkzeug.utils import secure_filename

from app.paths import DATA_ROOT, data_media_url
from models import db
from models.fahui import FahuiPaymentChannel

ALLOWED_QR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".heic", ".heif", ".webp"}
# 收款码属于用户上传内容，必须存在 DATA_ROOT，不能写进仓库的 static/。
QR_IMAGE_SUBDIR = "fahui_payment_qr"
QR_IMAGE_DIR = DATA_ROOT / QR_IMAGE_SUBDIR
CHANNEL_TYPES = {"qr", "bank"}


def _save_channel_qr(file_storage):
    if not file_storage or not getattr(file_storage, "filename", ""):
        raise ValueError("请上传收款二维码图片")

    original_name = secure_filename(file_storage.filename or "")
    extension = os.path.splitext(original_name)[1].lower()
    if extension not in ALLOWED_QR_EXTENSIONS:
        raise ValueError("仅支持 PNG、JPG、JPEG、HEIC、WEBP 图片")

    QR_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(8)}{extension}"
    file_storage.save(QR_IMAGE_DIR / filename)
    return data_media_url(QR_IMAGE_SUBDIR, filename)


def _clean(value):
    return str(value or "").strip() or None


def list_payment_channels(version):
    version = _clean(version)
    if not version:
        return {"status": "error", "message": "缺少 version"}, 400
    channels = (
        FahuiPaymentChannel.query.filter_by(version=version)
        .order_by(FahuiPaymentChannel.sort_order.asc(), FahuiPaymentChannel.id.asc())
        .all()
    )
    return {"status": "success", "data": [c.to_dict() for c in channels]}, 200


def _apply_fields(channel, form, files, *, is_create):
    channel_type = _clean(form.get("channel_type")) or channel.channel_type
    if channel_type not in CHANNEL_TYPES:
        raise ValueError("支付方式类型无效")
    channel.channel_type = channel_type
    channel.label = _clean(form.get("label"))
    channel.note = _clean(form.get("note"))

    if channel_type == "bank":
        channel.bank_name = _clean(form.get("bank_name"))
        channel.bank_account_no = _clean(form.get("bank_account_no"))
        channel.bank_account_name = _clean(form.get("bank_account_name"))
        if not channel.bank_account_no:
            raise ValueError("银行转账需要填写帐号")
        # 切换成银行转账则清掉旧二维码引用
        channel.qr_image_path = None
    else:  # qr
        channel.bank_name = None
        channel.bank_account_no = None
        channel.bank_account_name = None
        qr_file = files.get("qr_image") if files else None
        if qr_file and getattr(qr_file, "filename", ""):
            channel.qr_image_path = _save_channel_qr(qr_file)
        elif is_create or not channel.qr_image_path:
            raise ValueError("扫码支付需要上传二维码")

    sort_order = form.get("sort_order")
    if sort_order not in (None, ""):
        try:
            channel.sort_order = int(sort_order)
        except (TypeError, ValueError):
            channel.sort_order = channel.sort_order or 0

    is_active = form.get("is_active")
    if is_active is not None:
        channel.is_active = str(is_active).strip().lower() in {"1", "true", "yes", "on"}


def create_payment_channel(form, files):
    version = _clean(form.get("version"))
    if not version:
        return {"status": "error", "message": "缺少 version"}, 400
    try:
        channel = FahuiPaymentChannel(version=version, channel_type="qr", is_active=True, sort_order=0)
        _apply_fields(channel, form, files, is_create=True)
        db.session.add(channel)
        db.session.commit()
        return {"status": "success", "message": "已添加支付方式", "data": channel.to_dict()}, 200
    except ValueError as exc:
        db.session.rollback()
        return {"status": "error", "message": str(exc)}, 400
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        return {"status": "error", "message": str(exc)}, 500


def update_payment_channel(channel_id, form, files):
    channel = FahuiPaymentChannel.query.get(channel_id)
    if not channel:
        return {"status": "error", "message": "支付方式不存在"}, 404
    try:
        _apply_fields(channel, form, files, is_create=False)
        db.session.commit()
        return {"status": "success", "message": "已更新支付方式", "data": channel.to_dict()}, 200
    except ValueError as exc:
        db.session.rollback()
        return {"status": "error", "message": str(exc)}, 400
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        return {"status": "error", "message": str(exc)}, 500


def delete_payment_channel(channel_id):
    channel = FahuiPaymentChannel.query.get(channel_id)
    if not channel:
        return {"status": "error", "message": "支付方式不存在"}, 404
    db.session.delete(channel)
    db.session.commit()
    return {"status": "success", "message": "已删除支付方式"}, 200
