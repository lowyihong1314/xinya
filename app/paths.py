import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_ROOT = PROJECT_ROOT / "static"
TEMPLATE_ROOT = PROJECT_ROOT / "templates"

# 所有用户上传的文件都要落在 DATA_ROOT 里，不能写进 PROJECT_ROOT（static/ 等）。
# 写进仓库目录的话，deploy 时 git pull / checkout 会把这些文件删掉或覆盖掉。
DATA_ROOT = Path(os.environ.get("XINYA_DATA_ROOT") or "/srv/flaskapp/xinya/database")

# nginx: location /media_file/ { alias /srv/flaskapp/xinya/database/; }
# 找不到文件时 fallback 给 Flask 的 media_file 蓝图（app/media/routes.py）。
MEDIA_URL_PREFIX = "/media_file"


def data_dir(*parts):
    """取 DATA_ROOT 下的子目录（自动创建）。"""
    path = DATA_ROOT.joinpath(*[str(part) for part in parts])
    path.mkdir(parents=True, exist_ok=True)
    return path


def data_media_url(*parts):
    """DATA_ROOT 下的文件对应的公开 URL。"""
    tail = "/".join(str(part).strip("/") for part in parts if str(part).strip("/"))
    return f"{MEDIA_URL_PREFIX}/{tail}"
