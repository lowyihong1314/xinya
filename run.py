"""开发入口：起 uvicorn 跑 ASGI 应用。

v3 起 Flask 已下线（见 docs/flask_to_fastAPI/）。原来这里要先 eventlet.monkey_patch()
再 socketio.run()，是为了让 WSGI 撑住 Socket.IO 的长连接；现在长连接走 SSE、
由 ASGI 原生支持，猴子补丁和那一整套都不需要了。

生产用 gunicorn -k uvicorn.workers.UvicornWorker（见 docs/.../08-部署与回滚.md），
这个文件只管开发。
"""

if __name__ == "__main__":
    import uvicorn

    from core.config import settings

    uvicorn.run(
        "asgi:app",
        host="0.0.0.0",
        port=settings.dev_port,
        # reload 只在开发用：改了 core/ 或 app/ 下的文件自动重启。
        # 注意 reload 会另起子进程，日志里会看到两次启动横幅。
        reload=settings.app_debug,
        # SSE 是长连接，优雅关闭要给它时间断开，否则 Ctrl-C 会挂住。
        timeout_graceful_shutdown=5,
        log_level="info",
    )
