"""音乐模块的业务逻辑（原 backend/app/music/services.py）。

搬迁只动了四类东西：
  · ``flask.jsonify(d)`` / ``jsonify(d), 400``  → ``core.responses.json_response(d, status_code=400)``
  · ``flask_login.current_user``                → ``core.auth.current_user``（ContextVar 代理，同接口）
  · ``backend.models.db``                       → ``backend.core.db.db``（同一个对象，少走一层包初始化）
  · 包内 ``app.music.storage``                  → ``api.music.storage``
**其余一个字节没改** —— 校验顺序、状态码、中文文案、返回字典的键名与嵌套形状
都是前端在按着分支的契约（frontend/src/music/music_player/logic/api.ts 的 parseJson
直接读 ``error`` / ``message``，UI 又按 ``musics`` / ``album`` / ``playlist`` 这些键取值）。

★ 八处「看着像 bug、故意保留」，改之前先把这段读完：

  ① ``upload_album_cover`` 写进库的是 ``/api/music/album_cover/<file>`` —— v3 的 URL
     里**已经没有 /api 这一段**了。仍然照写，两个理由：
       · 前端根本不把它当 URL 用。musicCoverSources.ts 的 ``extractCoverFilename()``
         只取最后一段文件名，再用 ``API_ROOT`` / 生产域名自己拼（本地候选排在第一位）。
       · **生产今天还跑 Flask**，那边的 REMOTE_COVER_ROOT 就是带 /api 的。dev 改了值
         会让同一张表里新旧两种前缀并存，反而更难收。
     TODO(生产切换后): 连同 models/music.py 的 REMOTE_ALBUM_COVER_ROOT 和
     musicCoverSources.ts 的 REMOTE_COVER_ROOT 一起改，见 docs/flask_to_fastAPI/00-迁移进度.md。

  ② ``upload_music`` 的标题回退：``index < len(titles)`` → titles[index]；否则**只有单文件**
     时才用 title，多文件时用空串（→ 最终落到文件名）。所以「传 3 个文件 + 1 个 title」
     只有第一个文件…… 其实一个都不会拿到那个 title（len(files)!=1），三首全部以文件名入库。
     前端目前一次只传一个文件（api.ts:uploadMusic），走不到。保留。

  ③ ``upload_music`` 里 ``album_id`` / ``artist_id`` 是**字符串**直接塞进 Integer 列。
     传 ``album_id=abc`` 不会在这里报 400，而是 commit 时炸成 500。保留。

  ④ ``edit_album``：``str(data.get("name") or album.name).strip()`` —— 显式传
     ``{"name": ""}`` 会**悄悄回退到旧名字**，而不是回「专辑名称不能为空」。
     那条 400 只在旧名字本身也是空白时才走得到。保留。

  ⑤ ``add_one_minute`` 的 404 文案是英文 ``"Music not found"``，全模块独一份
     （其它都是中文）。保留 —— 前端可能在按这串匹配。

  ⑥ ``save_playlist`` 的 ``data.get("music_ids", [m.id for m in playlist.musics])``：
     Python 的默认参数是**及早求值**，所以即使前端传了 music_ids，那句列表推导也会先跑一遍
     （触发一次 lazy load）。纯浪费，但删了会改 lazy load 的触发时机，保留。

  ⑦ ``save_playlist_state`` 的 ``float(data.get("current_time", 0) or 0)`` 在
     ``current_time="abc"`` 时抛的是 **Python 自带的 ValueError**，被同一个
     ``except ValueError`` 接住 → 400 + 英文 ``"could not convert string to float: 'abc'"``。
     和上面几条手写的中文文案混在一起。保留。

  ⑧ ``replace_music_file`` / ``delete_music`` 的 500 文案拼了 ``str(exc)``，会把内部
     异常原文（含表名 / 路径）吐给前端。保留。TODO(安全): 收口时统一成固定文案 + 日志。

★ 一处并发缺口（不在本次范围内）：``add_one_minute`` 是「查 → 没有就 add → +1 → commit」，
  没有唯一约束以外的保护。同一用户同一首歌并发两次，后提交的那次会因为
  ``uq_music_user_play_minute_music_user`` 抛 IntegrityError → 500。原样保留。

★ 与 Flask 的已知差异（前端不可见）：
  ``list_music`` 用的 ``Query.paginate()`` 是 core.db 的垫片，``error_out=True`` 默认不变，
  页码越界仍是 404 —— 但响应体从 Flask 的 HTML 404 页变成 JSON ``{"detail": "未找到"}``。
  前端的 parseJson 两种都解析不出业务字段，等价。
"""

