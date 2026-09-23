"""小组积分控制面板：Redis session（1 天过期）+ 积分变更日志 + 实时广播。

原 backend/app/form/score_panel.py。

- 管理员在分组页生成一个短 token 链接（存 Redis，含生成者名字），
  链接可在任意设备打开（**无需登录**）来加/扣分。
- 任何显示分数的地方订阅 group_score 事件（房间 ``form_score_<form_id>``）。

── 搬迁只改了这五处，业务逻辑一行没动 ────────────────────────────────
  · ``flask.jsonify(x), code``        → ``core.responses.json_response(x, code)``
  · ``flask.render_template``         → ``.templating.render_template``（无 Flask 的 Jinja 环境）
  · ``flask_login.current_user``      → ``core.auth.current_user``（ContextVar 代理，同接口）
  · ``socket_broker.emit(e, d, room=R)`` → ``publish_sync("form", R, e, d)``（core.realtime）
  · ``/api/form/score_panel/{token}`` → ``public_url("/form/score_panel/{token}")``
    （``/api`` 段已随 BASE_PATH 改造取消，且要补项目前缀 —— 这条 URL 是要拿去
     二维码/复制分享的，少一段前缀就是 404）

★ **token 就是鉴权**：``score_panel_page`` / ``score_panel_data`` /
  ``score_panel_adjust`` 三条**完全公开**，没有 login_required。
  是有意的（面板要在活动现场的平板上打开），不是漏挂。Redis key 24 小时过期。

★ ``_actor_display_name()`` 在未登录时返回「管理员」—— ``current_user`` 是
  AnonymousUser，三个属性都取不到。公开面板那条路径写日志用的是 Redis 里存的
  ``creator_name``（生成链接的人），不是它，所以不受影响。
"""
import secrets
import time

from backend.core.auth import current_user
from backend.core.realtime import publish_sync
from backend.core.redis import redis_client
from backend.core.responses import json_response
from backend.core.urls import public_url
from backend.models import db
from backend.models.form import RegisForm, RegisFormGroup, RegisFormGroupScoreLog, regis_form_member

from .realtime import REALTIME_APP
from .service import _calc_age_from_nric
from .templating import render_template

PANEL_PREFIX = "form:score_panel:"
PANEL_TTL = 24 * 60 * 60

# 浅色系 palette（key -> 背景色 / 描边色）
PALETTE = {
    "blue": "#dbeafe",
    "green": "#dcfce7",
    "yellow": "#fef9c3",
    "pink": "#fce7f3",
    "purple": "#ede9fe",
    "orange": "#ffedd5",
    "teal": "#ccfbf1",
    "rose": "#ffe4e6",
    "sky": "#e0f2fe",
    "lime": "#ecfccb",
}


def _panel_key(token):
    return f"{PANEL_PREFIX}{token}"


def _score_room(form_id):
    return f"form_score_{form_id}"


def _actor_display_name():
    for attr in ("display_name", "username", "name_NRIC"):
        val = getattr(current_user, attr, None)
        if val:
            return str(val)
    return "管理员"


