"""把歌库里独立成一首歌的「伴奏 / 卡拉版 / minus one / instrumental」并进对应原唱的伴奏栏位。

用法（在项目根目录）：
    venv/bin/python scripts/merge_music_accompaniments.py            # 只打印计划，不改任何数据
    venv/bin/python scripts/merge_music_accompaniments.py --apply    # 真正执行

匹配规则：
- 标题里含伴奏标记（伴奏 / 伴唱 / 卡拉 / minus one / instrumental / karaoke / ktv / off vocal）的视为伴奏候选。
- 去掉标记、开头曲号、括号内容、空白和标点后做「标准化标题」，先在同一专辑找原唱，再全库找唯一原唱。
- 找到唯一原唱且原唱还没有伴奏时才归并；有歧义或找不到的只列出来，不动。

归并动作（--apply 时）：
- 原唱的 accompaniment_* 指向伴奏文件（文件本身不动）。
- 播放分钟合并到原唱；每人的播放分钟与日志记录也并到原唱。
- 队列 / 播放状态 / 歌单里对伴奏的引用改指向原唱。
- 删除伴奏那条歌曲记录，并清掉它的转码缓存。
"""
import argparse
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.factory import create_app  # noqa: E402
from app.music.storage import delete_music_cache  # noqa: E402
from models import db  # noqa: E402
from models.music import (  # noqa: E402
    Album,
    Music,
    MusicQueue,
    MusicUserPlayMinute,
    MusicUserPlayMinuteLog,
    PlaylistState,
    playlist_music,
)

MARKER_RE = re.compile(
    r"(伴奏|伴唱版|伴唱|卡拉版|卡拉ok|卡拉|minus\s*one|instrumental|karaoke|ktv|off\s*vocal|music\s*only|纯音乐|純音樂|无人声|無人聲)",
    re.IGNORECASE,
)
LEADING_NUMBER_RE = re.compile(r"^\s*\d+[\s.、_\-]*")
BRACKET_RE = re.compile(r"[\(（\[【][^\)）\]】]*[\)）\]】]")
NOISE_RE = re.compile(r"[\s\-–—_.,，。·・⸳'’\"“”:：/\\|~!！?？]+")


def is_accompaniment_title(title):
    return bool(MARKER_RE.search(title or ""))


def normalize_title(title):
    text = (title or "").strip().lower()
    text = LEADING_NUMBER_RE.sub("", text)
    text = MARKER_RE.sub("", text)
    text = BRACKET_RE.sub("", text)
    text = NOISE_RE.sub("", text)
    return text


def build_plan(musics, include_cross_album=False):
    candidates = [m for m in musics if is_accompaniment_title(m.title)]
    vocals = [m for m in musics if not is_accompaniment_title(m.title)]

    by_album_key = defaultdict(list)
    by_key = defaultdict(list)
    for m in vocals:
        key = normalize_title(m.title)
        if not key:
            continue
        by_album_key[(m.album_id, key)].append(m)
        by_key[key].append(m)

    plan = []  # (candidate, vocal, cross_album)
    skipped = []  # (candidate, reason, suggestions)
    claimed = set()
    ordered = sorted(candidates, key=lambda m: (m.album_id or 0, m.id))

    # 两轮：先让同专辑的配对占位，再处理跨专辑的，避免跨专辑的抢走同专辑原唱。
    def resolve(cand, allow_cross):
        key = normalize_title(cand.title)
        if not key:
            return None, ("去掉标记后标题为空", [])
        same_album = by_album_key.get((cand.album_id, key), [])
        if same_album:
            matches, cross = same_album, False
        elif allow_cross:
            matches, cross = by_key.get(key, []), True
        else:
            return None, None  # 这一轮不处理
        if not matches:
            hints = [m for k, ms in by_key.items() for m in ms if key in k or k in key][:5]
            return None, ("找不到原唱", hints)
        if len(matches) > 1:
            return None, ("多个原唱同名，无法判断", matches)
        vocal = matches[0]
        if vocal.accompaniment_file_name:
            return None, ("原唱已经有伴奏", [vocal])
        if vocal.id in claimed:
            return None, ("原唱已被另一首伴奏占用", [vocal])
        return (vocal, cross), None

    pending = []
    for cand in ordered:
        result, skip = resolve(cand, allow_cross=False)
        if result:
            vocal, cross = result
            claimed.add(vocal.id)
            plan.append((cand, vocal, cross))
        elif skip:
            skipped.append((cand, skip[0], skip[1]))
        else:
            pending.append(cand)

    for cand in pending:
        result, skip = resolve(cand, allow_cross=True)
        if result:
            vocal, cross = result
            if include_cross_album:
                claimed.add(vocal.id)
                plan.append((cand, vocal, cross))
            else:
                skipped.append((cand, "只在别的专辑找到原唱（加 --cross-album 才归并）", [vocal]))
        elif skip:
            skipped.append((cand, skip[0], skip[1]))
    return plan, skipped


