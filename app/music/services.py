import os

from flask import jsonify
from flask_login import current_user
from werkzeug.utils import secure_filename

from models import db
from models.music import Album, Music, MusicQueue, Playlist, PlaylistState

from .storage import (
    ALBUM_IMAGE_DIR,
    MUSIC_DIR,
    allowed_audio_extension,
    delete_music_cache,
    delete_music_file,
    detect_audio_mime,
    replace_music_upload,
    save_music_upload,
    stream_music_file,
)


def upload_music(files, album_id, artist_id):
    if not files:
        return jsonify({"error": "没有选择文件"}), 400

    saved_items = []
    for file in files:
        if not file or not allowed_audio_extension(file.filename):
            continue

        file_name, file_path, ext = save_music_upload(file)
        music = Music(
            title=file.filename,
            album_id=album_id or None,
            artist_id=artist_id or None,
            file_name=file_name,
            file_type=detect_audio_mime(ext),
            file_size=os.path.getsize(file_path),
        )
        db.session.add(music)
        saved_items.append(music)

    db.session.commit()
    return jsonify(
        {
            "success": True,
            "count": len(saved_items),
            "musics": [music.to_dict() for music in saved_items],
        }
    )


def get_albums():
    albums = Album.query.order_by(Album.created_at.desc()).all()
    return jsonify([album.to_dict() for album in albums])


def get_album(album_id):
    album = Album.query.get(album_id)
    if not album:
        return jsonify({"error": "专辑不存在"}), 404
    return jsonify(album.to_dict_full())


def upload_album_cover(album_id, file):
    album = Album.query.get(album_id)
    if not album:
        return jsonify({"error": "专辑不存在"}), 404
    if not file:
        return jsonify({"error": "未选择图片"}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
        return jsonify({"error": "仅支持 JPG/PNG/GIF/WEBP 图片"}), 400

    filename = secure_filename(f"{album_id}{ext}")
    save_path = os.path.join(ALBUM_IMAGE_DIR, filename)
    file.save(save_path)

    album.cover_url = f"/static/album_image/{filename}"
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


def delete_album(album_id):
    album = Album.query.get(album_id)
    if not album:
        return jsonify({"error": "专辑不存在"}), 404
    db.session.delete(album)
    db.session.commit()
    return jsonify({"success": True})


def list_music(page, per_page):
    pagination = Music.query.order_by(Music.created_at.desc()).paginate(
        page=page,
        per_page=per_page,
    )
    return jsonify(
        {
            "musics": [music.to_dict() for music in pagination.items],
            "page": page,
            "total_pages": pagination.pages,
            "total": pagination.total,
        }
    )


def music_detail(music_id):
    music = Music.query.get_or_404(music_id)
    return jsonify(music.to_dict_full())


def download_music(music_id):
    music = Music.query.get_or_404(music_id)
    return stream_music_file(music)


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
    return jsonify({"success": True, "music": music.to_dict_full()})


def replace_music_file(music_id, file):
    music = Music.query.get_or_404(music_id)
    if not file:
        return jsonify({"error": "没有选择文件"}), 400
    if not allowed_audio_extension(file.filename):
        return jsonify({"error": "仅支持 MP3/WAV/WMA 音频"}), 400

    try:
        file_name, file_path, ext = replace_music_upload(file, music.file_name)
        music.file_name = file_name
        music.file_type = detect_audio_mime(ext)
        music.file_size = os.path.getsize(file_path)
        delete_music_cache(music.id)
        db.session.commit()
        return jsonify({"success": True, "music": music.to_dict_full()})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"替换音频失败: {str(exc)}"}), 500


def delete_music(music_id):
    music = Music.query.get_or_404(music_id)
    try:
        delete_music_cache(music.id)
        delete_music_file(music.file_name)
        db.session.delete(music)
        db.session.commit()
        return jsonify({"success": True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"删除失败: {str(exc)}"}), 500


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
    if not playlist or playlist.user_id != current_user.id:
        raise ValueError(f"{field_name} 对应歌单不存在")
    return playlist_id


def list_playlists():
    playlists = (
        Playlist.query.filter_by(user_id=current_user.id)
        .order_by(Playlist.created_at.desc())
        .all()
    )
    return jsonify({"playlists": [playlist.to_dict() for playlist in playlists]})


def get_playlist(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return jsonify({"error": "歌单不存在"}), 404
    return jsonify({"playlist": playlist.to_dict()})


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
    )
    if music_ids:
        playlist.musics = Music.query.filter(Music.id.in_(set(music_ids))).all()
    db.session.add(playlist)
    db.session.commit()
    return jsonify({"success": True, "playlist": playlist.to_dict()})


def save_playlist(playlist_id, data):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
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
    playlist.musics = Music.query.filter(Music.id.in_(set(music_ids))).all() if music_ids else []
    db.session.commit()
    return jsonify({"success": True, "playlist": playlist.to_dict()})


def delete_playlist(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return jsonify({"error": "歌单不存在"}), 404
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
