"""伴奏（instrumental / kala / minus one）的标记与解除。

数据层是 ``music.accompaniment_of_id``：自引用 + 唯一约束，DB 强制 1 对 1
（见 migration ff4115af76ac）。这里只做**业务规则**校验，把 DB 会拒绝的情况
提前翻译成看得懂的中文，而不是让用户撞一个 IntegrityError。

三条规则，都有具体的坏处：
  ① 不能把自己设成自己的伴奏 —— 播放器切伴奏会切到同一个文件，无限套娃。
  ② 伴奏不能再有伴奏（不允许链） —— 「原曲 → 伴奏 → 伴奏的伴奏」没有意义，
     而且播放器的切换逻辑要处理任意深度。
  ③ 已经是别人伴奏的曲目不能再被指派 —— 唯一约束也会拒，但先给中文提示。
"""

from backend.core.db import db
from backend.core.responses import json_response
from backend.models.music import Music


def set_accompaniment(parent_id, data):
    """把 ``accompaniment_id`` 指定为 ``parent_id`` 的伴奏。"""
    parent = Music.query.get_or_404(parent_id, description="原曲不存在")

    raw = data.get("accompaniment_id")
    if raw is None:
        return json_response({"status": "error", "message": "缺少 accompaniment_id"}, 400)
    try:
        acc_id = int(raw)
    except (TypeError, ValueError):
        return json_response({"status": "error", "message": "accompaniment_id 必须是整数"}, 400)

    acc = Music.query.get(acc_id)
    if not acc:
        return json_response({"status": "error", "message": "指定的伴奏曲目不存在"}, 404)

    # ① 自己不能是自己的伴奏
    if acc.id == parent.id:
        return json_response({"status": "error", "message": "不能把一首歌设成它自己的伴奏"}, 400)

    # ② 不允许链：原曲本身如果已经是别人的伴奏，就不该再有自己的伴奏
    if parent.accompaniment_of_id is not None:
        return json_response(
            {"status": "error", "message": "这首歌本身是别人的伴奏，不能再给它配伴奏"}, 409
        )

    # ③ 这首伴奏已经属于另一首歌
    if acc.accompaniment_of_id is not None and acc.accompaniment_of_id != parent.id:
        owner = acc.accompaniment_of
        return json_response(
            {
                "status": "error",
                "message": f"《{acc.title}》已经是《{owner.title if owner else '另一首歌'}》的伴奏",
                "reason": "already_assigned",
            },
            409,
        )

    # ④ 原曲已经有别的伴奏 —— 1 对 1，要先解除
    existing = parent.accompaniment
    if existing is not None and existing.id != acc.id:
        return json_response(
            {
                "status": "error",
                "message": f"《{parent.title}》已经有伴奏《{existing.title}》，请先解除",
                "reason": "parent_occupied",
            },
            409,
        )

    acc.accompaniment_of_id = parent.id
    db.session.commit()
    return json_response(
        {"status": "success", "parent": parent.to_dict(), "accompaniment": acc.to_dict()}
    )


def clear_accompaniment(parent_id):
    """解除某首歌的伴奏关系。伴奏本身不删，退回普通曲目。"""
    parent = Music.query.get_or_404(parent_id, description="原曲不存在")
    acc = parent.accompaniment
    if acc is None:
        return json_response({"status": "error", "message": "这首歌还没有伴奏"}, 404)

    acc.accompaniment_of_id = None
    db.session.commit()
    return json_response({"status": "success", "parent": parent.to_dict()})
