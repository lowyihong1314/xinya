"""法会的出向实时推送：Socket.IO → SSE（core.realtime）的那层薄常量。

**搬迁时新增的文件，Flask 那边没有对应物。** 原来四处 ``socket_broker.emit(...)``
散在 ylp/services.py、ylp/board_services.py、ylp/board_routes.py 三个文件里，
app 名和房间名各写各的；集中到这里，是为了「频道名」只有一份真相。

    socket_broker.emit(evt, data, room=R)  → publish_sync(REALTIME_APP, R, evt, data)
    socket_broker.emit(evt, data)（无 room）→ publish_sync(REALTIME_APP, BROADCAST_ROOM, evt, data)

★ 为什么用 ``publish_sync`` 而不是 async 的 ``publish``
  四个发送点全在同步上下文里：FastAPI 的 ``def`` 路由跑在线程池、
  paiwei 的导出跑在普通后台线程，两处都碰不到事件循环，await 不了任何东西。

★ ``publish_sync`` 自己吞异常、只返回 bool，所以调用点原来那圈
  ``try: ... except Exception: pass`` 可以去掉，语义不变：
  **推送失败绝不能把正在进行的业务操作搞挂**。返回值故意不看。

★ 本模块**没有** ``core.realtime.register(RealtimeApp(...))``。也就是说在前端从
  Socket.IO 切到 SSE 之前，这些消息发出去**没有订阅者**（和 media / changyou_room
  现在一样）；旧那条链路仍由还没搬的 Flask 进程供着。等前端切过来时，
  authorize 回调要能认 board_terminal 的 30 天 token（core/realtime.py 的
  RealtimeApp 文档里已经把这件事记下了）。
"""

# core/realtime.py 频道里的 app 段（``rt:{app}:{room_id}``）。必须匹配
# ^[a-z][a-z0-9_]*$，也是前端将来订阅 SSE 时路径里的那个词。
# 叫 fahui_board 而不是 fahui：这四条消息全是「看板 / 订单列表要刷新了」这一类，
# 和将来可能出现的其它法会推送（点灯、报名）分开，免得一个频道什么都往里塞。
REALTIME_APP = "fahui_board"

# 原来 ``socket_broker.emit(evt, data)`` 不带 room 就是**广播给所有连接**。
# SSE 这边没有「全局」这种东西 —— 每条消息都必须落在某个频道上，所以给它一个固定房间。
# 选 "broadcast" 而不是复用某个业务 id，是为了保留原来「这条谁都收得到 /
# 那条只发给某个房间」的区分。
BROADCAST_ROOM = "broadcast"


# ⚠️ 下面这些房间名**原样保留了 Flask 时代带冒号的字符串**，没有拆成「裸 id」：
#
#   · ``fahui:board-terminal:{user_id}`` —— core/realtime.py 的 RealtimeApp 文档里
#     点名了这个房间（未登录的第二显示器凭 Redis 里的 30 天 token 进入），
#     两边写法必须一致。
#   · ``fahui:order:{order_id}`` —— 公开链接页在订阅它。
#   · ``paiwei_job:{job_id}``   —— 导出进度，前端拿 POST 回来的 ``room`` 字段直接订。
#
# 频道于是长成 ``rt:fahui_board:fahui:order:123``。room_id 里带冒号是安全的：
# core/realtime.py 的扇出是 ``channel[len("rt:"):]`` 整段当 key，不做二次 partition
# （只有 **app 名**不许带冒号，见 register() 里那句注释）。
