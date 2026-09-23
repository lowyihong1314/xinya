"""业务用的同步 Redis 客户端（单例）。

原 app/redis_client.py，地址是写死的 ``localhost:6379/0``；现在读
``settings.redis_url`` —— 切换前对拍过，两者完全一致，所以连的还是同一个库。

与 core/realtime.py 里那个 ``_sync_redis()`` 的分工：
  · 这里是**业务数据**用的（限流计数、房间状态、OCR 任务队列…），进程内单例，
    导入即建连接；
  · realtime 那个是**推送通道**专用，懒建连接（worker 子进程是 fork/spawn 出来的，
    导入期就建好连接会父子共用 socket 互相踩），并且带读写超时。
  两者连的是同一个 Redis，分开只是为了让转码线程卡住时不会拖垮业务查询。

``decode_responses=True``：取出来直接是 str，全项目的调用点都按 str 写的，
改成 False 会让每一处 ``.get()`` 的返回值变 bytes，静默走错分支。
"""

import redis

from backend.core.config import settings

redis_client = redis.StrictRedis.from_url(
    settings.redis_url,
    decode_responses=True,
)
