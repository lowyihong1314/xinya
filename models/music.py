import json
from datetime import datetime
from models import db
from models.user_data import User 

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    album = db.relationship('Album', back_populates='musics')
    artist = db.relationship('Artist', back_populates='musics')

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
            "created_at": self.created_at.isoformat()
        }

    def to_dict_full(self):
        data = self.to_dict()
        data["album"] = self.album.to_dict() if self.album else None
        return data

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

    def to_dict(self):
        data = {
            "id": self.id,
            "name": self.name,
            "artist_id": self.artist_id,
            "cover_url": self.cover_url,
            "release_date": self.release_date.isoformat() if self.release_date else None,
            "description": self.description,
            "created_at": self.created_at.isoformat()
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
    db.Column('playlist_id', db.Integer, db.ForeignKey('playlist.id')),
    db.Column('music_id', db.Integer, db.ForeignKey('music.id'))
)

class Playlist(db.Model):
    __tablename__ = 'playlist'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user_data.id'))   # 谁创建的
    cover_url = db.Column(db.String(255), nullable=True)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    musics = db.relationship('Music', secondary=playlist_music, backref='playlists')

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "user_id": self.user_id,
            "cover_url": self.cover_url,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
            "music_ids": [music.id for music in self.musics],
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
