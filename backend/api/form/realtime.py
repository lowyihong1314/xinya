"""报名表的实时推送（原 backend/app/form/realtime.py）。

原文件走的是 ``backend.app.extensions.socket_broker``（Flask-SocketIO 的外部
message queue 客户端）。这里换成 ``core.realtime.publish_sync`` ——
同一条 Redis，但频道格式和消费端变了：Redis PUBLISH ``rt:form:{room}`` →
各 uvicorn worker 的扇出循环 → SSE 客户端。设计见 docs/flask_to_fastAPI/12。

★ **房间名一个字没改**（``wait_register_{form_id}`` / ``youth_class_registration``），
  没有按 core/realtime.py 模块头那条「把模块前缀剥给 {app} 承担」的约定改成裸 id。
  理由：房间名同时写在**推送消息体自己的 ``room`` 字段**里，前端拿它做路由；
  而且 ``ai_group_{id}`` / ``form_agent_{id}`` 这两个还会出现在 ``/agent/chat``
  的响应体里让前端订阅。要改就得前后端一起改，不在本次搬迁范围内。
  于是 Redis 频道是 ``rt:form:wait_register_12`` 这种形状 —— 能用，只是多一层前缀。

★ ⚠️ 前端还没切到 SSE 之前，这些消息**没有订阅者**（与 quiz / changyou_room /
  event 模块当前的处境一样）：推送发出去，没人收，业务本身不受影响。

★ ``publish_sync`` **自己吞异常**（Redis 挂了只返回 False，不抛）。所以调用点那些
  ``try: emit_form_event(...) except Exception: print("[WS-DISCONNECTED] …")``
  在新架构下永远不会命中 —— 原样留着不删：① 它们是「推送失败不能影响主流程」这条
  意图的记录；② 万一以后 publish_sync 改成会抛，那圈 try 就又有用了。
  本文件里 ``emit_youth_class_event`` 自带的那圈 try/except 同理，逐字保留。

★ **入向没有东西要转。** form 模块一个 Socket.IO handler 都没注册
  （``backend/app/socket_events.py`` 里搜不到本模块的任何房间），
  所以 docs/flask_to_fastAPI/16「入向事件转 POST」那套规则这里用不上。
  ⚠️ 也因此本模块**没有** ``core.realtime.register(RealtimeApp(...))``：
  没有 authorize / snapshot 回调，SSE 端点暂时不认 ``app=form``。
  TODO(前端切 SSE 时): 在这里补 register，把「谁能订阅 wait_register_{id}」
  （至少要 form_read）和首帧快照定下来。
"""

from backend.core.realtime import publish_sync

# core.realtime 的 {app} 段。房间 id 见模块头。
REALTIME_APP = "form"

YOUTH_CLASS_REGISTRATION_ROOM = "youth_class_registration"


def emit_form_event(form_id, event, payload=None):
    room = f"wait_register_{form_id}"
    message = {"event": event, "room": room, "form_id": form_id}
    if payload:
        message.update(payload)
    # 原：socket_broker.emit("new_register", message, room=room)
    publish_sync(REALTIME_APP, str(room), "new_register", message)


def emit_youth_class_event(event, payload=None):
    message = {
        "event": event,
        "room": YOUTH_CLASS_REGISTRATION_ROOM,
    }
    if payload:
        message.update(payload)
    try:
        # 原：socket_broker.emit("youth_class_registration_update", message, room=…)
        publish_sync(
            REALTIME_APP,
            YOUTH_CLASS_REGISTRATION_ROOM,
            "youth_class_registration_update",
            message,
        )
    except Exception as exc:
        # 见模块头：publish_sync 不抛，这一支走不到了。逐字保留。
        print(f"[WS-DISCONNECTED] Youth class emit skipped: {exc}")