def describe(m):
    album = m.album.name if m.album else "未分类"
    return f"#{m.id} 「{m.title}」 [{album}] {m.file_name}"


def merge_pair(cand, vocal):
    vocal.accompaniment_file_name = cand.file_name
    vocal.accompaniment_file_type = cand.file_type
    vocal.accompaniment_file_size = cand.file_size
    vocal.play_minutes = float(vocal.play_minutes or 0.0) + float(cand.play_minutes or 0.0)

    # 每人播放分钟：有同一用户的记录就合并分钟并搬日志，否则整条改指向原唱。
    vocal_rows = {row.user_id: row for row in MusicUserPlayMinute.query.filter_by(music_id=vocal.id).all()}
    for row in MusicUserPlayMinute.query.filter_by(music_id=cand.id).all():
        target = vocal_rows.get(row.user_id)
        if target is None:
            row.music_id = vocal.id
            vocal_rows[row.user_id] = row
            continue
        target.play_minutes = float(target.play_minutes or 0.0) + float(row.play_minutes or 0.0)
        MusicUserPlayMinuteLog.query.filter_by(music_user_play_minute_id=row.id).update(
            {"music_user_play_minute_id": target.id}, synchronize_session=False
        )
        db.session.delete(row)

    for queue_state in MusicQueue.query.filter_by(current_music_id=cand.id).all():
        queue_state.current_music_id = vocal.id
    for playlist_state in PlaylistState.query.filter_by(current_music_id=cand.id).all():
        playlist_state.current_music_id = vocal.id
    for queue_state in MusicQueue.query.all():
        ids = queue_state.get_queue_ids()
        if cand.id not in ids:
            continue
        replaced = []
        for queue_id in ids:
            next_id = vocal.id if queue_id == cand.id else queue_id
            if next_id not in replaced:
                replaced.append(next_id)
        queue_state.set_queue_ids(replaced)

    existing_playlists = {
        row.playlist_id
        for row in db.session.execute(
            playlist_music.select().where(playlist_music.c.music_id == vocal.id)
        ).all()
    }
    for row in db.session.execute(playlist_music.select().where(playlist_music.c.music_id == cand.id)).all():
        if row.playlist_id in existing_playlists:
            db.session.execute(
                playlist_music.delete().where(
                    (playlist_music.c.playlist_id == row.playlist_id) & (playlist_music.c.music_id == cand.id)
                )
            )
        else:
            db.session.execute(
                playlist_music.update()
                .where((playlist_music.c.playlist_id == row.playlist_id) & (playlist_music.c.music_id == cand.id))
                .values(music_id=vocal.id)
            )

    db.session.delete(cand)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="真正执行归并；不加则只打印计划")
    parser.add_argument("--cross-album", action="store_true", help="允许把别的专辑里唯一同名的原唱也归并")
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        musics = Music.query.all()
        plan, skipped = build_plan(musics, include_cross_album=args.cross_album)

        print(f"歌曲总数 {len(musics)}，伴奏候选 {len(plan) + len(skipped)} 首，可归并 {len(plan)} 首，跳过 {len(skipped)} 首\n")
        print("=== 将归并 ===")
        for cand, vocal, cross in plan:
            print(f"伴奏 {describe(cand)}\n  -> 原唱 {describe(vocal)}{'  （跨专辑）' if cross else ''}")
        print("\n=== 跳过（需要人工处理） ===")
        for cand, reason, hints in skipped:
            print(f"{describe(cand)}\n  原因：{reason}")
            for hint in hints:
                print(f"  可能对应：{describe(hint)}")

        if not args.apply:
            print("\n（未加 --apply，没有改动任何数据）")
            return

        merged_ids = []
        for cand, vocal, _cross in plan:
            merge_pair(cand, vocal)
            merged_ids.append(cand.id)
        db.session.commit()
        for music_id in merged_ids:
            delete_music_cache(music_id)

        empty_albums = [album for album in Album.query.all() if not album.musics]
        print(f"\n已归并 {len(merged_ids)} 首。")
        if empty_albums:
            print("以下专辑归并后已经没有歌曲，可按需手动删除：")
            for album in empty_albums:
                print(f"  专辑 #{album.id} 「{album.name}」")


if __name__ == "__main__":
    main()
