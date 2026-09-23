"""活动 AI Agent：对当前活动的各模块（基本设置 / 待办 / 预算 / 流程）读+改。

原 backend/app/event/agent.py。

- 不能创建活动，只操作「当前活动」。
- 异步：起子进程调 Ark（不阻塞 worker），算完经 Redis 推回前端；
  前端预览方案后点「应用」落地。

── 搬迁时改动的三处（都是「不改就把 Flask 拉回进程 / 就跑不起来」）────────

  ① ``from backend.app.form.ai_grouping import _ark_api_key, _call_ark_chat``
     → ``from .ark import ...``。ai_grouping.py 顶部有 ``from flask import jsonify``，
     借两个函数会把整个 Flask 栈拖进来 —— 而干活的是**子进程**，更不该背它。
     见 ark.py 的模块头。

  ② 子进程的模块路径 ``backend.app.event.agent_worker``
     → ``backend.api.event.agent_worker``。这是**字符串**，IDE 和静态检查都抓不到，
     改漏了的表现是：接口照常回 200 + job_id，但前端永远等不到 event_agent_reply
     （子进程起来后 ModuleNotFoundError，stderr 又被 DEVNULL 吞了）。

  ③ ``socket_broker.emit(evt, data, room=R)``
     → ``publish_sync("event", R, evt, data)``（core.realtime，走 Redis → SSE）。
     **room 字符串保持 "event_agent_{id}" 原样**，没有按 core.realtime 模块头
     那条「把前缀剥给 {app} 承担」的约定改成裸 id —— 因为这个字符串同时是
     ``/agent/chat`` 响应体里的 ``room`` 字段，前端拿它去订阅。
     要改就得前后端一起改，不在本次搬迁范围内。
     Redis 频道因此是 ``rt:event:event_agent_{id}``。
     ⚠️ 前端还没切到 SSE 之前，这些消息**没有订阅者**（与 quiz / changyou_room
     模块当前的处境一样）。

★ 「看着像 bug、故意保留」：
  · ``apply_event_agent_plan`` 里 ``tasks.get("add")`` 循环每一轮都重算一次 maxno，
    但新加的行要 flush 之后才进 ``event.event_tasks``，所以一次加多条时 no 会重复。
    照搬不修 —— 排序只按 (no, id)，重复 no 的表现是「同 no 内按 id 排」，不影响正确性。
  · ``run_event_agent_job`` 把任何异常都转成 ``status: "error"`` 推回去，
    包括 ``_call_ark_chat`` 抛的 ValueError。子进程没有别的出口（stderr 被丢弃）。
"""
import json
import re
import subprocess
import sys
import uuid

from backend.core.paths import PROJECT_ROOT
from backend.core.realtime import publish_sync
from backend.core.responses import json_response
from backend.models import db
from backend.models.event_data import EventBudgetData, EventData, EventFlowData, EventTaskData

from .ark import _ark_api_key, _call_ark_chat
from .service import _norm_task_status, _parse_amount, _parse_task_date, parse_datetime

# core.realtime 的 {app} 段。房间 id 见模块头 ③。
REALTIME_APP = "event"


def _agent_room(event_id):
    return f"event_agent_{event_id}"


SYSTEM_PROMPT = (
    "你是「活动助理 Agent」，帮管理员管理某一个活动的各个模块。请始终用中文回复。\n"
    "你能读取并修改：基本设置、待办事项、财政预算、流程表。**不能新建活动**，只操作当前这个活动。\n\n"
    "规则：\n"
    "- 只是提问时（例如「预算合计多少」「还有哪些待办没完成」「流程几点午餐」），直接用中文回答，不要输出 JSON。\n"
    "- 需要改动时，先用中文简要说明你要做什么，然后在回复最后附一个 ```json 代码块，只放需要改的部分：\n"
    "{\n"
    '  "settings": {"event_name":"","type":"","location":"","target":"","purpose":"","datetime":"YYYY-MM-DD HH:MM","end_datetime":"YYYY-MM-DD HH:MM"},\n'
    '  "tasks":  {"add":[{"title":"","assignee":"","status":"todo|doing|done","due_date":"YYYY-MM-DD","remark":""}], "update":[{"id":1,"title":"","status":"done"}], "delete":[2]},\n'
    '  "budget": {"add":[{"category":"","budget_amount":0,"actual_amount":0,"remark":""}], "update":[{"id":1,"budget_amount":500}], "delete":[2]},\n'
    '  "flow":   {"add":[{"title":"","minutes":30,"detail":""}], "update":[{"id":1,"minutes":45}], "delete":[2], "reorder":[3,1,2]}\n'
    "}\n"
    "- 只输出确实要改的字段/模块；update/delete 用下面数据里给出的 id。flow 的 minutes 是该环节时长（分钟）。\n"
    "- 待办状态：todo=待办 doing=进行中 done=完成。金额单位 RM。\n"
    "⚠️ 重要：tasks/budget/flow 必须是 {\"add\":[],\"update\":[],\"delete\":[]} 这种**对象**，"
    "只列出要改动的项；**绝对不要**照抄上面活动数据里的整段列表。\n\n"
    "示例——用户说「把午餐预算设成 500，加个待办买急救包」（假设午餐预算 id=5），你回复：\n"
    "好的，已把午餐预算改成 RM500，并新增待办「买急救包」。\n"
    "```json\n{\"budget\":{\"update\":[{\"id\":5,\"budget_amount\":500}]},\"tasks\":{\"add\":[{\"title\":\"买急救包\"}]}}\n```\n"
)


