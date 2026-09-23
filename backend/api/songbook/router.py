"""歌本：列表 / 详情 / 个人编辑版 / 管理端增删 / docx 导入。

原 backend/app/songbook/routes.py（Flask Blueprint，挂在 /api/songbook）。
只做框架适配 —— 校验顺序、状态码、错误文案、响应体的键名与嵌套形状逐字照搬，
前端按 entries / entry / versions / active_version* 这些键分支，改一个键就是线上故障。
原文件没有 services.py，全部逻辑本来就住在 routes.py 里，所以这里也只有一个 router.py。

URL 变化（BASE_PATH 由 nginx 剥掉，应用内部一律写裸路径；/api 这一段整体去掉）：

    /api/songbook/list                        → /songbook/list
    /api/songbook/entry/<int:id>              → /songbook/entry/{entry_id:int}
    /api/songbook/entry/<int:id>/my_edit      → /songbook/entry/{entry_id:int}/my_edit   (POST/DELETE)
    /api/songbook/entry                       → /songbook/entry                          (POST)
    /api/songbook/entry/<int:id>              → /songbook/entry/{entry_id:int}           (DELETE)
    /api/songbook/import_docx                 → /songbook/import_docx

★ 四处「看起来该改、但故意保留」的地方：

  ① ``import_docx`` 里的 ``if not docx_path`` 是**死代码**：``Path("")`` 求值出来是
     ``PosixPath('.')``，而 Path 没有 ``__bool__``，恒为真。所以前端不传 path 时
     走不到 400「缺少 path」，而是落到下面的 ``is_file()`` 判断回 404「docx 文件不存在」。
     TODO(行为 bug，勿顺手修): 想修的话要先确认没有前端在按 404 这条分支做提示。

  ② ``import_docx`` 接受的是**服务器本地绝对路径**，带 music_edit 权限的账号可以让进程
     去读任意一个 .docx（读不到 zip 结构会抛异常 → 500）。这是原行为，不在本次迁移范围内。
     TODO(安全): 收口时应改成只允许 DATA_ROOT 下的相对路径。

  ③ ``/list`` 对每一条歌曲都会跑一次 override 查询 + 一次 ``User.query.get``（N+1）。
     照搬，不做批量化：一旦合并查询，``_apply_version`` 在「override 存在但 User 行已删」
     这种情况下的取值就会和现在不一样（见 ④）。

  ④ ``_apply_version`` / ``_list_versions`` 里的 ``.join(User, ...)`` 决定了
     **User 行被删掉之后，那条 override 就查不出来了**，于是接口表现成「回到原版」。
     后面 ``if user else`` 那段 f"用户 {id}" 的兜底因此实际上是走不到的死分支 —— 一起照抄。

★ 三条迁移硬约束（违反会启动即失败或线上事故）：

  ① 本文件**不能写 ``from __future__ import annotations``**：core.auth 的装饰器用
     functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了那一行会在那里找不到 ``Optional`` 而启动即 NameError。详见
     api/permission_mgmt/router.py 顶部那段。

  ② 路由函数一律 ``def``（同步）：底下是同步 ORM 查询 + commit + zipfile 读盘，
     写成 async def 会把 worker 的事件循环焊死。FastAPI 会自动把 def 丢线程池。

  ③ 装饰器顺序保持 Flask 原样：``@login_required`` 在外、``@permission_required`` 在内。
     顺序反过来会把「未登录」的响应从 401 变成 permission_required 的 500（契约 2），
     前端的重新登录跳转就失效了。

★ 与 Flask 的已知差异（都不构成前端可见的行为变更）：
  · 原代码用的是 ``request.get_json()``（**没有** silent=True），Flask 在 body 不是合法
    JSON / Content-Type 不对时抛 400 或 415 的 **HTML 错误页**；这里落到 FastAPI 的 422
    JSON。两边前端都解析不出业务字段，等价。
  · 路径参数写 ``{entry_id:int}`` 而不是靠注解转换：Flask 的 ``<int:entry_id>`` 在参数
    不是整数时是**不匹配**（→404），靠注解转换的话会变成 422，前端的 404 分支会失效。
"""

import re
from collections import OrderedDict
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from fastapi import APIRouter, Body
from sqlalchemy import or_

