"""AI 分组子进程入口：从 stdin 读 JSON 任务，调 AI 并经 socket 推回结果。

由 app.form.ai_grouping._spawn_ai_worker 以 `python -m app.form.ai_group_worker`
方式拉起，读取标准输入的 JSON payload。这样 AI 请求脱离 gunicorn 请求生命周期，
不受 worker 超时影响。
"""
import json
import sys


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        return
    from app.form.ai_grouping import run_ai_group_job

    run_ai_group_job(payload)


if __name__ == "__main__":
    main()