def _event_context(event):
    def tasks():
        rows = sorted(event.event_tasks or [], key=lambda x: (x.no or 0, x.id))
        return [{"id": t.id, "title": t.title, "assignee": t.assignee, "status": t.status, "due_date": t.due_date.isoformat() if t.due_date else None, "remark": t.remark} for t in rows]

    def budget():
        rows = sorted(event.event_budgets or [], key=lambda x: (x.no or 0, x.id))
        return [{"id": b.id, "category": b.category, "budget_amount": float(b.budget_amount or 0), "actual_amount": float(b.actual_amount) if b.actual_amount is not None else None, "remark": b.remark} for b in rows]

    def flow():
        rows = sorted(event.event_flows or [], key=lambda x: (x.no or 0, x.id))
        return [{"id": f.id, "title": f.title, "minutes": f.minutes, "detail": f.detail} for f in rows]

    return {
        "settings": {
            "event_name": event.event_name,
            "type": event.type,
            "location": event.location,
            "target": event.target,
            "purpose": event.purpose,
            "datetime": event.datetime.isoformat() if event.datetime else None,
            "end_datetime": event.end_datetime.isoformat() if event.end_datetime else None,
        },
        "tasks": tasks(),
        "budget": budget(),
        "flow": flow(),
    }


def _spawn_agent_worker(job_payload):
    process = subprocess.Popen(
        # ★ 模块路径跟着包一起搬了，见模块头 ②。
        [sys.executable, "-m", "backend.api.event.agent_worker"],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=PROJECT_ROOT,
        start_new_session=True,
    )
    process.stdin.write(json.dumps(job_payload, ensure_ascii=False).encode("utf-8"))
    process.stdin.close()


def event_agent_chat(event_id, data):
    event = EventData.query.get_or_404(event_id)
    raw = (data or {}).get("messages") or []
    history = [
        {"role": m.get("role"), "content": str(m.get("content") or "").strip()}
        for m in raw
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and str(m.get("content") or "").strip()
    ]
    if not history:
        return json_response({"status": "error", "message": "缺少对话内容"}, 400)
    history = history[-20:]

    if not _ark_api_key():
        return json_response(
            {"status": "error", "message": "AI 未配置（缺少 BytePlus/Ark API key）"}, 502
        )

    context = _event_context(event)
    system_content = (
        SYSTEM_PROMPT
        + f"\n当前活动：#{event.id} {event.event_name or ''}\n活动数据："
        + json.dumps(context, ensure_ascii=False)
    )
    messages = [{"role": "system", "content": system_content}] + history

    job_id = uuid.uuid4().hex
    room = _agent_room(event.id)
    try:
        _spawn_agent_worker({"job_id": job_id, "room": room, "messages": messages})
    except Exception as exc:  # noqa: BLE001
        return json_response({"status": "error", "message": f"AI 任务启动失败：{exc}"}, 500)
    return json_response({"status": "success", "job_id": job_id, "room": room})


def _extract_plan(text):
    block = None
    fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", text or "")
    if fenced:
        block = fenced.group(1)
    else:
        bare = re.search(r"(\{[\s\S]*\"(?:settings|tasks|budget|flow)\"[\s\S]*\})", text or "")
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
    plan = {k: obj[k] for k in ("settings", "tasks", "budget", "flow") if obj.get(k)}
    return plan or None


def run_event_agent_job(job_payload):
    """子进程入口调用的那一层：调 Ark，成败都推一条 event_agent_reply 回去。

    ``publish_sync`` 自己吞异常只返回 bool（Redis 挂了也不抛），所以这里不检查
    返回值 —— 检查了也只能再写一遍日志，而子进程的 stderr 是 DEVNULL。
    """
    job_id = job_payload.get("job_id")
    room = job_payload.get("room")
    try:
        reply = _call_ark_chat(job_payload.get("messages") or [])
        plan = _extract_plan(reply)
        publish_sync(
            REALTIME_APP,
            str(room),
            "event_agent_reply",
            {"job_id": job_id, "room": room, "status": "success", "reply": reply, "plan": plan},
        )
    except Exception as exc:  # noqa: BLE001
        publish_sync(
            REALTIME_APP,
            str(room),
            "event_agent_reply",
            {"job_id": job_id, "room": room, "status": "error", "message": str(exc)},
        )


def _is_int(v):
    try:
        int(v)
        return True
    except (TypeError, ValueError):
        return False


