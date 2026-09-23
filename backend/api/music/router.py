"""音乐：上传 / 专辑 / 歌曲 / 下载（含 wma 转码）/ 歌单 / 播放队列 / 播放分钟数。

原 backend/app/music/routes.py（Flask Blueprint，挂在 /api/music）。
本文件只做框架适配 —— 参数怎么取、装饰器怎么挂、响应怎么构造。
校验顺序、状态码、中文错误文案、响应体的键名与嵌套形状全部在 service.py / storage.py 里
逐字照搬，两个文件顶部各有一份「看着像 bug 但故意保留」的清单，动手前先读。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉（BASE_PATH 已经区分项目），其余路径一个字符没动：

    /api/music/upload                        → /music/upload                          (POST)
    /api/music/albums                        → /music/albums                          (GET)
    /api/music/albums/<int:id>               → /music/albums/{album_id:int}            (GET)
    /api/music/albums/<int:id>/upload_cover  → /music/albums/{album_id:int}/upload_cover(POST)
    /api/music/album                         → /music/album                           (POST)
    /api/music/album/<int:id>                → /music/album/{album_id:int}             (POST/DELETE)
    /api/music/list                          → /music/list                            (GET)
    /api/music/detail/<int:id>               → /music/detail/{music_id:int}            (GET)
    /api/music/download/<int:id>             → /music/download/{music_id:int}          (GET)
    /api/music/edit/<int:id>                 → /music/edit/{music_id:int}              (POST)
    /api/music/replace/<int:id>              → /music/replace/{music_id:int}           (POST)
    /api/music/delete/<int:id>               → /music/delete/{music_id:int}            (DELETE)
    /api/music/add_one_minute/<int:id>       → /music/add_one_minute/{music_id:int}    (POST)
    /api/music/minute_logs                   → /music/minute_logs                     (GET)
    /api/music/last_played                   → /music/last_played                     (GET)
    /api/music/album_cover/<path:filename>   → /music/album_cover/{filename:path}      (GET)
    /api/music/playlists                     → /music/playlists                       (GET)
    /api/music/playlist                      → /music/playlist                        (POST)
    /api/music/playlist/<int:id>             → /music/playlist/{playlist_id:int}       (GET/POST/DELETE)
    /api/music/queue                         → /music/queue                           (GET/POST)
    /api/music/playlist_state                → /music/playlist_state                  (GET/POST)

共 26 条。**注意哪些是公开的**（原来就没挂 @login_required，保持不变）：
albums / albums/{id} / list / detail / download / album_cover —— 也就是说
**音频本体不需要登录就能下载**。这是既有行为，本次不收口。
TODO(安全): 要收的话先确认 APK 端的播放器是不是在未登录状态下预取封面。

── 四件搬迁时必须这么写的事 ──────────────────────────────────────────

① **本文件不能写 ``from __future__ import annotations``。**
   core.auth 的装饰器用 functools.wraps 包过，FastAPI 取签名时会穿透到原函数，
   但求值注解用的是**包装函数的** ``__globals__`` —— 也就是 core/auth.py 的命名空间。
   开了这行注解全变字符串，会跑去那边找 ``Optional`` / ``UploadFile`` 而 NameError（启动即挂）。

② **路由函数一律 ``def``（同步），不写 async def。**
   底下是同步 ORM + 同步文件读写 + ``subprocess.run`` 转码（wma 那条能跑好几秒）。
   写成 async def 会把 worker 的事件循环焊死，整个进程一起卡。FastAPI 会自动把 def 丢线程池。

③ **装饰器顺序保持 Flask 原样**：``@router.*`` 最上，然后 ``@login_required``，
   最后 ``@permission_required``。反过来会把「未登录」的响应从 401 变成
   permission_required 的 500（core/auth.py 契约 2），前端的重新登录跳转就失效了。

④ **路径参数写 ``{music_id:int}``，不是只靠 ``: int`` 注解。**
   Flask 的 ``<int:music_id>`` 在参数不是整数时是**不匹配** → 404；只靠注解的话
   FastAPI 会先匹配上再校验失败 → **422**，前端的 404 分支会失效。

── 与 Flask 的已知差异（都不构成前端可见的行为变更）────────────────────

· ``request.get_json() or {}``（**没有** silent=True）：Flask 在 body 不是合法 JSON /
  Content-Type 不对时回 400 或 415 的 **HTML 错误页**，这里落到 FastAPI 的 422 JSON。
  两边前端都解析不出业务字段，等价。

· **表单里重复的同名字段**：werkzeug 的 ``MultiDict.get`` 取**第一个**，starlette 的
  ``FormData.get``（FastAPI 单值 Form 参数走的就是它）取**最后一个**。
  只影响「同一个 album_id 发两遍」这种畸形请求，前端不会这么发。
  ``files`` / ``titles`` 声明成 List，走的是 getlist，顺序与 Flask 完全一致 ——
  这点很重要，service 里 titles[index] 和 files[index] 是按下标对齐的。

· 把文件字段发成**普通文本字段**时：Flask 那边 ``request.files.get`` 直接返回 None
  → 400「没有选择文件」；FastAPI 会在参数校验阶段回 422。同样发不出去，不管。

· **HEAD**：Flask 给每条 GET 规则自动加 HEAD，FastAPI 的 ``@router.get`` 不加。
  本模块把两条二进制下发路由（download / album_cover）显式写成
  ``api_route(methods=["GET","HEAD"])`` 补回来（理由见那两个函数的 docstring）；
  其余 GET 路由回 JSON，丢了 HEAD 没有调用方在意，跟着 gl / songbook 的写法保持
  ``@router.get``。⚠️ 这条差异是**全项目性**的，不只本模块 —— 要不要统一补，
  归接线的人决定，别只在这里改一半。
"""

