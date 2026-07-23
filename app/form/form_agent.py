"""报名表 AI Agent：对某张报名表的全部内容读+改。

模块：基本设置、分组、报名费、表格内容(额外字段)、报名成员。
异步：起子进程调 Ark（不阻塞 gunicorn），算完经 Redis → socket 事件
form_agent_reply 推回；前端预览方案后点「应用」落地。

隐私：发给模型的成员只含 id/姓名/年龄/性别/组名（不含 NRIC、电话）。
"""
import json
import re
import subprocess
import sys
import uuid

from flask import jsonify

from app.paths import PROJECT_ROOT
from models import db
from models.form import (
    NRIC_Asset,
    RegisForm,
    RegisFormExtraFieldConfig,
    RegisFormGroup,
    RegistrationFee,
    regis_form_member,
)

from .ai_grouping import _ark_api_key, _call_ark_chat, _member_context
from .realtime import emit_form_event
from .services import _extract_field_switches, _normalize_max_members


def _form_agent_room(form_id):
    return f"form_agent_{form_id}"


SYSTEM_PROMPT = (
    "你是「报名表助理 Agent」，帮管理员管理某一张报名表的全部内容。请始终用中文回复。\n"
    "你能读取并修改：基本设置、分组、报名费、表格内容(额外字段)、报名成员。**不能新建报名表**。\n\n"
    "规则：\n"
    "- 只是提问时（例如「有几个未分组」「报名费多少」「姓黄的有几个」），直接用中文回答，不要输出 JSON。\n"
    "- 需要改动时，先用中文简要说明，然后在回复最后附一个 ```json 代码块，只放需要改的部分：\n"
    "{\n"
    '  "settings": {"title":"","detail":"","expired":"YYYY-MM-DD","max_members":50,"closed_manually":false,\n'
    '               "field_switches":{"email":true,"parental_form":true,"parent_1":true,"parent_2":false,"address":false,"medical":false,"allergy":false,"other_remark":false}},\n'
    '  "groups": {"groups":[{"name":"小组1","member_ids":[1,2]}], "rename":[{"from":"小组2","to":"红队"}], "delete":["小组3"]},\n'
    '  "fees": {"add":[{"category":"成人","amount":50,"age_range_from":18,"age_range_to":null,"description":""}], "update":[{"id":1,"amount":60}], "delete":[2]},\n'
    '  "extra_fields": {"add":[{"label":"紧急联络人","field_type":"text","options":null}], "update":[{"id":1,"label":""}], "delete":[2]},\n'
    '  "members": {"remove":[3]}\n'
    "}\n"
    "- 只输出确实要改的字段/模块；update/delete/rename 用下面数据里给出的 id 或组名。\n"
    "- groups.groups 把成员放进该组（组名不存在会新建）；member_ids 用成员 id。\n"
    "- 金额单位 RM。field_type 可用 text/number/select/checkbox。\n"
    "⚠️ 重要：fees/extra_fields/members 必须是 {\"add\":[],\"update\":[],\"delete\":[]} 这种**对象**，"
    "只列要改动的项，**绝不要**照抄下面数据里的整段列表。\n\n"
    "示例——用户说「加一个成人报名费 RM50，并把第 1 组改名叫红队」，你回复：\n"
    "好的，已新增成人报名费 RM50，并把小组1改名为红队。\n"
    "```json\n{\"fees\":{\"add\":[{\"category\":\"成人\",\"amount\":50}]},\"groups\":{\"rename\":[{\"from\":\"小组1\",\"to\":\"红队\"}]}}\n```\n"
)


def _form_context(form):
    groups = sorted(form.groups or [], key=lambda g: (g.order or 0, g.id))
    fees = [
        {
            "id": f.id, "category": f.category, "amount": float(f.amount or 0),
            "age_range_from": f.age_range_from, "age_range_to": f.age_range_to,
            "description": f.description,
        }
        for f in (form.fees or [])
    ]
    extra_fields = [
        {"id": c.id, "label": c.label, "field_type": c.field_type, "options": c.options, "order": c.order}
        for c in sorted(form.extra_field_configs or [], key=lambda c: (c.order or 0, c.id))
    ]
    events = [{"id": e.id, "event_name": getattr(e, "event_name", None)} for e in (form.events or [])]
    return {
        "settings": {
            "title": form.title,
            "detail": form.detail,
            "expired": form.expired.isoformat() if form.expired else None,
            "max_members": form.max_members,
            "closed_manually": bool(form.closed_manually),
            "field_switches": form.field_switches_dict(),
        },
        "groups": [{"id": g.id, "name": g.name} for g in groups],
        "fees": fees,
        "extra_fields": extra_fields,
        "events": events,
        "members": _member_context(form),
    }


