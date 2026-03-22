import re
from collections import OrderedDict
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import or_

from app.auth import permission_required
from models import db
from models.songbook import SongbookEntry, normalize_song_text
from models.songbook_user_edit import SongbookUserEdit
from models.user_data import User

songbook_bp = Blueprint("songbook_bp", __name__)

DOCX_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
TITLE_RE = re.compile(r"^(?P<number>\d+)\.\s*(?P<title>.+?)\s*$")
META_RE = re.compile(
    r"原调[:：]\s*(?P<original>[^\s]+)?\s*选调[:：]\s*(?P<selected>[^\s]+)?\s*BPM[:：]\s*(?P<bpm>[^\s|]+)?\s*(?P<time>\|[^|]+\|)?"
)
SKIP_HEADINGS = {"目录", "Chord"}


def _serialize_entry(entry, include_content=False):
    data = entry.to_dict(include_content=include_content)
    data["active_version"] = "base"
    data["active_version_label"] = "原版"
    data["active_editor_user_id"] = None
    data["active_editor_name"] = None
    data["has_user_override"] = False
    data["user_override_updated_at"] = None
    return data


def _apply_version(entry, include_content=False, editor_user_id=None, version_kind=None):
    data = _serialize_entry(entry, include_content=include_content)
    override = None
    if version_kind == "base":
        override = None
    elif editor_user_id is not None:
        override = (
            SongbookUserEdit.query.join(User, User.id == SongbookUserEdit.user_id)
            .filter(SongbookUserEdit.base_entry_id == entry.id, SongbookUserEdit.user_id == editor_user_id)
            .first()
        )
    elif current_user.is_authenticated:
        override = (
            SongbookUserEdit.query.join(User, User.id == SongbookUserEdit.user_id)
            .filter(SongbookUserEdit.base_entry_id == entry.id, SongbookUserEdit.user_id == current_user.id)
            .first()
        )
    if override:
        user = User.query.get(override.user_id)
        editor_name = (getattr(user, "display_name", None) or getattr(user, "username", None) or f"用户 {override.user_id}") if user else f"用户 {override.user_id}"
        data["active_version"] = "user"
        data["active_version_label"] = f"{editor_name} 的编辑版"
        data["active_editor_user_id"] = override.user_id
        data["active_editor_name"] = editor_name
        data["has_user_override"] = current_user.is_authenticated and override.user_id == current_user.id
        data["user_override_updated_at"] = override.updated_at.isoformat() if override.updated_at else None
        if include_content:
            data["content"] = override.content
    return data


def _list_versions(entry):
    versions = [{
        "kind": "base",
        "label": "原版",
        "user_id": None,
        "editor_name": None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }]
    overrides = (
        SongbookUserEdit.query.join(User, User.id == SongbookUserEdit.user_id)
        .filter(SongbookUserEdit.base_entry_id == entry.id)
        .order_by(SongbookUserEdit.updated_at.desc())
        .all()
    )
    for item in overrides:
        user = User.query.get(item.user_id)
        editor_name = (getattr(user, "display_name", None) or getattr(user, "username", None) or f"用户 {item.user_id}") if user else f"用户 {item.user_id}"
        versions.append({
            "kind": "user",
            "label": f"{editor_name} 的编辑版",
            "user_id": item.user_id,
            "editor_name": editor_name,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            "is_me": current_user.is_authenticated and item.user_id == current_user.id,
        })
    return versions


def _parse_heading(raw_heading, variant):
    heading = str(raw_heading or "").strip()
    match = TITLE_RE.match(heading)
    song_number = int(match.group("number")) if match else None
    title = match.group("title").strip() if match else heading
    title = re.sub(r"\s*G\s*$", "", title).strip() if variant == "G" else title.strip()
    return song_number, title


def _extract_docx_sections(docx_path):
    with ZipFile(docx_path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))

    sections = []
    current = None
    for para in root.findall(".//w:body/w:p", DOCX_NS):
        parts = []
        for node in para.iter():
            tag = node.tag.split("}")[-1]
            if tag == "t":
                parts.append(node.text or "")
            elif tag == "tab":
                parts.append("\t")
            elif tag == "br":
                parts.append("\n")
        text = "".join(parts).strip()
        if not text:
            continue

        pstyle = para.find("./w:pPr/w:pStyle", DOCX_NS)
        style = pstyle.get("{%s}val" % DOCX_NS["w"]) if pstyle is not None else ""

        if style in {"Heading1", "Heading2"}:
            if text in SKIP_HEADINGS:
                current = None
                continue
            if style != "Heading1":
                current = None
                continue
            current = {"heading": text, "variant": "C", "lines": []}
            sections.append(current)
            continue

        if current is not None:
            current["lines"].append(text)
    return sections


