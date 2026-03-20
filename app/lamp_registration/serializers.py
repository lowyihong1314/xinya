from models import db
from models.lampRegistration import Lamp


def serialize_registration(registration, include_payments=True):
    lamps = db.session.query(Lamp).filter(Lamp.registration_id == registration.id).all()
    payments = (
        registration.payments.all()
        if include_payments and hasattr(registration, "payments")
        else []
    )

    data = {
        "id": registration.id,
        "devotee_name": registration.devotee_name,
        "address": registration.address,
        "phone": registration.phone,
        "total_amount": str(registration.total_amount),
        "status": registration.status,
        "created_at": registration.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        "lamps": [
            {"lamp_type": lamp.lamp_type, "amount": str(lamp.amount), "note": lamp.note}
            for lamp in lamps
        ],
    }

    if include_payments:
        data["payments"] = [
            {
                "id": payment.id,
                "amount": str(payment.amount),
                "method": payment.method,
                "paid_at": payment.paid_at.strftime("%Y-%m-%d %H:%M:%S")
                if payment.paid_at
                else None,
                "payer_name": payment.payer_name,
                "phone": payment.phone,
                "submitter_id": payment.submitter_id,
                "created_at": payment.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                "note": payment.note,
                "doc_path": payment.doc_path,
            }
            for payment in payments
        ]

    return data
