"""头像目录 + 缩图，以及两个 DNS 辅助（原 backend/app/user_control/utils.py，逐字平移）。

只改了一处：包内 import 的路径。函数体一个字没动。

★ ``get_dns_record`` / ``is_local_ip`` 在**全仓库零调用点**（已 grep）。
  照搬过来而不是顺手删，是因为「搬迁」和「清理」混在一起做，出了问题就分不清
  是谁弄的。TODO(清理): 确认没有外部脚本 import 它们之后，连同 _token 的
  CLOUDFLARE 三个常量一起删掉 —— 留着等于让一个不用的模块常驻两个密钥。

★ ``os.makedirs(PROFILE_PATH, exist_ok=True)`` 是 **import 期副作用**，也照搬：
  头像目录必须在第一次上传之前就存在，而 generate_resized_image 里的
  ``img.save()`` 不会自己建目录。挪到函数里的话，第一个上传的人会拿到 500。
"""

import ipaddress
import json
import os
import subprocess

from PIL import Image

from _token import API_TOKEN, RECORD_NAME, ZONE_ID
from backend.core.paths import DATA_ROOT

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
