"""music: 伴奏 1 对 1、歌单排序、歌本↔音频关联

Revision ID: ff4115af76ac
Revises: c3f8b21e7a06

三件事：

① ``music.accompaniment_of_id`` —— 自引用 + **唯一约束**，两条合起来卡死 1 对 1：
     unique → 一首歌最多一个伴奏；单列 → 一个伴奏最多属于一首歌。
   指向谁 = **本行是谁的伴奏**（伴奏行有值，原曲行为 NULL）。

② ``playlist_music.position`` —— 歌单是有序的。原来这张关联表没有排序列，
   同一个歌单两次打开顺序可能不一样。

③ ``songbook_entry.music_id`` —— 歌本条目关联音频，唱游房间投屏歌词时能同时放伴奏。

④ **一次性数据**：把库里已有的伴奏配对好（571 首里混着 42 首伴奏）。
   这一步只做这一次，之后由界面手动维护 —— 所以下面的算法是**保守**的：
   配不准就不配，宁可留给人工。

   配对规则（按顺序，先命中先用）：
     a. 标题里含伴奏标记：kala / 卡拉版 / 伴唱版 / 伴奏 / instrumental /
        minus one / 演奏版（括号内外都认）
     b. 去掉标记后与「不含标记的曲目」比对，空白与全半角括号归一
     c. **同专辑优先** —— 跨专辑同名是真实存在的（库里「归敬三宝」有两首，
        分属不同专辑；不限定专辑的话 13-16 那组 kala 会配错到另一张专辑上）
     d. 上一轮配不上时，再去掉开头的曲目编号重试
        （原曲叫 ``1.水``、伴奏叫 ``01 水 minus one``）
     e. 候选不唯一就**跳过**，留给人工

   实测：32 对自动配上，10 首留给人工（原曲不在库里，或标题多了
   ``【之一】`` 这类后缀）。
"""
import re

import sqlalchemy as sa
from alembic import op

revision = "ff4115af76ac"
down_revision = "c3f8b21e7a06"
branch_labels = None
depends_on = None


# ─────────────────────────── 伴奏配对算法 ───────────────────────────
# 与 scripts 里的空跑版本保持一致；改这里要连带重跑一次空跑核对结果。
_MARKERS = [
    r"[（(\[【]\s*(?:kala|instrumental|minus\s*one|演奏版|伴奏|伴唱版|卡拉版)\s*[)）\]】]",
    r"\bminus\s*one\b",
    r"\binstrumental\b",
    r"\bkala\b",
    r"伴唱版",
    r"卡拉版",
    r"演奏版",
    r"伴奏",
]
_MARK_RE = re.compile("|".join(_MARKERS), re.I)
# 开头的曲目编号：01 / 1. / 01、/ 1-
_NUM_RE = re.compile(r"^\s*\d+\s*[.\-、,]?\s*")


def _normalize(title, drop_number):
    text = _MARK_RE.sub("", title or "")
    if drop_number:
        text = _NUM_RE.sub("", text)
    text = text.replace("（", "(").replace("）", ")").replace("　", "")
    # 空白与常见分隔符全去掉：同一首歌在两处的写法常差一个空格或点
    return re.sub(r"[\s.\-、,]+", "", text).strip().lower()


def _pair_accompaniments(connection):
    rows = connection.execute(
        sa.text("SELECT id, title, album_id FROM music ORDER BY id")
    ).fetchall()

    accompaniments = [r for r in rows if _MARK_RE.search(r[1] or "")]
    plain = [r for r in rows if not _MARK_RE.search(r[1] or "")]

    def build_index(drop_number):
        index = {}
        for row in plain:
            index.setdefault(_normalize(row[1], drop_number), []).append(row)
        return index

    indexes = {False: build_index(False), True: build_index(True)}

    pairs = []
    for acc_id, acc_title, acc_album in accompaniments:
        chosen = None
        # 先不去编号（更严格），再去编号（更宽松）
        for drop_number in (False, True):
            candidates = indexes[drop_number].get(_normalize(acc_title, drop_number), [])
            same_album = [c for c in candidates if acc_album is not None and c[2] == acc_album]
            if len(same_album) == 1:
                chosen = same_album[0]
            elif len(candidates) == 1:
                chosen = candidates[0]
            if chosen:
                break
        if chosen and chosen[0] != acc_id:
            pairs.append((acc_id, chosen[0]))

    # 唯一约束要求「一首原曲只被一个伴奏指向」。算法理论上不会产生重复
    # （候选不唯一就跳过），但万一数据里有意外，这里挡一道 —— 迁移中途
    # 撞 unique 约束会让整个事务回滚，比少配几首严重得多。
    seen_parents = set()
    deduped = []
    for acc_id, parent_id in pairs:
        if parent_id in seen_parents:
            continue
        seen_parents.add(parent_id)
        deduped.append((acc_id, parent_id))
    return deduped


def upgrade():
    # ① 伴奏：自引用 + 唯一
    op.add_column("music", sa.Column("accompaniment_of_id", sa.Integer(), nullable=True))
    op.create_index("ix_music_accompaniment_of_id", "music", ["accompaniment_of_id"])
    op.create_unique_constraint("uq_music_accompaniment_of_id", "music", ["accompaniment_of_id"])
    op.create_foreign_key(
        "fk_music_accompaniment_of_id",
        "music",
        "music",
        ["accompaniment_of_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ② 歌单排序
    op.add_column(
        "playlist_music",
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )

    # ③ 歌本 ↔ 音频
    op.add_column("songbook_entry", sa.Column("music_id", sa.Integer(), nullable=True))
    op.create_index("ix_songbook_entry_music_id", "songbook_entry", ["music_id"])
    op.create_foreign_key(
        "fk_songbook_entry_music_id",
        "songbook_entry",
        "music",
        ["music_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ④ 一次性把已有的伴奏配好
    connection = op.get_bind()
    pairs = _pair_accompaniments(connection)
    for acc_id, parent_id in pairs:
        connection.execute(
            sa.text("UPDATE music SET accompaniment_of_id = :parent WHERE id = :acc"),
            {"parent": parent_id, "acc": acc_id},
        )
    print(f"[migration] 伴奏自动配对完成：{len(pairs)} 对（配不上的留给界面手动指定）")


def downgrade():
    op.drop_constraint("fk_songbook_entry_music_id", "songbook_entry", type_="foreignkey")
    op.drop_index("ix_songbook_entry_music_id", table_name="songbook_entry")
    op.drop_column("songbook_entry", "music_id")

    op.drop_column("playlist_music", "position")

    op.drop_constraint("fk_music_accompaniment_of_id", "music", type_="foreignkey")
    op.drop_constraint("uq_music_accompaniment_of_id", "music", type_="unique")
    op.drop_index("ix_music_accompaniment_of_id", table_name="music")
    op.drop_column("music", "accompaniment_of_id")