def _emit_group(form_id, group):
    # 房间名 ``form_score_{form_id}`` 一个字没改，理由见 realtime.py 模块头。
    # publish_sync 自己吞异常（只返回 bool），下面那圈 try 因此永远不命中 ——
    # 逐字保留，它记录的是「推送失败不能影响加减分」这条意图。
    try:
        publish_sync(
            REALTIME_APP,
            _score_room(form_id),
            "group_score",
            {
                "form_id": form_id, "group_id": group.id, "score": group.score or 0,
                "color": group.color, "name": group.name, "leader_member_id": group.leader_member_id,
            },
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[WS-DISCONNECTED] group_score emit skipped: {exc}")


def _write_log(form_id, group, delta, actor_name):
    db.session.add(RegisFormGroupScoreLog(
        form_id=form_id, group_id=group.id, group_name=group.name, delta=delta, actor_name=actor_name,
    ))


def _fetch_panel(token):
    return redis_client.hgetall(_panel_key(token)) or None


# -------- 管理员：生成面板链接 --------
def create_score_panel(form_id):
    form = RegisForm.query.get_or_404(form_id)
    token = secrets.token_urlsafe(9)
    key = _panel_key(token)
    redis_client.hset(key, mapping={
        "form_id": str(form.id),
        "creator_id": str(getattr(current_user, "id", "") or ""),
        "creator_name": _actor_display_name(),
        "created_at": str(int(time.time())),
    })
    redis_client.expire(key, PANEL_TTL)
    # 原值是写死的 ``/api/form/score_panel/{token}``，见模块头最后一条。
    return json_response({"status": "success", "token": token, "url": public_url(f"/form/score_panel/{token}")})


# -------- 公开面板（token 鉴权，无需登录）--------
def score_panel_page(token):
    del token
    return render_template("form/score_panel.html")


def score_panel_data(token):
    panel = _fetch_panel(token)
    if not panel:
        return json_response({"status": "error", "message": "链接已失效，请让管理员重新生成。"}, 404)
    form = RegisForm.query.get(int(panel.get("form_id") or 0))
    if not form:
        return json_response({"status": "error", "message": "表单不存在。"}, 404)
    groups = sorted(form.groups or [], key=lambda g: (g.order or 0, g.id))

    # 每组成员（仅 姓名/年龄/性别）
    links = db.session.execute(
        regis_form_member.select().where(regis_form_member.c.form_id == form.id)
    ).fetchall()
    group_of = {row.member_id: row.group_id for row in links}
    leader_of = {g.id: g.leader_member_id for g in groups}
    members_by_gid = {}
    for member in (form.members or []):
        gid = group_of.get(member.id)
        if gid is None:
            continue
        latest = member.latest_data()
        try:
            age = _calc_age_from_nric(member.nric)
        except Exception:  # noqa: BLE001
            age = None
        members_by_gid.setdefault(gid, []).append({
            "name": (latest.name_cn or latest.name) if latest else "",
            "age": age,
            "gender": (latest.gender if latest else "") or "",
            "is_leader": leader_of.get(gid) == member.id,
        })
    # 组长排在最前
    for rows in members_by_gid.values():
        rows.sort(key=lambda r: (0 if r.get("is_leader") else 1))

    groups_out = []
    for g in groups:
        gd = g.to_dict()
        gd["members"] = members_by_gid.get(g.id, [])
        groups_out.append(gd)

    return json_response({
        "status": "success",
        "creator_name": panel.get("creator_name"),
        "form_id": form.id,
        "form_title": form.title,
        "palette": PALETTE,
        "groups": groups_out,
    })


def score_panel_adjust(token, data):
    panel = _fetch_panel(token)
    if not panel:
        return json_response({"status": "error", "message": "链接已失效。"}, 404)
    form_id = int(panel.get("form_id") or 0)
    data = data or {}
    try:
        delta = int(data.get("delta") or 0)
    except (TypeError, ValueError):
        return json_response({"status": "error", "message": "分数需为整数。"}, 400)
    if not delta:
        return json_response({"status": "error", "message": "分数不能为 0。"}, 400)

    group = RegisFormGroup.query.get(data.get("group_id")) if data.get("group_id") else None
    if not group or group.form_id != form_id:
        return json_response({"status": "error", "message": "小组不存在。"}, 400)

    group.score = (group.score or 0) + delta
    _write_log(form_id, group, delta, panel.get("creator_name"))
    db.session.commit()
    _emit_group(form_id, group)
    return json_response({"status": "success", "group": group.to_dict()})


# -------- 管理员端：加/扣分（写日志 + 广播）、设颜色、查记录 --------
def admin_adjust_score(group_id, data):
    group = RegisFormGroup.query.get_or_404(group_id)
    data = data or {}
    if "delta" in data:
        try:
            delta = int(data.get("delta") or 0)
        except (TypeError, ValueError):
            return json_response({"status": "error", "message": "加减分需为整数。"}, 400)
        if delta:
            group.score = (group.score or 0) + delta
            _write_log(group.form_id, group, delta, _actor_display_name())
    elif "score" in data:
        try:
            group.score = int(data.get("score") or 0)
        except (TypeError, ValueError):
            return json_response({"status": "error", "message": "分数需为整数。"}, 400)
    else:
        return json_response({"status": "error", "message": "缺少 delta 或 score。"}, 400)

    db.session.commit()
    _emit_group(group.form_id, group)
    return json_response({"status": "success", "group": group.to_dict()})


def set_group_color(group_id, data):
    group = RegisFormGroup.query.get_or_404(group_id)
    color = str((data or {}).get("color") or "").strip() or None
    if color is not None and color not in PALETTE:
        return json_response({"status": "error", "message": "颜色无效。"}, 400)
    group.color = color
    db.session.commit()
    _emit_group(group.form_id, group)
    return json_response({"status": "success", "group": group.to_dict()})


def set_group_leader(group_id, data):
    group = RegisFormGroup.query.get_or_404(group_id)
    mid = (data or {}).get("member_id")
    if mid in (None, "", 0, "0"):
        group.leader_member_id = None
    else:
        try:
            mid = int(mid)
        except (TypeError, ValueError):
            return json_response({"status": "error", "message": "member_id 无效。"}, 400)
        link = db.session.execute(
            regis_form_member.select().where(
                regis_form_member.c.form_id == group.form_id,
                regis_form_member.c.member_id == mid,
            )
        ).first()
        if not link:
            return json_response({"status": "error", "message": "该成员未报名此表单。"}, 400)
        group.leader_member_id = mid
    db.session.commit()
    _emit_group(group.form_id, group)
    return json_response({"status": "success", "group": group.to_dict()})


def group_score_log(group_id):
    group = RegisFormGroup.query.get_or_404(group_id)
    logs = (
        RegisFormGroupScoreLog.query
        .filter_by(group_id=group.id)
        .order_by(RegisFormGroupScoreLog.created_at.desc(), RegisFormGroupScoreLog.id.desc())
        .limit(200)
        .all()
    )
    return json_response({"status": "success", "group": group.to_dict(), "logs": [x.to_dict() for x in logs]})
