from flask import Blueprint, request
from flask_login import login_required

from app.auth import permission_required
from . import services
from .storage import serve_album_image


music_bp = Blueprint("music_bp", __name__)


@music_bp.route("/upload", methods=["POST"])
@login_required
@permission_required("music_edit")
def upload_music():
    return services.upload_music(
        request.files.getlist("files"),
        request.form.get("album_id"),
        request.form.get("artist_id"),
        request.form.get("title"),
        request.form.getlist("titles"),
    )


@music_bp.route("/albums", methods=["GET"])
def get_albums():
    return services.get_albums()


@music_bp.route("/albums/<int:album_id>", methods=["GET"])
def get_album(album_id):
    return services.get_album(album_id)


@music_bp.route("/albums/<int:album_id>/upload_cover", methods=["POST"])
@login_required
@permission_required("music_edit")
def upload_album_cover(album_id):
    return services.upload_album_cover(album_id, request.files.get("file"))


@music_bp.route("/album", methods=["POST"])
@login_required
@permission_required("music_edit")
def create_album():
    return services.create_album(request.get_json() or {})


@music_bp.route("/album/<int:album_id>", methods=["DELETE"])
@login_required
@permission_required("music_edit")
def delete_album(album_id):
    return services.delete_album(album_id)


@music_bp.route("/album/<int:album_id>", methods=["POST"])
@login_required
@permission_required("music_edit")
def edit_album(album_id):
    return services.edit_album(album_id, request.get_json() or {})


@music_bp.route("/list", methods=["GET"])
def list_music():
    return services.list_music(
        int(request.args.get("page", 1)),
        int(request.args.get("per_page", 20)),
    )


@music_bp.route("/detail/<int:music_id>", methods=["GET"])
def music_detail(music_id):
    return services.music_detail(music_id)


@music_bp.route("/download/<int:music_id>", methods=["GET"])
def download_music(music_id):
    return services.download_music(music_id)


@music_bp.route("/edit/<int:music_id>", methods=["POST"])
@login_required
@permission_required("music_edit")
def edit_music(music_id):
    return services.edit_music(music_id, request.get_json() or {})


@music_bp.route("/replace/<int:music_id>", methods=["POST"])
@login_required
@permission_required("music_edit")
def replace_music(music_id):
    return services.replace_music_file(music_id, request.files.get("file"))


@music_bp.route("/delete/<int:music_id>", methods=["DELETE"])
@login_required
@permission_required("music_edit")
def delete_music(music_id):
    return services.delete_music(music_id)


@music_bp.route("/add_one_minute/<int:music_id>", methods=["POST"])
@login_required
def add_one_minute(music_id):
    return services.add_one_minute(music_id)


@music_bp.route("/minute_logs", methods=["GET"])
@login_required
def list_minute_logs():
    return services.list_minute_logs(
        request.args.get("page", 1, type=int),
        request.args.get("per_page", 200, type=int),
        request.args.get("music_id", type=int),
        request.args.get("user_id", type=int),
    )


@music_bp.route("/last_played", methods=["GET"])
@login_required
def get_last_played_music():
    return services.get_last_played_music()


@music_bp.route("/album_cover/<path:filename>", methods=["GET"])
def album_cover(filename):
    return serve_album_image(filename)


@music_bp.route("/playlists", methods=["GET"])
@login_required
def list_playlists():
    return services.list_playlists()


@music_bp.route("/playlist", methods=["POST"])
@login_required
def create_playlist():
    return services.create_playlist(request.get_json() or {})


@music_bp.route("/playlist/<int:playlist_id>", methods=["GET"])
@login_required
def get_playlist(playlist_id):
    return services.get_playlist(playlist_id)


@music_bp.route("/playlist/<int:playlist_id>", methods=["POST"])
@login_required
def save_playlist(playlist_id):
    return services.save_playlist(playlist_id, request.get_json() or {})


@music_bp.route("/playlist/<int:playlist_id>", methods=["DELETE"])
@login_required
def delete_playlist(playlist_id):
    return services.delete_playlist(playlist_id)


@music_bp.route("/queue", methods=["GET"])
@login_required
def get_queue_state():
    return services.get_queue_state()


@music_bp.route("/queue", methods=["POST"])
@login_required
def save_queue_state():
    return services.save_queue_state(request.get_json() or {})


@music_bp.route("/playlist_state", methods=["GET"])
@login_required
def get_playlist_state():
    return services.get_playlist_state()


@music_bp.route("/playlist_state", methods=["POST"])
@login_required
def save_playlist_state():
    return services.save_playlist_state(request.get_json() or {})
