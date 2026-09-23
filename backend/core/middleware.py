"""core.middleware —— ASGI 中间件集合（给 asgi.py 装配用）。

设计见 docs/flask_to_fastAPI/04-兼容层设计.md §1、02-差异与风险.md §6、11-BASE_PATH.md §3。

这里的四件东西，每一件都在补回一个「Flask 有、Starlette 没有」的默认行为：

    ProxyHeadersMiddleware    ← Flask/werkzeug 的 X-Forwarded-* 处理（分享链接不变 127.0.0.1）
    BodySizeLimitMiddleware   ← Flask 的 MAX_CONTENT_LENGTH 自动 413
    DBSessionMiddleware       ← Flask-SQLAlchemy 按 app context 的会话作用域
    AuthContextMiddleware     ← flask_login 的 current_user（实现在 core/auth.py，这里只重导出）

── 四条都写成**纯 ASGI 类中间件**，不用 BaseHTTPMiddleware ──────────────────

BaseHTTPMiddleware 把下游跑在另一个 asyncio task 里，带来两个这个项目受不了的后果：

  ① contextvars 的传播方向不保证 —— 下游 set 的值不一定回得来。会话作用域和
     current_user 全靠 ContextVar，这一条直接动摇地基（见 core/db.py 红线 1）。
  ② 它的 try/finally 在**响应体开始流之前**就跑完了。对 JSONResponse 无所谓，
     对 SSE 来说等于「流还没发一个字节，Session 已经被 remove 了」。

纯 ASGI 中间件里 `await self.app(...)` 返回时，响应体已经发完，finally 的时机才是对的。

── 这些中间件必须用 app.add_middleware() 注册，不能在外面包一层 ───────────────

★ `FastAPI.__call__` 的第一件事是 `scope["root_path"] = self.root_path`。
  如果把 ProxyHeadersMiddleware 写成 `app = ProxyHeadersMiddleware(app)` 包在最外面，
  我们刚从 X-Forwarded-Prefix 解析出来的 root_path 会在下一行被 FastAPI **覆盖掉**，
  而且没有任何报错 —— 表现是「灰度域名复制出来的分享链接指向生产前缀」。
  用 add_middleware 注册的中间件跑在 FastAPI.__call__ **里面**，改 scope 才算数。
"""

from __future__ import annotations

import logging
from types import SimpleNamespace

from starlette.datastructures import Headers

# AuthContextMiddleware 故意不在本文件重新实现，只做一次重导出：
# 它要 set/reset 的两个 ContextVar（_current_user / _current_request）是 core/auth.py 的
# 模块私有状态，在这里另写一份就会出现「两套中间件各管一半」的局面 ——
# 而这类错误的症状正是串号（A 请求看到 B 的身份），且不报错。
# 重导出的好处：asgi.py 装配时四个中间件从同一个模块取，顺序一眼可见。
from backend.core.auth import AuthContextMiddleware
from backend.core.config import settings
from backend.core.db import close_scope, open_scope
from backend.core.responses import json_response
from backend.core.urls import base_path

log = logging.getLogger("backend.core.middleware")

__all__ = [
    "ProxyHeadersMiddleware",
    "BodySizeLimitMiddleware",
    "DBSessionMiddleware",
    "AuthContextMiddleware",
]


# ─────────────────────── 1. 反向代理头 ───────────────────────

# 只有「上一跳是自己人」时才信这些头。nginx 与应用同机，proxy_pass 打的是 127.0.0.1，
# 所以 scope["client"] 恒为回环地址。
# ★ 这一步不能省：X-Forwarded-Proto / X-Forwarded-Prefix 是**客户端可以自己写**的普通请求头。
#   谁都能直连 127.0.0.1:5006（内网、调试端口、漏配 proxy_set_header 的 location）
#   塞一个假前缀进来，让我们生成的分享链接指向他想要的地方。
# 空字符串是给「拿不到 client」的场景留的（某些 ASGI 测试驱动不填 client）。
_TRUSTED_PROXY_CLIENTS = frozenset({"127.0.0.1", "::1", "localhost", ""})


