"""报名成员「AI 分组」对话助手：复用 BytePlus/Ark 聊天补全。

- 只把「id / 姓名 / 年龄 / 性别 / 当前组名」发给模型（不含 NRIC、电话等）。
- 支持普通问答（如「姓黄的有几个」）与分组指令；分组时模型在回复末尾附
  ```json {"groups":[{"name","member_ids":[...]}]} ``` 代码块，前端点「应用」落地。
"""
import json
import re
import urllib.error
import urllib.request

from flask import jsonify

from app.email.service import env_value
from models import db
from models.form import NRIC_Asset, RegisForm, RegisFormGroup, regis_form_member

from .realtime import emit_form_event
from .services import _calc_age_from_nric


DEFAULT_ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
DEFAULT_ARK_MODEL = "seed-2-0-pro-260328"

SYSTEM_PROMPT = (
    "你是活动分组助理，帮管理员回答关于报名成员的问题、并按要求分组。请始终用中文回复。\n\n"
    "成员字段：id（内部编号，只用于分组引用）、name（姓名）、age（年龄，可能为 null）、"
    "gender（性别）、group（当前所在小组名，null 表示未分组）。\n\n"
    "规则：\n"
    "- 只是提问时（例如「姓黄的有几个」「各组几人」「谁未分组」），直接用中文回答，不要输出 JSON。\n"
    "- 需要分组/建组/改名/删组时，先用中文简要说明，然后在回复最后附一个 ```json 代码块，可含以下任意字段：\n"
    '  {\n'
    '    "groups": [{"name":"小组1","member_ids":[1,2]}],   // 把这些成员放进该组；组名不存在会自动新建\n'
    '    "rename": [{"from":"小组2","to":"红队"}],            // 重命名已有小组\n'
    '    "delete": ["小组3"]                                  // 删除小组（组内成员变回未分组）\n'
    "  }\n"
    "  member_ids 用成员 id；没提到的人保持原样。只在用户要求相应操作时才输出对应字段。\n"
    "- 若无特别说明，尽量让各组人数与年龄均衡；用户点名要在一起的人务必放同一组。\n"
)


def _ark_api_key():
    return (env_value("BYTEPLUS_API_KEY") or env_value("ARK_API_KEY") or "").strip()


def _ark_base_url():
    return (env_value("BYTEPLUS_BASE_URL") or DEFAULT_ARK_BASE_URL).strip()


def _ark_model():
    return (env_value("BYTEPLUS_MODEL") or DEFAULT_ARK_MODEL).strip()


