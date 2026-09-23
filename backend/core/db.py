"""core.db —— 替掉 Flask-SQLAlchemy 的 `db` 门面。

为什么要自己造这个东西：项目里有 3000+ 个 ``db.*`` 调用点、517 处 ``Model.query``，
手改既不可能，也没有测试兜得住。而 Flask-SQLAlchemy 其实只做三件事 ——
按 app context 分会话作用域、给 Model 挂 ``.query``、提供 ``get_or_404`` / ``paginate``；
底层早就是 SQLAlchemy 2.0。我们把这三件事自己实现，``models/`` 就能一个字不改。

这是**长期资产**，不是临时脚手架（04 文档 §5）：想干掉它 = 重写 3000 个调用点。

── 四条不要随手改的红线 ───────────────────────────────────────────────

1. 会话作用域用 ContextVar，**不是线程**。同步路由跑在 anyio 的工作线程池里，
   线程会被**复用**；用 SQLAlchemy 默认的 scoped_session（按线程分作用域）会让
   A 请求读到 B 请求未提交的数据，而且不报任何错。见下面「会话作用域」一节。

2. ``expire_on_commit=True`` / ``autoflush=True`` —— 这才是 Flask-SQLAlchemy 的
   真实行为（实测 FSA 3.1.1 没有传任何 session_options，落的是 sessionmaker 默认值）。
   04 文档里写的 False 是错的，翻这两个开关会静默改掉现有语义。见各自注释。

3. ``get_or_404`` / ``first_or_404`` / ``paginate`` 挂在 **Query** 上，不是 Model 上：
   83 处调用全部是 ``Model.query.get_or_404(id)``，另有 3 处 ``first_or_404()``、
   3 处 ``paginate(...)`` 是链式调用。挂到 Model 上等于 83 处 AttributeError。

4. ``db.Table`` 必须是包了一层的方法，不能 ``Table = sa.Table``。见 Table() 的注释。

── 与 Flask-SQLAlchemy 的已知行为差异（要进 07 文档的「允许差异」清单）────────

* ``get_or_404`` / ``first_or_404`` / ``paginate(error_out=True)`` 越界时抛
  404（见 ``_raise_404``：Flask 期间抛 werkzeug NotFound，FastAPI 下抛 HTTPException），
  响应体在 FastAPI 下从 werkzeug 的 **HTML 错误页变成 JSON**
  ``{"detail": ...}``。86+ 个调用点的 404 响应体都会变，上线前要逐个确认前端不解析 HTML。
* ``paginate()`` 不再在 page/per_page 为 None 时去读 ``request.args``：
  FastAPI 下没有「随处可取的当前请求」这种东西。现有 3 处调用全部显式传参，无影响。
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from math import ceil
from uuid import uuid4

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy import orm
from sqlalchemy.orm import DeclarativeBase, scoped_session, sessionmaker

from backend.core.config import settings

log = logging.getLogger("backend.core.db")

__all__ = ["db", "Model", "engine", "session", "Pagination",
           "db_session_scope", "open_scope", "close_scope", "current_scope",
           "load_model_modules"]


# ─────────────────────────── 引擎 ───────────────────────────
#
# 池子参数一律从 core.config 取，不在这里写死数字：PG 的 max_connections 默认只有 100，
# 而且每条连接是一个**进程**，不能像 MySQL 那样靠调大参数解决。改数字去 core/config.py，
# 那里有为什么是 8+4 的完整说明。
#
# create_engine 只是建池子，不会真的连库 —— 所以 import core.db 不需要数据库在线。
engine = sa.create_engine(settings.sqlalchemy_uri, **settings.sqlalchemy_engine_options)


# ─────────────────────────── 分页 ───────────────────────────


class Pagination:
    """照抄 flask_sqlalchemy.pagination.QueryPagination 的行为，去掉 Flask 依赖。

    只由 Query.paginate() 构造，不要手动 new。
    """

    def __init__(self, query, *, page=None, per_page=None, max_per_page=None,
                 error_out=True, count=True):
        page, per_page = self._prepare_args(page, per_page, max_per_page, error_out)
        self.page = page
        self.per_page = per_page
        self.max_per_page = max_per_page

        items = query.limit(per_page).offset((page - 1) * per_page).all()
        # 翻过头了当 404，与 Flask-SQLAlchemy 一致（第 1 页空是正常的「没数据」，不算越界）。
        if not items and page != 1 and error_out:
            _raise_404()
        self.items = items

        # order_by(None) 是必须的：count 查询带着 ORDER BY 在 PG 下纯属浪费，
        # 有 DISTINCT / GROUP BY 时还可能直接报错。
        self.total = query.order_by(None).count() if count else None

    @staticmethod
    def _prepare_args(page, per_page, max_per_page, error_out):
        # 与 Flask-SQLAlchemy 的差异：那边 page/per_page 为 None 时会去读 request.args，
        # FastAPI 下没有「随处可取的当前请求」，所以直接落默认值 1 / 20。
        # 现有 3 处调用全部显式传 page= 和 per_page=，行为无变化。
        try:
            page = 1 if page is None else int(page)
            per_page = 20 if per_page is None else int(per_page)
        except (TypeError, ValueError):
            if error_out:
                _raise_404()  # noqa: B904
            page, per_page = 1, 20

        # ★ max_per_page 默认是 None，不是 100。Pagination 文档里的 100 只对
        #   db.paginate() 生效，Query.paginate 是显式把 None 传下来的 —— 实测
        #   per_page=1000 真的返回 1000 条。写成 100 会让 app/music/services.py:485
        #   （自己夹到 1000）静默缩水成 100 条。
        if max_per_page is not None:
            per_page = min(per_page, max_per_page)

        if page < 1:
            if error_out:
                _raise_404()
            page = 1
        if per_page < 1:
            if error_out:
                _raise_404()
            per_page = 20
        return page, per_page

    @property
    def pages(self):
        if not self.total:
            return 0
        return ceil(self.total / self.per_page)

    @property
    def has_prev(self):
        return self.page > 1

    @property
    def has_next(self):
        return self.page < self.pages

    @property
    def prev_num(self):
        return self.page - 1 if self.has_prev else None

    @property
    def next_num(self):
        return self.page + 1 if self.has_next else None

    @property
    def first(self):
        """当前页第一条在全集里的序号（1 起；空页为 0）。"""
        return 0 if not self.items else (self.page - 1) * self.per_page + 1

    @property
    def last(self):
        first = self.first
        return max(first, first + len(self.items) - 1)

    def __iter__(self):
        # FSA 3.0 起「遍历 pagination = 遍历 items」，保持一致。
        return iter(self.items)

    def __len__(self):
        return len(self.items)


# ─────────────────────────── Query ───────────────────────────


def _raise_404(description=None):
    """抛 404，给 95 处 ``get_or_404`` / ``first_or_404`` 用。

    历史：迁移中途有一段"已经用 core.db 垫片、但还跑 Flask"的时期，这里曾按
    运行时框架分流去抛 werkzeug 的 NotFound —— 因为 ``fastapi.HTTPException``
    并不是 werkzeug ``HTTPException`` 的子类，抛错了会变成 500 而不是 404。
    Flask 已经下线，分流去掉；注意 flask 包**还装在 venv 里**，留着
    ``from flask import ...`` 会在第一次 404 时把整个 Flask 拉回进程。
    """
    raise HTTPException(status_code=404, detail=description or "Not Found")


class _Query(orm.Query):
    """带 Flask-SQLAlchemy 那几个便利方法的 Query。

    （放在 sessionmaker 前面，是因为它要当 query_cls 传进去。）

    ★ 直接继承 sa.orm.Query，是为了**白拿**链式调用上的 23 个方法
      （filter / join / first / delete / update / exists / with_entities / subquery …）。
      千万别改成「自己实现一个只有几个方法的壳」—— 那 517 处链式调用会一个个地炸。

    ★ 也别把 .get() 重写成 Session.get(cls, ident)：语义差在「Query 上已 apply 的
      options 会不会带上」。原生 .get() 在 SQLAlchemy 2.0 下会发 LegacyAPIWarning，
      162 处全中 —— 但今天 Flask-SQLAlchemy 下也一样在发，是平的，不是新增问题。
      这里**故意不加全局 warnings.filterwarnings**（库代码不该替全进程改警告策略）；
      如果测试配了 filterwarnings=error，请在 pytest.ini 里单独 ignore 这一类。
    """

    def get_or_404(self, ident, description=None):
        rv = self.get(ident)
        if rv is None:
            # 与 werkzeug 的 abort(404) 行为等价，但响应体从 HTML 变 JSON（见模块头）。
            _raise_404(description)
        return rv

    def first_or_404(self, description=None):
        rv = self.first()
        if rv is None:
            _raise_404(description)
        return rv

    def one_or_404(self, description=None):
        # 全项目 0 处调用，纯粹为了「对齐 FSA 的 Query 接口」而留，免得以后有人写了才发现没有。
        try:
            return self.one()
        except (sa.exc.NoResultFound, sa.exc.MultipleResultsFound):
            _raise_404(description)  # noqa: B904

    def paginate(self, *, page=None, per_page=None, max_per_page=None,
                 error_out=True, count=True):
        # ★ 全部是 keyword-only，与 Flask-SQLAlchemy 3.x 一致。
        #   别「好心」改成位置参数也能用 —— 那会让新代码养成和老代码不一致的写法。
        return Pagination(self, page=page, per_page=per_page, max_per_page=max_per_page,
                          error_out=error_out, count=count)


# ─────────────────────── 会话作用域（最危险的一段）───────────────────────
#
# ★★★ 读完这段再动下面的代码 ★★★
#
# Flask-SQLAlchemy 是按 **app context** 分会话作用域的：一个请求一个 app context，
# 一个 app context 一个 Session。FastAPI 下没有 app context，要自己找一个
# 「每个请求唯一、而且同步/异步两种路由都成立」的键。
#
# 为什么不能用线程（scoped_session 的默认 scopefunc 就是线程）：
#   FastAPI 把 `def` 路由（本项目现有的全部路由）丢进 anyio 的工作线程池执行，
#   线程池里的线程是**复用**的。请求 A 在线程 T 上建了 Session、里面还有没提交的改动，
#   请求 B 复用线程 T 时会拿到**同一个 Session** —— B 能看见 A 未提交的数据，
#   B 的 commit 会把 A 的改动一起提交。没有任何异常，症状是「数据写给了错的人」。
#   这是整个迁移里唯一一类「错了也不报错」的 bug，必须从根上堵死。
#
# ContextVar 为什么对：每个请求在中间件里 set 一个全新的 token，
# ASGI 栈保证请求处理（含被丢进线程池的同步路由）跑在那次 set 的上下文副本里。
# 已在 FastAPI 0.141.1 / Starlette 1.7.0 / anyio 4.15.1 上实测（16 并发 × 两轮）：
#   · 同步路由、async 路由，16 个请求拿到 16 个互不相同的 scope 和 16 个不同的 Session
#   · 第二轮 16 条线程**与第一轮完全重合**（线程确实被复用了），scope 仍然两两不同
#     —— 这一条才是关键：它证明「换成按线程分作用域就会串场」的那个坑真的被绕开了
#   · 中间件 finally 里读回自己设的 scope，没有被并发的别人改掉
#
# ⚠️ ContextVar 只挡住了「串场」，没挡住「活得比请求久」：线程池任务和
#   asyncio.create_task() 起的游离任务拿到的是**同一份上下文的副本**，
#   请求结束后它们手里那个作用域键还在。这就是下面 _Scope 要解决的问题。


class _Scope:
    """一次请求（或一次 ``with db_session_scope()``）的作用域标识。

    ★ 故意用**可变对象**而不是字符串，这一点是下面那个坑的解药：

      ``copy_context()`` 复制上下文时复制的是**引用**。同步路由被丢进线程池、
      ``asyncio.create_task()`` 起一个游离任务，拿到的都是同一个 _Scope 实例。
      于是中间件这边一 ``close``，所有继承了这个上下文的线程/任务立刻就看得见 ——
      再碰 db.session 会当场 RuntimeError，而不是安静地开一个没人管的新 Session。

      用字符串做不到这件事：字符串是不可变的，请求结束后游离任务手里那份副本
      还是原来那个键，scopefunc 照样返回它，ScopedRegistry 里查不到就
      ``setdefault`` 一个**全新 Session**塞回去 —— 那条 PG 连接从此再没人还，
      registry 里那个条目也永远不会被清掉。实测过：请求结束 2 秒后游离任务
      仍然能查库成功，registry 永久多一条。池子只有 12 条/worker，
      十几次就把整个 worker 卡死，而日志里一个字都没有。
    """

    __slots__ = ("key", "closed")

    def __init__(self, key: str):
        self.key = key
        self.closed = False


# default 为什么是 None 而不是 "global"：
#   给一个「能用」的默认值（如 "global"）会让所有没进过中间件的代码路径
#   —— 后台线程、CLI 脚本、alembic、定时任务 —— **静默共用同一个 Session**，
#   连报错都没有。宁可让漏网的调用点当场炸掉，也不要它安静地共享。
#   所以 scopefunc 在没开作用域时直接抛 RuntimeError，异常信息里写清怎么修。
#   ⚠️ 已知有这么一处：app/fahui/YLP/paiwei_job.py 的 threading.Thread 里会查库，
#      那里必须改成 `with db_session_scope():`（那是别人的文件，已在交接里点名）。
#      实测 threading.Thread 不继承 ContextVar（新线程是空 Context），
#      所以那里现在就是 RuntimeError —— 这是对的，是「响亮地失败」。
_SCOPE: ContextVar["_Scope | None"] = ContextVar("db_scope", default=None)


def _scopefunc() -> str:
    scope = _SCOPE.get()
    if scope is None:
        raise RuntimeError(
            "当前上下文没有打开数据库会话作用域。"
            "HTTP 请求应由 core.db 的 open_scope()/close_scope() 中间件负责；"
            "后台线程、CLI 脚本、alembic 请自己包一层 `with db_session_scope():`。"
            "（故意不给默认作用域：否则所有漏网路径会静默共用同一个 Session。）"
        )
    if scope.closed:
        # 到这里说明：有人在**请求已经结束之后**，用那次请求继承下来的上下文碰了数据库。
        # 典型是 asyncio.create_task() 起的游离任务（core/realtime.py 的 _spawn_cleanup、
        # _ensure_fanout 都是这个形状）。不拦的话会新开一个永不归还的 Session。
        raise RuntimeError(
            f"数据库会话作用域 {scope.key} 已经关闭了，不能再用。"
            "常见原因：在请求里 asyncio.create_task()/开线程起了一个活得比请求久的任务，"
            "它继承了请求的上下文，但请求结束时作用域已经被关掉。"
            "这类任务必须自己包一层 `with db_session_scope():` 来界定事务边界。"
        )
    return scope.key


# autoflush / expire_on_commit 为什么都是 True：这是 Flask-SQLAlchemy 的现状行为，
# 垫片的第一目标是**行为对齐**，不是「顺手调优」。
#
#   · expire_on_commit=True —— 项目里有 23 处 `.delete(synchronize_session=False)` /
#     `.update(synchronize_session=False)`（board_services 10、form/services 6、
#     filesystem 4、user_control/lamp/mobile 各 1）。这些写法之所以正确，
#     **恰恰是靠 commit 把 identity map 整个过期掉**。改成 False 之后，被批量删改的行
#     会在 session 里留成永久脏缓存，症状是「删了还在」「改了没变」，且不报错。
#     嫌慢就针对具体热点加 populate_existing / refresh，不要翻这个全局开关。
#     （04 文档说 False 是「与 Flask-SQLAlchemy 一致」—— 实测恰好相反。）
#
#   · autoflush=True —— 56 处 `db.session.flush()` 之后的查询语义依赖它；
#     而且 app/user_control/routes.py:218 特地用 `with db.session.no_autoflush:`
#     并写了注释说明靠它压住 autoflush，全局关掉的话那段防护变成空转。
#
# query_cls 是关键：这样 `Model.query` 和 `db.session.query(...)` 拿到的
# 是同一个带 or_404 / paginate 的 Query 子类。
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=True,
    expire_on_commit=True,
    query_cls=_Query,
)

# 必须是货真价实的 scoped_session，不能是自己撸的代理类：
# models/event_data.py:608 把 db.session 当普通 Session 对象传进函数里用
# （session.scalar(...) / session.get(...)），scoped_session 已经把这些方法全代理好了。
#
# ⚠️ 写测试的人会踩的一个坑：``session.configure(...)`` 第一行就是 ``registry.has()``，
#    而 has() 要调 scopefunc —— 在作用域外调它会直接吃一个 RuntimeError。
#    测试里要换 bind，请改 ``SessionLocal.configure(bind=...)``（工厂那一层不碰 registry），
#    或者包在 ``with db_session_scope():`` 里。
session = scoped_session(SessionLocal, scopefunc=_scopefunc)


def open_scope() -> object:
    """开一个新的会话作用域，返回 ContextVar token（要原样交给 close_scope）。

    给 ASGI 中间件用：

        @app.middleware("http")
        async def db_scope(request, call_next):
            token = open_scope()
            try:
                return await call_next(request)
            finally:
                close_scope(token)

    ⚠️ BaseHTTPMiddleware 的 finally 是在**响应体开始流之前**跑的。对 JSONResponse
       无所谓（body 早就是 bytes 了），但对 StreamingResponse / SSE 来说，
       流还没发完 Session 就被 remove 了。12 文档要新写的 SSE 端点必须自己
       `with db_session_scope():` 管 session，不能靠这个中间件。
       （现有唯一的生成器响应是 app/media/utils.py:117，只读文件不碰库，安全。）
    """
    # 线程 id 只是为了日志/排查时一眼看出是谁；唯一性靠 uuid4。
    return _SCOPE.set(_Scope(f"t{threading.get_ident()}-{uuid4().hex}"))


def close_scope(token=None) -> None:
    """关掉当前作用域：把 Session 关掉、连接还给池子，再复位 ContextVar。

    注意 Session.remove() 不会自动 commit —— 和 Flask-SQLAlchemy 一致，
    没显式 commit 的改动会被丢弃（Session.close 里 rollback 掉）。

    这个函数**永远不抛异常**：它只会被中间件/上下文管理器的 finally 调用，
    在那里抛出去会把真正的响应或真正的异常整个盖掉（症状是「接口 500，
    日志里只有还连接失败」，真正的业务报错一个字都看不到）。
    """
    scope = _SCOPE.get()
    try:
        if scope is not None and not scope.closed:
            # 顺序很重要：remove() 内部要调 scopefunc 拿键，所以必须在标记 closed / reset 之前。
            try:
                session.remove()
            except Exception:  # noqa: BLE001
                # ★ scoped_session.remove() 的实现是
                #       if registry.has(): registry().close()
                #       registry.clear()
                #   close() 里要 rollback，连接被 PG 掐掉时**是会抛的** —— 一抛，
                #   下面那句 clear() 就跳过了，registry 里那条记录和它握着的连接
                #   从此没人回收。PG 重启/网络抖一下，在飞的请求就会**每条漏一个**，
                #   漏够 12 条（pool_size 8 + overflow 4）整个 worker 就卡死。
                #   所以这里自己补一次 clear，并且把异常降级成一条日志。
                log.exception("关闭数据库会话失败，强制清掉 registry 条目：%s", scope.key)
                try:
                    session.registry.clear()
                except Exception:  # noqa: BLE001
                    log.exception("清 registry 也失败了：%s", scope.key)
    finally:
        # ★ 标记 closed 必须发生，而且要在 reset 之前 —— 这是给所有**继承了本上下文**
        #   的线程池任务 / asyncio 游离任务留的开关：它们手里是同一个 _Scope 对象，
        #   一标记就全都看得见，之后再碰 db.session 会响亮地 RuntimeError，
        #   而不是安静地开一个永不归还的新 Session（见 _Scope 的注释）。
        if scope is not None:
            scope.closed = True
        # ★ 复位也必须放 finally。异常一旦跳过复位，ContextVar 就留着那个旧作用域不放。
        #   在没有上下文副本的场景（普通后台线程、CLI 脚本、alembic）里，
        #   这意味着之后本该炸出 RuntimeError 的无作用域访问会安静地复用残留作用域。
        if token is not None:
            try:
                _SCOPE.reset(token)
            except ValueError:
                # token 是在别的 Context 里 set 的（典型是异步生成器被 GC 在另一个
                # context 里 aclose 掉）。这时当前 context 里本来就没这个值，
                # 置空即可；硬 reset 只会把真正的异常盖掉。
                _SCOPE.set(None)
        else:
            # 没带 token 的零散调用：直接置空。不置的话作用域其实并没有关掉。
            _SCOPE.set(None)


@contextmanager
def db_session_scope():
    """给**非 HTTP 请求**的代码用：后台线程、CLI 脚本、worker 子进程、alembic。

        with db_session_scope() as s:
            s.add(obj)
            s.commit()          # 要不要提交由调用方决定，这里不代劳

    每进一次就是一个全新的 Session（也就是一条池子里的连接），出来就归还。
    别在长循环里把一个 scope 开着不放 —— 连接池只有 pool_size+max_overflow 条。

    ⚠️ 嵌套会拿到一个**全新的、与外层互不相干**的 Session：看不见外层未提交的改动，
       退出时也只关自己那个。所以请求处理流程里不要再套一层，
       那会变成「同一个业务操作横跨两个事务」。它只给「本来就没有外层」的场景用。
    """
    token = open_scope()
    try:
        yield session
    finally:
        close_scope(token)


def current_scope() -> str | None:
    """当前作用域键；没开作用域时返回 None。只用来排查问题，业务别依赖它。

    作用域已经关闭时**仍然返回那个键**（而不是 None）：排查游离任务串场时，
    「是哪次请求留下来的」这条信息比「现在不能用了」更值钱。
    要判断还能不能用，直接去碰 db.session 让它自己抛。
    """
    scope = _SCOPE.get()
    return None if scope is None else scope.key


class _QueryProperty:
    """让 100 个模型继续能用 ``Model.query``（517 处调用）。

    等价于 ``db.session.query(cls)``，拿到的是上面那个 _Query。
    描述符在**访问时**才去取 session，所以不会有 import 期的先后顺序问题。
    """

    def __get__(self, obj, cls):
        return session.query(cls)


# ─────────────────────────── Model ───────────────────────────


class Model(DeclarativeBase):
    """所有模型的基类，替掉 Flask-SQLAlchemy 的 db.Model。

    好消息是这里可以很薄：94 个模型**全部**显式写了 __tablename__，项目里既没有
    __bind_key__ 也没有自定义 query_class，所以 FSA 的驼峰转蛇形自动命名
    （NameMetaMixin）、多库绑定（BindMetaMixin）这几套东西一个都不用实现。

    metadata 故意**不设 naming_convention**：现网的约束名是 MySQL/历史遗留的，
    现在加约定会让 alembic autogenerate 想把每一个索引和外键都改名，
    生成一堆高风险的无意义迁移。要加也是单独立项，不是在垫片里顺手加。
    """

    query = _QueryProperty()

    def __repr__(self):
        # DeclarativeBase 自带的 repr 是 <models.fahui.FahuiOrder object at 0x7f...>，
        # 排查问题时基本没用。照抄 FSA 的三分支版本，成本 10 行。
        state = sa.inspect(self)
        if state is None:
            return super().__repr__()
        if state.transient:
            pk = f"(transient {id(self)})"
        elif state.pending:
            pk = f"(pending {id(self)})"
        else:
            pk = ", ".join(map(str, state.identity))
        return f"<{type(self).__name__} {pk}>"


# ─────────────────────────── db 门面 ───────────────────────────


class _SQLAlchemyShim:
    """把 sqlalchemy 的命名空间原样摆成 db.*，再补上 Flask-SQLAlchemy 的专有件。

    常用的都显式写出来：一是 IDE 能补全、能跳转，二是这份清单本身就是
    「垫片到底承诺支持什么」的文档。冷门的走 __getattr__ 兜底透传。

    ⚠️ 写在类上的**普通函数**必须包 staticmethod，否则会被当成实例方法，
       db.relationship(...) 的第一个参数会变成 db 自己。
       类（Column / Integer / ForeignKey…）和实例（sa.func）不受影响。
       走 __getattr__ 兜底拿到的也不受影响（实例 __getattr__ 返回原对象，不做绑定）。
    """

    # ── 核心三件套 ──
    Model = Model
    session = session
    engine = engine
    metadata = Model.metadata

    # 必须显式写出来：不写的话 __getattr__ 会兜底到 sa.orm.Query —— 拿到的是**没有**
    # get_or_404 / paginate 的原生 Query，而且不报错，纯属埋雷。项目现在 0 处使用，是防未来。
    Query = _Query

    # ── 建表 / 建模 ──
    Column = sa.Column
    ForeignKey = sa.ForeignKey
    UniqueConstraint = sa.UniqueConstraint
    Index = sa.Index
    relationship = staticmethod(orm.relationship)
    backref = staticmethod(orm.backref)

    # ── 类型 ──（按调用量排：Integer 304 / String 303 / DateTime 108 / Text 66 …）
    Integer = sa.Integer
    String = sa.String
    DateTime = sa.DateTime
    Text = sa.Text
    Boolean = sa.Boolean
    Numeric = sa.Numeric
    Date = sa.Date
    Float = sa.Float
    Time = sa.Time
    Enum = sa.Enum
    TIMESTAMP = sa.TIMESTAMP  # 大写的这个只在 models/fahui.py 用，7 处
    BigInteger = sa.BigInteger
    JSON = sa.JSON
    LargeBinary = sa.LargeBinary

    # ── 表达式 / 函数 ──
    func = sa.func  # .lower / .count / .max / .coalesce / .sum / .current_timestamp
    text = staticmethod(sa.text)
    select = staticmethod(sa.select)
    or_ = staticmethod(sa.or_)
    and_ = staticmethod(sa.and_)  # 项目里 0 处（都是直接 from sqlalchemy import and_），留着零成本
    not_ = staticmethod(sa.not_)
    false = staticmethod(sa.false)
    true = staticmethod(sa.true)
    case = staticmethod(sa.case)
    distinct = staticmethod(sa.distinct)

    # 模块，不是函数：用法是 @db.event.listens_for(Model, "before_insert")
    # （models/songbook.py:81,86）。__getattr__ 也能兜到，但显式写出来更保险。
    event = sa.event

    def Table(self, name, *args, **kwargs):
        """★ 这里**不能**写成 ``Table = sa.Table``。

        sa.Table 的第二个位置参数是 MetaData，而项目里 7 处调用全是
        ``db.Table("name", db.Column(...), ...)`` —— 把 Column 当 MetaData 传进去，
        报的还不是「缺参数」，而是一句莫名其妙的
        ``AttributeError: Neither 'Column' object nor 'Comparator' object has an
        attribute 'schema'``，排查起来很费劲。所以必须包一层，替调用方塞 metadata。
        """
        if args and isinstance(args[0], sa.MetaData):
            # 调用方自己给了 MetaData（本项目目前没有，但别把路堵死）。
            return sa.Table(name, *args, **kwargs)
        return sa.Table(name, self.metadata, *args, **kwargs)


    def get_engine(self, *args, **kwargs):
        """Flask-Migrate 会调这个（migrations/env.py:30）。"""
        return self.engine

    def create_all(self, bind=None):
        """只给测试和一次性脚本用。生产环境建表一律走 alembic。"""
        self.metadata.create_all(bind or self.engine)

    def drop_all(self, bind=None):
        self.metadata.drop_all(bind or self.engine)

    def get_engine(self, *args, **kwargs):
        """alembic 与少数工具会问引擎。参数一律忽略（本项目无多库绑定）。"""
        return self.engine

    def __getattr__(self, name):
        # 兜底：sa 顶层 → sqlalchemy.orm 顶层。冷门类型（LONGTEXT 之类的方言类型除外）
        # 和以后新用到的名字都不用回来改这个文件。
        if name.startswith("__") and name.endswith("__"):
            # 双下划线不透传：否则 db.__name__ / db.__path__ / db.__all__ 会拿到 sqlalchemy
            # 模块自己的值，让 db 在 inspect、序列化这类工具眼里像个「模块」，排查时极其误导。
            raise AttributeError(name)
        try:
            return getattr(sa, name)
        except AttributeError:
            pass
        try:
            return getattr(orm, name)
        except AttributeError:
            raise AttributeError(
                f"db.{name} 不存在：sqlalchemy 和 sqlalchemy.orm 顶层都没有这个名字。"
                "如果它是 Flask-SQLAlchemy 的专有件，请在 core/db.py 里补实现。"
            ) from None


db = _SQLAlchemyShim()


# ─────────────────────── models 相关的兼容导出 ───────────────────────


def load_model_modules():
    """把 models/ 下的 17 个模块全部 import 一遍，让 metadata 填满。

    models/__init__.py 自己就有这个函数，这里只是个转口，方便
    ``from core.db import db, load_model_modules`` 一行搞定（alembic 的 env.py、
    建表脚本、冒烟测试都是这个用法）。

    import 故意写在函数体里：core 不许在 import 期依赖 models（core/__init__.py 的铁律），
    否则 models → core.db → models 会直接转成循环导入。调用时才 import 就没这个问题。
    """
    from backend.models import load_model_modules as _load

    return _load()
