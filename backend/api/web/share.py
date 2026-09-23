"""分享页的 og:image 注入 —— /event/{id} 与 /image/{id} 用到的全部 helper。

原 backend/app/web.py 的第 1–333 行（Flask）。业务逻辑（挑哪张图、视频抽第几帧、
图标怎么裁、文案怎么截断）一字未改，只改了三件事：依赖换成 FastAPI 侧的模块、
Flask 的全局 ``request`` 改成显式传参、渲染方式从「独立中间页」改成「往 SPA 外壳注标签」。

── 为什么不再有中间页 ────────────────────────────────────────────────

旧版 ``/event/{id}`` 渲染 ``templates/event_share.html``：一个独立页面，带 og 标签 +
一张图 + 一个「打开活动详情」按钮链到 ``/#/event/{id}``（hash 路由）。
新前端是**路径路由**，``/events/{id}`` 本身就是应用内的页面地址 —— 那个按钮会指向
它自己，点一下原地转圈。

所以现在的做法是：**照发 SPA 外壳，只在 ``</head>`` 前插一段 meta**。
爬虫（WhatsApp / 微信 / Telegram / Twitter）只读 head，拿到缩略图；
真人拿到的是完整的应用，落地即是活动详情页，少一次跳转。
这两个模板（event_share.html / image_share.html）因此**已删除**。

── 两件动手前必须知道的事 ────────────────────────────────────────────

① **一切插进 HTML 的文本都必须 ``html.escape(..., quote=True)``。**
   标题和描述来自数据库（活动名、地点、目的都是用户填的），URL 里也可能带 ``&``。
   不转义就是一个存储型 XSS：活动名填 ``"><script>…`` 就能在分享页执行脚本。
   本文件只在 ``_esc()`` 一处做转义，``_share_head_html()`` 里每个值都过了它。

② **``_absolute_url(path, request)`` 的 request 必须一路传下来。**
   Flask 有全局 request，FastAPI 没有。``core.urls.absolute_url`` 在拿不到 request
   时会回落到 ``settings.app_public_origin``，而 dev 机上那个值可能没配 ——
   表现是 og:image 变成不带域名的相对路径，爬虫抓不到图（它们不按当前页做相对解析）。
   所以调用链上每一层都带着 request，不要图省事省掉参数。

── 与旧版的已知差异 ──────────────────────────────────────────────────

· canonical / og:url 从 ``/event/{id}`` 改成 ``/events/{id}``（新前端的真实地址）。
  ``/image/{id}`` 前端**暂时没有对应页面**，所以它的 canonical 仍指向 ``/image/{id}``
  自己 —— 也就是说这条分享链接点开会被 catch-all 当成未知路径发 SPA 外壳，
  前端路由匹配不上会落到 404 页。TODO: 前端加出图片详情页后，把这里同步改掉。
· 不再有 ``body_image_url`` 对应的 ``<img>``（页面由 SPA 自己渲染）。
  ``_browser_source_image_url()`` 仍保留并计算，但**当前没有消费者**，
  留着是因为它是这套逻辑里唯一「给浏览器直接看的原图而不是缓存图」的分支。
"""

import os
import re
import subprocess
from datetime import date, datetime
from html import escape

from backend.api.media.constants import IMAGE_EXTS, VIDEO_EXTS
from backend.api.media.paths import event_photo_base_dir, event_photo_cache_dir, to_short_data_path
from backend.api.media.service import get_event_image_payload, resolve_media_path
from backend.core.files import secure_filename
from backend.core.paths import STATIC_ROOT
from backend.core.urls import absolute_url as _core_absolute_url
from backend.models.event_data import AlbumFiles

EVENT_SHARE_CACHE_SECONDS = 300
IMAGE_SHARE_CACHE_SECONDS = 300

# ★ 比 media 的 IMAGE_EXTS 多了 .heic/.heif：取图走的是 get_event_image_payload("cache")，
#   它对这两个格式有单独的 pillow_heif 分支，产出的是 JPEG 缓存，爬虫能认。
EVENT_SHARE_IMAGE_EXTS = IMAGE_EXTS | {".heic", ".heif"}

VIDEO_SHARE_POSTER_SUFFIX = "_share_poster.jpeg"
SHARE_ICON_SIZE = 192
SHARE_ICON_SUFFIX = "_share_icon.png"

