from pathlib import Path

from flask import Blueprint, jsonify, send_from_directory

from app.paths import PROJECT_ROOT

app_release_bp = Blueprint("app_release", __name__)

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
    return max(matches, key=lambda path: path.stat().st_mtime)


@app_release_bp.get("/releases")
def list_releases():
    """Return all .apk files in frontend/apk/ with metadata."""
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
                "download_url": f"/api/app/download/{entry.name}",
            }

    releases = list(releases_by_name.values())
    releases.sort(key=lambda r: r.pop("_mtime"), reverse=True)
    return jsonify({"releases": releases})


@app_release_bp.get("/download/<filename>")
def download_apk(filename: str):
    """Serve a single APK file as an attachment download."""
    # Prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        return jsonify({"error": "invalid filename"}), 400
    if not filename.lower().endswith(".apk"):
        return jsonify({"error": "not an apk"}), 400

    apk_path = _find_apk(filename)
    if apk_path is None:
        return jsonify({"error": "apk not found"}), 404

    return send_from_directory(
        str(apk_path.parent),
        apk_path.name,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.android.package-archive",
    )
