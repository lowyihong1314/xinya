import json
from datetime import datetime

from app.timezone import malaysia_now_naive
from models import db


REMOTE_ALBUM_COVER_ROOT = "https://utbabuddha.com/api/music/album_cover"


def _resolve_remote_album_cover_url(cover_url):
    raw = str(cover_url or "").strip()
    if not raw:
        return None
    filename = raw.split("#", 1)[0].split("?", 1)[0].rstrip("/").split("/")[-1]
    if not filename:
        return None
    return f"{REMOTE_ALBUM_COVER_ROOT}/{filename}"


class Music(db.Model):
    __tablename__ = 'music'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    album_id = db.Column(db.Integer, db.ForeignKey('album.id'))
    artist_id = db.Column(db.Integer, db.ForeignKey('artist.id'))
    file_name = db.Column(db.String(255), nullable=False)
    file_type = db.Column(db.String(50), nullable=False)
    file_size = db.Column(db.BigInteger, nullable=False)
    duration = db.Column(db.Integer, nullable=True)
    cover_url = db.Column(db.String(255), nullable=True)
    play_minutes = db.Column(db.Float, nullable=False, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # 伴奏版音频（可选）：和主音频一样存在 MUSIC_DIR 下，播放器的「伴奏模式」会切到这个文件。
    accompaniment_file_name = db.Column(db.String(255), nullable=True)
    accompaniment_file_type = db.Column(db.String(50), nullable=True)
    accompaniment_file_size = db.Column(db.BigInteger, nullable=True)

    album = db.relationship('Album', back_populates='musics')
    artist = db.relationship('Artist', back_populates='musics')
    user_play_minutes = db.relationship(
        'MusicUserPlayMinute',
        back_populates='music',
        cascade='all, delete-orphan',
    )

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "album_id": self.album_id,
            "artist_id": self.artist_id,
            "file_name": self.file_name,
            "file_type": self.file_type,
            "file_size": self.file_size,
            "duration": self.duration,
            "cover_url": self.cover_url,
            "play_minutes": self.play_minutes,
            "created_at": self.created_at.isoformat(),
            "has_accompaniment": bool(self.accompaniment_file_name),
            "accompaniment_file_name": self.accompaniment_file_name,
            "accompaniment_file_type": self.accompaniment_file_type,
            "accompaniment_file_size": self.accompaniment_file_size,
        }

    def to_dict_full(self, album_total_minutes=None):
        data = self.to_dict()
        data["album"] = self.album.to_dict(total_minutes=album_total_minutes) if self.album else None
        return data


