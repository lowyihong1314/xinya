"""所有业务路由的汇总注册位。

backend/main.py 只 include 这里的 ``api_router`` 一条，不直接认识任何业务模块——
加一个模块只改本文件，不动 main.py。

── 为什么分组、组内为什么是这个顺序 ────────────────────────────────

Starlette 的路由表是**先注册先匹配**（第一条 path 正则匹配上就用它，不会回溯找
更精确的）。所以规则只有一条：**带 prefix 的先挂，挂在根上的最后挂。**

  · 第一组各自占着 /mobile、/twilio、/permission、/move_camera、/app、/email
    这些独立前缀，彼此不可能撞，组内顺序无所谓（按字母排只是为了好读）。
  · public_api 是历史杂物抽屉，六条路由**直接挂在应用根上**
    （/ping、/forms、/members、/payments、/event_data/{id}、/get_file_data/{id}），
    命名空间最宽，所以排最后。今天它和谁都不撞，但下一批搬 app/event 时，
    /event_data/get_all_event 这类具名路径就会和它的 /event_data/{event_id:int}
    同处一个命名空间 —— 靠的是 Starlette 的 :int 转换器在匹配阶段就只认数字
    （已实测两边谁先注册都不会互相抢），而不是靠注册顺序。
    ⚠️ 真要新增一条会与它重叠的根级路由，必须挂在 public_api **之前**。

⚠️ 各模块的 prefix 写在自己的 router.py 里（多数是 f"{settings.api_prefix}/xxx"，
   api_prefix 今天是空串），这里不重复声明 —— 两处各写一份迟早漂移。

每条 include_router 都能单独注释掉回滚 —— 模块之间没有 import 依赖。
"""

from fastapi import APIRouter

from backend.api import account, app_release, asset, camera, changyou_room, content
from backend.api import email, event, filesystem, gl, media, mobile, music
from backend.api import permission_mgmt, quiz, songbook, twilio
from backend.api import public_api  # 根级路由，必须最后 include
from backend.api import web  # SPA 兜底，catch-all，必须最最后

api_router = APIRouter()

# ── 第一组：各自独立前缀，互不重叠 ──────────────────────────────
api_router.include_router(mobile.router)           # /mobile/session/*      APK 令牌签发
api_router.include_router(twilio.router)           # /twilio/*              OTP
api_router.include_router(permission_mgmt.router)  # /permission/*          部门权限分配
api_router.include_router(camera.router)           # /move_camera/*         CCTV（含 nginx authz）
api_router.include_router(app_release.router)      # /app/releases|download APK 分发
api_router.include_router(email.router)            # /email/*               公司邮箱收发 + 验证
api_router.include_router(gl.router)               # /gl/*                  总账（科目/凭证/过账）
api_router.include_router(songbook.router)         # /songbook/*            歌本
api_router.include_router(content.router)          # /info/*                关于我们 / 历史 / 手册
api_router.include_router(quiz.router)             # /quiz/*                抢答（出向推送已走 SSE）
api_router.include_router(changyou_room.router)    # /changyou_room/*       唱游房间（出向推送已走 SSE）
api_router.include_router(account.router)          # /account/*             报销 / 收入 / 付款凭证
api_router.include_router(asset.router)            # /asset/*               资产
api_router.include_router(filesystem.router)       # /files/*               文件系统
api_router.include_router(music.router)            # /music/*               音乐库
api_router.include_router(media.router)            # /media/*               媒体上传 / 转码 / 爱心
api_router.include_router(event.router)            # /event_data/*          活动与相册
# ★ media_file_router 挂在**根上**（/media_file/<path>），不带 /media 前缀：
#   nginx 那条 `location /media_file/ { alias …; }` 和库里存的相对路径都咬死了根路径。
api_router.include_router(media.media_file_router)  # /media_file/<path>    nginx 找不到文件时的回落

# ── 第二组：挂在根上的，最后 ────────────────────────────────────
api_router.include_router(public_api.router)       # /ping /forms /members /payments /event_data/{id} …

# ── 第三组：SPA 兜底，必须最最后 ────────────────────────────────
# web.router 里有一条 GET /{spa_path:path}，它匹配一切路径。
# 放在任何业务路由之前都会把那条业务路由吃掉（症状：接口返回一坨 HTML）。
api_router.include_router(web.router)              # /favicon.ico + SPA catch-all

# ── 尚未迁移的模块 ──────────────────────────────────────────────
# 剩下的按 docs/flask_to_fastAPI/05 的模块顺序继续搬，搬完一个在上面加一行，
# 并把 backend/app/blueprints.py 里对应的 BLUEPRINT_SPECS 条目摘掉。
