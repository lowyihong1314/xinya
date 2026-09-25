import os

from flask import jsonify
from flask_login import current_user
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from app.timezone import malaysia_now_naive
from models import db
from models.music import (
    Album,
    Music,
    MusicQueue,
    MusicUserPlayMinute,
    MusicUserPlayMinuteLog,
    Playlist,
    PlaylistState,
    playlist_member,
    playlist_music,
)
from models.user_data import User

from .storage import (
    MUSIC_DIR,
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


def upload_music(files, album_id, artist_id, title=None, titles=None, accompaniment_file=None):
    if not files:
        return jsonify({"error": "没有选择文件"}), 400
    if accompaniment_file and accompaniment_file.filename and not allowed_audio_extension(accompaniment_file.filename):
        return jsonify({"error": f"伴奏仅支持 {SUPPORTED_AUDIO_FORMATS_LABEL} 音频"}), 400

    titles = titles or []
    saved_items = []
    for index, file in enumerate(files):
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
        return jsonify({"error": f"仅支持 {SUPPORTED_AUDIO_FORMATS_LABEL} 音频"}), 400

    # 单首上传时可以顺带带一个伴奏文件。
    if accompaniment_file and accompaniment_file.filename and len(saved_items) == 1:
        acc_name, acc_path, acc_ext = save_music_upload(accompaniment_file)
        music = saved_items[0]
        music.accompaniment_file_name = acc_name
        music.accompaniment_file_type = detect_audio_mime(acc_ext)
        music.accompaniment_file_size = os.path.getsize(acc_path)

    db.session.commit()
    return jsonify(
        {
            "success": True,
            "count": len(saved_items),
            "musics": [music.to_dict() for music in saved_items],
        }
    )


def _album_minutes_map(album_ids=None):
    # 一条聚合 SQL 算出每个专辑的总播放分钟，避免逐专辑懒加载歌曲再求和。
    query = db.session.query(Music.album_id, func.coalesce(func.sum(Music.play_minutes), 0.0)).filter(
        Music.album_id.isnot(None)
    )
    if album_ids is not None:
        album_ids = [album_id for album_id in album_ids if album_id is not None]
        if not album_ids:
            return {}
        query = query.filter(Music.album_id.in_(album_ids))
    return {album_id: float(total or 0.0) for album_id, total in query.group_by(Music.album_id).all()}


def get_albums():
    albums = Album.query.all()
    minutes_map = _album_minutes_map()
    albums.sort(key=lambda a: minutes_map.get(a.id, 0.0), reverse=True)
    return jsonify([album.to_dict(total_minutes=minutes_map.get(album.id, 0.0)) for album in albums])


def get_album(album_id):
    album = Album.query.get(album_id)
    if not album:
        return jsonify({"error": "专辑不存在"}), 404
    minutes_map = _album_minutes_map([album_id])
    data = album.to_dict(total_minutes=minutes_map.get(album_id, 0.0))
    data["music_list"] = [music.to_dict() for music in album.musics]
    return jsonify(data)


def upload_album_cover(album_id, file):
    album = Album.query.get(album_id)
    if not album:
        return jsonify({"error": "专辑不存在"}), 404
    if not file:
        return jsonify({"error": "未选择图片"}), 400

    if not allowed_album_image_extension(file.filename):
        return jsonify({"error": "仅支持 JPG/PNG/GIF/WEBP 图片"}), 400

    try:
        filename = save_album_cover_upload(file, album_id)
    except Exception as exc:
        return jsonify({"error": "封面压缩失败", "detail": str(exc)}), 500

    album.cover_url = f"/api/music/album_cover/{filename}"
    db.session.commit()
    return jsonify({"success": True, "cover_url": album.cover_url})


def create_album(data):
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "缺少专辑名称"}), 400

    album = Album(
        name=name,
        cover_url=data.get("cover_url"),
        description=data.get("description"),
    )
    db.session.add(album)
    db.session.commit()
    return jsonify({"success": True, "id": album.id, "album": album.to_dict_full()})


