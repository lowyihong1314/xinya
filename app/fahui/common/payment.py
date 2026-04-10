from __future__ import annotations

import os
from pathlib import Path

from flask import abort, jsonify, send_file
from werkzeug.utils import secure_filename


DEFAULT_PAYMENT_UPLOAD_EXTENSIONS = frozenset({"pdf", "png", "jpg", "jpeg"})
PAYMENT_TYPE_LAMP = "lamp"
PAYMENT_TYPE_YLP = "ylp"
PAYMENT_STATUS_ALIASES = {
    "approve": "approved",
    "approved": "approved",
    "reject": "rejected",
    "rejected": "rejected",
    "panding": "pending",
}


def is_allowed_payment_upload(
    filename: str | None,
    *,
    allowed_extensions: set[str] | frozenset[str] = DEFAULT_PAYMENT_UPLOAD_EXTENSIONS,
) -> bool:
    return bool(
        filename
        and "." in filename
        and filename.rsplit(".", 1)[1].lower() in allowed_extensions
    )


def normalize_payment_status(
    value: str | None,
    *,
    aliases: dict[str, str] | None = None,
    default: str = "pending",
) -> str:
    text = (value or "").strip().lower()
    if aliases:
        text = aliases.get(text, text)
    return text or default


def normalize_fahui_payment_status(value: str | None, *, default: str = "pending") -> str:
    return normalize_payment_status(value, aliases=PAYMENT_STATUS_ALIASES, default=default)


def build_payment_review_state(
    *,
    raw_status: str | None = None,
    reviewer: object = None,
    aliases: dict[str, str] | None = None,
    approved_status: str = "approved",
    pending_status: str = "pending",
) -> dict:
    reviewer_present = reviewer not in (None, "", 0)
    fallback_status = approved_status if reviewer_present else pending_status
    status = normalize_payment_status(
        raw_status,
        aliases=aliases,
        default=fallback_status,
    )
    return {
        "status": status,
        "is_approved": status == approved_status,
    }


def resolve_payment_path(file_path: str | None, search_roots: list[Path] | tuple[Path, ...]) -> Path | None:
    if not file_path:
        return None

    candidate = Path(file_path)
    if candidate.is_absolute() and candidate.exists():
        return candidate

    for root in search_roots:
        resolved = root / candidate
        if resolved.exists():
            return resolved
        fallback = root / candidate.name
        if fallback.exists():
            return fallback
    return None


def save_payment_upload(
    upload,
    *,
    save_dir: Path,
    save_name: str,
    return_relative_dir: Path | None = None,
) -> str:
    save_dir.mkdir(parents=True, exist_ok=True)
    save_path = save_dir / save_name
    upload.save(save_path)
    if return_relative_dir is not None:
        return str(return_relative_dir / save_name)
    return str(save_path)


def remove_payment_file(file_path: str | None, *, search_roots: list[Path] | tuple[Path, ...]) -> None:
    resolved_path = resolve_payment_path(file_path, search_roots)
    if resolved_path and resolved_path.exists():
        try:
            os.remove(resolved_path)
        except Exception:
            pass


def send_payment_file(
    payment,
    *,
    file_attr: str,
    search_roots: list[Path] | tuple[Path, ...],
    missing_payment_message: str = "找不到 payment",
    missing_document_message: str = "该付款没有上传凭证",
):
    if not payment:
        abort(404, description=missing_payment_message)

    file_path = getattr(payment, file_attr, None)
    if not file_path:
        abort(404, description=missing_document_message)

    resolved_path = resolve_payment_path(file_path, search_roots)
    if not resolved_path:
        abort(404, description="文件不存在")

    try:
        return send_file(
            resolved_path,
            as_attachment=False,
            download_name=resolved_path.name,
        )
    except Exception as exc:
        return jsonify({"status": "error", "message": "无法读取文件", "error": str(exc)}), 500