# 浏览器能直接 <img> 的格式。比 IMAGE_EXTS 少了 tif/tiff（Safari 以外基本不认），
# 多了 gif。只用于 _browser_source_image_url。
BROWSER_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


# ─────────────────────────── URL 拼装 ───────────────────────────


def _absolute_url(path, request):
    """裸路径 → 带域名的完整 URL。

    ★ 与旧版的唯一区别是 request 显式传进来（Flask 的全局 request 没了）。

    走 core.urls 而不是自己拼：它会读 X-Forwarded-Prefix 补上项目前缀（如 /UTBA_DEMO），
    并对这个头做安全校验（直连端口时它是客户端可控的，塞 //evil.com 就是开放重定向）。
    """
    normalized = str(path or "").strip()
    if not normalized:
        return ""
    if re.match(r"^https?://", normalized, re.IGNORECASE):
        return normalized
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return _core_absolute_url(normalized, request=request)


def _with_version(url, version):
    """给 URL 挂 ?v=<mtime>。爬虫和 CDN 都会按 URL 缓存图，换了图不换 URL 就刷不掉。"""
    if not version:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}v={version}"


def _version_for_public_path(path, fallback):
    """取文件 mtime 当版本号；取不到就用 fallback（通常是 file_id）。"""
    normalized = str(path or "").strip()
    try:
        if normalized.startswith("/static/"):
            real_path = os.path.join(str(STATIC_ROOT), normalized[len("/static/"):].lstrip("/"))
        elif normalized.startswith("/media_file/"):
            real_path = resolve_media_path(normalized[len("/media_file/"):])
        elif normalized and not re.match(r"^https?://", normalized, re.IGNORECASE):
            real_path = resolve_media_path(normalized)
        else:
            real_path = ""

        if real_path and os.path.exists(real_path):
            return str(int(os.path.getmtime(real_path)))
    except Exception:
        # resolve_media_path 逃出 DATA_ROOT 时抛的是 HTTPException(404)，
        # 它也是 Exception 的子类，会被这里吞掉 → 退回 fallback 版本号。
        # 这是对的：版本号取不到不该让整张分享卡片 404。
        pass
    return str(fallback or "")


def _media_file_url(path, version, request):
    """库里存的相对路径 / 站内绝对路径 / 外链 → 带域名带版本号的图片地址。"""
    normalized = str(path or "").strip()
    if not normalized:
        return ""
    if (
        normalized.startswith("/static/")
        or normalized.startswith("/media_file/")
        or re.match(r"^https?://", normalized, re.IGNORECASE)
    ):
        return _with_version(_absolute_url(normalized, request), version)
    return _with_version(_absolute_url(f"/media_file/{normalized.lstrip('/')}", request), version)


def _fallback_share_image_url(request):
    """兜底图：会徽。取不到活动图时用它，总比爬虫抓个空白强。"""
    path = "/static/images/logo/logo.png"
    version = _version_for_public_path(path, "logo")
    return _media_file_url(path, version, request)


# ─────────────────────────── 文案 ───────────────────────────


def _compact_text(value, fallback="", limit=220):
    """压掉连续空白并截断。og:description 超长的部分各家爬虫截法不一，自己截更可控。"""
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return fallback
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


def _format_event_datetime(value):
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _image_share_description(album_file, event):
    parts = [
        getattr(album_file, "file_name", None),
        _format_event_datetime(getattr(album_file, "created_at", None)),
        getattr(event, "location", None),
    ]
    return _compact_text(" · ".join(str(part).strip() for part in parts if part), "UTBA 活动媒体")


def _event_share_description(event):
    parts = [
        _format_event_datetime(event.datetime),
        event.location,
        event.type,
        event.target,
        event.purpose,
    ]
    return _compact_text(" · ".join(str(part).strip() for part in parts if part), "UTBA 活动详情")


# ─────────────────────────── 选图 ───────────────────────────


def _album_file_ext(album_file):
    """扩展名。优先信 file_type 列，它为空才退回去切 file_name。

    ★ 退回切 file_name 这一支在中文文件名上会切出空串（上传时 secure_filename
      把非 ASCII 全丢了，库里存的却是原名）—— 既有行为，不在这里修。
    """
    raw_type = str(getattr(album_file, "file_type", "") or "").strip().lower().lstrip(".")
    if raw_type:
        return f".{raw_type}"
    _, ext = os.path.splitext(getattr(album_file, "file_name", "") or "")
    return ext.lower()