def _call_ark_chat(messages, temperature=0.3, max_tokens=1600):
    key = _ark_api_key()
    if not key:
        raise ValueError("AI 未配置（缺少 BytePlus/Ark API key）")

    payload = {
        "model": _ark_model(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        # 关闭「深度思考」，把分组这类任务从 ~12s 降到 ~3.5s，避免 gunicorn 超时。
        "thinking": {"type": "disabled"},
    }
    request_obj = urllib.request.Request(
        f"{_ark_base_url()}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=90) as response:
            data = json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise ValueError(f"AI 服务错误（{exc.code}）：{detail}")
    except urllib.error.URLError as exc:
        raise ValueError(f"AI 服务暂时无法连接：{exc.reason}")

    try:
        return data["choices"][0]["message"]["content"]
    except Exception as exc:  # noqa: BLE001
        raise ValueError("AI 返回格式异常") from exc


def _member_context(form):
    links = db.session.execute(
        regis_form_member.select().where(regis_form_member.c.form_id == form.id)
    ).fetchall()
    group_of = {row.member_id: row.group_id for row in links}
    group_names = {g.id: g.name for g in (form.groups or [])}

    rows = []
    for member in (form.members or []):
        latest = member.latest_data()
        try:
            age = _calc_age_from_nric(member.nric)
        except Exception:  # noqa: BLE001
            age = None
        rows.append(
            {
                "id": member.id,
                "name": (latest.name_cn or latest.name) if latest else "",
                "age": age,
                "gender": (latest.gender if latest else "") or "",
                "group": group_names.get(group_of.get(member.id)),
            }
        )
    return rows


def _is_int(value):
    try:
        int(value)
        return True
    except (TypeError, ValueError):
        return False


def _extract_plan(text, valid_ids, existing_names):
    block = None
    fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", text or "")
    if fenced:
        block = fenced.group(1)
    else:
        bare = re.search(r"(\{[\s\S]*\"(?:groups|rename|delete)\"[\s\S]*\})", text or "")
        if bare:
            block = bare.group(1)
    if not block:
        return None
    try:
        obj = json.loads(block)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(obj, dict):
        return None

    plan = {}

    groups = obj.get("groups")
    if isinstance(groups, list):
        cleaned = []
        for group in groups:
            if not isinstance(group, dict):
                continue
            name = str(group.get("name") or "").strip()
            ids = [
                int(mid)
                for mid in (group.get("member_ids") or [])
                if _is_int(mid) and int(mid) in valid_ids
            ]
            if name and ids:
                cleaned.append({"name": name, "member_ids": ids})
        if cleaned:
            plan["groups"] = cleaned

    rename = obj.get("rename")
    if isinstance(rename, list):
        cleaned = []
        for item in rename:
            if not isinstance(item, dict):
                continue
            frm = str(item.get("from") or "").strip()
            to = str(item.get("to") or "").strip()
            if frm and to and frm != to and frm in existing_names:
                cleaned.append({"from": frm, "to": to})
        if cleaned:
            plan["rename"] = cleaned

    delete = obj.get("delete")
    if isinstance(delete, list):
        cleaned = [str(x).strip() for x in delete if str(x).strip() in existing_names]
        if cleaned:
            plan["delete"] = cleaned

    return plan or None


def ai_group_chat(form_id, data):
    form = RegisForm.query.get_or_404(form_id)
    raw_messages = (data or {}).get("messages") or []
    history = [
        {"role": item.get("role"), "content": str(item.get("content") or "").strip()}
        for item in raw_messages
        if isinstance(item, dict)
        and item.get("role") in ("user", "assistant")
        and str(item.get("content") or "").strip()
    ]
    if not history:
        return jsonify({"status": "error", "message": "缺少对话内容"}), 400
    # 限制上下文长度，避免过长对话拖慢/超额。
    history = history[-20:]

    context = _member_context(form)
    group_names = [g.name for g in sorted(form.groups or [], key=lambda x: (x.order or 0, x.id))]
    system_content = (
        SYSTEM_PROMPT
        + "\n现有小组名："
        + json.dumps(group_names, ensure_ascii=False)
        + "\n成员数据："
        + json.dumps(context, ensure_ascii=False)
    )
    messages = [{"role": "system", "content": system_content}] + history

    try:
        reply = _call_ark_chat(messages)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 502

    plan = _extract_plan(reply, {row["id"] for row in context}, set(group_names))
    return jsonify({"status": "success", "reply": reply, "plan": plan})


def apply_group_plan(form_id, data):
    form = RegisForm.query.get_or_404(form_id)
    plan = (data or {}).get("plan") or (data or {})
    if not isinstance(plan, dict):
        return jsonify({"status": "error", "message": "没有可应用的分组方案"}), 400

    groups = plan.get("groups") if isinstance(plan.get("groups"), list) else []
    renames = plan.get("rename") if isinstance(plan.get("rename"), list) else []
    deletes = plan.get("delete") if isinstance(plan.get("delete"), list) else []
    if not (groups or renames or deletes):
        return jsonify({"status": "error", "message": "没有可应用的分组方案"}), 400

    existing = {g.name: g for g in (form.groups or [])}

    # 1) 改名
    renamed = 0
    for item in renames:
        if not isinstance(item, dict):
            continue
        frm = str(item.get("from") or "").strip()
        to = str(item.get("to") or "").strip()
        target = existing.get(frm)
        if target is not None and to:
            target.name = to
            existing.pop(frm, None)
            existing[to] = target
            renamed += 1

    # 2) 删除（组内成员由外键 SET NULL 变回未分组）
    deleted = 0
    for name in deletes:
        name = str(name).strip()
        target = existing.get(name)
        if target is not None:
            db.session.delete(target)
            existing.pop(name, None)
            deleted += 1
    if renamed or deleted:
        db.session.flush()

    # 3) 分组（组名不存在则新建）
    valid_member_ids = {member.id for member in (form.members or [])}
    next_order = max([g.order or 0 for g in existing.values()], default=-1)
    assigned = set()
    for group in groups:
        if not isinstance(group, dict):
            continue
        name = str(group.get("name") or "").strip()
        if not name:
            continue
        target = existing.get(name)
        if target is None:
            next_order += 1
            target = RegisFormGroup(form_id=form.id, name=name, order=next_order)
            db.session.add(target)
            db.session.flush()
            existing[name] = target
        for mid in (group.get("member_ids") or []):
            if not _is_int(mid):
                continue
            mid = int(mid)
            if mid not in valid_member_ids or mid in assigned:
                continue
            assigned.add(mid)
            db.session.execute(
                regis_form_member.update()
                .where(
                    regis_form_member.c.form_id == form.id,
                    regis_form_member.c.member_id == mid,
                )
                .values(group_id=target.id)
            )

    db.session.commit()
    try:
        emit_form_event(form.id, "update")
    except Exception as exc:  # noqa: BLE001
        print(f"[WS-DISCONNECTED] ai group apply emit skipped: {exc}")
    return jsonify({
        "status": "success",
        "assigned": len(assigned),
        "renamed": renamed,
        "deleted": deleted,
    })