import os

from sqlalchemy.orm import joinedload

# current_user 从 flask_login 换成 core.auth 的 ContextVar 代理：同名同语义
# （.is_authenticated / .id），下面 11 处引用一个字不用改。
from backend.core.auth import current_user
from backend.core.db import db
from backend.core.responses import json_response
from backend.core.timezone import malaysia_now_naive
from backend.models.music import (
    Album,
    Music,
    MusicQueue,
    MusicUserPlayMinute,
    MusicUserPlayMinuteLog,
    Playlist,
    PlaylistState,
)

from .storage import (
    SUPPORTED_AUDIO_FORMATS_LABEL,
    allowed_album_image_extension,
    allowed_audio_extension,
    delete_music_cache,
    delete_music_file,
    detect_audio_mime,
    replace_music_upload,
    save_album_cover_upload,
    save_music_upload,
    stream_music_file,
)

# 注：原文件还 import 了 ``MUSIC_DIR`` 但全文没用到，跟着删（纯死 import，无行为影响）。


# ─────────────────────────── 上传 / 专辑 ───────────────────────────


def upload_music(files, album_id, artist_id, title=None, titles=None):
    if not files:
        return json_response({"error": "没有选择文件"}, status_code=400)

    titles = titles or []
    saved_items = []
    for index, file in enumerate(files):
        # ★ 不合法的文件是 **continue 而不是整批失败**，而且 index 照常往前走 ——
        #   所以 titles 的下标始终对齐「原始上传顺序」，不是「成功入库的顺序」。
        #   （werkzeug 的 FileStorage 在没选文件时是 falsy，UploadFile 恒为真；
        #     但那种 part 的 filename 是空串，allowed_audio_extension("") 也是 False，
        #     两边最终都走这条 continue，见 router.py 的 _nullable_upload 说明。）
        if not file or not allowed_audio_extension(file.filename):
            continue

        if index < len(titles):
            title_override = titles[index]
        elif len(files) == 1:
            title_override = title
        else:
            title_override = ""
        music_title = (title_override or "").strip() or file.filename
        file_name, file_path, ext = save_music_upload(file)
        music = Music(
            title=music_title,
            album_id=album_id or None,
            artist_id=artist_id or None,
            file_name=file_name,
            file_type=detect_audio_mime(ext),
            file_size=os.path.getsize(file_path),
        )
        db.session.add(music)
        saved_items.append(music)

    if not saved_items:
        # 一条都没成时不需要 rollback：走到这里说明一次 add 都没发生过。
        return json_response({"error": f"仅支持 {SUPPORTED_AUDIO_FORMATS_LABEL} 音频"}, status_code=400)

    db.session.commit()
    return json_response(
        {
            "success": True,
            "count": len(saved_items),
            "musics": [music.to_dict() for music in saved_items],
        }
    )


def get_albums():
    # 排序在 Python 里做（按专辑下所有歌的播放分钟数合计倒序），不是 SQL ——
    # 每张专辑都会触发一次 musics 的 lazy load（N+1）。照搬，别顺手改成聚合查询：
    # to_dict() 里的 album_total_minutes 用的是同一份已加载的 musics。
    albums = Album.query.all()
    albums.sort(key=lambda a: sum(m.play_minutes for m in a.musics), reverse=True)
    return json_response([album.to_dict() for album in albums])


def get_album(album_id):
    album = Album.query.get(album_id)
    if not album:
        return json_response({"error": "专辑不存在"}, status_code=404)
    return json_response(album.to_dict_full())


def upload_album_cover(album_id, file):
    album = Album.query.get(album_id)
    if not album:
        return json_response({"error": "专辑不存在"}, status_code=404)
    if not file:
        return json_response({"error": "未选择图片"}, status_code=400)

    if not allowed_album_image_extension(file.filename):
        return json_response({"error": "仅支持 JPG/PNG/GIF/WEBP 图片"}, status_code=400)

    try:
        filename = save_album_cover_upload(file, album_id)
    except Exception as exc:
        return json_response({"error": "封面压缩失败", "detail": str(exc)}, status_code=500)

    # ★ 见模块头 ①：这里写死的 /api 前缀是故意留的，前端只取最后一段文件名。
    album.cover_url = f"/api/music/album_cover/{filename}"
    db.session.commit()
    return json_response({"success": True, "cover_url": album.cover_url})


