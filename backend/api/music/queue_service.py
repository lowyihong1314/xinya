"""播放队列的增量操作。

``MusicQueue`` 模型早就有（每用户一行，``queue_json`` 存有序 id 列表），
但原来只有「整份读 / 整份写」两个接口。前端要做「加入队列」就得先拉全量、
本地拼好、再整份写回 —— 两个人同时操作会互相覆盖，而且一次加一首要传整个队列。

这里补上增量操作。全部基于同一条原则：**队列是有序的，顺序由用户决定**，
所以内部一律按列表处理，不去重排序（重复出现同一首是合法的，
有人就是想连着听两遍）。
"""

from backend.core.auth import current_user
from backend.core.db import db
from backend.core.responses import json_response
from backend.models.music import Music, MusicQueue


def _get_or_create():
    """取当前用户的队列行，没有就建一条空的。"""
    queue = MusicQueue.query.filter_by(user_id=current_user.id).first()
    if not queue:
        queue = MusicQueue(user_id=current_user.id)
        db.session.add(queue)
        db.session.flush()  # 让下面能拿到 id
    return queue


def _existing_ids(music_ids):
    """过滤掉库里不存在的 id。

    静默丢弃而不是报错：队列里的歌可能已经被删了，让整个操作失败没有意义。
    """
    if not music_ids:
        return []
    found = {m.id for m in Music.query.filter(Music.id.in_(music_ids)).all()}
    return [i for i in music_ids if i in found]


def _coerce_ids(raw):
    if raw is None:
        return []
    if isinstance(raw, (int, str)):
        raw = [raw]
    out = []
    for item in raw:
        try:
            out.append(int(item))
        except (TypeError, ValueError):
            raise ValueError("music_ids 必须是整数或整数数组")
    return out


def add_to_queue(data):
    """加入队列。

    ``position``：
      · ``"end"``（默认）追加到队尾
      · ``"next"`` 插到当前播放的下一首 —— 「下一首播放」这个常见动作
    """
    try:
        music_ids = _coerce_ids(data.get("music_ids") if "music_ids" in data else data.get("music_id"))
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)
    if not music_ids:
        return json_response({"status": "error", "message": "没有要加入的歌曲"}, 400)

    music_ids = _existing_ids(music_ids)
    if not music_ids:
        return json_response({"status": "error", "message": "这些歌曲不存在"}, 404)

    queue = _get_or_create()
    ids = queue.get_queue_ids()

    if str(data.get("position") or "end") == "next" and queue.current_music_id in ids:
        at = ids.index(queue.current_music_id) + 1
        ids[at:at] = music_ids
    else:
        ids.extend(music_ids)

    queue.set_queue_ids(ids)
    db.session.commit()
    return json_response({"status": "success", "added": len(music_ids), "queue": queue.to_dict()})


def remove_from_queue(data):
    """从队列移除。

    按 ``index`` 移除而不是按 music_id —— 同一首歌可以在队列里出现多次，
    按 id 删会把用户特意加的第二遍也删掉。
    """
    queue = MusicQueue.query.filter_by(user_id=current_user.id).first()
    if not queue:
        return json_response({"status": "error", "message": "队列是空的"}, 404)

    ids = queue.get_queue_ids()
    raw = data.get("index")
    try:
        index = int(raw)
    except (TypeError, ValueError):
        return json_response({"status": "error", "message": "index 必须是整数"}, 400)
    if index < 0 or index >= len(ids):
        return json_response({"status": "error", "message": "index 超出队列范围"}, 400)

    removed = ids.pop(index)
    queue.set_queue_ids(ids)
    # 删掉的正好是当前播放的那首 → 清空 current，前端据此停掉或跳下一首。
    if queue.current_music_id == removed and removed not in ids:
        queue.current_music_id = None
    db.session.commit()
    return json_response({"status": "success", "queue": queue.to_dict()})


def clear_queue():
    queue = _get_or_create()
    queue.set_queue_ids([])
    queue.current_music_id = None
    db.session.commit()
    return json_response({"status": "success", "queue": queue.to_dict()})


def reorder_queue(data):
    """整份重排（拖动排序后前端把新顺序发上来）。

    只接受「与原队列**同一批 id**」的新顺序：这样能挡住「拖动过程中队列在别处
    被改过」导致的静默丢歌 —— 那种情况下前端该先刷新再拖。
    """
    queue = MusicQueue.query.filter_by(user_id=current_user.id).first()
    if not queue:
        return json_response({"status": "error", "message": "队列是空的"}, 404)

    try:
        new_ids = _coerce_ids(data.get("queue_ids"))
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)

    if sorted(new_ids) != sorted(queue.get_queue_ids()):
        return json_response(
            {"status": "error", "message": "队列内容已变化，请刷新后重试", "reason": "stale_queue"},
            409,
        )

    queue.set_queue_ids(new_ids)
    db.session.commit()
    return json_response({"status": "success", "queue": queue.to_dict()})


def queue_detail():
    """队列 + 每首歌的完整信息。

    前端渲染队列要显示歌名/专辑，只有 id 列表不够；让它按 id 一首首去查
    会产生 N 次请求。这里一次给全。
    """
    queue = MusicQueue.query.filter_by(user_id=current_user.id).first()
    if not queue:
        return json_response({"queue": None, "items": []})

    ids = queue.get_queue_ids()
    by_id = {m.id: m for m in Music.query.filter(Music.id.in_(ids)).all()} if ids else {}
    # 按队列顺序还原，并跳过已经被删掉的歌
    items = [by_id[i].to_dict_full() for i in ids if i in by_id]
    return json_response({"queue": queue.to_dict(), "items": items})
