"""小组积分控制面板：Redis session（1 天过期）+ 积分变更日志 + socket 广播。

- 管理员在分组页生成一个短 token 链接（存 Redis，含生成者名字），
  链接可在任意设备打开（无需登录）来加/扣分。
- 任何显示分数的地方监听 socket 事件 group_score（房间 form_score_<form_id>）。
"""
import secrets
import time

from flask import jsonify, render_template
from flask_login import current_user

from app.extensions import socket_broker
from app.redis_client import redis_client
from models import db
from models.form import RegisForm, RegisFormGroup, RegisFormGroupScoreLog, regis_form_member

from .services import _calc_age_from_nric

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
    try:
        socket_broker.emit(
            "group_score",
            {
                "form_id": form_id, "group_id": group.id, "score": group.score or 0,
                "color": group.color, "name": group.name, "leader_member_id": group.leader_member_id,
            },
            room=_score_room(form_id),
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
    return jsonify({"status": "success", "token": token, "url": f"/api/form/score_panel/{token}"})


# -------- 公开面板（token 鉴权，无需登录）--------
def score_panel_page(token):
    del token
    return render_template("form/score_panel.html")


def score_panel_data(token):
    panel = _fetch_panel(token)
    if not panel:
        return jsonify({"status": "error", "message": "链接已失效，请让管理员重新生成。"}), 404
    form = RegisForm.query.get(int(panel.get("form_id") or 0))
    if not form:
        return jsonify({"status": "error", "message": "表单不存在。"}), 404
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

    return jsonify({
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
        return jsonify({"status": "error", "message": "链接已失效。"}), 404
    form_id = int(panel.get("form_id") or 0)
    data = data or {}
    try:
        delta = int(data.get("delta") or 0)
    except (TypeError, ValueError):
        return jsonify({"status": "error", "message": "分数需为整数。"}), 400
    if not delta:
        return jsonify({"status": "error", "message": "分数不能为 0。"}), 400

    group = RegisFormGroup.query.get(data.get("group_id")) if data.get("group_id") else None
    if not group or group.form_id != form_id:
        return jsonify({"status": "error", "message": "小组不存在。"}), 400

    group.score = (group.score or 0) + delta
    _write_log(form_id, group, delta, panel.get("creator_name"))
    db.session.commit()
    _emit_group(form_id, group)
    return jsonify({"status": "success", "group": group.to_dict()})


# -------- 管理员端：加/扣分（写日志 + 广播）、设颜色、查记录 --------
def admin_adjust_score(group_id, data):
    group = RegisFormGroup.query.get_or_404(group_id)
    data = data or {}
    if "delta" in data:
        try:
            delta = int(data.get("delta") or 0)
        except (TypeError, ValueError):
            return jsonify({"status": "error", "message": "加减分需为整数。"}), 400
        if delta:
            group.score = (group.score or 0) + delta
            _write_log(group.form_id, group, delta, _actor_display_name())
    elif "score" in data:
        try:
            group.score = int(data.get("score") or 0)
        except (TypeError, ValueError):
            return jsonify({"status": "error", "message": "分数需为整数。"}), 400
    else:
        return jsonify({"status": "error", "message": "缺少 delta 或 score。"}), 400

    db.session.commit()
    _emit_group(group.form_id, group)
    return jsonify({"status": "success", "group": group.to_dict()})


def set_group_color(group_id, data):
    group = RegisFormGroup.query.get_or_404(group_id)
    color = str((data or {}).get("color") or "").strip() or None
    if color is not None and color not in PALETTE:
        return jsonify({"status": "error", "message": "颜色无效。"}), 400
    group.color = color
    db.session.commit()
    _emit_group(group.form_id, group)
    return jsonify({"status": "success", "group": group.to_dict()})


def set_group_leader(group_id, data):
    group = RegisFormGroup.query.get_or_404(group_id)
    mid = (data or {}).get("member_id")
    if mid in (None, "", 0, "0"):
        group.leader_member_id = None
    else:
        try:
            mid = int(mid)
        except (TypeError, ValueError):
            return jsonify({"status": "error", "message": "member_id 无效。"}), 400
        link = db.session.execute(
            regis_form_member.select().where(
                regis_form_member.c.form_id == group.form_id,
                regis_form_member.c.member_id == mid,
            )
        ).first()
        if not link:
            return jsonify({"status": "error", "message": "该成员未报名此表单。"}), 400
        group.leader_member_id = mid
    db.session.commit()
    _emit_group(group.form_id, group)
    return jsonify({"status": "success", "group": group.to_dict()})


def group_score_log(group_id):
    group = RegisFormGroup.query.get_or_404(group_id)
    logs = (
        RegisFormGroupScoreLog.query
        .filter_by(group_id=group.id)
        .order_by(RegisFormGroupScoreLog.created_at.desc(), RegisFormGroupScoreLog.id.desc())
        .limit(200)
        .all()
    )
    return jsonify({"status": "success", "group": group.to_dict(), "logs": [x.to_dict() for x in logs]})
