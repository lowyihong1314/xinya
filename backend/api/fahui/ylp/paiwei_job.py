"""牌位批量打印的后台任务：起一个线程渲染 PDF，进度写 Redis + 推实时事件。

原 backend/app/fahui/YLP/paiwei_job.py。取件规则、进度算法、Redis 键名
（``paiwei_job:<id>``）、落盘路径（``paiwei_result/job_<id>.pdf``）、
以及那几句中文错误文案全部逐字照搬。搬迁动了四处，每一处都非动不可：

① **``current_app._get_current_object()`` + ``with app.app_context():`` →
   ``with db_session_scope():``**
   线程里要查库，而 core/db.py 的会话作用域是一个 ContextVar，
   ``threading.Thread`` **不继承 ContextVar**（新线程是空 Context）。
   不包这一层，线程里第一句 ORM 查询就会 RuntimeError ——
   core/db.py 的 ``_SCOPE`` 注释里点名的就是本文件。
   顺带也不再需要把 app 对象传进线程（``_run_job`` 少了第一个参数）。

② **Socket.IO → core.realtime。**
   原来的 ``_emit`` 要在 ``socketio``（有 eventlet 时）和 ``socket_broker``
   （sync gunicorn 时）之间二选一 —— 这个分支整个没有了：
   ``publish_sync`` 本来就是走 Redis 的同步发送端，在普通后台线程里正好合用。
       emitter.emit(evt, payload, to="paiwei_job:<id>")
           → publish_sync(REALTIME_APP, "paiwei_job:<id>", evt, payload)
   事件名（paiwei:progress / paiwei:done / paiwei:error）和 payload 形状没动。

③ **``socketio.sleep(0)`` 删掉。** 它是 eventlet 协程的让出点，用来保证进度事件
   及时下发。现在这里是一个**真线程**，publish_sync 发完就是发完，没有要让出的协程。

④ **``download_url`` 里的 ``/api`` 段去掉，并补上项目前缀。**
   原值是写死的 ``/api/print_paiwei/jobs/<id>/download``。``/api`` 这一段整个迁移
   都去掉了（BASE_PATH 已经区分项目），而这条链接是**发给浏览器点的**，
   所以还要过一遍 ``public_url`` 补 ``/UTBA_DEMO`` 这类前缀 —— 线程里没有 request，
   ``base_path()`` 会回落到 ``settings.app_base_path``（core/urls.py 的模块头
   点名了 paiwei_job 这个场景）。

⚠️ 前端对这条链路有轮询兜底（``GET /print_paiwei/jobs/<id>``），
   所以在前端从 Socket.IO 切到 SSE 之前，这些事件没有订阅者也不影响功能。
"""

import threading
import uuid

from backend.api.fahui.realtime import REALTIME_APP
from backend.core.config import settings
from backend.core.db import db_session_scope
from backend.core.realtime import publish_sync
from backend.core.redis import redis_client
from backend.core.urls import public_url

from ..common.ylp_storage import preferred_dir
from .print_generator import (
    count_all_sources,
    generate_paiwei_pdf_all_sources,
    generate_paiwei_pdf_by_pdf_ids,
    generate_paiwei_pdf_by_source,
    group_source_items,
    pdf_pages_for_reprint,
)

JOB_TTL_SECONDS = 3600
_PAIWEI_TEMPLATE_ALIASES = {
    "large": "paiwei_1",
    "big": "paiwei_1",
    "super": "paiwei_SS",
    "paiwei_SS": "paiwei_SS",
    "paiwei_1": "paiwei_1",
    "small": "paiwei_5",
    "paiwei_5": "paiwei_5",
    "creditor": "paiwei_10",
    "yuanqin": "paiwei_10",
    "paiwei_10": "paiwei_10",
    # 「不选类型」：三种牌位一次印完，合成一份 PDF
    "all": "all",
}


def resolve_template(template) -> str | None:
    return _PAIWEI_TEMPLATE_ALIASES.get(str(template or "").strip())


def _job_key(job_id: str) -> str:
    return f"paiwei_job:{job_id}"


def job_room(job_id: str) -> str:
    return f"paiwei_job:{job_id}"


def _emit(event: str, payload: dict):
    # 尽力而为：publish_sync 自己吞异常、只返回 bool，所以这里不再需要 try ——
    # 语义与原来的 try/except: pass 一致（推送失败绝不能把正在跑的打印任务弄挂）。
    # 即便没有订阅者也不影响主流程（前端有轮询兜底）。
    publish_sync(REALTIME_APP, job_room(payload.get("job_id")), event, payload)


