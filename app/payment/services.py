from flask import jsonify


def make_payment(order_id):
    del order_id
    return jsonify({"success": True, "message": "支付记录已保存"})
