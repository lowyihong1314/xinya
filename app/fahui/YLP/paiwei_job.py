from __future__ import annotations

import threading
import uuid

from flask import current_app

from app.extensions import socket_broker, socketio
from app.redis_client import redis_client

from ..common.ylp_storage import preferred_dir
from .print_generator import (
    generate_paiwei_pdf_by_pdf_ids,
    generate_paiwei_pdf_by_source,
    group_source_items,
    pdf_pages_for_reprint,
)

JOB_TTL_SECONDS = 3600
_PAIWEI_TEMPLATE_ALIASES = {
    "large": "paiwei_1",
    "big": "paiwei_1",
    "paiwei_1": "paiwei_1",
    "small": "paiwei_5",
    "paiwei_5": "paiwei_5",
    "creditor": "paiwei_10",
    "yuanqin": "paiwei_10",
    "paiwei_10": "paiwei_10",
}


def resolve_template(template) -> str | None:
    return _PAIWEI_TEMPLATE_ALIASES.get(str(template or "").strip())


def _job_key(job_id: str) -> str:
    return f"paiwei_job:{job_id}"


def job_room(job_id: str) -> str:
    return f"paiwei_job:{job_id}"


def _emit(event: str, payload: dict):
    # 尽力而为：生产用 sync gunicorn（socketio.server 为 None）时走 socket_broker
    # 的 Redis 消息队列；即便没有 socket 服务消费也不影响主流程（前端有轮询兜底）。
    try:
        emitter = socketio if getattr(socketio, "server", None) is not None else socket_broker
        emitter.emit(event, payload, to=job_room(payload.get("job_id")))
    except Exception:  # noqa: BLE001
        pass


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
    app = current_app._get_current_object()
    # 用普通后台线程：生产是 sync gunicorn（无 eventlet），socketio.start_background_task
    # 会因 socketio.server 为 None 而报错。线程 + Redis 状态 + 磁盘落盘可跨 worker 读取。
    thread = threading.Thread(
        target=_run_job,
        args=(app, job_id, list(order_ids or []), source_name, bool(need_barcode)),
        kwargs={
            "item_ids": None if item_ids is None else list(item_ids),
            "pdf_ids": None if pdf_ids is None else list(pdf_ids),
        },
        daemon=True,
    )
    thread.start()
    return job_id


def _run_job(app, job_id: str, order_ids, source_name, need_barcode=False, item_ids=None, pdf_ids=None):
    with app.app_context():
        try:
            reprint = bool(pdf_ids)
            if reprint:
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
                    if getattr(socketio, "server", None) is not None:
                        socketio.sleep(0)  # 让出协程，保证进度事件及时下发

            if reprint:
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
                    "download_url": f"/api/print_paiwei/jobs/{job_id}/download",
                },
            )
        except Exception as exc:  # noqa: BLE001
            _set_state(job_id, status="error", message=str(exc))
            _emit("paiwei:error", {"job_id": job_id, "message": str(exc)})