def _pick_event_share_image(event):
    """活动封面。没设封面（或封面不是图片）就取相册里最新的一张图。"""
    if event.event_image and _album_file_ext(event.event_image) in EVENT_SHARE_IMAGE_EXTS:
        return event.event_image

    return (
        AlbumFiles.query
        .filter(AlbumFiles.event_id == event.id)
        .filter(AlbumFiles.file_type.in_([ext.lstrip(".") for ext in EVENT_SHARE_IMAGE_EXTS]))
        .order_by(AlbumFiles.created_at.desc(), AlbumFiles.id.desc())
        .first()
    )


# ─────────────────────────── 图标（192×192 方图）───────────────────────────


def _share_icon_path(source_path):
    """把分享图裁成 192×192 的 PNG，落在源文件旁边，返回绝对路径。

    微信/WhatsApp 的会话列表缩略图是方的，直接给 16:9 的原图会被两边裁掉主体。

    TODO(并发): 临时文件名只带 ``os.getpid()``，不带线程 id。FastAPI 把同步路由丢进
      **线程池**，同一进程里两个线程同时给同一张图生成图标会写同一个 .tmp，
      互相截断 → 偶发的半张图 / PNG 解码失败。旧版跑在 eventlet 下也有同样的问题
      （所以不算迁移引入的退化），但线程池让它更容易撞上。修法是把 tmp 名换成
      ``f"{output_path}.tmp.{os.getpid()}.{threading.get_ident()}.png"``。
      本次照搬未改，以免动到落盘名相关的行为。
    """
    if not source_path or not os.path.exists(source_path):
        return ""

    stem, _ = os.path.splitext(source_path)
    output_path = f"{stem}{SHARE_ICON_SUFFIX}"
    try:
        if os.path.exists(output_path) and os.path.getmtime(output_path) >= os.path.getmtime(source_path):
            from PIL import Image

            with Image.open(output_path) as icon:
                if icon.size == (SHARE_ICON_SIZE, SHARE_ICON_SIZE):
                    return output_path
    except OSError:
        pass
    except Exception:
        try:
            os.remove(output_path)
        except OSError:
            pass

    tmp_path = f"{output_path}.tmp.{os.getpid()}.png"
    try:
        from PIL import Image, ImageOps

        with Image.open(source_path) as raw_image:
            image = ImageOps.exif_transpose(raw_image).convert("RGB")
            width, height = image.size
            side = min(width, height)
            left = max(0, (width - side) // 2)
            top = max(0, (height - side) // 2)
            image = image.crop((left, top, left + side, top + side))
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
            image = image.resize((SHARE_ICON_SIZE, SHARE_ICON_SIZE), resampling)
            image.save(tmp_path, "PNG", optimize=True)
        os.replace(tmp_path, output_path)
        return output_path
    except Exception as exc:
        print(f"[WEB] Failed to build share icon for {source_path}: {exc}")
        return ""
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _share_icon_url_for_path(path, fallback, request):
    try:
        source_path = resolve_media_path(path)
    except Exception:
        source_path = ""

    icon_path = _share_icon_path(source_path)
    if icon_path:
        icon_short_path = to_short_data_path(icon_path)
        version = _version_for_public_path(icon_short_path, fallback)
        return _media_file_url(icon_short_path, version, request)
    return _fallback_share_image_url(request)


# ─────────────────────────── 视频封面帧 ───────────────────────────


def _run_video_poster_ffmpeg(source_path, output_path, seek_seconds):
    """抽一帧当封面。成功返回 True。

    TODO(并发): tmp 名同样只带 pid，问题与 _share_icon_path 一致，照搬未改。
    """
    tmp_path = f"{output_path}.tmp.{os.getpid()}.jpeg"
    try:
        command = [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-ss",
            str(seek_seconds),
            "-i",
            source_path,
            "-frames:v",
            "1",
            "-vf",
            "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
            "-q:v",
            "3",
            tmp_path,
        ]
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=25)
        if result.returncode != 0 or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) <= 0:
            return False
        os.replace(tmp_path, output_path)
        return True
    except Exception as exc:
        print(f"[WEB] Failed to extract video poster for {source_path}: {exc}")
        return False
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _video_share_poster_path(album_file):
    """视频的分享封面。先试第 1 秒（跳过黑场片头），失败再试第 0 秒。"""
    event = getattr(album_file, "event", None)
    event_code = getattr(event, "event_code", None)
    if not event_code:
        return ""

    filename = secure_filename(getattr(album_file, "file_name", "") or "")
    if not filename:
        return ""

    source_path = os.path.join(event_photo_base_dir(event_code), filename)
    if not os.path.exists(source_path):
        return ""

    stem, _ = os.path.splitext(filename)
    output_path = os.path.join(event_photo_cache_dir(event_code), f"{stem}{VIDEO_SHARE_POSTER_SUFFIX}")
    try:
        if os.path.exists(output_path) and os.path.getmtime(output_path) >= os.path.getmtime(source_path):
            return output_path
    except OSError:
        pass

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    if _run_video_poster_ffmpeg(source_path, output_path, 1) or _run_video_poster_ffmpeg(source_path, output_path, 0):
        return output_path
    return ""