from typing import List, Optional

from fastapi import APIRouter, Body, File, Form, UploadFile

from backend.core.auth import login_required, permission_required
from backend.core.config import settings

from . import service
from .storage import serve_album_image

# prefix 用 settings.api_prefix 拼而不是写死 "/music"：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目，再套一层 /api 不带信息量），但配置项留着就是为了
# 需要时还能整体把前缀加回来 —— 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/music", tags=["music"])

# 对应 Flask 的 ``request.get_json() or {}``：不带 embed，所以前端发的整个 JSON 体
# 原样进到这个参数；没有 body 时落到 None，路由里 ``payload or {}`` 补成空字典，
# 后面的校验分支自然会回 400 —— 与 Flask 时代一致。
_JSON_BODY = Body(default=None)


def _int_arg(raw, default=None):
    """对应 Flask 的 ``request.args.get(name, default, type=int)``。

    werkzeug 的语义是「**转不动就回 default**」（不是报错，也不是 None）：

        rv = self[key]            # 没这个 key → 直接 return default
        try: rv = type(rv)
        except (ValueError, TypeError): rv = default

    所以查询参数一律声明成带默认值的 ``str`` 再在这里手工转。
    直接声明成 ``Optional[int]`` 会让 ``?music_id=abc`` 变成 422，
    而 Flask 那边是「当没传」继续走 —— 前端的分支会跟着变。
    注意 ``"0"`` 要转成 0 而不是 None：0 是 falsy，调用点的 ``if music_id:`` 因此
    不加过滤，与 Flask 一致。
    """
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _nullable_upload(upload):
    """把「没选文件」的空 part 归一成 None，对齐 werkzeug 的 ``FileStorage.__bool__``。

    ★ 这是行为问题不是洁癖：werkzeug 的 FileStorage 定义了
      ``__bool__ = bool(self.filename)``，而浏览器在 file input 留空时**仍然会发**
      一个 ``filename=""`` 的空 part。于是 Flask 那边 ``if not file:`` 为真，
      走的是 400「未选择图片」/「没有选择文件」。
      starlette 的 UploadFile 没有 ``__bool__``（恒为真），不补这一步的话会往下走到
      扩展名判断，用户看到的变成 400「仅支持 JPG/PNG/GIF/WEBP 图片」——
      状态码一样，**文案不一样**。

    只用在单文件的两条路由上。``/upload`` 的 files 列表**不能**这样过滤：
    service 里 titles[index] 是按原始上传顺序对下标的，抽掉一个元素会让后面的标题错位
    （那边靠 ``allowed_audio_extension("")`` 为 False 走到同一条 continue，结果一致）。
    """
    if upload is None or not (upload.filename or ""):
        return None
    return upload


# ─────────────────────────── 上传 / 专辑 ───────────────────────────