def edit_album(album_id, data):
    album = Album.query.get(album_id)
    if not album:
        return jsonify({"error": "专辑不存在"}), 404

    name = str(data.get("name") or album.name).strip()
    if not name:
        return jsonify({"error": "专辑名称不能为空"}), 400

    album.name = name
    album.description = data.get("description", album.description)
    album.cover_url = data.get("cover_url", album.cover_url)
    db.session.commit()
    return jsonify({"success": True, "album": album.to_dict_full()})


def _detach_music_references(music_ids):
    """删歌前先把队列 / 播放状态 / 歌单里对这些歌的引用清掉，否则外键会挡住删除。"""
    music_ids = [int(music_id) for music_id in music_ids]
    if not music_ids:
        return
    id_set = set(music_ids)

    for queue_state in MusicQueue.query.filter(MusicQueue.current_music_id.in_(music_ids)).all():
        queue_state.current_music_id = None
    for playlist_state in PlaylistState.query.filter(PlaylistState.current_music_id.in_(music_ids)).all():
        playlist_state.current_music_id = None

    # queue_json 是 JSON 文本，只能逐条读出来过滤。
    for queue_state in MusicQueue.query.all():
        queue_ids = queue_state.get_queue_ids()
        remaining = [queue_id for queue_id in queue_ids if queue_id not in id_set]
        if len(remaining) != len(queue_ids):
            queue_state.set_queue_ids(remaining)

    db.session.execute(playlist_music.delete().where(playlist_music.c.music_id.in_(music_ids)))


def delete_album(album_id):
    album = Album.query.get(album_id)
    if not album:
        return jsonify({"error": "专辑不存在"}), 404

    musics = list(album.musics)
    music_ids = [music.id for music in musics]
    file_names = []
    for music in musics:
        file_names.append(music.file_name)
        if music.accompaniment_file_name:
            file_names.append(music.accompaniment_file_name)

    try:
        _detach_music_references(music_ids)
        db.session.delete(album)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"删除专辑失败: {str(exc)}"}), 500

    # 数据库提交成功后才动磁盘，避免删了文件却留下坏记录。
    for music_id in music_ids:
        delete_music_cache(music_id)
    for file_name in file_names:
        delete_music_file(file_name)
    return jsonify({"success": True})


def list_music(page, per_page):
    pagination = (
        Music.query.options(joinedload(Music.album))
        .order_by(Music.created_at.desc())
        .paginate(page=page, per_page=per_page)
    )
    minutes_map = _album_minutes_map({music.album_id for music in pagination.items})
    return jsonify(
        {
            "musics": [
                music.to_dict_full(album_total_minutes=minutes_map.get(music.album_id, 0.0))
                for music in pagination.items
            ],
            "page": page,
            "total_pages": pagination.pages,
            "total": pagination.total,
        }
    )


def _music_full(music):
    minutes_map = _album_minutes_map([music.album_id]) if music.album_id else {}
    return music.to_dict_full(album_total_minutes=minutes_map.get(music.album_id, 0.0))


def music_detail(music_id):
    music = Music.query.get_or_404(music_id)
    return jsonify(_music_full(music))


def download_music(music_id, variant="vocal"):
    music = Music.query.get_or_404(music_id)
    return stream_music_file(music, variant=variant)


def upload_accompaniment(music_id, file):
    """上传 / 更换伴奏文件。"""
    music = Music.query.get_or_404(music_id)
    if not file:
        return jsonify({"error": "没有选择文件"}), 400
    if not allowed_audio_extension(file.filename):
        return jsonify({"error": f"仅支持 {SUPPORTED_AUDIO_FORMATS_LABEL} 音频"}), 400

    old_file_name = music.accompaniment_file_name
    try:
        file_name, file_path, ext = save_music_upload(file)
        music.accompaniment_file_name = file_name
        music.accompaniment_file_type = detect_audio_mime(ext)
        music.accompaniment_file_size = os.path.getsize(file_path)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"上传伴奏失败: {str(exc)}"}), 500

    delete_music_cache(music.id, variant="accompaniment")
    if old_file_name and old_file_name != music.accompaniment_file_name:
        delete_music_file(old_file_name)
    return jsonify({"success": True, "music": _music_full(music)})