class MusicUserPlayMinute(db.Model):
    __tablename__ = 'music_user_play_minute'
    __table_args__ = (
        db.UniqueConstraint('music_id', 'user_id', name='uq_music_user_play_minute_music_user'),
    )

    id = db.Column(db.Integer, primary_key=True)
    music_id = db.Column(db.Integer, db.ForeignKey('music.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=False, index=True)
    play_minutes = db.Column(db.Float, nullable=False, default=0.0)
    created_at = db.Column(db.DateTime, default=malaysia_now_naive, nullable=False)

    minute_logs = db.relationship(
        'MusicUserPlayMinuteLog',
        back_populates='music_user_play_minute',
        cascade='all, delete-orphan',
        order_by='MusicUserPlayMinuteLog.created_at.asc(), MusicUserPlayMinuteLog.id.asc()',
    )

    music = db.relationship('Music', back_populates='user_play_minutes')
    user = db.relationship('User', backref='music_user_play_minutes')

    def to_dict(self):
        return {
            "id": self.id,
            "music_id": self.music_id,
            "user_id": self.user_id,
            "play_minutes": self.play_minutes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "minute_log_count": len(self.minute_logs) if self.minute_logs is not None else None,
        }


class MusicUserPlayMinuteLog(db.Model):
    __tablename__ = 'music_user_play_minute_log'

    id = db.Column(db.Integer, primary_key=True)
    music_user_play_minute_id = db.Column(
        db.Integer,
        db.ForeignKey('music_user_play_minute.id'),
        nullable=False,
        index=True,
    )
    created_at = db.Column(db.DateTime, default=malaysia_now_naive, nullable=False, index=True)

    music_user_play_minute = db.relationship(
        'MusicUserPlayMinute',
        back_populates='minute_logs',
    )

    def to_dict(self):
        parent = self.music_user_play_minute
        return {
            "id": self.id,
            "music_user_play_minute_id": self.music_user_play_minute_id,
            "music_id": parent.music_id if parent else None,
            "user_id": parent.user_id if parent else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Album(db.Model):
    __tablename__ = 'album'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    artist_id = db.Column(db.Integer, db.ForeignKey('artist.id'))
    cover_url = db.Column(db.String(255), nullable=True)
    release_date = db.Column(db.Date, nullable=True)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    musics = db.relationship('Music', back_populates='album', cascade="all, delete-orphan")
    artist = db.relationship('Artist', back_populates='albums')

    def to_dict(self, total_minutes=None):
        # total_minutes 由调用方用一条聚合 SQL 算好传进来；不传才回退到懒加载 musics 求和。
        if total_minutes is None:
            total_minutes = sum(m.play_minutes for m in self.musics)
        data = {
            "id": self.id,
            "name": self.name,
            "artist_id": self.artist_id,
            "cover_url": self.cover_url,
            "image": _resolve_remote_album_cover_url(self.cover_url),
            "release_date": self.release_date.isoformat() if self.release_date else None,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
            "album_total_minutes": total_minutes,
        }
        return data

    def to_dict_full(self):
        data = self.to_dict()
        data["music_list"] = [m.to_dict() for m in self.musics]
        return data

class Artist(db.Model):
    __tablename__ = 'artist'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, unique=True)
    bio = db.Column(db.Text, nullable=True)
    avatar_url = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    albums = db.relationship('Album', back_populates='artist')
    musics = db.relationship('Music', back_populates='artist')

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "bio": self.bio,
            "avatar_url": self.avatar_url
        }

playlist_music = db.Table(
    'playlist_music',
    db.Column('playlist_id', db.Integer, db.ForeignKey('playlist.id'), nullable=False),
    db.Column('music_id', db.Integer, db.ForeignKey('music.id'), nullable=False),
    # 歌单内的顺序；旧行为 0，按 position 再按 music_id 排。
    db.Column('position', db.Integer, nullable=False, default=0, server_default='0'),
)

# 歌单成员：歌单和用户多对多。创建者（Playlist.user_id）也在这张表里，成员都能加歌减歌和播放。
playlist_member = db.Table(
    'playlist_member',
    db.Column('playlist_id', db.Integer, db.ForeignKey('playlist.id', ondelete='CASCADE'), primary_key=True),
    db.Column('user_id', db.Integer, db.ForeignKey('user_data.id', ondelete='CASCADE'), primary_key=True),
    db.Column('joined_at', db.DateTime, default=datetime.utcnow, nullable=False),
)


class Playlist(db.Model):
    __tablename__ = 'playlist'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'))   # 谁创建的（拥有者）
    cover_url = db.Column(db.String(255), nullable=True)
    description = db.Column(db.Text, nullable=True)
    # 公开歌单：所有登录用户都能看到并播放，但只有成员能改。
    is_public = db.Column(db.Boolean, nullable=False, default=False, server_default='0')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    musics = db.relationship(
        'Music',
        secondary=playlist_music,
        backref='playlists',
        order_by=(playlist_music.c.position, playlist_music.c.music_id),
    )
    members = db.relationship('User', secondary=playlist_member, backref=db.backref('shared_playlists', lazy='dynamic'))

    def is_member(self, user_id):
        if user_id is None:
            return False
        if self.user_id == user_id:
            return True
        return any(member.id == user_id for member in self.members)

    def owner_label(self):
        owner = next((member for member in self.members if member.id == self.user_id), None)
        if owner is None:
            return None
        return getattr(owner, "display_name", None) or owner.username

    def to_dict(self, viewer_id=None):
        members = []
        seen = set()
        for member in self.members:
            if member.id in seen:
                continue
            seen.add(member.id)
            members.append({
                "id": member.id,
                "username": member.username,
                "display_name": getattr(member, "display_name", None) or member.username,
                "is_owner": member.id == self.user_id,
            })
        return {
            "id": self.id,
            "name": self.name,
            "user_id": self.user_id,
            "owner_id": self.user_id,
            "is_owner": viewer_id is not None and viewer_id == self.user_id,
            "is_public": bool(self.is_public),
            "owner_name": self.owner_label(),
            "can_edit": viewer_id is not None and self.is_member(viewer_id),
            "cover_url": self.cover_url,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
            "music_ids": [music.id for music in self.musics],
            "members": members,
        }


class MusicQueue(db.Model):
    __tablename__ = 'music_queue'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=False, unique=True)
    queue_json = db.Column(db.Text, nullable=False, default='[]')
    current_music_id = db.Column(db.Integer, db.ForeignKey('music.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    current_music = db.relationship('Music', foreign_keys=[current_music_id])
    user = db.relationship('User', backref=db.backref('music_queue_state', uselist=False))

    def get_queue_ids(self):
        try:
            data = json.loads(self.queue_json or '[]')
        except (TypeError, ValueError):
            return []
        return [int(item) for item in data if isinstance(item, int) or str(item).isdigit()]

    def set_queue_ids(self, queue_ids):
        self.queue_json = json.dumps([int(item) for item in queue_ids], ensure_ascii=False)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "queue_ids": self.get_queue_ids(),
            "current_music_id": self.current_music_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class PlaylistState(db.Model):
    __tablename__ = 'playlist_state'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'), nullable=False, unique=True)
    active_playlist_id = db.Column(db.Integer, db.ForeignKey('playlist.id'), nullable=True)
    current_music_id = db.Column(db.Integer, db.ForeignKey('music.id'), nullable=True)
    current_time = db.Column('playback_time', db.Float, nullable=False, default=0)
    was_playing = db.Column(db.Boolean, nullable=False, default=False)
    panel_view = db.Column(db.String(20), nullable=True)
    is_expanded = db.Column(db.Boolean, nullable=True)
    state_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    user = db.relationship('User', backref=db.backref('playlist_state_record', uselist=False))
    active_playlist = db.relationship('Playlist', foreign_keys=[active_playlist_id])
    current_music = db.relationship('Music', foreign_keys=[current_music_id])

    def get_state(self):
        if not self.state_json:
            return {}
        try:
            data = json.loads(self.state_json)
        except (TypeError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def set_state(self, state):
        self.state_json = json.dumps(state or {}, ensure_ascii=False)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "active_playlist_id": self.active_playlist_id,
            "current_music_id": self.current_music_id,
            "current_time": self.current_time,
            "was_playing": self.was_playing,
            "panel_view": self.panel_view,
            "is_expanded": self.is_expanded,
            "state": self.get_state(),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

class PlayHistory(db.Model):
    __tablename__ = 'play_history'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'))
    music_id = db.Column(db.Integer, db.ForeignKey('music.id'))
    played_at = db.Column(db.DateTime, default=datetime.utcnow)

class Favorite(db.Model):
    __tablename__ = 'favorite'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'))
    music_id = db.Column(db.Integer, db.ForeignKey('music.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