def create_album(data):
    name = str(data.get("name") or "").strip()
    if not name:
        return json_response({"error": "缺少专辑名称"}, status_code=400)

    album = Album(
        name=name,
        cover_url=data.get("cover_url"),
        description=data.get("description"),
    )
    db.session.add(album)
    db.session.commit()
    return json_response({"success": True, "id": album.id, "album": album.to_dict_full()})


def edit_album(album_id, data):
    album = Album.query.get(album_id)
    if not album:
        return json_response({"error": "专辑不存在"}, status_code=404)

    # ★ 见模块头 ④：传空串会回退到旧名字，不会报错。
    name = str(data.get("name") or album.name).strip()
    if not name:
        return json_response({"error": "专辑名称不能为空"}, status_code=400)

    album.name = name
    # 用 ``data.get(k, 旧值)`` 而不是 ``data.get(k) or 旧值``：前端可以显式传 null 清空，
    # 但**不传**这个键时保持原值。两者区别是有意的，别合并。
    album.description = data.get("description", album.description)
    album.cover_url = data.get("cover_url", album.cover_url)
    db.session.commit()
    return json_response({"success": True, "album": album.to_dict_full()})


def delete_album(album_id):
    album = Album.query.get(album_id)
    if not album:
        return json_response({"error": "专辑不存在"}, status_code=404)
    # 专辑下的歌靠 models 里的 cascade="all, delete-orphan" 一起删 ——
    # 注意**磁盘上的音频文件不会被删**（只有 delete_music 才删文件）。原行为，保留。
    db.session.delete(album)
    db.session.commit()
    return json_response({"success": True})


# ─────────────────────────── 歌曲 ───────────────────────────


def list_music(page, per_page):
    pagination = Music.query.order_by(Music.created_at.desc()).paginate(
        page=page,
        per_page=per_page,
    )
    return json_response(
        {
            "musics": [music.to_dict_full() for music in pagination.items],
            # 回的是**入参** page 而不是 pagination.page，两者在越界时会不同 ——
            # 不过越界已经被 error_out 拦成 404 了，走不到。保留。
            "page": page,
            "total_pages": pagination.pages,
            "total": pagination.total,
        }
    )


def music_detail(music_id):
    music = Music.query.get_or_404(music_id)
    return json_response(music.to_dict_full())


def download_music(music_id):
    music = Music.query.get_or_404(music_id)
    return stream_music_file(music)


def edit_music(music_id, data):
    music = Music.query.get_or_404(music_id)
    title = str(data.get("title", music.title)).strip()
    if not title:
        return json_response({"error": "歌曲标题不能为空"}, status_code=400)

    album_id = data.get("album_id", music.album_id)
    artist_id = data.get("artist_id", music.artist_id)
    music.title = title
    # 空串和 None 都当「解除归属」；0 不在这个集合里，会被当成真实 id 存下去。
    music.album_id = album_id if album_id not in ("", None) else None
    music.artist_id = artist_id if artist_id not in ("", None) else None
    db.session.commit()
    return json_response({"success": True, "music": music.to_dict_full()})


def replace_music_file(music_id, file):
    music = Music.query.get_or_404(music_id)
    if not file:
        return json_response({"error": "没有选择文件"}, status_code=400)
    if not allowed_audio_extension(file.filename):
        return json_response({"error": f"仅支持 {SUPPORTED_AUDIO_FORMATS_LABEL} 音频"}, status_code=400)

    try:
        file_name, file_path, ext = replace_music_upload(file, music.file_name)
        music.file_name = file_name
        music.file_type = detect_audio_mime(ext)
        music.file_size = os.path.getsize(file_path)
        # 换了文件一定要清 wma 转码缓存，否则还在下发旧曲子。
        delete_music_cache(music.id)
        db.session.commit()
        return json_response({"success": True, "music": music.to_dict_full()})
    except Exception as exc:
        # rollback 只回滚 DB —— 新文件已经落盘、旧文件已经被删。失败时磁盘上会留一个
        # 没人引用的孤儿文件，且**旧音频已经找不回来了**。原行为，保留。
        db.session.rollback()
        return json_response({"error": f"替换音频失败: {str(exc)}"}, status_code=500)


def delete_music(music_id):
    music = Music.query.get_or_404(music_id)
    try:
        delete_music_cache(music.id)
        delete_music_file(music.file_name)
        db.session.delete(music)
        db.session.commit()
        return json_response({"success": True})
    except Exception as exc:
        db.session.rollback()
        return json_response({"error": f"删除失败: {str(exc)}"}, status_code=500)