def _sections_to_entries(sections, source_doc):
    entries = []
    for section in sections:
        song_number, title = _parse_heading(section["heading"], section["variant"])
        lines = list(section["lines"])
        original_key = None
        selected_key = None
        bpm = None
        time_signature = None
        if lines:
            meta_match = META_RE.search(lines[0])
            if meta_match:
                original_key = (meta_match.group("original") or "").strip() or None
                selected_key = (meta_match.group("selected") or "").strip() or None
                bpm = (meta_match.group("bpm") or "").strip() or None
                time_signature = (meta_match.group("time") or "").strip() or None
        content = "\n".join(lines).strip()
        if not title or not content:
            continue
        entry = SongbookEntry(
            song_number=song_number,
            title=title,
            variant=section["variant"],
            heading_text=section["heading"],
            original_key=original_key,
            selected_key=selected_key,
            bpm=bpm,
            time_signature=time_signature,
            content=content,
            search_text="",
            source_doc=source_doc,
            published=True,
            sort_order=((song_number or 999999) * 10),
        )
        entry.sync_search_fields()
        entries.append(entry)
    return entries


def _query_entries(include_unpublished=False):
    query = SongbookEntry.query
    if not include_unpublished:
        query = query.filter_by(published=True)

    q = str(request.args.get("q") or "").strip()
    variant = str(request.args.get("variant") or "").strip().upper()
    if q:
        like = f"%{q}%"
        normalized = f"%{normalize_song_text(q)}%"
        query = query.filter(
            or_(
                SongbookEntry.title.ilike(like),
                SongbookEntry.heading_text.ilike(like),
                SongbookEntry.search_text.ilike(like),
                SongbookEntry.title_normalized.ilike(normalized),
            )
        )
    if variant in {"C", "G"}:
        query = query.filter_by(variant=variant)

    return query.order_by(SongbookEntry.sort_order.asc(), SongbookEntry.id.asc())


@songbook_bp.get("/list")
def list_songbook_entries():
    include_unpublished = str(request.args.get("include_unpublished") or "").lower() in {"1", "true", "yes"}
    entries = _query_entries(include_unpublished=include_unpublished).all()
    return jsonify({"entries": [_apply_version(entry, include_content=False) for entry in entries]})


@songbook_bp.get("/entry/<int:entry_id>")
def get_songbook_entry(entry_id):
    entry = SongbookEntry.query.get_or_404(entry_id)
    if not entry.published and not request.args.get("include_unpublished"):
        return jsonify({"error": "歌曲不存在"}), 404
    editor_user_id = request.args.get("editor_user_id", type=int)
    version_kind = request.args.get("version_kind", type=str)
    data = _apply_version(entry, include_content=True, editor_user_id=editor_user_id, version_kind=version_kind)
    data["versions"] = _list_versions(entry)
    return jsonify({"entry": data})


@songbook_bp.post("/entry/<int:entry_id>/my_edit")
@login_required
def save_my_songbook_edit(entry_id):
    entry = SongbookEntry.query.get_or_404(entry_id)
    data = request.get_json() or {}
    content = str(data.get("content") or "").rstrip()
    if not content:
        return jsonify({"error": "内容不能为空"}), 400
    override = SongbookUserEdit.query.filter_by(base_entry_id=entry.id, user_id=current_user.id).first()
    if override is None:
        override = SongbookUserEdit(base_entry_id=entry.id, user_id=current_user.id, content=content)
        db.session.add(override)
    else:
        override.content = content
    db.session.commit()
    data = _apply_version(entry, include_content=True, editor_user_id=current_user.id)
    data["versions"] = _list_versions(entry)
    return jsonify({"success": True, "entry": data, "override": override.to_dict()})


