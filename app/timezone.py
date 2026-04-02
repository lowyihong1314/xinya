from datetime import datetime, timezone
from zoneinfo import ZoneInfo


MALAYSIA_TIMEZONE = ZoneInfo("Asia/Kuala_Lumpur")


def malaysia_now():
    return datetime.now(MALAYSIA_TIMEZONE)


def malaysia_now_naive():
    return malaysia_now().replace(tzinfo=None)


def assume_utc_to_malaysia_naive(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(MALAYSIA_TIMEZONE).replace(tzinfo=None)
