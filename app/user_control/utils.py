import ipaddress
import json
import os
import subprocess

from PIL import Image

from _token import API_TOKEN, RECORD_NAME, ZONE_ID
from app.paths import DATA_ROOT

BASE_URL = f"https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records"
PROFILE_PATH = os.path.join(DATA_ROOT, "profile")

os.makedirs(PROFILE_PATH, exist_ok=True)


def get_dns_record():
    try:
        result = subprocess.check_output(
            [
                "curl",
                "-s",
                "-X",
                "GET",
                "--interface",
                "eno1",
                f"{BASE_URL}?type=A&name={RECORD_NAME}",
                "-H",
                f"Authorization: Bearer {API_TOKEN}",
                "-H",
                "Content-Type: application/json",
            ]
        )
        data = json.loads(result.decode())
        if "result" in data and data["result"]:
            record = data["result"][0]
            return record["id"], record["content"]
        return None, None
    except Exception as exc:
        print(f"❌ 获取 DNS 失败：{exc}")
        return None, None


def is_local_ip(ip):
    try:
        ip_obj = ipaddress.ip_address(ip)
        if ip_obj.is_private or ip_obj.is_loopback:
            return True

        _, dns_ip = get_dns_record()
        return bool(dns_ip and ip == dns_ip)
    except ValueError:
        return False


def generate_resized_image(img, save_path, size, quality):
    original_width, original_height = img.size
    target_width, target_height = size
    aspect_ratio = original_width / original_height

    if target_width / target_height > aspect_ratio:
        target_width = int(target_height * aspect_ratio)
    else:
        target_height = int(target_width / aspect_ratio)

    img_resized = img.resize((target_width, target_height), Image.Resampling.LANCZOS)
    img_resized.save(save_path, "JPEG", quality=quality)