# ─────────────────────────── 组装三个图片 URL ───────────────────────────


def _browser_source_image_url(album_file, ext, request):
    """原图（不是缓存 JPEG）的地址。当前没有消费者，见模块 docstring。"""
    if ext not in BROWSER_IMAGE_EXTS:
        return ""

    event = getattr(album_file, "event", None)
    event_code = getattr(event, "event_code", None)
    filename = secure_filename(getattr(album_file, "file_name", "") or "")
    if not event_code or not filename:
        return ""

    source_path = os.path.join(event_photo_base_dir(event_code), filename)
    if not os.path.exists(source_path):
        return ""

    path = to_short_data_path(source_path)
    version = _version_for_public_path(path, album_file.id)
    return _media_file_url(path, version, request)


def _event_share_image_urls(event, request):
    """→ (og:image, icon)。任何一步出岔子都退到会徽。"""
    album_file = _pick_event_share_image(event)
    if not album_file:
        fallback = _fallback_share_image_url(request)
        return fallback, fallback

    try:
        payload = get_event_image_payload(album_file.id, "cache")
        # 转码/压缩还没完成时 service 返回 (dict, 202)，取第一项即可（ready 会是 False）。
        if isinstance(payload, tuple):
            payload = payload[0]
        if payload.get("ready") and payload.get("path"):
            path = payload["path"]
            version = _version_for_public_path(path, album_file.id)
            return _media_file_url(path, version, request), _share_icon_url_for_path(path, album_file.id, request)
    except Exception:
        pass

    fallback = _fallback_share_image_url(request)
    return fallback, fallback


def _image_file_share_urls(album_file, request):
    """→ (og:image, icon, 原图)。视频走抽帧，图片走缓存 JPEG，其余退到会徽。

    TODO(照搬的可疑行为): 图片分支里缓存还没压好（ready=False）时，三个都退成会徽 ——
      即便 _browser_source_image_url 拿得到原图也不用。表现是刚上传的照片分享出去
      是会徽，等缓存压好后再分享才对。旧版即如此，本次未改。
    """
    ext = _album_file_ext(album_file)
    if ext in EVENT_SHARE_IMAGE_EXTS:
        try:
            payload = get_event_image_payload(album_file.id, "cache")
            if isinstance(payload, tuple):
                payload = payload[0]
            if payload.get("ready") and payload.get("path"):
                path = payload["path"]
                version = _version_for_public_path(path, album_file.id)
                image_url = _media_file_url(path, version, request)
                icon_url = _share_icon_url_for_path(path, album_file.id, request)
                body_image_url = _browser_source_image_url(album_file, ext, request) or image_url
                return image_url, icon_url, body_image_url
        except Exception as exc:
            print(f"[WEB] Failed to prepare image share cache for file {album_file.id}: {exc}")
        fallback = _fallback_share_image_url(request)
        return fallback, fallback, fallback

    if ext in VIDEO_EXTS:
        poster_path = _video_share_poster_path(album_file)
        if poster_path:
            path = to_short_data_path(poster_path)
            version = _version_for_public_path(path, album_file.id)
            image_url = _media_file_url(path, version, request)
            return image_url, _share_icon_url_for_path(path, album_file.id, request), image_url
        fallback = _fallback_share_image_url(request)
        return fallback, fallback, fallback

    fallback = _fallback_share_image_url(request)
    return fallback, fallback, fallback


# ─────────────────────────── 注入 <head> ───────────────────────────


