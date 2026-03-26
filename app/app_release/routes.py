import os

from flask import Blueprint, jsonify, send_from_directory

from pathlib import Path

app_release_bp = Blueprint("app_release", __name__)

APK_DIR = Path("/home/yukang/flaskapp/xinya/frontend/apk")


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} GB"


@app_release_bp.get("/releases")
def list_releases():
    """Return all .apk files in frontend/apk/ with metadata."""
    if not APK_DIR.is_dir():
        return jsonify({"releases": []})

    releases = []
    for entry in sorted(APK_DIR.iterdir()):
        if entry.suffix.lower() != ".apk":
            continue
        stat = entry.stat()
        releases.append(
            {
                "filename": entry.name,
                "size_bytes": stat.st_size,
                "size_label": _human_size(stat.st_size),
                "download_url": f"/api/app/download/{entry.name}",
            }
        )

    # Newest first (by mtime)
    releases.sort(key=lambda r: APK_DIR.joinpath(r["filename"]).stat().st_mtime, reverse=True)
    return jsonify({"releases": releases})


@app_release_bp.get("/download/<filename>")
def download_apk(filename: str):
    """Serve a single APK file as an attachment download."""
    # Prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        return jsonify({"error": "invalid filename"}), 400
    if not filename.lower().endswith(".apk"):
        return jsonify({"error": "not an apk"}), 400

    return send_from_directory(
        str(APK_DIR),
        filename,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.android.package-archive",
    )
