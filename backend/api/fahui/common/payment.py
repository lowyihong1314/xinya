"""法会付款的共用小工具：上传落盘、文件定位、审核状态归一。

原 backend/app/fahui/common/payment.py。lamp 与 YLP 两边共用，所以这里既不认
订单也不认登记，只认「一个上传对象」和「一条付款记录」。

── 搬迁时动过的四处（业务逻辑一个字没改）───────────────────────────
  · ``flask.abort(404, description=X)`` → ``fastapi.HTTPException(404, detail=X)``。
    响应体由 main.py 注册在 StarletteHTTPException 上的处理器渲染成
    ``{"status": "error", "message": X}`` —— 和 Flask 那边的 JSON 错误处理器一致。
  · ``flask.send_file(...)`` → api/fahui/downloads.py 里那份**同名复刻**
    （Content-Disposition / Cache-Control / ETag 都对拍过，调用行一个字没改）。
  · ``jsonify(x), 500`` → ``json_response(x, 500)``。
  · 原文件 import 了 ``werkzeug.utils.secure_filename`` 但**一次都没用**，
    这里直接删掉 —— 本包不 import werkzeug（要用就取 core.files 那份逐字复刻）。

★ ``upload.save(save_path)`` 收的不再是 werkzeug 的 FileStorage，而是
  api/fahui/uploads.py 里的 UploadedFile；它把 ``.save()`` 复刻了一遍，
  所以下面这些函数体不用改。
"""

import os
from pathlib import Path

from fastapi import HTTPException

from backend.api.fahui.downloads import send_file
from backend.core.responses import json_response


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
        raise HTTPException(status_code=404, detail=missing_payment_message)

    file_path = getattr(payment, file_attr, None)
    if not file_path:
        raise HTTPException(status_code=404, detail=missing_document_message)

    resolved_path = resolve_payment_path(file_path, search_roots)
    if not resolved_path:
        raise HTTPException(status_code=404, detail="文件不存在")

    try:
        return send_file(
            resolved_path,
            as_attachment=False,
            download_name=resolved_path.name,
        )
    except Exception as exc:
        # 这个 except 在两边命中的时机不完全一样：downloads.send_file 会先 os.stat
        # （拿 ETag / Content-Length），所以「文件在 exists() 之后被删掉」这种竞态
        # 仍然落到这里回 500 JSON —— 和 Flask 一致。真正读文件的 IO 在响应发送阶段，
        # 那一段两边都不在 try 里，凭证是几十 MB 的 PDF，不能为了兜异常先读进内存。
        return json_response({"status": "error", "message": "无法读取文件", "error": str(exc)}, 500)