def apply_event_agent_plan(event_id, data):
    event = EventData.query.get_or_404(event_id)
    plan = (data or {}).get("plan") or (data or {})
    if not isinstance(plan, dict):
        return json_response({"status": "error", "message": "没有可应用的操作"}, 400)

    summary = []

    # --- 基本设置 ---
    settings = plan.get("settings")
    if isinstance(settings, dict):
        for field in ("event_name", "type", "location", "target", "purpose"):
            if field in settings and settings[field] is not None:
                setattr(event, field, str(settings[field]).strip() or None)
                summary.append(f"设置·{field}")
        for field in ("datetime", "end_datetime"):
            if field in settings:
                val = settings[field]
                setattr(event, field, parse_datetime(val) if val else None)
                summary.append(f"设置·{field}")

    # --- 待办 ---
    tasks = plan.get("tasks") if isinstance(plan.get("tasks"), dict) else {}
    task_ids = {t.id: t for t in (event.event_tasks or [])}
    for item in tasks.get("add") or []:
        title = str((item or {}).get("title") or "").strip()
        if not title:
            continue
        maxno = max([t.no or 0 for t in (event.event_tasks or [])], default=0)
        db.session.add(EventTaskData(
            event_id=event.id, no=maxno + 1, title=title[:255],
            assignee=(str(item.get("assignee") or "").strip() or None),
            status=_norm_task_status(item.get("status")),
            due_date=_parse_task_date(item.get("due_date")),
            remark=(str(item.get("remark") or "").strip() or None),
        ))
        db.session.flush()
        summary.append("加待办")
    for item in tasks.get("update") or []:
        t = task_ids.get(item.get("id")) if isinstance(item, dict) else None
        if not t:
            continue
        if "title" in item and str(item["title"]).strip():
            t.title = str(item["title"]).strip()[:255]
        if "assignee" in item:
            t.assignee = str(item["assignee"] or "").strip() or None
        if "status" in item:
            t.status = _norm_task_status(item["status"])
        if "due_date" in item:
            t.due_date = _parse_task_date(item["due_date"])
        if "remark" in item:
            t.remark = str(item["remark"] or "").strip() or None
        summary.append("改待办")
    for tid in tasks.get("delete") or []:
        t = task_ids.get(tid)
        if t:
            db.session.delete(t)
            summary.append("删待办")

    # --- 预算 ---
    budget = plan.get("budget") if isinstance(plan.get("budget"), dict) else {}
    budget_ids = {b.id: b for b in (event.event_budgets or [])}
    for item in budget.get("add") or []:
        category = str((item or {}).get("category") or "").strip()
        if not category:
            continue
        maxno = max([b.no or 0 for b in (event.event_budgets or [])], default=0)
        db.session.add(EventBudgetData(
            event_id=event.id, no=maxno + 1, category=category[:255],
            budget_amount=_parse_amount(item.get("budget_amount")) or 0,
            actual_amount=_parse_amount(item.get("actual_amount")),
            remark=(str(item.get("remark") or "").strip() or None),
        ))
        db.session.flush()
        summary.append("加预算")
    for item in budget.get("update") or []:
        b = budget_ids.get(item.get("id")) if isinstance(item, dict) else None
        if not b:
            continue
        if "category" in item and str(item["category"]).strip():
            b.category = str(item["category"]).strip()[:255]
        if "budget_amount" in item:
            b.budget_amount = _parse_amount(item["budget_amount"]) or 0
        if "actual_amount" in item:
            b.actual_amount = _parse_amount(item["actual_amount"])
        if "remark" in item:
            b.remark = str(item["remark"] or "").strip() or None
        summary.append("改预算")
    for bid in budget.get("delete") or []:
        b = budget_ids.get(bid)
        if b:
            db.session.delete(b)
            summary.append("删预算")

    # --- 流程 ---
    flow = plan.get("flow") if isinstance(plan.get("flow"), dict) else {}
    flow_ids = {f.id: f for f in (event.event_flows or [])}
    for item in flow.get("add") or []:
        title = str((item or {}).get("title") or "").strip()
        if not title:
            continue
        maxno = max([f.no or 0 for f in (event.event_flows or [])], default=0)
        minutes = item.get("minutes")
        db.session.add(EventFlowData(
            event_id=event.id, no=maxno + 1,
            minutes=int(minutes) if _is_int(minutes) else None,
            title=title[:255],
            detail=(str(item.get("detail") or "").strip() or None),
        ))
        db.session.flush()
        summary.append("加流程")
    for item in flow.get("update") or []:
        f = flow_ids.get(item.get("id")) if isinstance(item, dict) else None
        if not f:
            continue
        if "title" in item and str(item["title"]).strip():
            f.title = str(item["title"]).strip()[:255]
        if "minutes" in item:
            f.minutes = int(item["minutes"]) if _is_int(item["minutes"]) else None
        if "detail" in item:
            f.detail = str(item["detail"] or "").strip() or None
        summary.append("改流程")
    for fid in flow.get("delete") or []:
        f = flow_ids.get(fid)
        if f:
            db.session.delete(f)
            summary.append("删流程")
    reorder = flow.get("reorder")
    if isinstance(reorder, list):
        order = 0
        for fid in reorder:
            f = flow_ids.get(fid)
            if f:
                order += 1
                f.no = order
        if order:
            summary.append("排序流程")

    db.session.commit()
    return json_response({"status": "success", "count": len(summary), "summary": summary})