# ─────────────────────────── 歌单 / 队列的入参归一 ───────────────────────────


def _coerce_music_ids(raw_ids):
    """None → []；不是数组 → ValueError；元素里的空串/None 跳过，其余必须能转 int。"""
    if raw_ids is None:
        return []
    if not isinstance(raw_ids, list):
        raise ValueError("music_ids / queue_ids 必须是数组")

    music_ids = []
    for item in raw_ids:
        if item in ("", None):
            continue
        try:
            music_ids.append(int(item))
        except (TypeError, ValueError) as exc:
            raise ValueError("music_ids / queue_ids 只能包含数字") from exc
    return music_ids


def _ensure_music_ids_exist(music_ids):
    # 报错里带上缺失的 id 列表（``歌曲不存在: [3, 9]``），前端直接把这串弹出来。
    if not music_ids:
        return
    existing_ids = {
        music.id
        for music in Music.query.filter(Music.id.in_(set(music_ids))).all()
    }
    missing_ids = [music_id for music_id in music_ids if music_id not in existing_ids]
    if missing_ids:
        raise ValueError(f"歌曲不存在: {missing_ids}")


def _coerce_optional_music_id(raw_value, field_name):
    if raw_value in ("", None):
        return None
    try:
        music_id = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} 必须是数字") from exc

    if not Music.query.get(music_id):
        raise ValueError(f"{field_name} 对应歌曲不存在")
    return music_id


def _coerce_optional_playlist_id(raw_value, field_name):
    if raw_value in ("", None):
        return None
    try:
        playlist_id = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} 必须是数字") from exc

    playlist = Playlist.query.get(playlist_id)
    # 「别人的歌单」和「不存在的歌单」回同一句话：不让状态码/文案泄露别人有没有这个歌单。
    if not playlist or playlist.user_id != current_user.id:
        raise ValueError(f"{field_name} 对应歌单不存在")
    return playlist_id


# ─────────────────────────── 歌单 ───────────────────────────


def list_playlists():
    playlists = (
        Playlist.query.filter_by(user_id=current_user.id)
        .order_by(Playlist.created_at.desc())
        .all()
    )
    return json_response({"playlists": [playlist.to_dict() for playlist in playlists]})