def _set_state(job_id: str, **fields):
    mapping = {key: ("" if value is None else str(value)) for key, value in fields.items()}
    redis_client.hset(_job_key(job_id), mapping=mapping)
    redis_client.expire(_job_key(job_id), JOB_TTL_SECONDS)


def get_job_state(job_id: str) -> dict:
    return redis_client.hgetall(_job_key(job_id)) or {}


def start_paiwei_job(order_ids, source_name, need_barcode=False, item_ids=None, pdf_ids=None) -> str:
    """三种取件方式，优先级 pdf_ids > item_ids > order_ids：

    - pdf_ids：按牌位单号重印，逐页渲染、单号复用
    - item_ids：打印弹窗算完张数后提交的精确清单（例如「只印未注册的」）
    - order_ids：整张订单里属于该模板的牌位，老行为
    """
    job_id = uuid.uuid4().hex
    _set_state(job_id, status="pending", progress=0, done=0, total=0, message="")
    # 用普通后台线程：状态放 Redis、结果落盘，任何 worker 都能读到。
    # 线程里自己开数据库会话作用域（见模块头 ①），所以不用再把 app 传进去。
    thread = threading.Thread(
        target=_run_job,
        args=(job_id, list(order_ids or []), source_name, bool(need_barcode)),
        kwargs={
            "item_ids": None if item_ids is None else list(item_ids),
            "pdf_ids": None if pdf_ids is None else list(pdf_ids),
        },
        daemon=True,
    )
    thread.start()
    return job_id


def _run_job(job_id: str, order_ids, source_name, need_barcode=False, item_ids=None, pdf_ids=None):
    # ★ 这一层不能省，也不能挪到 try 里面：它界定了本线程的数据库会话与事务边界。
    #   见模块头 ①。退出时 Session 关闭、连接还给池子。
    with db_session_scope():
        try:
            reprint = bool(pdf_ids)
            every = source_name == "all"
            if every:
                total = count_all_sources(order_ids, item_ids=item_ids, pdf_ids=pdf_ids)
                empty_message = "这些单号下没有可打印的牌位"
            elif reprint:
                # 重印按「页」计进度：一个牌位单号 = 一页。
                total = len(pdf_pages_for_reprint(pdf_ids, source_name))
                empty_message = "这些牌位单号里没有该类型的牌位"
            else:
                _, total = group_source_items(order_ids, source_name, item_ids=item_ids)
                empty_message = "所选订单没有该类型的牌位"
            if not total:
                _set_state(job_id, status="error", message=empty_message)
                _emit("paiwei:error", {"job_id": job_id, "message": empty_message})
                return

            _set_state(job_id, status="processing", total=total, done=0, progress=0)
            _emit("paiwei:progress", {"job_id": job_id, "done": 0, "total": total, "percent": 0})

            state = {"done": 0, "last_percent": 0}

            def progress_cb(step):
                state["done"] += step
                percent = min(99, int(state["done"] / total * 100)) if total else 0
                if percent != state["last_percent"]:
                    state["last_percent"] = percent
                    _set_state(job_id, done=state["done"], progress=percent)
                    _emit(
                        "paiwei:progress",
                        {"job_id": job_id, "done": state["done"], "total": total, "percent": percent},
                    )

            if every:
                output = generate_paiwei_pdf_all_sources(
                    order_ids, need_barcode=need_barcode, progress_cb=progress_cb,
                    item_ids=item_ids, pdf_ids=pdf_ids,
                )
            elif reprint:
                output = generate_paiwei_pdf_by_pdf_ids(
                    pdf_ids, source_name, need_barcode=need_barcode, progress_cb=progress_cb
                )
            else:
                output = generate_paiwei_pdf_by_source(
                    order_ids, source_name, need_barcode=need_barcode, progress_cb=progress_cb, item_ids=item_ids
                )
            if output is None:
                _set_state(job_id, status="error", message="生成失败")
                _emit("paiwei:error", {"job_id": job_id, "message": "生成失败"})
                return

            result_dir = preferred_dir("paiwei_result")
            file_path = result_dir / f"job_{job_id}.pdf"
            with open(file_path, "wb") as output_file:
                output_file.write(output.getvalue())

            _set_state(job_id, status="done", progress=100, done=total, file=str(file_path))
            _emit(
                "paiwei:done",
                {
                    "job_id": job_id,
                    "percent": 100,
                    # 见模块头 ④：去掉 /api 段，并补上项目前缀（线程里回落到 settings）。
                    "download_url": public_url(
                        f"{settings.api_prefix}/print_paiwei/jobs/{job_id}/download"
                    ),
                },
            )
        except Exception as exc:  # noqa: BLE001
            _set_state(job_id, status="error", message=str(exc))
            _emit("paiwei:error", {"job_id": job_id, "message": str(exc)})