from backend.core.auth import (
    current_user,
    get_current_user_permissions,
    login_required,
    permission_required,
)
from backend.core.config import settings
from backend.core.db import db
from backend.core.responses import json_response
from backend.models.songbook import SongbookEntry, normalize_song_text
from backend.models.songbook_user_edit import SongbookUserEdit
from backend.models.user_data import User

# prefix 用 settings.api_prefix 拼而不是写死：api_prefix 今天是空串（BASE_PATH 已经区分了
# 项目，再套一层 /api 不带信息量），但配置项留着就是为了需要时还能整体加回来。
# ★ 挂在 /music 下：歌本、音频库、唱游房间是同一个域的三块
#   （房间推的就是 SongbookEntry，歌本条目现在也能关联 Music）。
#   原地址是 /songbook/*，v3 起是 /music/songbook/*。
router = APIRouter(prefix=f"{settings.api_prefix}/music/songbook", tags=["music:songbook"])

DOCX_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
TITLE_RE = re.compile(r"^(?P<number>\d+)\.\s*(?P<title>.+?)\s*$")
META_RE = re.compile(
    r"原调[:：]\s*(?P<original>[^\s]+)?\s*选调[:：]\s*(?P<selected>[^\s]+)?\s*BPM[:：]\s*(?P<bpm>[^\s|]+)?\s*(?P<time>\|[^|]+\|)?"
)
SKIP_HEADINGS = {"目录", "Chord"}

# 对应 Flask 的 ``request.get_json() or {}``：不带 embed，所以前端发的整个 JSON 体
# 原样进到这个参数；没有 body 时落到 None，路由里 ``payload or {}`` 补成空字典，
# 后面的校验分支自然会回 400 —— 与 Flask 时代一致。
_JSON_BODY = Body(default=None)


def _int_arg(raw):
    """对应 Flask 的 ``request.args.get(name, type=int)``。

    关键是「转不动就当没传」：Flask 转换失败时静默回 default(None)，而把参数直接声明成
    ``Optional[int]`` 会让 ``?editor_user_id=abc`` 变成 422。查询参数一律声明成 str
    再在这里手工转，就是为了守住这个分支。
    注意 ``"0"`` 要转成 0 而不是 None —— 0 会走 ``editor_user_id is not None`` 那一支
    （查不到 override，最终回原版），与 Flask 一致。
    """
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _is_truthy_flag(raw):
    """对应 ``str(request.args.get(k) or "").lower() in {"1","true","yes"}``。

    只认这三个字面量："on" / "TRUE " 之类都是假。照抄，别扩表 —— 前端可能正靠
    「传了别的值等于没传」来临时关掉这个开关。
    """
    return str(raw or "").lower() in {"1", "true", "yes"}


def _current_user_can_view_unpublished():
    if not current_user.is_authenticated:
        return False
    try:
        return "music_edit" in get_current_user_permissions(current_user)
    except Exception:
        # 读权限炸了当成「没权限」而不是 500：未发布歌曲本来就是可选内容，
        # 宁可少给也不要整页挂掉。
        return False


def _serialize_entry(entry, include_content=False):
    data = entry.to_dict(include_content=include_content)
    # 这六个键**恒存在**（哪怕是 null），前端不用写 if 判断有没有。
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
        # 显式要原版：直接跳过 override 查询（哪怕同时传了 editor_user_id）。
        override = None
    elif editor_user_id is not None:
        override = (
            SongbookUserEdit.query.join(User, User.id == SongbookUserEdit.user_id)
            .filter(SongbookUserEdit.base_entry_id == entry.id, SongbookUserEdit.user_id == editor_user_id)
            .first()
        )
    elif current_user.is_authenticated:
        # 没指定版本时默认看**自己的**编辑版；未登录就一直是原版。
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
        # has_user_override 问的是「当前正在看的这个版本是不是我自己的」，
        # 不是「我有没有编辑版」—— 看别人的版本时这里是 False，前端据此决定显不显示「保存」。
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
            # 注意：base 那一项**没有** is_me 键（不是 None，是根本没有）。
            # 前端读的是 undefined，照搬，别补齐。
            "is_me": current_user.is_authenticated and item.user_id == current_user.id,
        })
    return versions


