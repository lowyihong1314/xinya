from ..common.payment_review import serialize_lamp_registration


def serialize_registration(registration, include_payments=True):
    return serialize_lamp_registration(registration, include_payments=include_payments)