def delete_accompaniment(music_id):
    music = Music.query.get_or_404(music_id)
    old_file_name = music.accompaniment_file_name
    if not old_file_name:
        return jsonify({"error": "这首歌没有伴奏文件"}), 404
    try:
        music.accompaniment_file_name = None
        music.accompaniment_file_type = None
        music.accompaniment_file_size = None
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"移除伴奏失败: {str(exc)}"}), 500

    delete_music_cache(music.id, variant="accompaniment")
    delete_music_file(old_file_name)
    return jsonify({"success": True, "music": _music_full(music)})


def edit_music(music_id, data):
    music = Music.query.get_or_404(music_id)
    title = str(data.get("title", music.title)).strip()
    if not title:
        return jsonify({"error": "歌曲标题不能为空"}), 400

    album_id = data.get("album_id", music.album_id)
    artist_id = data.get("artist_id", music.artist_id)
    music.title = title
    music.album_id = album_id if album_id not in ("", None) else None
    music.artist_id = artist_id if artist_id not in ("", None) else None
    db.session.commit()
    return jsonify({"success": True, "music": _music_full(music)})


def replace_music_file(music_id, file):
    music = Music.query.get_or_404(music_id)
    if not file:
        return jsonify({"error": "没有选择文件"}), 400
    if not allowed_audio_extension(file.filename):
        return jsonify({"error": f"仅支持 {SUPPORTED_AUDIO_FORMATS_LABEL} 音频"}), 400

    try:
        file_name, file_path, ext = replace_music_upload(file, music.file_name)
        music.file_name = file_name
        music.file_type = detect_audio_mime(ext)
        music.file_size = os.path.getsize(file_path)
        delete_music_cache(music.id, variant="vocal")
        db.session.commit()
        return jsonify({"success": True, "music": _music_full(music)})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"替换音频失败: {str(exc)}"}), 500


def delete_music(music_id):
    music = Music.query.get_or_404(music_id)
    file_names = [music.file_name]
    if music.accompaniment_file_name:
        file_names.append(music.accompaniment_file_name)
    try:
        # 先清掉队列 / 播放状态 / 歌单里的引用，再删记录；文件留到 commit 成功之后才删。
        _detach_music_references([music.id])
        db.session.delete(music)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"删除失败: {str(exc)}"}), 500

    delete_music_cache(music_id)
    for file_name in file_names:
        delete_music_file(file_name)
    return jsonify({"success": True})


def _coerce_music_ids(raw_ids):
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
    if not playlist or not playlist.is_member(current_user.id):
        raise ValueError(f"{field_name} 对应歌单不存在")
    return playlist_id


def _set_playlist_musics(playlist, music_ids):
    """按传入顺序设置歌单歌曲，并把顺序写进 playlist_music.position。"""
    ordered_ids = [music_id for music_id in dict.fromkeys(music_ids)]
    if not ordered_ids:
        playlist.musics = []
        db.session.flush()
        return
    by_id = {music.id: music for music in Music.query.filter(Music.id.in_(set(ordered_ids))).all()}
    ordered_ids = [music_id for music_id in ordered_ids if music_id in by_id]
    playlist.musics = [by_id[music_id] for music_id in ordered_ids]
    db.session.flush()
    for position, music_id in enumerate(ordered_ids):
        db.session.execute(
            playlist_music.update()
            .where((playlist_music.c.playlist_id == playlist.id) & (playlist_music.c.music_id == music_id))
            .values(position=position)
        )
    db.session.expire(playlist, ["musics"])


def _member_playlist_or_none(playlist_id):
    """当前用户是成员（含创建者）的歌单；不是成员就当不存在。"""
    playlist = Playlist.query.get(playlist_id)
    if not playlist or not playlist.is_member(current_user.id):
        return None
    return playlist


def list_playlists():
    # 多对多：列出当前用户是成员的所有歌单（创建者也在成员表里，旧数据由迁移补齐），
    # 再附上别人设为公开的歌单（只读）。
    playlists = (
        Playlist.query.outerjoin(playlist_member, playlist_member.c.playlist_id == Playlist.id)
        .filter((playlist_member.c.user_id == current_user.id) | (Playlist.user_id == current_user.id))
        .order_by(Playlist.created_at.desc())
        .distinct()
        .all()
    )
    mine_ids = {playlist.id for playlist in playlists}
    public_playlists = [
        playlist
        for playlist in Playlist.query.filter(Playlist.is_public.is_(True)).order_by(Playlist.created_at.desc()).all()
        if playlist.id not in mine_ids
    ]
    return jsonify(
        {
            "playlists": [playlist.to_dict(viewer_id=current_user.id) for playlist in playlists],
            "public_playlists": [playlist.to_dict(viewer_id=current_user.id) for playlist in public_playlists],
        }
    )


