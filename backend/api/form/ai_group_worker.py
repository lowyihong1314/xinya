"""AI 分组子进程入口：从 stdin 读 JSON 任务，调 AI 并经 Redis 推回结果。

原 backend/app/form/ai_group_worker.py。由 ``ai_grouping._spawn_ai_worker`` 以
``python -m backend.api.form.ai_group_worker`` 拉起（模块路径是那边的一个**字符串**，
两边必须一起改，见 ai_grouping.py 模块头 ③），读取标准输入的 JSON payload。
这样 AI 请求脱离请求生命周期，不受 worker 超时影响。

★ 这是一个独立进程，**只能用 publish_sync**（core.realtime 的同步发送端）——
  它碰不到 uvicorn worker 的事件循环，await 不了任何东西。
★ 同样**不能 import flask**：子进程从零启动，把 Flask 栈拉起来纯属白付启动开销。
★ import 放在 main() 里面（照搬原样）：stdin 读坏了的话连 ai_grouping 都不用加载。
"""
import json
import sys


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        return
    from backend.api.form.ai_grouping import run_ai_group_job

    run_ai_group_job(payload)


if __name__ == "__main__":
    main()