class ProxyHeadersMiddleware:
    """把 nginx 转发来的真实协议 / 前缀 / 客户端 IP 写回 ASGI scope。

    不装它的后果（02 文档 §6.3 列过）：

      · uvicorn 在 nginx 后面看到的 scheme 恒为 http，Host 恒为 127.0.0.1:5006。
        于是 `request.url_for()`、二维码、OG 图、邮件短信里的链接会拼成
        `http://127.0.0.1:5006/event/12` —— 发出去谁都打不开，而服务端日志一切正常。
      · 前缀丢失：nginx 用 `proxy_pass http://127.0.0.1:5006/;`（末尾斜杠）把 /UTBA_DEMO
        **剥掉**再转进来，应用自己看到的 path 里压根没有前缀。不从 X-Forwarded-Prefix
        补回 root_path，`request.url_for()` 出来的地址就少一段，点进去 404。

    ⚠️ 只改 scope，不改 `core.urls`。两边是互补的：
       core.urls.public_url()/absolute_url() 才是**生成对外 URL 的唯一出口**，
       它自己也读 X-Forwarded-Prefix，不依赖本中间件。这里写 root_path 是为了
       FastAPI 自带的 `url_for` / openapi servers / Mount 这些我们管不到的地方。
    """

    def __init__(self, app, trusted_clients=None):
        self.app = app
        self.trusted = (
            frozenset(trusted_clients) if trusted_clients is not None else _TRUSTED_PROXY_CLIENTS
        )

    async def __call__(self, scope, receive, send):
        # lifespan 没有 headers/client，直接放行。
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        peer = (client[0] if client else "") or ""
        if peer not in self.trusted:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)

        # 多层代理时这些头是逗号串（每跳追加一段），第一段才是最初的客户端信息。
        proto = (headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
        if proto in ("http", "https", "ws", "wss"):
            # websocket 的 scheme 只能是 ws/wss；nginx 转发的是 http/https，要翻译一下。
            scope["scheme"] = proto.replace("http", "ws") if scope["type"] == "websocket" else proto

        # 前缀的合法性校验（长度、字符集、非法值一律当没有）统一在 core.urls 里做，
        # 不在这里再写一遍 —— 两处规则一旦漂移，就会出现「URL 生成放行、路由不放行」的怪事。
        # 这里不构造完整的 Request：websocket scope 上构造 Request 会 assert，
        # 而 base_path() 只用到 .headers 这一个属性。
        prefix = base_path(SimpleNamespace(headers=headers))
        if prefix:
            scope["root_path"] = prefix

        forwarded_for = headers.get("x-forwarded-for")
        if forwarded_for:
            origin_ip = forwarded_for.split(",")[0].strip()
            if origin_ip:
                # nginx 的 $proxy_add_x_forwarded_for 只给裸 IP，不带端口，所以端口填 0。
                # 全项目没有任何地方读客户端端口（审计、限流都只看 IP），填 0 是安全的；
                # 真实 IP 则有人读 —— core/auth.py 的 _session_identifier 就是。
                scope["client"] = (origin_ip, 0)

        await self.app(scope, receive, send)


# ─────────────────────── 2. 请求体大小上限 ───────────────────────


class _BodyTooLarge(Exception):
    """内部信号，不外泄。"""


class BodySizeLimitMiddleware:
    """补回 Flask 的 MAX_CONTENT_LENGTH：超限返回 413，而不是把整个文件读进内存。

    Starlette **没有**这个开关（02 文档 §6.5）。少了它，一个 POST 就能让 worker
    把任意大的请求体读进内存 —— 4 个 worker 一起中招就是 OOM，systemd 重启，
    所有在线用户掉线，而日志里只有一条 Killed。

    ⚠️ **真正的第一道闸是 nginx 的 `client_max_body_size`**，不是这里。
       nginx 在请求进程序之前就能拒掉，代价小得多。这一层是「万一有人直连端口」
       以及「保持与 Flask 同样的 413 语义」的兜底。
       本项目现在两边的数字都大得离谱（应用 5000MB / nginx 50000M），
       所以这个中间件平时基本不会触发 —— 别把它当成「已经验证能传 5GB」。
    """

    def __init__(self, app, max_bytes=None):
        self.app = app
        self.max_bytes = int(settings.max_content_length if max_bytes is None else max_bytes)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or self.max_bytes <= 0:
            await self.app(scope, receive, send)
            return

        # 快路径：绝大多数客户端（浏览器 fetch、APK、curl）都会带 Content-Length，
        # 这时不用读一个字节就能拒掉。
        declared = Headers(scope=scope).get("content-length")
        if declared:
            try:
                if int(declared) > self.max_bytes:
                    await self._reject(scope, receive, send)
                    return
            except ValueError:
                # 畸形的 Content-Length 不在这里下判断：交给下面的流式计数，
                # 也交给服务器自己的协议解析去报错。
                pass

        received = 0
        started = False

        async def guarded_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body") or b"")
                if received > self.max_bytes:
                    # ★ 这里不能 raise HTTPException：ExceptionMiddleware（认得 HTTPException
                    #   的那一层）在所有用户中间件的**内侧**，我们抛的异常根本到不了它手上，
                    #   会一路冒到 ServerErrorMiddleware 变成 500。所以自己抛自己接。
                    raise _BodyTooLarge
            return message

        async def guarded_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, guarded_receive, guarded_send)
        except _BodyTooLarge:
            if started:
                # 响应头已经发出去了，没法再改成 413。只能让连接就这么断掉，
                # 客户端表现为「响应被截断」。记一条日志，否则这种情况无从查起。
                log.warning("请求体超限，但响应已开始，无法返回 413：%s", scope.get("path"))
                return
            await self._reject(scope, receive, send)

    async def _reject(self, scope, receive, send):
        log.warning("请求体超过上限 %d 字节，拒绝：%s %s",
                    self.max_bytes, scope.get("method"), scope.get("path"))
        response = json_response(
            # 旧形状：现在前端 400 个调用点都在按 {"status","message"} 分支，
            # 上传失败的提示框读的就是 message（见 core/responses.py 开头的说明）。
            {"status": "error", "message": "上传内容超过大小上限"},
            status_code=413,
            # 我们**没有把请求体读完**就回了响应。HTTP/1.1 的 keep-alive 下，
            # 没读完的那些字节会被当成下一个请求的开头，后续请求全部错位。
            # 明确要求关连接是唯一干净的做法（nginx 到上游走的就是 HTTP/1.1）。
            headers={"connection": "close"},
        )
        await response(scope, receive, send)