@songbook_bp.delete("/entry/<int:entry_id>/my_edit")
@login_required
def delete_my_songbook_edit(entry_id):
    entry = SongbookEntry.query.get_or_404(entry_id)
    override = SongbookUserEdit.query.filter_by(base_entry_id=entry.id, user_id=current_user.id).first()
    if override:
        db.session.delete(override)
        db.session.commit()
    data = _apply_version(entry, include_content=True)
    data["versions"] = _list_versions(entry)
    return jsonify({"success": True, "entry": data})


@songbook_bp.post("/entry")
@login_required
@permission_required("music_edit")
def save_songbook_entry():
    data = request.get_json() or {}
    entry_id = data.get("id")
    title = str(data.get("title") or "").strip()
    content = str(data.get("content") or "").strip()
    variant = str(data.get("variant") or "C").strip().upper()
    if variant not in {"C", "G"}:
        return jsonify({"error": "variant 只能是 C 或 G"}), 400
    if not title:
        return jsonify({"error": "歌名不能为空"}), 400
    if not content:
        return jsonify({"error": "内容不能为空"}), 400

    entry = SongbookEntry.query.get(entry_id) if entry_id else SongbookEntry()
    if entry_id and not entry:
        return jsonify({"error": "歌曲不存在"}), 404

    song_number_raw = data.get("song_number")
    try:
        song_number = int(song_number_raw) if song_number_raw not in (None, "") else None
    except (TypeError, ValueError):
        return jsonify({"error": "song_number 必须是数字"}), 400

    entry.song_number = song_number
    entry.title = title
    entry.variant = variant
    entry.heading_text = str(data.get("heading_text") or "").strip() or None
    entry.original_key = str(data.get("original_key") or "").strip() or None
    entry.selected_key = str(data.get("selected_key") or "").strip() or None
    entry.bpm = str(data.get("bpm") or "").strip() or None
    entry.time_signature = str(data.get("time_signature") or "").strip() or None
    entry.content = content
    entry.source_doc = str(data.get("source_doc") or "").strip() or None
    entry.published = bool(data.get("published", True))
    sort_order_raw = data.get("sort_order")
    try:
        entry.sort_order = int(sort_order_raw) if sort_order_raw not in (None, "") else 0
    except (TypeError, ValueError):
        return jsonify({"error": "sort_order 必须是数字"}), 400
    entry.sync_search_fields()

    db.session.add(entry)
    db.session.commit()
    data = _apply_version(entry, include_content=True)
    data["versions"] = _list_versions(entry)
    return jsonify({"success": True, "entry": data})


@songbook_bp.delete("/entry/<int:entry_id>")
@login_required
@permission_required("music_edit")
def delete_songbook_entry(entry_id):
    entry = SongbookEntry.query.get_or_404(entry_id)
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"success": True})


@songbook_bp.post("/import_docx")
@login_required
@permission_required("music_edit")
def import_songbook_docx():
    data = request.get_json() or {}
    docx_path = Path(str(data.get("path") or "").strip())
    replace_existing = bool(data.get("replace_existing", False))
    if not docx_path:
        return jsonify({"error": "缺少 path"}), 400
    if not docx_path.exists() or not docx_path.is_file():
        return jsonify({"error": "docx 文件不存在"}), 404

    sections = _extract_docx_sections(docx_path)
    entries = _sections_to_entries(sections, str(docx_path))
    if not entries:
        return jsonify({"error": "没有解析到歌曲"}), 400

    if replace_existing:
        SongbookUserEdit.query.delete()
        SongbookEntry.query.delete()
        db.session.commit()

    saved = 0
    updated = 0
    cache = OrderedDict()
    for existing in SongbookEntry.query.all():
        cache[(existing.song_number, existing.title_normalized, existing.variant)] = existing

    for item in entries:
        key = (item.song_number, item.title_normalized, item.variant)
        existing = cache.get(key)
        if existing:
            existing.title = item.title
            existing.heading_text = item.heading_text
            existing.original_key = item.original_key
            existing.selected_key = item.selected_key
            existing.bpm = item.bpm
            existing.time_signature = item.time_signature
            existing.content = item.content
            existing.source_doc = item.source_doc
            existing.published = True
            existing.sort_order = item.sort_order
            existing.sync_search_fields()
            updated += 1
        else:
            db.session.add(item)
            cache[key] = item
            saved += 1

    db.session.commit()
    return jsonify({"success": True, "saved": saved, "updated": updated, "total": len(entries), "source_doc": str(docx_path)})