def _spawn_worker(job_payload):
    process = subprocess.Popen(
        [sys.executable, "-m", "app.form.form_agent_worker"],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=PROJECT_ROOT,
        start_new_session=True,
    )
    process.stdin.write(json.dumps(job_payload, ensure_ascii=False).encode("utf-8"))
    process.stdin.close()


def form_agent_chat(form_id, data):
    form = RegisForm.query.get_or_404(form_id)
    raw = (data or {}).get("messages") or []
    history = [
        {"role": m.get("role"), "content": str(m.get("content") or "").strip()}
        for m in raw
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and str(m.get("content") or "").strip()
    ]
    if not history:
        return jsonify({"status": "error", "message": "缺少对话内容"}), 400
    history = history[-20:]
    if not _ark_api_key():
        return jsonify({"status": "error", "message": "AI 未配置（缺少 BytePlus/Ark API key）"}), 502

    context = _form_context(form)
    system_content = (
        SYSTEM_PROMPT
        + f"\n当前报名表：#{form.id} {form.title or ''}\n表格数据："
        + json.dumps(context, ensure_ascii=False)
    )
    messages = [{"role": "system", "content": system_content}] + history

    job_id = uuid.uuid4().hex
    room = _form_agent_room(form.id)
    try:
        _spawn_worker({"job_id": job_id, "room": room, "messages": messages})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"status": "error", "message": f"AI 任务启动失败：{exc}"}), 500
    return jsonify({"status": "success", "job_id": job_id, "room": room})


def _extract_plan(text):
    block = None
    fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", text or "")
    if fenced:
        block = fenced.group(1)
    else:
        bare = re.search(r"(\{[\s\S]*\"(?:settings|groups|fees|extra_fields|members)\"[\s\S]*\})", text or "")
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
    plan = {k: obj[k] for k in ("settings", "groups", "fees", "extra_fields", "members") if obj.get(k)}
    return plan or None


def run_form_agent_job(job_payload):
    from app.extensions import socket_broker

    job_id = job_payload.get("job_id")
    room = job_payload.get("room")
    try:
        reply = _call_ark_chat(job_payload.get("messages") or [])
        plan = _extract_plan(reply)
        socket_broker.emit(
            "form_agent_reply",
            {"job_id": job_id, "room": room, "status": "success", "reply": reply, "plan": plan},
            room=room,
        )
    except Exception as exc:  # noqa: BLE001
        socket_broker.emit(
            "form_agent_reply",
            {"job_id": job_id, "room": room, "status": "error", "message": str(exc)},
            room=room,
        )


def _is_int(v):
    try:
        int(v)
        return True
    except (TypeError, ValueError):
        return False


def _to_amount(v):
    from decimal import Decimal, InvalidOperation

    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