def _parse_heading(raw_heading, variant):
    heading = str(raw_heading or "").strip()
    match = TITLE_RE.match(heading)
    song_number = int(match.group("number")) if match else None
    title = match.group("title").strip() if match else heading
    # G 调版的标题在 Word 里是「12. 某某 G」，尾巴那个 G 是调号不是歌名的一部分。
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
                # Heading2 只用来**结束**上一首（它是歌内的小标题，不开新歌）。
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
            # 元信息只可能在正文第一行（「原调:C 选调:G BPM:72 |4/4|」），
            # 匹配不上就整首当纯歌词，不往下找。
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
            # 没编号的排最后；乘 10 是给同号的 C/G 两版留出插空位
            # （models/songbook.py 的 sync_search_fields 会给 G 版 +1）。
            sort_order=((song_number or 999999) * 10),
        )
        entry.sync_search_fields()
        entries.append(entry)
    return entries


def _query_entries(q, variant, include_unpublished=False):
    """原来直接读 ``request.args``，这里改成入参。

    取值口径与 Flask 完全一致：``str(x or "").strip()``，多值时取第一个。
    """
    query = SongbookEntry.query
    if not include_unpublished:
        query = query.filter_by(published=True)

    q = str(q or "").strip()
    variant = str(variant or "").strip().upper()
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
        # 只认 C/G，其它值（含空）当成「不过滤」而不是「查不到」。
        query = query.filter_by(variant=variant)

    return query.order_by(SongbookEntry.sort_order.asc(), SongbookEntry.id.asc())


@router.get("/list")
def list_songbook_entries(q: str = "", variant: str = "", include_unpublished: str = ""):
    unpublished = _is_truthy_flag(include_unpublished)
    if unpublished and not _current_user_can_view_unpublished():
        return json_response({"error": "没有权限查看未发布歌曲"}, status_code=403)
    entries = _query_entries(q, variant, include_unpublished=unpublished).all()
    return json_response({"entries": [_apply_version(entry, include_content=False) for entry in entries]})


@router.get("/entry/{entry_id:int}")
def get_songbook_entry(
    entry_id: int,
    include_unpublished: str = "",
    editor_user_id: str = "",
    version_kind: Optional[str] = None,
):
    entry = SongbookEntry.query.get_or_404(entry_id)
    unpublished = _is_truthy_flag(include_unpublished)
    if unpublished and not _current_user_can_view_unpublished():
        return json_response({"error": "没有权限查看未发布歌曲"}, status_code=403)
    if not entry.published and not unpublished:
        # 未发布的歌对普通用户「等于不存在」：回 404 而不是 403，
        # 别让状态码本身泄露有这么一首歌。
        return json_response({"error": "歌曲不存在"}, status_code=404)
    data = _apply_version(
        entry,
        include_content=True,
        editor_user_id=_int_arg(editor_user_id),
        version_kind=version_kind,
    )
    data["versions"] = _list_versions(entry)
    return json_response({"entry": data})


@router.post("/entry/{entry_id:int}/my_edit")
@login_required
def save_my_songbook_edit(entry_id: int, payload: Optional[dict] = _JSON_BODY):
    entry = SongbookEntry.query.get_or_404(entry_id)
    data = payload or {}
    # rstrip 而不是 strip：歌词开头的缩进是有意义的（和弦对位），只去掉尾部空白。
    content = str(data.get("content") or "").rstrip()
    if not content:
        return json_response({"error": "内容不能为空"}, status_code=400)
    override = SongbookUserEdit.query.filter_by(base_entry_id=entry.id, user_id=current_user.id).first()
    if override is None:
        override = SongbookUserEdit(base_entry_id=entry.id, user_id=current_user.id, content=content)
        db.session.add(override)
    else:
        override.content = content
    db.session.commit()
    # 这里的 data 被原代码复用成了「响应用的 entry 字典」（上面的请求体 data 已经用完）。
    # 照搬变量名，别为了可读性改 —— 下面 return 的形状与它强绑定。
    data = _apply_version(entry, include_content=True, editor_user_id=current_user.id)
    data["versions"] = _list_versions(entry)
    return json_response({"success": True, "entry": data, "override": override.to_dict()})


@router.delete("/entry/{entry_id:int}/my_edit")
@login_required
def delete_my_songbook_edit(entry_id: int):
    entry = SongbookEntry.query.get_or_404(entry_id)
    override = SongbookUserEdit.query.filter_by(base_entry_id=entry.id, user_id=current_user.id).first()
    if override:
        db.session.delete(override)
        db.session.commit()
    # 本来就没有编辑版时也回 success:True（幂等），前端连点两次不会看见报错。
    data = _apply_version(entry, include_content=True)
    data["versions"] = _list_versions(entry)
    return json_response({"success": True, "entry": data})


