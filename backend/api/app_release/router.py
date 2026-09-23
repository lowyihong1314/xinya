"""APK 发布列表与下载（原 app/app_release/routes.py 的 FastAPI 版）。

对照表（旧 → 新，/api 这一段去掉；BASE_PATH 由 nginx 剥，路由表里只写裸路径）：

    GET /api/app/releases             → GET /app/releases
    GET /api/app/download/<filename>  → GET /app/download/{filename}

★ 两条路由**都不鉴权**，这是照搬现状：原 Blueprint 上没有任何 @login_required /
  @permission_required。也就是说 APK 清单和安装包今天对公网是开放的。
  迁移的价值在于行为不变，所以这里不顺手加装饰器 —— 要收口请单独立项评估
  （前端「个人中心 → 下载 APP」那条链路没有「一定带着凭据」的保证，
  贸然加鉴权的表现是「下载按钮点了没反应」）。

★ 响应体形状与 Flask 版逐键一致（前端 frontend/src/profile/react/api.ts 还在按
  ``{"releases": [...]}`` 解，错误分支按 ``data.error`` 取字符串）。所以这里用
  core.responses.json_response 直接发裸字典，**不能**套 ok()/fail() 的新信封 ——
  ok() 会多一层 data，fail() 会把 error 从字符串变成对象，两者都让前端静默解不出来。

★ 原路由层里的三个小工具（_human_size / _apk_dirs / _find_apk）没有独立的 services.py，
  它们是路由文件自带的私有函数，随着 app/app_release/routes.py 一起退场，
  所以这里是**平移**而不是「抄了一份 services」。逻辑一字未改。
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

# 不从 app.paths 取 PROJECT_ROOT：import app.paths 会先跑 app/__init__.py，
# 那里 import 了 flask_socketio。Flask 下线后那条链路迟早 import 失败，
# 而 core.config 的 PROJECT_ROOT 是同一个值（仓库根）且零依赖。
from backend.core.config import PROJECT_ROOT
from backend.core.responses import json_response
from backend.core.urls import public_url

router = APIRouter(prefix="/app", tags=["app_release"])

# 三个候选目录都留着：开发机在仓库里、生产部署在 /srv 下，哪个存在用哪个。
APK_DIR_CANDIDATES = [
    PROJECT_ROOT / "frontend" / "apk",
    Path("/home/yukang/flaskapp/xinya/frontend/apk"),
    Path("/srv/flaskapp/xinya/frontend/apk"),
]


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} GB"


def _apk_dirs():
    seen = set()
    for directory in APK_DIR_CANDIDATES:
        resolved = directory.resolve()
        if resolved in seen or not resolved.is_dir():
            continue
        seen.add(resolved)
        yield resolved


def _find_apk(filename: str):
    matches = []
    for directory in _apk_dirs():
        path = directory / filename
        if path.is_file() and path.suffix.lower() == ".apk":
            matches.append(path)
    if not matches:
        return None
    # 同名文件在多个候选目录里都存在时，取最后改动的那个（部署后以新的为准）。
    return max(matches, key=lambda path: path.stat().st_mtime)


@router.get("/releases")
def list_releases(request: Request):
    """列出 frontend/apk/ 下所有 .apk 及其元信息。

    同步 def：这里全是 iterdir/stat 这类阻塞磁盘 IO，FastAPI 会把它丢进线程池。
    """
    releases_by_name = {}
    for directory in _apk_dirs():
        for entry in directory.iterdir():
            if entry.suffix.lower() != ".apk":
                continue
            stat = entry.stat()
            current = releases_by_name.get(entry.name)
            if current and current["_mtime"] >= stat.st_mtime:
                continue
            releases_by_name[entry.name] = {
                "_mtime": stat.st_mtime,
                "filename": entry.name,
                "size_bytes": stat.st_size,
                "size_label": _human_size(stat.st_size),
                # 旧值是写死的 "/api/app/download/{name}"。这里过一遍 public_url：
                # ① 去掉 /api 那一段；② 自动补上项目前缀（BASE_PATH 为空时逐字节退化成
                # "/app/download/xxx.apk"）。前端 downloadUrl() 还会再 apiPath() 一次，
                # 而那个函数是幂等的，所以不会拼成双前缀。
                # TODO: 文件名没做 URL 编码（照搬现状）。今天的名字全是 ASCII，
                #       哪天出现带空格/中文的包名，这个链接会是坏的。
                "download_url": public_url(f"/app/download/{entry.name}", request),
            }

    releases = list(releases_by_name.values())
    # 按 mtime 倒序，顺手把私有键 pop 掉（照搬现状：sort 的 key 每个元素只调一次，
    # 所以这个写法是成立的，只是很脆）。
    releases.sort(key=lambda r: r.pop("_mtime"), reverse=True)
    return json_response({"releases": releases})


@router.get("/download/{filename}")
def download_apk(filename: str):
    """按文件名下发单个 APK（附件下载）。

    FileResponse 是流式的（分块读 + 支持 Range），8MB 的包不会整个读进内存；
    Range 支持顺带让断点续传/边下边装可用 —— 与 Flask 的 send_from_directory
    (conditional=True) 行为对齐。
    """
    # 防路径穿越。FastAPI 的 {filename} 本来就不跨 "/"，但这几行照搬 ——
    # 它挡的是 "..\\" 这类 Windows 分隔符和编码变体，删掉不省事只增风险。
    if "/" in filename or "\\" in filename or ".." in filename:
        return json_response({"error": "invalid filename"}, status_code=400)
    if not filename.lower().endswith(".apk"):
        return json_response({"error": "not an apk"}, status_code=400)

    apk_path = _find_apk(filename)
    if apk_path is None:
        return json_response({"error": "apk not found"}, status_code=404)

    # filename= 会带出 Content-Disposition: attachment（等价于 Flask 的
    # as_attachment=True + download_name）。跨域时该头已在 asgi.py 的 CORS
    # expose_headers 里放行，APK 里读得到文件名。
    return FileResponse(
        apk_path,
        filename=filename,
        media_type="application/vnd.android.package-archive",
    )


# asgi.py 里：
#     from api import app_release
#     app.include_router(app_release.router)