# ─────────────────────── 3. 数据库会话作用域 ───────────────────────


class DBSessionMiddleware:
    """每请求开一个数据库会话作用域，请求结束归还。

    ★★★ **整个迁移里最危险的一处。写错不会报错，只会静默把数据写给错的人。** ★★★

    Flask-SQLAlchemy 的会话作用域绑在 app context 上，一个请求一个。搬到 FastAPI 后，
    同步路由跑在 anyio 的工作线程池里，而**线程是复用的**：用 SQLAlchemy 默认的
    scoped_session（按线程分作用域）意味着第 17 个请求可能拿到第 3 个请求用过的那个
    Session —— 里面还留着人家 identity map 里的对象、甚至未提交的改动。
    症状是「A 用户偶尔看到 B 用户的数据」「改了别人的单」，
    而且**只在有并发的时候出现**，日志干干净净。这是 02 文档的 R3，灾难级。

    所以作用域键用 ContextVar 而不是线程（实现在 core/db.py，那边有完整说明），
    本中间件负责的只有两件事：进来 open_scope()、出去 close_scope(token)。

    ── 注册顺序的硬约束 ────────────────────────────────────────────────

    ★ **必须包在 AuthContextMiddleware 外面**（即比它先执行）。
      认证中间件要查 users 表才能解析出 current_user，那次查询必须落在一个已经打开的
      作用域里，否则 core/db.py 的 _scopefunc 会直接抛 RuntimeError —— 表现是
      **所有带 Cookie 的请求 500，匿名请求正常**（匿名路径不查库，被短路掉了），
      很容易被误判成「会话 Cookie 坏了」。

    ── SSE / 长流式响应的代价（必须知道）──────────────────────────────

    ⚠️ 纯 ASGI 中间件的 finally 要等响应体**全部发完**才跑。对一条挂一小时的 SSE 连接，
      意味着这一小时里它的作用域一直开着。作用域本身不占连接（scoped_session 是惰性的），
      但只要生成器里查过一次库，那条 PG 连接就会被这个 Session 一直握着不放。
      池子是 pool_size=8 + max_overflow=4 = 12 条/worker，十几条 SSE 就能占满，
      之后整个 worker 的所有请求都卡在等连接 —— 表现是「网站整个转圈」。

      解法不是改这里，是 SSE 端点自己在每次查库之后放手：

          snap = query_something()      # 用完了
          db.session.remove()           # 还连接；作用域还在，下次用会自动开新 Session

      （现在 core/realtime.py 的 authorize / snapshot 回调跑完**没有**做这件事，
        这是已知待补的一处，见交接说明。）
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        # lifespan 不开作用域：启动/关闭钩子里要碰库的话，请自己 `with db_session_scope():`。
        # 那里没有「一个请求」这种边界，硬给一个作用域反而会让启动期的 Session
        # 一直挂到进程退出。
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        token = open_scope()
        try:
            await self.app(scope, receive, send)
        finally:
            # 注意 close_scope 不会 commit —— 和 Flask-SQLAlchemy 一致，
            # 没显式 commit 的改动会被丢弃。别指望「请求结束自动保存」。
            close_scope(token)
