import os

from app.paths import DATA_ROOT, STATIC_ROOT

DATA_PATH = str(DATA_ROOT)
STATIC_PATH = str(STATIC_ROOT)
BROKEN_IMAGE_PATH = os.path.join(STATIC_PATH, "images", "file_icon", "broken-image.png")


def abs_data_path(*parts):
    return os.path.join(DATA_PATH, *parts)


def event_photo_base_dir(event_code):
    return abs_data_path("NAS", "UTBA", "event_photo", event_code)


def event_photo_cache_dir(event_code):
    return abs_data_path("CACHE", "UTBA", "event_photo", event_code)


def event_photo_mp4_dir(event_code):
    return abs_data_path("MP4", "UTBA", "event_photo", event_code)


def to_short_data_path(full_path):
    return full_path.replace(DATA_PATH + os.sep, "", 1)
