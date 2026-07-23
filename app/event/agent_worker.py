"""活动 AI Agent 子进程入口：从 stdin 读 JSON 任务，调 AI 并经 socket 推回。

由 app.event.agent._spawn_agent_worker 以 `python -m app.event.agent_worker` 拉起。
"""
import json
import sys


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        return
    from app.event.agent import run_event_agent_job

    run_event_agent_job(payload)


if __name__ == "__main__":
    main()