@router.post("/upload")
@login_required
@permission_required("music_edit")
def upload_music(
    # ``request.files.getlist("files")`` → List[UploadFile]；缺字段时 Flask 回 []，
    # 这里给 default=[] 对齐（声明成必填会让「没带文件」从 400 变 422）。
    files: List[UploadFile] = File(default=[]),
    # ``request.form.get(...)`` → 带默认值的 Form，默认必须是 None 而不是 ""：
    # service 里 ``album_id or None`` 对两者等价，但 title 那条
    # ``(title_override or "").strip() or file.filename`` 也一样，保持 None 最贴原样。
    album_id: Optional[str] = Form(default=None),
    artist_id: Optional[str] = Form(default=None),
    title: Optional[str] = Form(default=None),
    # ``request.form.getlist("titles")``：走 getlist，顺序和重复都与 Flask 一致。
    titles: List[str] = Form(default=[]),
):
    return service.upload_music(files, album_id, artist_id, title, titles)


@router.get("/albums")
def get_albums():
    return service.get_albums()


@router.get("/albums/{album_id:int}")
def get_album(album_id: int):
    return service.get_album(album_id)


@router.post("/albums/{album_id:int}/upload_cover")
@login_required
@permission_required("music_edit")
def upload_album_cover(album_id: int, file: Optional[UploadFile] = File(default=None)):
    return service.upload_album_cover(album_id, _nullable_upload(file))


@router.post("/album")
@login_required
@permission_required("music_edit")
def create_album(payload: Optional[dict] = _JSON_BODY):
    return service.create_album(payload or {})


@router.delete("/album/{album_id:int}")
@login_required
@permission_required("music_edit")
def delete_album(album_id: int):
    return service.delete_album(album_id)