def get_playlist(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return json_response({"error": "歌单不存在"}, status_code=404)
    return json_response({"playlist": playlist.to_dict()})


def create_playlist(data):
    name = str(data.get("name") or "").strip()
    if not name:
        return json_response({"error": "歌单名称不能为空"}, status_code=400)

    try:
        music_ids = _coerce_music_ids(data.get("music_ids"))
        _ensure_music_ids_exist(music_ids)
    except ValueError as exc:
        return json_response({"error": str(exc)}, status_code=400)

    playlist = Playlist(
        name=name,
        user_id=current_user.id,
        cover_url=data.get("cover_url"),
        description=data.get("description"),
    )
    if music_ids:
        # ⚠️ 用 ``filter(id.in_(set(...)))`` 赋值，所以歌单里的**顺序按 id 升序**，
        # 不是前端传进来的顺序，而且重复 id 会被去重。原行为，保留。
        playlist.musics = Music.query.filter(Music.id.in_(set(music_ids))).all()
    db.session.add(playlist)
    db.session.commit()
    return json_response({"success": True, "playlist": playlist.to_dict()})


def save_playlist(playlist_id, data):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return json_response({"error": "歌单不存在"}, status_code=404)

    name = str(data.get("name", playlist.name) or "").strip()
    if not name:
        return json_response({"error": "歌单名称不能为空"}, status_code=400)

    try:
        # ★ 见模块头 ⑥：默认值那句列表推导是及早求值的，传不传 music_ids 都会跑。
        music_ids = _coerce_music_ids(data.get("music_ids", [music.id for music in playlist.musics]))
        _ensure_music_ids_exist(music_ids)
    except ValueError as exc:
        return json_response({"error": str(exc)}, status_code=400)

    playlist.name = name
    playlist.cover_url = data.get("cover_url", playlist.cover_url)
    playlist.description = data.get("description", playlist.description)
    playlist.musics = Music.query.filter(Music.id.in_(set(music_ids))).all() if music_ids else []
    db.session.commit()
    return json_response({"success": True, "playlist": playlist.to_dict()})


def delete_playlist(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return json_response({"error": "歌单不存在"}, status_code=404)
    db.session.delete(playlist)
    db.session.commit()
    return json_response({"success": True})


# ─────────────────────────── 播放队列 / 播放器状态 ───────────────────────────


def get_queue_state():
    queue_state = MusicQueue.query.filter_by(user_id=current_user.id).first()
    if not queue_state:
        # 没存过时回 ``{"queue": null}`` 而不是 404 —— 前端按 null 判「第一次用」。
        return json_response({"queue": None})
    return json_response({"queue": queue_state.to_dict()})


def save_queue_state(data):
    try:
        queue_ids = _coerce_music_ids(data.get("queue_ids"))
        _ensure_music_ids_exist(queue_ids)
        current_music_id = _coerce_optional_music_id(
            data.get("current_music_id"),
            "current_music_id",
        )
    except ValueError as exc:
        return json_response({"error": str(exc)}, status_code=400)

    queue_state = MusicQueue.query.filter_by(user_id=current_user.id).first()
    if not queue_state:
        queue_state = MusicQueue(user_id=current_user.id)
        db.session.add(queue_state)

    # 队列**保留前端给的顺序**（set_queue_ids 是直接 json.dumps 列表），
    # 与上面歌单那条按 id 排序的路径不一样。不是笔误。
    queue_state.set_queue_ids(queue_ids)
    queue_state.current_music_id = current_music_id
    db.session.commit()
    return json_response({"success": True, "queue": queue_state.to_dict()})


def get_playlist_state():
    playlist_state = PlaylistState.query.filter_by(user_id=current_user.id).first()
    if not playlist_state:
        return json_response({"playlist_state": None})
    return json_response({"playlist_state": playlist_state.to_dict()})


def save_playlist_state(data):
    try:
        active_playlist_id = _coerce_optional_playlist_id(
            data.get("active_playlist_id"),
            "active_playlist_id",
        )
        current_music_id = _coerce_optional_music_id(
            data.get("current_music_id"),
            "current_music_id",
        )
        # ★ 见模块头 ⑦：float("abc") 抛的 ValueError 也会被这个 except 接住，
        #   前端拿到的是 Python 的英文报错原文。
        current_time = float(data.get("current_time", 0) or 0)
        if current_time < 0:
            current_time = 0
        state = data.get("state") or {}
        if not isinstance(state, dict):
            raise ValueError("state 必须是对象")
    except ValueError as exc:
        return json_response({"error": str(exc)}, status_code=400)

    playlist_state = PlaylistState.query.filter_by(user_id=current_user.id).first()
    if not playlist_state:
        playlist_state = PlaylistState(user_id=current_user.id)
        db.session.add(playlist_state)

    playlist_state.active_playlist_id = active_playlist_id
    playlist_state.current_music_id = current_music_id
    playlist_state.current_time = current_time
    playlist_state.was_playing = bool(data.get("was_playing", False))
    # panel_view / is_expanded 没做 bool()/白名单校验，前端传什么存什么（列是可空的）。保留。
    playlist_state.panel_view = data.get("panel_view")
    playlist_state.is_expanded = data.get("is_expanded")
    playlist_state.set_state(state)
    db.session.commit()
    return json_response({"success": True, "playlist_state": playlist_state.to_dict()})


# ─────────────────────────── 播放分钟数统计 ───────────────────────────


def add_one_minute(music_id):
    music = Music.query.get(music_id)
    if not music:
        # ★ 见模块头 ⑤：全模块唯一一句英文文案。
        return json_response({"error": "Music not found"}, status_code=404)

    user_id = current_user.id

    # 时间一律用马来西亚本地时间的 naive datetime（列是 DateTime 无时区），
    # 与 list_minute_logs 回的 ``"timezone": "Asia/Kuala_Lumpur"`` 对应。
    now = malaysia_now_naive()
    user_play_minute = MusicUserPlayMinute.query.filter_by(
        music_id=music_id,
        user_id=user_id,
    ).first()
    if not user_play_minute:
        user_play_minute = MusicUserPlayMinute(
            music_id=music_id,
            user_id=user_id,
            play_minutes=0.0,
            created_at=now,
        )
        db.session.add(user_play_minute)

    minute_log = MusicUserPlayMinuteLog(
        music_user_play_minute=user_play_minute,
        created_at=now,
    )
    db.session.add(minute_log)

    music.play_minutes += 1.0
    user_play_minute.play_minutes += 1.0
    db.session.commit()
    return json_response(
        {
            "success": True,
            "music_id": music_id,
            "user_id": user_id,
            # 回的是**这首歌所有人合计**的分钟数，不是当前用户的。前端的"总播放"就读这个。
            "play_minutes": music.play_minutes,
            "played_at": now.isoformat(),
        }
    )


def list_minute_logs(page, per_page, music_id=None, user_id=None):
    # 入参已经在 router 层按 Flask 的 ``type=int`` 语义转过一遍（转不动 → 默认值），
    # 这里再夹一次边界：page 至少 1，per_page 夹到 [1, 1000]。
    page = max(1, int(page or 1))
    per_page = min(max(1, int(per_page or 200)), 1000)

    query = MusicUserPlayMinuteLog.query.options(
        joinedload(MusicUserPlayMinuteLog.music_user_play_minute).joinedload(
            MusicUserPlayMinute.music
        ),
        joinedload(MusicUserPlayMinuteLog.music_user_play_minute).joinedload(
            MusicUserPlayMinute.user
        ),
    )

    # join 只在真要过滤时才加（joinedload 用的是自己的别名，不能拿来过滤）。
    # 注意 ``music_id=0`` / ``user_id=0`` 是 falsy → 不过滤，与 Flask 一致。
    if music_id or user_id:
        query = query.join(MusicUserPlayMinuteLog.music_user_play_minute)
    if music_id:
        query = query.filter(MusicUserPlayMinute.music_id == music_id)
    if user_id:
        query = query.filter(MusicUserPlayMinute.user_id == user_id)

    pagination = query.order_by(
        MusicUserPlayMinuteLog.created_at.desc(),
        MusicUserPlayMinuteLog.id.desc(),
    ).paginate(page=page, per_page=per_page)

    items = []
    for minute_log in pagination.items:
        user_play_minute = minute_log.music_user_play_minute
        user = user_play_minute.user if user_play_minute else None
        music = user_play_minute.music if user_play_minute else None
        items.append(
            {
                "id": minute_log.id,
                "created_at": minute_log.created_at.isoformat()
                if minute_log.created_at
                else None,
                "music_user_play_minute_id": user_play_minute.id
                if user_play_minute
                else None,
                "music_id": music.id if music else None,
                "music_title": music.title if music else None,
                "user_id": user.id if user else None,
                "username": user.username if user else None,
                "display_name": user.display_name if user else None,
            }
        )

    return json_response(
        {
            "items": items,
            "page": page,
            "per_page": per_page,
            "total_pages": pagination.pages,
            "total": pagination.total,
            # 写死的时区串（不是从 settings 读的）。前端拿它格式化 created_at。保留。
            "timezone": "Asia/Kuala_Lumpur",
        }
    )


def get_last_played_music():
    # 路由挂了 @login_required，所以这里恒为真；getattr 的兜底是原代码就有的，保留。
    user_id = getattr(current_user, "id", None)
    if not user_id:
        return json_response({"last_played": None, "timezone": "Asia/Kuala_Lumpur"})

    latest_log = (
        MusicUserPlayMinuteLog.query.join(MusicUserPlayMinuteLog.music_user_play_minute)
        .options(
            joinedload(MusicUserPlayMinuteLog.music_user_play_minute).joinedload(
                MusicUserPlayMinute.music
            ),
            joinedload(MusicUserPlayMinuteLog.music_user_play_minute).joinedload(
                MusicUserPlayMinute.user
            ),
        )
        .filter(MusicUserPlayMinute.user_id == user_id)
        .order_by(
            MusicUserPlayMinuteLog.created_at.desc(),
            MusicUserPlayMinuteLog.id.desc(),
        )
        .first()
    )

    if not latest_log:
        return json_response({"last_played": None, "timezone": "Asia/Kuala_Lumpur"})

    user_play_minute = latest_log.music_user_play_minute
    music = user_play_minute.music if user_play_minute else None
    user = user_play_minute.user if user_play_minute else None

    return json_response(
        {
            "last_played": {
                "music_user_play_minute_id": user_play_minute.id
                if user_play_minute
                else None,
                "music_id": music.id if music else None,
                "music_title": music.title if music else None,
                "user_id": user.id if user else None,
                "username": user.username if user else None,
                "display_name": user.display_name if user else None,
                # 这里是**当前用户在这首歌上**的分钟数（和 add_one_minute 回的全局值不是一回事）。
                "play_minutes": user_play_minute.play_minutes
                if user_play_minute
                else None,
                "played_at": latest_log.created_at.isoformat()
                if latest_log.created_at
                else None,
            },
            "timezone": "Asia/Kuala_Lumpur",
        }
    )
