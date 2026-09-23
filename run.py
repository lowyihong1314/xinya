"""开发入口：起 uvicorn 跑 ASGI 应用。

v3 起 Flask 已下线（见 docs/flask_to_fastAPI/）。原来这里要先 eventlet.monkey_patch()
再 socketio.run()，是为了让 WSGI 撑住 Socket.IO 的长连接；现在长连接走 SSE、
由 ASGI 原生支持，猴子补丁和那一整套都不需要了。

生产用 gunicorn -k uvicorn.workers.UvicornWorker（见 docs/.../08-部署与回滚.md），
这个文件只管开发。
"""

if __name__ == "__main__":
    import uvicorn

    from backend.core.config import settings

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=settings.dev_port,
        # reload 只在开发用：改了 backend/ 下的文件自动重启。
        # 注意 reload 会另起子进程，日志里会看到两次启动横幅。
        reload=settings.app_debug,
        # ★ 关掉 uvicorn 自带的 proxy-headers 处理。
        #   它默认开启，会先把 scope["client"] 从 X-Forwarded-For 改成**真实用户 IP**。
        #   而我们自己的 core.middleware.ProxyHeadersMiddleware 要先校验
        #   「对端必须是 127.0.0.1（也就是 nginx）」才肯采信转发头 ——
        #   uvicorn 改在前面，那道校验看到的就是用户 IP，于是**每一个经 nginx
        #   进来的请求都被我们的中间件跳过了**，X-Forwarded-Prefix 从来没被读过。
        #   症状：静态资源 404、分享链接少一段前缀，而日志里一切正常。
        #   两套只能留一套，留我们自己那套（它还管前缀和 scheme）。
        proxy_headers=False,
        # SSE 是长连接，优雅关闭要给它时间断开，否则 Ctrl-C 会挂住。
        timeout_graceful_shutdown=5,
        log_level="info",
    )