@router.post("/album/{album_id:int}")
@login_required
@permission_required("music_edit")
def edit_album(album_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.edit_album(album_id, payload or {})


# ─────────────────────────── 歌曲 ───────────────────────────


@router.get("/list")
def list_music(
    page: str = "1",
    per_page: str = "20",
    search: str = "",
    include_accompaniments: str = "",
):
    # 原式是 ``int(request.args.get("page", 1))`` —— **没有** type=int，也没有 try。
    # 所以 ``?page=abc`` / ``?page=`` 在 Flask 下是 ValueError → 500，不是 400。
    # 这里把默认值写成字符串 "1"/"20" 再原样 int()，两种情况都与 Flask 一致
    # （backend/main.py 注册了兜底的 Exception 处理器，同样出 500）。
    # ⚠️ 别"顺手"换成 _int_arg：那会把 500 变成 200，是行为变更。
    # ★ 默认**不含伴奏**。伴奏不是独立作品，混进「全部歌曲」会让列表凭空多出
    #   一批重复歌名，加入歌单/队列时也容易误选。伴奏管理界面传 =1 才拿得到。
    #   只认字面量 "1"/"true"/"yes"，与本项目其它布尔查询参数口径一致。
    want_acc = str(include_accompaniments).strip().lower() in ("1", "true", "yes")
    return service.list_music(int(page), int(per_page), search.strip(), want_acc)


@router.get("/detail/{music_id:int}")
def music_detail(music_id: int):
    return service.music_detail(music_id)


@router.api_route("/download/{music_id:int}", methods=["GET", "HEAD"])
def download_music(music_id: int):
    """音频本体。公开（无 @login_required），与 Flask 一致。

    下发走 storage.stream_music_file → starlette FileResponse，**原生支持 Range**，
    所以 <audio> 能拖进度条、iOS Safari 能播。别改成自己读 bytes 返回。

    ★ 为什么这条写 ``api_route(methods=["GET","HEAD"])`` 而不是 ``@router.get``：
      Flask/werkzeug 给每条 GET 规则**自动加 HEAD**，FastAPI 的 ``.get()`` 不加
      （starlette 的 Route 加，但 FastAPI 的 APIRoute 覆盖掉了）。少了 HEAD 的话，
      会先发 HEAD 探 Content-Length 再发 Range 的播放器（部分原生播放器 / 下载管理器）
      会拿到 405 直接放弃。JSON 路由丢了 HEAD 没人在意，二进制下发这条不行。
      FileResponse 认得 HEAD（只发头不发体），所以加上就是对的。
    """
    return service.download_music(music_id)


@router.post("/edit/{music_id:int}")
@login_required
@permission_required("music_edit")
def edit_music(music_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.edit_music(music_id, payload or {})


@router.post("/replace/{music_id:int}")
@login_required
@permission_required("music_edit")
def replace_music(music_id: int, file: Optional[UploadFile] = File(default=None)):
    return service.replace_music_file(music_id, _nullable_upload(file))


@router.delete("/delete/{music_id:int}")
@login_required
@permission_required("music_edit")
def delete_music(music_id: int):
    return service.delete_music(music_id)


# ─────────────────────────── 播放分钟数统计 ───────────────────────────


@router.post("/add_one_minute/{music_id:int}")
@login_required
def add_one_minute(music_id: int):
    # 只要登录就能打点，不需要 music_edit（播放器每播满一分钟调一次）。
    return service.add_one_minute(music_id)


@router.get("/minute_logs")
@login_required
def list_minute_logs(
    page: str = "",
    per_page: str = "",
    music_id: str = "",
    user_id: str = "",
):
    # 原式四个都带 ``type=int``：page 默认 1、per_page 默认 200、
    # music_id / user_id 默认 None（= 不过滤）。转不动一律回默认值，见 _int_arg。
    return service.list_minute_logs(
        _int_arg(page, 1),
        _int_arg(per_page, 200),
        _int_arg(music_id),
        _int_arg(user_id),
    )


@router.get("/last_played")
@login_required
def get_last_played_music():
    return service.get_last_played_music()


# ─────────────────────────── 专辑封面图 ───────────────────────────


@router.api_route("/album_cover/{filename:path}", methods=["GET", "HEAD"])
def album_cover(filename: str):
    """公开（无 @login_required），与 Flask 一致 —— 封面是 <img> 直接引用的。

    用 ``:path`` 转换器对应 Flask 的 ``<path:filename>``：filename 可以带斜杠，
    storage 那边靠 ``os.path.basename()`` 砍掉目录部分防穿越。
    HEAD 的理由同 download_music。
    """
    return serve_album_image(filename)


# ─────────────────────────── 歌单 ───────────────────────────


@router.get("/playlists")
@login_required
def list_playlists():
    return service.list_playlists()


@router.post("/playlist")
@login_required
def create_playlist(payload: Optional[dict] = _JSON_BODY):
    # 歌单是「每个用户自己的」，所以只要登录，不需要 music_edit。
    return service.create_playlist(payload or {})


@router.get("/playlist/{playlist_id:int}")
@login_required
def get_playlist(playlist_id: int):
    return service.get_playlist(playlist_id)


@router.post("/playlist/{playlist_id:int}")
@login_required
def save_playlist(playlist_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.save_playlist(playlist_id, payload or {})


@router.delete("/playlist/{playlist_id:int}")
@login_required
def delete_playlist(playlist_id: int):
    return service.delete_playlist(playlist_id)


# ─────────────────────────── 播放队列 / 播放器状态 ───────────────────────────


@router.get("/queue")
@login_required
def get_queue_state():
    return service.get_queue_state()


@router.post("/queue")
@login_required
def save_queue_state(payload: Optional[dict] = _JSON_BODY):
    return service.save_queue_state(payload or {})


@router.get("/playlist_state")
@login_required
def get_playlist_state():
    return service.get_playlist_state()


@router.post("/playlist_state")
@login_required
def save_playlist_state(payload: Optional[dict] = _JSON_BODY):
    return service.save_playlist_state(payload or {})


# ═══════════════════ 播放队列（增量操作）═══════════════════
#
# 原来只有 GET/POST /queue 两条「整份读 / 整份写」。前端要「加入队列」就得
# 先拉全量、本地拼好、再整份写回 —— 两个人同时操作会互相覆盖，
# 而且一次加一首要传整个队列。下面是增量版本。

from backend.api.music import accompaniment_service, queue_service  # noqa: E402


@router.get("/queue/detail")
@login_required
def get_queue_detail():
    """队列 + 每首歌的完整信息。

    前端渲染队列要显示歌名/专辑，只有 id 列表不够；让它按 id 一首首去查
    会产生 N 次请求，所以这里一次给全。
    """
    return queue_service.queue_detail()


@router.post("/queue/add")
@login_required
def add_to_queue(payload: Optional[dict] = _JSON_BODY):
    """加入队列。position="next" 插到当前播放的下一首，默认追加到队尾。"""
    return queue_service.add_to_queue(payload or {})


@router.post("/queue/remove")
@login_required
def remove_from_queue(payload: Optional[dict] = _JSON_BODY):
    """按**下标**移除（不是按 music_id）——同一首歌可以在队列里出现多次。"""
    return queue_service.remove_from_queue(payload or {})


@router.post("/queue/clear")
@login_required
def clear_queue():
    return queue_service.clear_queue()


@router.post("/queue/reorder")
@login_required
def reorder_queue(payload: Optional[dict] = _JSON_BODY):
    """拖动排序后整份重排。只接受与原队列同一批 id 的新顺序，否则 409。"""
    return queue_service.reorder_queue(payload or {})


# ═══════════════════ 伴奏（1 对 1）═══════════════════
#
# 数据层是 music.accompaniment_of_id（自引用 + 唯一约束，DB 强制 1 对 1）。
# 这两条只做业务规则校验，把 DB 会拒绝的情况提前翻成看得懂的中文。


@router.post("/tracks/{music_id:int}/accompaniment")
@login_required
@permission_required("music_edit")
def set_accompaniment(music_id: int, payload: Optional[dict] = _JSON_BODY):
    """把某首曲目指定为 music_id 的伴奏。"""
    return accompaniment_service.set_accompaniment(music_id, payload or {})


@router.delete("/tracks/{music_id:int}/accompaniment")
@login_required
@permission_required("music_edit")
def clear_accompaniment(music_id: int):
    """解除伴奏关系。伴奏本身不删，退回普通曲目。"""
    return accompaniment_service.clear_accompaniment(music_id)


# ═══════════════════ 播放设备与播放权（Spotify Connect 那一套）═══════════════════
#
# 一个用户可能同时开着电脑浏览器、手机浏览器、APK。规则是
# **同一时刻只有一个在放**，另外几个只能看状态或把播放接管过来。
#
# 实时通道：app 名 ``music``，房间就是**用户自己的 id** —— 一条私人频道，
# 别人订会被 authorize 拒掉。设备的上下线由 on_connect / on_disconnect 登记。

from backend.core.realtime import RealtimeApp, register  # noqa: E402

from backend.api.music import playback_service  # noqa: E402


def _music_authorize(room_id, user, params):
    """只有本人能订自己的频道。

    ``room_id`` 就是 user_id 的字符串形式。比字符串而不是比 int：
    房间 id 在 Redis 频道里本来就是字符串，转 int 还要处理转不动的情况。
    """
    del params
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    return str(room_id) == str(getattr(user, "id", ""))


def _music_snapshot(room_id, user, params):
    """首帧：当前设备表 + 谁在放。

    ★ 这一帧很重要：SSE **重连即自愈**靠的就是它。
      设备断线重连后 connection_id 会变，没有快照的话它会以为自己还持有播放权。
    """
    del user, params
    devices, active = playback_service._device_list(room_id)
    import json as _json

    raw = playback_service.redis_client.get(playback_service._now_key(room_id))
    try:
        now_playing = _json.loads(raw) if raw else None
    except (TypeError, ValueError):
        now_playing = None
    return {"devices": devices, "active_connection_id": active, "now_playing": now_playing}


def _music_on_connect(conn):
    """设备上线。名字由客户端在查询参数里报上来（?device=Chrome · Windows）。"""
    user_id = getattr(conn.user, "id", None)
    if not user_id:
        return
    playback_service.register_device(
        user_id,
        conn.id,
        conn.params.get("device"),
        conn.params.get("kind"),
    )


def _music_on_disconnect(conn):
    user_id = getattr(conn.user, "id", None)
    if user_id:
        playback_service.unregister_device(user_id, conn.id)


# 导入本模块时注册一次。backend/api/router.py include 本 router 就会触发。
register(
    RealtimeApp(
        name="music",
        authorize=_music_authorize,
        snapshot=_music_snapshot,
        on_connect=_music_on_connect,
        on_disconnect=_music_on_disconnect,
    )
)


@router.get("/playback/devices")
@login_required
def list_playback_devices():
    """当前用户的在线设备 + 谁持有播放权 + 在放什么。

    前端首屏用它；之后靠 SSE 的 music:devices 事件增量更新。
    """
    return playback_service.get_devices(current_user.id)


@router.post("/playback/claim")
@login_required
def claim_playback(payload: Optional[dict] = _JSON_BODY):
    """把播放权拿到某台设备上。

    两个场景共用这一条：本机点播放（传自己的 connection_id），
    或在下拉里选了另一台（传那一台的，即 Spotify 的「转移播放」）。
    """
    return playback_service.claim_playback(current_user.id, payload or {})


@router.post("/playback/state")
@login_required
def report_playback_state(payload: Optional[dict] = _JSON_BODY):
    """上报当前在放什么，让别的设备能显示。

    ★ 只有**持有播放权**的设备说得算（服务端校验）。不校验的话，
      一台刚被接管走、还没停下来的设备上报的状态会覆盖掉新设备的，
      两边来回打架。
    """
    return playback_service.report_state(current_user.id, payload or {})
