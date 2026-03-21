import os

from flask import abort, jsonify, send_file
from werkzeug.utils import secure_filename

from app.paths import DATA_ROOT


LAMP_PAYMENT_IMAGE_DIR = DATA_ROOT / "lamp_paymet_images"
os.makedirs(LAMP_PAYMENT_IMAGE_DIR, exist_ok=True)


def save_payment_upload(payment_id, upload):
    filename = secure_filename(upload.filename)
    save_name = f"{payment_id}_{filename}"
    save_path = LAMP_PAYMENT_IMAGE_DIR / save_name
    upload.save(save_path)
    return str(save_path)


def remove_payment_file(file_path):
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass


def send_payment_file(payment):
    if not payment:
        abort(404, description="找不到 payment")
    if not payment.doc_path:
        abort(404, description="该付款没有上传凭证")
    if not os.path.exists(payment.doc_path):
        abort(404, description="文件不存在")

    try:
        return send_file(
            payment.doc_path,
            as_attachment=False,
            download_name=os.path.basename(payment.doc_path),
        )
    except Exception as exc:
        return jsonify({"status": "error", "message": "无法读取文件", "error": str(exc)}), 500