def get_playlist(playlist_id):
    playlist = _member_playlist_or_none(playlist_id)
    if not playlist:
        # 公开歌单谁都能看
        playlist = Playlist.query.get(playlist_id)
        if not playlist or not playlist.is_public:
            return jsonify({"error": "歌单不存在"}), 404
    return jsonify({"playlist": playlist.to_dict(viewer_id=current_user.id)})


def _resolve_member_user(data):
    """按 user_id / username / phone 找要加入的用户。"""
    user_id = data.get("user_id")
    if user_id not in ("", None):
        try:
            return User.query.get(int(user_id))
        except (TypeError, ValueError):
            return None
    handle = str(data.get("username") or data.get("phone") or "").strip()
    if not handle:
        return None
    user = User.query.filter_by(username=handle).first()
    if not user:
        user = User.query.filter_by(phone=handle).first()
    return user


def add_playlist_member(playlist_id, data):
    playlist = _member_playlist_or_none(playlist_id)
    if not playlist:
        return jsonify({"error": "歌单不存在"}), 404
    if playlist.user_id != current_user.id:
        return jsonify({"error": "只有歌单创建者可以添加成员"}), 403

    user = _resolve_member_user(data or {})
    if not user:
        return jsonify({"error": "找不到这个用户，请确认用户名或手机号"}), 404
    if playlist.is_member(user.id):
        return jsonify({"success": True, "playlist": playlist.to_dict(viewer_id=current_user.id), "already_member": True})

    playlist.members.append(user)
    db.session.commit()
    return jsonify({"success": True, "playlist": playlist.to_dict(viewer_id=current_user.id)})


def remove_playlist_member(playlist_id, user_id):
    playlist = _member_playlist_or_none(playlist_id)
    if not playlist:
        return jsonify({"error": "歌单不存在"}), 404
    try:
        target_id = int(user_id)
    except (TypeError, ValueError):
        return jsonify({"error": "user_id 必须是数字"}), 400

    is_owner = playlist.user_id == current_user.id
    if target_id != current_user.id and not is_owner:
        return jsonify({"error": "只有歌单创建者可以移除其他成员"}), 403
    if target_id == playlist.user_id:
        return jsonify({"error": "创建者不能退出自己的歌单，可以直接删除歌单"}), 400

    playlist.members = [member for member in playlist.members if member.id != target_id]
    db.session.commit()
    if target_id == current_user.id:
        return jsonify({"success": True, "left": True})
    return jsonify({"success": True, "playlist": playlist.to_dict(viewer_id=current_user.id)})


def create_playlist(data):
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "歌单名称不能为空"}), 400

    try:
        music_ids = _coerce_music_ids(data.get("music_ids"))
        _ensure_music_ids_exist(music_ids)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    playlist = Playlist(
        name=name,
        user_id=current_user.id,
        cover_url=data.get("cover_url"),
        description=data.get("description"),
        is_public=bool(data.get("is_public", False)),
    )
    owner = User.query.get(current_user.id)
    if owner:
        playlist.members.append(owner)
    db.session.add(playlist)
    db.session.flush()
    _set_playlist_musics(playlist, music_ids)
    db.session.commit()
    return jsonify({"success": True, "playlist": playlist.to_dict(viewer_id=current_user.id)})