def apply_form_agent_plan(form_id, data):
    form = RegisForm.query.get_or_404(form_id)
    plan = (data or {}).get("plan") or (data or {})
    if not isinstance(plan, dict):
        return jsonify({"status": "error", "message": "没有可应用的操作"}), 400
    summary = []

    # --- 基本设置 ---
    s = plan.get("settings")
    if isinstance(s, dict):
        if "title" in s and str(s["title"]).strip():
            form.title = str(s["title"]).strip()
            summary.append("设置·标题")
        if "detail" in s:
            form.detail = str(s["detail"] or "")
            summary.append("设置·详情")
        if "expired" in s and s["expired"]:
            from datetime import datetime as _dt
            try:
                form.expired = _dt.strptime(str(s["expired"])[:10], "%Y-%m-%d").date()
                summary.append("设置·截止")
            except Exception:  # noqa: BLE001
                pass
        if "max_members" in s:
            try:
                form.max_members = _normalize_max_members(s["max_members"])
                summary.append("设置·名额")
            except ValueError:
                pass
        if "closed_manually" in s:
            form.closed_manually = bool(s["closed_manually"])
            summary.append("设置·报名开关")
        switches = _extract_field_switches(s)
        for key in ["email", "parental_form", "address", "medical", "allergy", "other_remark"]:
            if key in switches:
                setattr(form, key, switches[key])
                summary.append(f"开关·{key}")
        if "parent_1" in switches:
            form.parent_1 = switches["parent_1"]
            form.parent_1_phone = switches["parent_1"]
            summary.append("开关·parent_1")
        if "parent_2" in switches:
            form.parent_2 = switches["parent_2"]
            form.parent_2_phone = switches["parent_2"]
            summary.append("开关·parent_2")

    # --- 分组 ---
    g = plan.get("groups") if isinstance(plan.get("groups"), dict) else {}
    existing_groups = {gr.name: gr for gr in (form.groups or [])}
    for item in g.get("rename") or []:
        frm = str((item or {}).get("from") or "").strip()
        to = str((item or {}).get("to") or "").strip()
        gr = existing_groups.get(frm)
        if gr and to:
            gr.name = to
            existing_groups.pop(frm, None)
            existing_groups[to] = gr
            summary.append("改组名")
    for name in g.get("delete") or []:
        gr = existing_groups.get(str(name).strip())
        if gr:
            db.session.delete(gr)
            existing_groups.pop(str(name).strip(), None)
            summary.append("删小组")
    if g.get("rename") or g.get("delete"):
        db.session.flush()
    valid_member_ids = {m.id for m in (form.members or [])}
    next_order = max([gr.order or 0 for gr in existing_groups.values()], default=-1)
    assigned = set()
    for grp in g.get("groups") or []:
        name = str((grp or {}).get("name") or "").strip()
        if not name:
            continue
        target = existing_groups.get(name)
        if target is None:
            next_order += 1
            target = RegisFormGroup(form_id=form.id, name=name, order=next_order)
            db.session.add(target)
            db.session.flush()
            existing_groups[name] = target
        for mid in (grp.get("member_ids") or []):
            if not _is_int(mid):
                continue
            mid = int(mid)
            if mid not in valid_member_ids or mid in assigned:
                continue
            assigned.add(mid)
            db.session.execute(
                regis_form_member.update()
                .where(regis_form_member.c.form_id == form.id, regis_form_member.c.member_id == mid)
                .values(group_id=target.id)
            )
            summary.append("分组")

    # --- 报名费 ---
    fees = plan.get("fees") if isinstance(plan.get("fees"), dict) else {}
    fee_ids = {f.id: f for f in (form.fees or [])}
    for item in fees.get("add") or []:
        category = str((item or {}).get("category") or "").strip()
        amount = _to_amount(item.get("amount"))
        if not category or amount is None:
            continue
        db.session.add(RegistrationFee(
            regis_form_id=form.id, category=category[:100], amount=amount,
            age_range_from=int(item["age_range_from"]) if _is_int(item.get("age_range_from")) else None,
            age_range_to=int(item["age_range_to"]) if _is_int(item.get("age_range_to")) else None,
            description=(str(item.get("description") or "").strip() or None),
        ))
        summary.append("加报名费")
    for item in fees.get("update") or []:
        fee = fee_ids.get(item.get("id")) if isinstance(item, dict) else None
        if not fee:
            continue
        if "category" in item and str(item["category"]).strip():
            fee.category = str(item["category"]).strip()[:100]
        if "amount" in item and _to_amount(item["amount"]) is not None:
            fee.amount = _to_amount(item["amount"])
        if "age_range_from" in item:
            fee.age_range_from = int(item["age_range_from"]) if _is_int(item["age_range_from"]) else None
        if "age_range_to" in item:
            fee.age_range_to = int(item["age_range_to"]) if _is_int(item["age_range_to"]) else None
        if "description" in item:
            fee.description = str(item["description"] or "").strip() or None
        summary.append("改报名费")
    for fid in fees.get("delete") or []:
        fee = fee_ids.get(fid)
        if fee:
            db.session.delete(fee)
            summary.append("删报名费")

    # --- 表格内容(额外字段) ---
    ef = plan.get("extra_fields") if isinstance(plan.get("extra_fields"), dict) else {}
    ef_ids = {c.id: c for c in (form.extra_field_configs or [])}
    for item in ef.get("add") or []:
        label = str((item or {}).get("label") or "").strip()
        if not label:
            continue
        maxno = max([c.order or 0 for c in (form.extra_field_configs or [])], default=-1)
        opts = item.get("options")
        db.session.add(RegisFormExtraFieldConfig(
            regis_form_id=form.id, label=label[:255],
            field_type=str(item.get("field_type") or "text").strip() or "text",
            options=opts if isinstance(opts, list) else None,
            order=maxno + 1,
        ))
        summary.append("加表格内容")
    for item in ef.get("update") or []:
        c = ef_ids.get(item.get("id")) if isinstance(item, dict) else None
        if not c:
            continue
        if "label" in item and str(item["label"]).strip():
            c.label = str(item["label"]).strip()[:255]
        if "field_type" in item and str(item["field_type"]).strip():
            c.field_type = str(item["field_type"]).strip()
        if "options" in item:
            c.options = item["options"] if isinstance(item["options"], list) else None
        summary.append("改表格内容")
    for cid in ef.get("delete") or []:
        c = ef_ids.get(cid)
        if c:
            db.session.delete(c)
            summary.append("删表格内容")

    # --- 报名成员：移除 ---
    members = plan.get("members") if isinstance(plan.get("members"), dict) else {}
    member_by_id = {m.id: m for m in (form.members or [])}
    for mid in members.get("remove") or []:
        m = member_by_id.get(mid)
        if m is not None and m in form.members:
            form.members.remove(m)
            summary.append("移除成员")

    db.session.commit()
    try:
        emit_form_event(form.id, "update")
    except Exception as exc:  # noqa: BLE001
        print(f"[WS-DISCONNECTED] form agent emit skipped: {exc}")
    return jsonify({"status": "success", "count": len(summary), "summary": summary})