@router.post("/entry")
@login_required
@permission_required("music_edit")
def save_songbook_entry(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    entry_id = data.get("id")
    title = str(data.get("title") or "").strip()
    content = str(data.get("content") or "").strip()
    variant = str(data.get("variant") or "C").strip().upper()
    # 校验顺序照搬：variant 在 title / content 之前。同时缺两样时前端拿到的是
    # variant 那条文案，改顺序等于改文案。
    if variant not in {"C", "G"}:
        return json_response({"error": "variant 只能是 C 或 G"}, status_code=400)
    if not title:
        return json_response({"error": "歌名不能为空"}, status_code=400)
    if not content:
        return json_response({"error": "内容不能为空"}, status_code=400)

    entry = SongbookEntry.query.get(entry_id) if entry_id else SongbookEntry()
    if entry_id and not entry:
        return json_response({"error": "歌曲不存在"}, status_code=404)

    song_number_raw = data.get("song_number")
    try:
        song_number = int(song_number_raw) if song_number_raw not in (None, "") else None
    except (TypeError, ValueError):
        return json_response({"error": "song_number 必须是数字"}, status_code=400)

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
    # 默认发布：前端的新建表单不传这个字段。
    entry.published = bool(data.get("published", True))
    sort_order_raw = data.get("sort_order")
    try:
        entry.sort_order = int(sort_order_raw) if sort_order_raw not in (None, "") else 0
    except (TypeError, ValueError):
        # 注意这一条 400 发生在上面那一堆赋值**之后**：对已存在的歌，entry 上的字段
        # 已经被改过了。因为没 commit 且随后会话回滚，DB 不受影响 —— 照搬，别提前校验。
        return json_response({"error": "sort_order 必须是数字"}, status_code=400)
    entry.sync_search_fields()

    db.session.add(entry)
    db.session.commit()
    data = _apply_version(entry, include_content=True)
    data["versions"] = _list_versions(entry)
    return json_response({"success": True, "entry": data})


@router.delete("/entry/{entry_id:int}")
@login_required
@permission_required("music_edit")
def delete_songbook_entry(entry_id: int):
    entry = SongbookEntry.query.get_or_404(entry_id)
    # 用户的编辑版靠外键 ON DELETE CASCADE 一起删（见 models/songbook_user_edit.py）。
    db.session.delete(entry)
    db.session.commit()
    return json_response({"success": True})


@router.post("/import_docx")
@login_required
@permission_required("music_edit")
def import_songbook_docx(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    docx_path = Path(str(data.get("path") or "").strip())
    replace_existing = bool(data.get("replace_existing", False))
    # ★ 这一行是死代码：Path("") == PosixPath('.')，恒为真。见模块头 ①。不修。
    if not docx_path:
        return json_response({"error": "缺少 path"}, status_code=400)
    if not docx_path.exists() or not docx_path.is_file():
        return json_response({"error": "docx 文件不存在"}, status_code=404)

    sections = _extract_docx_sections(docx_path)
    entries = _sections_to_entries(sections, str(docx_path))
    if not entries:
        # 先解析、确认有货，再决定要不要清库 —— 顺序反了会出现「解析失败但歌全没了」。
        return json_response({"error": "没有解析到歌曲"}, status_code=400)

    if replace_existing:
        # 全量替换：用户的个人编辑版也一起清掉（它们的 base_entry_id 马上就要失效了）。
        SongbookUserEdit.query.delete()
        SongbookEntry.query.delete()
        db.session.commit()

    saved = 0
    updated = 0
    cache = OrderedDict()
    for existing in SongbookEntry.query.all():
        # 去重键是 (编号, 归一化标题, 调式) —— 只按标题会让同名的 C/G 两版互相覆盖。
        cache[(existing.song_number, existing.title_normalized, existing.variant)] = existing

    for item in entries:
        key = (item.song_number, item.title_normalized, item.variant)
        existing = cache.get(key)
        if existing:
            # 逐字段覆盖而不是 delete+insert：保住 id，用户挂在上面的编辑版才不会断链。
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
            # 塞回 cache：同一份 docx 里出现两条同键的歌时，第二条会走 update 分支，
            # 不会插出重复行。
            cache[key] = item
            saved += 1

    db.session.commit()
    return json_response({"success": True, "saved": saved, "updated": updated, "total": len(entries), "source_doc": str(docx_path)})