def save_playlist(playlist_id, data):
    playlist = _member_playlist_or_none(playlist_id)
    if not playlist:
        return jsonify({"error": "歌单不存在"}), 404

    name = str(data.get("name", playlist.name) or "").strip()
    if not name:
        return jsonify({"error": "歌单名称不能为空"}), 400

    try:
        music_ids = _coerce_music_ids(data.get("music_ids", [music.id for music in playlist.musics]))
        _ensure_music_ids_exist(music_ids)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    playlist.name = name
    playlist.cover_url = data.get("cover_url", playlist.cover_url)
    playlist.description = data.get("description", playlist.description)
    if "is_public" in data:
        if playlist.user_id != current_user.id:
            return jsonify({"error": "只有歌单创建者可以设置公开"}), 403
        playlist.is_public = bool(data.get("is_public"))
    if "music_ids" in data:
        _set_playlist_musics(playlist, music_ids)
    db.session.commit()
    return jsonify({"success": True, "playlist": playlist.to_dict(viewer_id=current_user.id)})


def delete_playlist(playlist_id):
    playlist = _member_playlist_or_none(playlist_id)
    if not playlist:
        return jsonify({"error": "歌单不存在"}), 404
    if playlist.user_id != current_user.id:
        return jsonify({"error": "只有歌单创建者可以删除歌单，成员可以选择退出"}), 403
    playlist.members = []
    db.session.delete(playlist)
    db.session.commit()
    return jsonify({"success": True})


def get_queue_state():
    queue_state = MusicQueue.query.filter_by(user_id=current_user.id).first()
    if not queue_state:
        return jsonify({"queue": None})
    return jsonify({"queue": queue_state.to_dict()})


def save_queue_state(data):
    try:
        queue_ids = _coerce_music_ids(data.get("queue_ids"))
        _ensure_music_ids_exist(queue_ids)
        current_music_id = _coerce_optional_music_id(
            data.get("current_music_id"),
            "current_music_id",
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    queue_state = MusicQueue.query.filter_by(user_id=current_user.id).first()
    if not queue_state:
        queue_state = MusicQueue(user_id=current_user.id)
        db.session.add(queue_state)

    queue_state.set_queue_ids(queue_ids)
    queue_state.current_music_id = current_music_id
    db.session.commit()
    return jsonify({"success": True, "queue": queue_state.to_dict()})


def get_playlist_state():
    playlist_state = PlaylistState.query.filter_by(user_id=current_user.id).first()
    if not playlist_state:
        return jsonify({"playlist_state": None})
    return jsonify({"playlist_state": playlist_state.to_dict()})


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
        current_time = float(data.get("current_time", 0) or 0)
        if current_time < 0:
            current_time = 0
        state = data.get("state") or {}
        if not isinstance(state, dict):
            raise ValueError("state 必须是对象")
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    playlist_state = PlaylistState.query.filter_by(user_id=current_user.id).first()
    if not playlist_state:
        playlist_state = PlaylistState(user_id=current_user.id)
        db.session.add(playlist_state)

    playlist_state.active_playlist_id = active_playlist_id
    playlist_state.current_music_id = current_music_id
    playlist_state.current_time = current_time
    playlist_state.was_playing = bool(data.get("was_playing", False))
    playlist_state.panel_view = data.get("panel_view")
    playlist_state.is_expanded = data.get("is_expanded")
    playlist_state.set_state(state)
    db.session.commit()
    return jsonify({"success": True, "playlist_state": playlist_state.to_dict()})


def add_one_minute(music_id):
    music = Music.query.get(music_id)
    if not music:
        return jsonify({"error": "Music not found"}), 404

    user_id = current_user.id

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
    return jsonify(
        {
            "success": True,
            "music_id": music_id,
            "user_id": user_id,
            "play_minutes": music.play_minutes,
            "played_at": now.isoformat(),
        }
    )


def list_minute_logs(page, per_page, music_id=None, user_id=None):
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

    return jsonify(
        {
            "items": items,
            "page": page,
            "per_page": per_page,
            "total_pages": pagination.pages,
            "total": pagination.total,
            "timezone": "Asia/Kuala_Lumpur",
        }
    )


def get_last_played_music():
    user_id = getattr(current_user, "id", None)
    if not user_id:
        return jsonify({"last_played": None, "timezone": "Asia/Kuala_Lumpur"})

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
        return jsonify({"last_played": None, "timezone": "Asia/Kuala_Lumpur"})

    user_play_minute = latest_log.music_user_play_minute
    music = user_play_minute.music if user_play_minute else None
    user = user_play_minute.user if user_play_minute else None

    return jsonify(
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