def _esc(value):
    """本文件唯一的 HTML 转义口。quote=True 连 " 和 ' 一起转 —— 这些值全在属性里。"""
    return escape(str(value or ""), quote=True)


def _share_head_html(title, description, image_url, icon_url, canonical_url):
    """照抄 templates/event_share.html 的 <head>（只留元信息，样式和 body 不要了）。

    og:image 给两份（image + image:secure_url）是历史写法：早年 Facebook 在
    https 页面上只认 secure_url，现在两个都给最省事。
    """
    title = _esc(title)
    description = _esc(description)
    image_url = _esc(image_url)
    icon_url = _esc(icon_url)
    canonical_url = _esc(canonical_url)
    return "\n".join([
        f"<title>{title}</title>",
        f'<meta name="description" content="{description}">',
        f'<link rel="canonical" href="{canonical_url}">',
        f'<link rel="icon" type="image/png" sizes="192x192" href="{icon_url}">',
        f'<link rel="shortcut icon" href="{icon_url}">',
        f'<link rel="apple-touch-icon" sizes="180x180" href="{icon_url}">',
        '<meta property="og:type" content="article">',
        '<meta property="og:site_name" content="UTBA">',
        f'<meta property="og:title" content="{title}">',
        f'<meta property="og:description" content="{description}">',
        f'<meta property="og:url" content="{canonical_url}">',
        f'<meta property="og:image" content="{image_url}">',
        f'<meta property="og:image:secure_url" content="{image_url}">',
        f'<meta property="og:image:alt" content="{title}">',
        '<meta property="og:locale" content="zh_CN">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{title}">',
        f'<meta name="twitter:description" content="{description}">',
        f'<meta name="twitter:image" content="{image_url}">',
    ])


# 外壳自带的 <title>心芽 · UTBA</title>。见 inject_head 里为什么要先摘掉它。
_TITLE_RE = re.compile(r"<title\b[^>]*>.*?</title>", re.IGNORECASE | re.DOTALL)
_HEAD_CLOSE_RE = re.compile(r"</head\s*>", re.IGNORECASE)


def inject_head(shell_html, head_html):
    """把 head_html 插进 SPA 外壳的 ``</head>`` 之前。

    ★ 先用正则摘掉外壳自带的那个 ``<title>``：HTML 里出现两个 title 时，浏览器和
      大部分爬虫取的是**第一个** —— 不摘的话分享卡片的标题永远是「心芽 · UTBA」，
      注进去的活动名一个字都不会被用上。只摘第一个（count=1），body 里不会有 title。

    外壳没有 </head>（理论上不会，vite 产物一定有）时插在文档最前面：
    爬虫对 head 外的 meta 大多也认，总比整段丢掉强。
    """
    stripped = _TITLE_RE.sub("", shell_html, count=1)
    match = _HEAD_CLOSE_RE.search(stripped)
    if not match:
        return f"{head_html}\n{stripped}"
    return f"{stripped[:match.start()]}{head_html}\n{stripped[match.start():]}"


def event_share_head(event, request):
    """活动分享卡片的 head 片段。"""
    title = _compact_text(event.event_name, f"活动 #{event.id}", 90)
    image_url, icon_url = _event_share_image_urls(event, request)
    # ★ 路径变了：旧版 canonical 指向 /event/{id}（那个独立中间页），
    #   新前端是路径路由，活动详情的真实地址是 /events/{id}。
    canonical_url = _absolute_url(f"/events/{event.id}", request)
    return _share_head_html(
        title=title,
        description=_event_share_description(event),
        image_url=image_url,
        icon_url=icon_url,
        canonical_url=canonical_url,
    )


def image_share_head(album_file, event, request):
    """单张媒体分享卡片的 head 片段。"""
    title = _compact_text(getattr(event, "event_name", None), f"媒体 #{album_file.id}", 90)
    image_url, icon_url, _body_image_url = _image_file_share_urls(album_file, request)
    # ★ 前端还没有「单张媒体」这个页面，canonical 只能仍旧指向 /image/{id} 自己。
    #   见模块 docstring 里的 TODO。
    canonical_url = _absolute_url(f"/image/{album_file.id}", request)
    return _share_head_html(
        title=title,
        description=_image_share_description(album_file, event),
        image_url=image_url,
        icon_url=icon_url,
        canonical_url=canonical_url,
    )
