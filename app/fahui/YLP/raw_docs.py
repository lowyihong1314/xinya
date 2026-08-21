"""法会「原始文档」：手写单据原图存档的列表与取图。

图片放在 DATA_ROOT/fahui_raw_img/images（归档时一并生成的 INDEX.csv 带施主/电话/金额等
抽取结果）。这些单据上有姓名、电话、亡者名讳，所以不走公开的 /media_file，
改由本模块带权限地读出来。
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
from datetime import date, datetime
from pathlib import Path

from flask import send_file

from app.paths import DATA_ROOT
from models import db
from models.fahui import (
    FahuiOrder,
    FahuiOrderItem,
    FahuiRawDoc,
    FahuiRawDocFlag,
    FahuiRawDocOrder,
)

RAW_DOC_ROOT = DATA_ROOT / "fahui_raw_img"
RAW_DOC_IMAGES = RAW_DOC_ROOT / "images"
RAW_DOC_INDEX = RAW_DOC_ROOT / "INDEX.csv"
RAW_DOC_EXTRACTED = RAW_DOC_ROOT / "extracted"

ALLOWED_SUFFIXES = {".jpeg", ".jpg", ".png", ".webp", ".gif", ".heic"}
_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def _read_index() -> dict[str, dict]:
    """INDEX.csv → {文件名: 元数据}；没有这个档也能正常列图，只是少了施主等资料。"""
    if not RAW_DOC_INDEX.exists():
        return {}
    meta: dict[str, dict] = {}
    try:
        with RAW_DOC_INDEX.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                name = (row.get("文件名") or "").strip()
                if not name:
                    continue
                meta[name] = {
                    "date": (row.get("日期") or "").strip(),
                    "source": (row.get("来源目录") or "").strip(),
                    "extract": (row.get("抽取档") or "").strip(),
                    "customer": (row.get("施主") or "").strip(),
                    "phone": (row.get("电话") or "").strip(),
                    "declared_total": (row.get("申报金额") or "").strip(),
                    "review_flags": (row.get("待核项") or "").strip(),
                    "plan": (row.get("处理计划") or "").strip(),
                    "duplicate_of": (row.get("内容重复于") or "").strip(),
                }
    except Exception:  # noqa: BLE001 - 索引坏了不该让整页打不开
        return {}
    return meta


def list_raw_docs() -> dict:
    """优先读 fahui_raw_doc 表（带订单关联）；表还空着就退回扫盘 + INDEX.csv。"""
    from models.fahui import FahuiRawDoc as _Doc  # 局部导入，保持本模块可被单独引用

    rows = _Doc.query.order_by(_Doc.shot_date.desc(), _Doc.filename.desc()).all()
    if rows:
        items = []
        for row in rows:
            data = row.to_dict()
            data["date"] = data.get("date") or ""
            data["declared_total"] = "" if data["declared_total"] is None else f"{data['declared_total']:g}"
            data["review_flags"] = "" if data["review_flags"] is None else str(data["review_flags"])
            data["flags_total"] = len(data.get("flags") or [])
            items.append(data)
        return {
            "items": items,
            "total": len(items),
            "root": str(RAW_DOC_IMAGES),
            "ready": RAW_DOC_IMAGES.is_dir(),
            "source": "db",
        }

    if not RAW_DOC_IMAGES.is_dir():
        return {"items": [], "total": 0, "root": str(RAW_DOC_IMAGES), "ready": False, "source": "disk"}

    meta = _read_index()
    items = []
    for path in sorted(RAW_DOC_IMAGES.iterdir()):
        if not path.is_file() or path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue
        info = meta.get(path.name, {})
        matched_date = _DATE_RE.search(path.name)
        items.append(
            {
                "filename": path.name,
                "size": path.stat().st_size,
                "date": info.get("date") or (matched_date.group(1) if matched_date else ""),
                "source": info.get("source", ""),
                "extract": info.get("extract", ""),
                "customer": info.get("customer", ""),
                "phone": info.get("phone", ""),
                "declared_total": info.get("declared_total", ""),
                "review_flags": info.get("review_flags", ""),
                "plan": info.get("plan", ""),
                "duplicate_of": info.get("duplicate_of", ""),
                "orders": [],
            }
        )

    # 按日期倒序（新的在前），同日按文件名
    items.sort(key=lambda item: (item["date"], item["filename"]), reverse=True)
    return {"items": items, "total": len(items), "root": str(RAW_DOC_IMAGES), "ready": True, "source": "disk"}


def raw_doc_file_response(filename: str):
    """按文件名取图；只认 images/ 底下的单层文件名，挡掉路径穿越。"""
    safe_name = Path(str(filename or "")).name
    if not safe_name or safe_name != str(filename or "").strip():
        return None
    if Path(safe_name).suffix.lower() not in ALLOWED_SUFFIXES:
        return None

    target = (RAW_DOC_IMAGES / safe_name).resolve()
    try:
        target.relative_to(RAW_DOC_IMAGES.resolve())
    except ValueError:
        return None
    if not target.is_file():
        return None

    return send_file(target, conditional=True, max_age=3600)


# ---------------------------------------------------------------------------
# 入库 + 与订单对应
# ---------------------------------------------------------------------------

def _norm_phone(value) -> str:
    """统一成本地 0 开头的写法：+60123456789 / 60123456789 / 0123456789 → 0123456789。"""
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        return ""
    if digits.startswith("60") and len(digits) >= 11:
        digits = "0" + digits[2:]
    elif not digits.startswith("0"):
        digits = "0" + digits
    return digits


def _norm_name(value) -> str:
    return re.sub(r"[\s·、,，]+", "", str(value or "")).strip().lower()


def _to_date(value):
    try:
        return datetime.strptime(str(value or "").strip(), "%Y-%m-%d").date()
    except Exception:  # noqa: BLE001
        return None


def _to_decimal(value):
    text = re.sub(r"[^\d.\-]", "", str(value or ""))
    try:
        return float(text) if text else None
    except ValueError:
        return None


def _extract_payload(extract_key: str) -> dict:
    if not extract_key:
        return {}
    path = RAW_DOC_EXTRACTED / f"{extract_key}.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def sync_raw_docs_from_disk() -> dict:
    """扫描 images/ + INDEX.csv，把原始文档写进 fahui_raw_doc（按文件名 upsert）。"""
    if not RAW_DOC_IMAGES.is_dir():
        return {"created": 0, "updated": 0, "total": 0, "ready": False}

    meta = _read_index()
    existing = {row.filename: row for row in FahuiRawDoc.query.all()}
    created = updated = 0

    for path in sorted(RAW_DOC_IMAGES.iterdir()):
        if not path.is_file() or path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue
        info = meta.get(path.name, {})
        matched_date = _DATE_RE.search(path.name)
        payload = _extract_payload(info.get("extract", ""))
        order_info = payload.get("order") or {}

        doc = existing.get(path.name)
        if doc is None:
            doc = FahuiRawDoc(filename=path.name)
            db.session.add(doc)
            created += 1
        else:
            updated += 1

        doc.source = info.get("source") or None
        doc.shot_date = _to_date(info.get("date")) or _to_date(matched_date.group(1) if matched_date else "")
        doc.file_size = path.stat().st_size
        doc.sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        doc.extract_key = info.get("extract") or None
        doc.customer_name = info.get("customer") or order_info.get("customer_name") or order_info.get("name") or None
        doc.phone = _norm_phone(info.get("phone") or order_info.get("phone")) or None
        doc.declared_total = _to_decimal(info.get("declared_total") or order_info.get("total_declared"))
        try:
            doc.review_flag_count = int(info.get("review_flags") or len(payload.get("review_flags") or []))
        except (TypeError, ValueError):
            doc.review_flag_count = None
        doc.plan = (info.get("plan") or payload.get("plan") or None)
        doc.duplicate_of = info.get("duplicate_of") or None

        db.session.flush()
        _sync_doc_flags(doc, payload.get("review_flags") or [])

    db.session.commit()
    return {"created": created, "updated": updated, "total": FahuiRawDoc.query.count(), "ready": True}


def _sync_doc_flags(doc, flags) -> None:
    """抽取档里的 review_flags → fahui_raw_doc_flag。

    用文本指纹当键：抽取档重跑后同一条备注仍认得出来，已勾选的「已处理」不会被清掉；
    原档里删掉的备注也会跟着删。
    """
    seen_hashes = []
    existing = {row.text_hash: row for row in (doc.flags or [])}

    for seq, raw in enumerate(flags, start=1):
        text = str(raw or "").strip()
        if not text:
            continue
        text_hash = hashlib.sha1(text.encode("utf-8")).hexdigest()[:40]
        seen_hashes.append(text_hash)
        row = existing.get(text_hash)
        if row is None:
            db.session.add(
                FahuiRawDocFlag(raw_doc_id=doc.id, seq=seq, text=text, text_hash=text_hash)
            )
        else:
            row.seq = seq

    for text_hash, row in existing.items():
        if text_hash not in seen_hashes:
            db.session.delete(row)


def set_raw_doc_flag_resolved(doc_id: int, flag_id, resolved: bool, user=None) -> dict | None:
    doc = FahuiRawDoc.query.get(doc_id)
    if not doc:
        return None
    flag = FahuiRawDocFlag.query.filter_by(id=flag_id, raw_doc_id=doc.id).first()
    if not flag:
        raise ValueError("备注不存在")

    flag.resolved = bool(resolved)
    flag.resolved_at = datetime.utcnow() if flag.resolved else None
    flag.resolved_by_user_id = getattr(user, "id", None) if flag.resolved else None
    db.session.commit()
    db.session.refresh(doc)
    return doc.to_dict()


def _order_snapshot(version: str):
    """该版本的订单：电话/姓名/金额，用来和单据对应。"""
    orders = (
        FahuiOrder.query.filter(FahuiOrder.version == version)
        .with_entities(FahuiOrder.id, FahuiOrder.phone, FahuiOrder.customer_name, FahuiOrder.name)
        .all()
    )
    totals = dict(
        db.session.query(FahuiOrderItem.order_id, db.func.coalesce(db.func.sum(FahuiOrderItem.price), 0))
        .group_by(FahuiOrderItem.order_id)
        .all()
    )
    by_phone: dict[str, list[dict]] = {}
    by_name: dict[str, list[dict]] = {}
    for row in orders:
        entry = {
            "id": row.id,
            "names": {_norm_name(row.customer_name), _norm_name(row.name)} - {""},
            "total": float(totals.get(row.id, 0) or 0),
        }
        by_phone.setdefault(_norm_phone(row.phone), []).append(entry)
        for name in entry["names"]:
            by_name.setdefault(name, []).append(entry)
    return by_phone, by_name


def link_raw_docs_to_orders(version: str = "2026_YLP", replace_auto: bool = True) -> dict:
    """按 电话 + 姓名 + 金额 把单据对到该版本的订单上。

    一张单据可以对上多张订单（同一叠纸拆成几单），所以写进关联表而不是外键。
    手动建立的关联（match_by='manual'）不会被覆盖。
    """
    by_phone, by_name = _order_snapshot(version)
    docs = FahuiRawDoc.query.all()
    stats = {"docs": len(docs), "linked_docs": 0, "links": 0, "unlinked": 0, "by_confidence": {}}

    for doc in docs:
        # 已有的关联：自动的清掉重算，手动挂的保留
        kept_ids: set[int] = set()
        if replace_auto:
            for link in list(doc.links):
                if (link.match_by or "") != "manual":
                    db.session.delete(link)
                else:
                    kept_ids.add(link.order_id)
            db.session.flush()
            # 关系还缓存着刚删掉的对象，不 expire 的话下面会误判「已存在」而跳过重建
            db.session.expire(doc, ["links"])
        else:
            kept_ids = {link.order_id for link in doc.links}

        phone = _norm_phone(doc.phone)
        doc_name = _norm_name(doc.customer_name)
        doc_total = float(doc.declared_total) if doc.declared_total is not None else None

        candidates = by_phone.get(phone, []) if phone else []
        # 有不少单据电话栏空白、录入时统一填了预设号，导致同号下挂着一堆不相干的单；
        # 这时改用「姓名 + 金额」来认，比电话可靠。
        phone_is_useful = bool(candidates) and len(candidates) <= 12
        if not phone_is_useful and doc_name:
            candidates = by_name.get(doc_name, [])

        if not candidates:
            stats["unlinked"] += 1
            continue

        matches = []
        for candidate in candidates:
            name_hit = bool(doc_name) and any(
                doc_name == n or doc_name in n or n in doc_name for n in candidate["names"]
            )
            total_hit = doc_total is not None and abs(candidate["total"] - doc_total) < 0.01
            if name_hit and total_hit:
                matches.append((candidate, "phone_name_total", "high"))
            elif total_hit:
                matches.append((candidate, "phone_total", "medium"))
            elif name_hit:
                matches.append((candidate, "phone_name", "medium"))

        if not matches and doc_name and doc_total is not None:
            # 电话不可靠时的兜底：同名 + 金额完全相同
            same_name_total = [
                c for c in by_name.get(doc_name, []) if abs(c["total"] - doc_total) < 0.01
            ]
            if len(same_name_total) == 1:
                matches = [(same_name_total[0], "name_total", "high")]
            elif same_name_total:
                matches = [(c, "name_total", "medium") for c in same_name_total]

        if not matches and doc_name:
            same_name = by_name.get(doc_name, [])
            if len(same_name) == 1:
                matches = [(same_name[0], "name_only", "medium")]

        if not matches and len(candidates) == 1:
            # 该号码在这个版本只有一张单，直接挂上（低信心）
            matches = [(candidates[0], "phone_only", "low")]

        if not matches:
            stats["unlinked"] += 1
            continue

        # 有高信心的就只保留高信心，避免同一张图挂一堆勉强的候选
        best = min(matches, key=lambda m: {"high": 0, "medium": 1, "low": 2}[m[2]])[2]
        matches = [m for m in matches if m[2] == best]

        existing_ids = set(kept_ids)
        added = 0
        for candidate, match_by, confidence in matches:
            if candidate["id"] in existing_ids:
                continue
            db.session.add(
                FahuiRawDocOrder(
                    raw_doc_id=doc.id,
                    order_id=candidate["id"],
                    match_by=match_by,
                    confidence=confidence,
                    note=f"{version} 自动对应",
                )
            )
            existing_ids.add(candidate["id"])
            added += 1
            stats["links"] += 1
            stats["by_confidence"][confidence] = stats["by_confidence"].get(confidence, 0) + 1
        if added or kept_ids:
            stats["linked_docs"] += 1

    db.session.commit()
    return stats


def update_raw_doc_link(doc_id: int, order_id, action: str) -> dict | None:
    """审核单张单据的匹配：add=手动挂上、confirm=确认这条自动匹配、remove=解除。

    确认/手动挂的关联 match_by 记为 manual，重新扫描时不会被覆盖。
    """
    doc = FahuiRawDoc.query.get(doc_id)
    if not doc:
        return None

    try:
        order_id = int(order_id)
    except (TypeError, ValueError):
        raise ValueError("order_id 格式错误")

    link = FahuiRawDocOrder.query.filter_by(raw_doc_id=doc.id, order_id=order_id).first()

    if action == "remove":
        if link:
            db.session.delete(link)
    elif action in {"add", "confirm"}:
        if action == "add" and not FahuiOrder.query.get(order_id):
            raise ValueError("订单不存在")
        if not link:
            link = FahuiRawDocOrder(raw_doc_id=doc.id, order_id=order_id)
            db.session.add(link)
        link.match_by = "manual"
        link.confidence = "manual"
        link.note = "人工确认"
    else:
        raise ValueError("action 只能是 add / confirm / remove")

    db.session.commit()
    db.session.refresh(doc)
    return doc.to_dict()


# ---------------------------------------------------------------------------
# 「找旧单」：BytePlus 读图 + 拿单据资料去历史版本里找最像的订单
# ---------------------------------------------------------------------------

_PHONE_IN_TEXT_RE = re.compile(r"(?:\+?60|0)\d[\d\s\-]{6,12}")


def _current_ylp_version() -> str:
    return f"{datetime.now().year}_YLP"


# 表格上印着会所自己的联络电话，OCR 每张都会读到，不能当成施主电话
PRINTED_FORM_PHONES = {"0127396596", "0176076710", "0167000779"}


def _run_byteplus_ocr(path: Path) -> dict:
    """直连 BytePlus 视觉模型读这张登记单（提示词是照牌位单写的，读得到手写栏）。"""
    from .paiwei_ocr import read_paiwei_slip

    result = read_paiwei_slip(path)
    data = result.get("data") or {}

    phones, printed = [], []
    for raw in data.get("phones") or []:
        normalized = _norm_phone(raw)
        if not (9 <= len(normalized) <= 12):
            continue
        (printed if normalized in PRINTED_FORM_PHONES else phones).append(normalized)

    names = [str(name).strip() for name in (data.get("person_names") or []) if str(name).strip()]
    customer = str(data.get("customer_name") or "").strip()
    red_pen = re.sub(r"\D", "", str(data.get("red_pen_number") or ""))

    return {
        "ok": bool(result.get("ok")),
        "error": result.get("error"),
        "model": result.get("model"),
        "phones": sorted(set(phones)),
        "printed_phones": sorted(set(printed)),
        "names": names[:20],
        "customer": customer,
        "totals": [t for t in [_to_decimal(data.get("total"))] if t],
        "red_pen_number": red_pen,
        "item_count": data.get("item_count"),
        "text": str(data.get("summary") or "")[:300],
    }


def _history_snapshot(exclude_versions: set[str]):
    rows = (
        FahuiOrder.query.filter(
            ~FahuiOrder.version.in_(list(exclude_versions)),
            db.func.coalesce(FahuiOrder.status, "") != "delete",
        )
        .with_entities(
            FahuiOrder.id, FahuiOrder.version, FahuiOrder.phone,
            FahuiOrder.customer_name, FahuiOrder.name, FahuiOrder.created_at,
        )
        .all()
    )
    stats = {
        row[0]: (float(row[1] or 0), int(row[2] or 0))
        for row in db.session.query(
            FahuiOrderItem.order_id,
            db.func.coalesce(db.func.sum(FahuiOrderItem.price), 0),
            db.func.count(FahuiOrderItem.id),
        )
        .group_by(FahuiOrderItem.order_id)
        .all()
    }
    return [
        {
            "id": row.id,
            "version": row.version,
            "phone": _norm_phone(row.phone),
            "customer_name": row.customer_name or row.name or "",
            "names": {_norm_name(row.customer_name), _norm_name(row.name)} - {""},
            "total": stats.get(row.id, (0.0, 0))[0],
            "item_count": stats.get(row.id, (0.0, 0))[1],
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


def suggest_old_orders(doc_id: int, use_ocr: bool = True, limit: int = 3) -> dict | None:
    """给这张单据找「去年那张」：往年版本里按 电话 / 姓名 / 金额 / 笔数 打分，最多回 limit 张。"""
    doc = FahuiRawDoc.query.get(doc_id)
    if not doc:
        return None

    image_path = RAW_DOC_IMAGES / doc.filename
    ocr = _run_byteplus_ocr(image_path) if (use_ocr and image_path.is_file()) else {
        "ok": False, "error": "跳过 OCR", "phones": [], "totals": [], "text": ""
    }

    phones = {p for p in [_norm_phone(doc.phone)] + list(ocr.get("phones") or []) if p}
    doc_name = _norm_name(doc.customer_name) or _norm_name(ocr.get("customer"))
    ocr_names = {_norm_name(name) for name in (ocr.get("names") or [])} - {""}
    totals = [float(doc.declared_total)] if doc.declared_total is not None else []
    totals += [t for t in (ocr.get("totals") or []) if t]
    # 单据右上角红笔写的就是去年那张订单的编号，命中直接置顶
    red_pen_id = int(ocr["red_pen_number"]) if (ocr.get("red_pen_number") or "").isdigit() else None

    current = _current_ylp_version()
    candidates = _history_snapshot({current, "DELETE"})

    scored = []
    for candidate in candidates:
        score, reasons = 0, []
        if red_pen_id and candidate["id"] == red_pen_id:
            score += 80
            reasons.append(f"红笔编号 {red_pen_id}")
        if candidate["phone"] and candidate["phone"] in phones:
            score += 50
            reasons.append("电话相同")
        if doc_name and any(doc_name == n or doc_name in n or n in doc_name for n in candidate["names"]):
            score += 40
            reasons.append("姓名相同")
        elif ocr_names and any(
            any(name == n or (len(name) >= 2 and name in n) for n in candidate["names"]) for name in ocr_names
        ):
            score += 20
            reasons.append("单上人名相符")
        if totals and any(abs(candidate["total"] - t) < 0.01 for t in totals):
            score += 30
            reasons.append("金额相同")
        elif totals and any(t and abs(candidate["total"] - t) / max(t, 1) <= 0.1 for t in totals):
            score += 10
            reasons.append("金额接近")
        if score:
            scored.append({**{k: v for k, v in candidate.items() if k != "names"}, "score": score, "reasons": reasons})

    scored.sort(key=lambda item: (-item["score"], -(item["item_count"] or 0), item["id"]))
    return {
        "doc": {"id": doc.id, "filename": doc.filename, "customer": doc.customer_name, "phone": doc.phone,
                "declared_total": float(doc.declared_total) if doc.declared_total is not None else None},
        "ocr": ocr,
        "current_version": current,
        "candidates": scored[:limit],
    }


def save_uploaded_raw_docs(files) -> dict:
    """上传原始单据图：存进 images/、按内容去重、写进 fahui_raw_doc。

    不自动跑 OCR / 匹配（那要花钱且慢），上传完在页面上点「找旧单」再说。
    """
    RAW_DOC_IMAGES.mkdir(parents=True, exist_ok=True)
    existing_hashes = {
        row.sha256: row.filename for row in FahuiRawDoc.query.filter(FahuiRawDoc.sha256.isnot(None)).all()
    }

    saved, skipped = [], []
    for uploaded in files or []:
        original = Path(str(getattr(uploaded, "filename", "") or "")).name
        if not original:
            continue
        suffix = Path(original).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            skipped.append({"filename": original, "reason": "不是支持的图片格式"})
            continue

        content = uploaded.read()
        if not content:
            skipped.append({"filename": original, "reason": "文件是空的"})
            continue

        digest = hashlib.sha256(content).hexdigest()
        if digest in existing_hashes:
            skipped.append({"filename": original, "reason": f"内容与已有的《{existing_hashes[digest]}》相同"})
            continue

        # 同名不同内容：加 -1 -2 后缀，别覆盖旧档
        target = RAW_DOC_IMAGES / original
        stem, index = Path(original).stem, 1
        while target.exists():
            target = RAW_DOC_IMAGES / f"{stem}-{index}{suffix}"
            index += 1
        target.write_bytes(content)

        matched_date = _DATE_RE.search(target.name)
        doc = FahuiRawDoc(
            filename=target.name,
            source="上传",
            shot_date=_to_date(matched_date.group(1) if matched_date else ""),
            file_size=len(content),
            sha256=digest,
        )
        db.session.add(doc)
        existing_hashes[digest] = target.name
        saved.append(target.name)

    db.session.commit()
    return {"saved": saved, "skipped": skipped, "total": FahuiRawDoc.query.count()}
