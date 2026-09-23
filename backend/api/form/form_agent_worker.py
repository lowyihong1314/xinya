"""报名表 AI Agent 子进程入口：从 stdin 读 JSON 任务，调 AI 并经 Redis 推回。

原 backend/app/form/form_agent_worker.py。由 ``form_agent._spawn_worker`` 以
``python -m backend.api.form.form_agent_worker`` 拉起（模块路径是那边的一个**字符串**，
两边必须一起改，见 form_agent.py 模块头 ②）。

★ 这是一个独立进程，**只能用 publish_sync**（core.realtime 的同步发送端）。
★ 同样**不能 import flask**：子进程从零启动，把 Flask 栈拉起来纯属白付启动开销。
★ import 放在 main() 里面（照搬原样）：stdin 读坏了的话连 form_agent 都不用加载。
"""
import json
import sys


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        return
    from backend.api.form.form_agent import run_form_agent_job

    run_form_agent_job(payload)


if __name__ == "__main__":
    main()
