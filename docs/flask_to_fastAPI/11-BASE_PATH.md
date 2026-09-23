# 11 · `VITE_BASE_PATH` / `APP_BASE_PATH`：多项目共域名部署

> 阶段 B。**不依赖 FastAPI，可以在 Flask 上先做完上线。**

## 1. 要达成什么

现在每个项目一个域名，加项目就要加 CNAME。目标改成：

```
utbabuddha.com/xinya/...      → 127.0.0.1:5006   （本项目）
utbabuddha.com/fahui/...      → 127.0.0.1:5009
utbabuddha.com/aci/...        → 127.0.0.1:5012
```

只改 nginx 的 `location`，不碰 DNS。

**前提**：整套应用必须不再假设自己住在 `/`。现在它到处假设 —— 下面是完整的
"假设清单"，一条都不能漏，漏一条就是某个链接 404 或某张二维码扫出死链。

## 2. 受影响的全部位置

### 后端（Python）

| 位置 | 现在 | 要改成 |
|---|---|---|
| `app/settings.py` | `API_PREFIX = "/api"` | 保持不变（前缀由外层注入，见 §3） |
| `app/web.py` `_absolute_url()` | `request.url_root + path` | 感知 `SCRIPT_NAME` / `root_path` |
| `app/web.py` 短链跳转 | `redirect("/#/music/turntable/mirror")` | `redirect(public_url("/#/..."))` |
| `app/common/council_sign.py` ×2 | `request.host_url + "/template/council-sign"` | `public_url(...)` |
| 分享页模板 | `canonical_url` / `og:image` / `og:url` | 同上（17 个模板里凡是写死 `/` 开头的都要查） |
| 会话 Cookie | `path` 默认 `/` | `path = APP_BASE_PATH`（**否则多项目 Cookie 互相覆盖**） |
| 静态目录 | Flask `static_folder` 挂 `/static` | 由外层前缀覆盖，或 nginx 直接服务 |

### 前端（TS）

| 位置 | 数量 | 要改成 |
|---|---:|---|
| `frontend/vite.config.js` `base` | 1 | `` `${BASE}/static/vite/` ``（APK 仍是 `./`） |
| `apiFetch()` 里拼 URL | 1 处（覆盖 400 个调用点） | `API_BASE + BASE_PATH + path` |
| `window.location.origin + "/..."` | **41 处** | 统一走新助手 `publicUrl(path)` |
| socket `io(origin)` | 5+ 处 | 传 `path: \`${BASE}/socket.io\`` |
| `static/index.html` 与 `frontend/index.html` | 2 份 | `/static/vite/init.js`、`/favicon.ico` 要带前缀 |
| 短链构造（二维码） | `buildMirrorPlayerUrl` / `buildGamePlayerUrl` 等 | 带上前缀 |

> ⚠️ **首页有两份**：网页版是 `static/index.html`，`frontend/index.html` 只给 APK 用。
> 改 `<head>` 里的资源路径**两处都要改**，只改一份会让另一端白屏。

### 基础设施

| 位置 | 要改 |
|---|---|
| nginx | `location /xinya/` + `location /xinya/socket.io/` + `location /xinya/media_file/` + `cctv_authz` |
| systemd | 传入 `APP_BASE_PATH`（或由 `system_config.env` 提供） |

## 3. 设计：前缀由外层注入，应用内部只认相对路径

两种实现路线，**推荐 (A)**：

### (A) nginx 剥掉前缀 + 应用知道自己的"公开前缀"

```nginx
location /xinya/ {
    proxy_pass http://127.0.0.1:5006/;      # 末尾斜杠 = 剥掉 /xinya
    proxy_set_header X-Forwarded-Prefix /xinya;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;
}
location /xinya/socket.io/ {
    proxy_pass http://127.0.0.1:8000/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

应用内部路由表完全不变（还是 `/api/...`），只在**生成对外链接**时补前缀。

Flask 阶段用一个 WSGI 中间件把 `X-Forwarded-Prefix` 写进 `SCRIPT_NAME`，
Werkzeug 会自动让 `url_root` / `redirect` / `url_for` 全部带上前缀：

```python
# core/prefix.py
class PrefixMiddleware:
    def __init__(self, app): self.app = app
    def __call__(self, environ, start_response):
        prefix = environ.get("HTTP_X_FORWARDED_PREFIX", "").rstrip("/")
        if prefix:
            environ["SCRIPT_NAME"] = prefix
            path = environ["PATH_INFO"]
            if path.startswith(prefix):
                environ["PATH_INFO"] = path[len(prefix):] or "/"
        return self.app(environ, start_response)

app.wsgi_app = PrefixMiddleware(app.wsgi_app)
```

FastAPI 阶段等价物是 `root_path`：

```python
app = FastAPI(root_path=settings.app_base_path)     # 或 uvicorn --root-path /xinya
```

⚠️ 注意：FastAPI 的 `root_path` 会让 `request.url_for()` 带前缀，但
**`RedirectResponse("/foo")` 不会自动带** —— 裸路径就是裸路径。所以仍然需要
统一的 `public_url()` 助手，见下。

### (B) 应用自己把全部路由挂到前缀下

`app.mount(f"{base}/api", ...)`。看起来直白，但 574 个路由 + 静态 + 模板都要跟着变，
而且本地开发（无前缀）与生产（有前缀）行为不一致。**不推荐。**

## 4. 统一助手（两端各一个）

### 后端

```python
# core/urls.py
from flask import request   # FastAPI 阶段换成 starlette 的 Request

def base_path() -> str:
    return (request.headers.get("X-Forwarded-Prefix") or settings.app_base_path or "").rstrip("/")

def public_url(path: str) -> str:
    """把应用内部路径变成对外可点的绝对/相对 URL。"""
    p = "/" + str(path or "").lstrip("/")
    return f"{base_path()}{p}"

def absolute_url(path: str) -> str:
    origin = settings.app_public_origin or request.host_url.rstrip("/")
    return f"{origin}{public_url(path)}"
```

`app/web.py` 里现有的 `_absolute_url()` 直接改为调用 `absolute_url()`，
7 处 `redirect(...)` 改为 `redirect(public_url(...))`。

### 前端

```ts
// frontend/src/js/basePath.ts
export const BASE_PATH: string = (import.meta.env.VITE_BASE_PATH as string || "").replace(/\/$/, "");

/** 应用内部路径 → 可对外分享的绝对 URL（二维码、分享链接、下载兜底都用它）。 */
export function publicUrl(path: string): string {
  const origin = (import.meta.env.VITE_PUBLIC_ORIGIN as string) || window.location.origin;
  return `${origin}${BASE_PATH}/${String(path).replace(/^\//, "")}`;
}
```

`apiFetch` 改一处即可覆盖 400 个调用点：

```ts
if (typeof input === "string" && input.startsWith("/")) {
  input = `${API_BASE}${BASE_PATH}${input}`;
}
```

41 处 `window.location.origin + ...` 逐个换成 `publicUrl(...)` —— 这是本阶段
**最琐碎但最容易漏**的部分，漏掉的表现是「二维码扫出来 404」。

### Socket.IO

```ts
io(origin, { path: `${BASE_PATH}/socket.io`, withCredentials: true, transports: ["websocket", "polling"] })
```

5+ 处连接点（`mediaRealtime.ts`、`CRM/fahui/socket.ts`、`useFormRealtime.ts`、
`changyou/room/socket.ts`、`quizSocket.ts`）统一抽成一个 `connectSocket()` 助手再改。

## 5. Cookie 的坑（多项目共域名时必炸）

同一域名下 `/xinya` 和 `/fahui` 两个项目，如果 Cookie 都写 `path=/`：

- 两个项目的会话 Cookie **同名**（Flask 默认都叫 `session`）→ 互相覆盖 → 用户在
  A 项目登录会把 B 项目踢下线。

必须两条一起做：

```dotenv
SESSION_COOKIE_NAME=xinya_session      # 每个项目不同名
SESSION_COOKIE_PATH=/xinya             # = APP_BASE_PATH
```

⚠️ **改 Cookie 名/路径 = 所有在线用户掉线一次**。安排在低峰期，并提前通知。
（`REMEMBER_COOKIE_*` 同样要改名改 path。）

## 6. APK 怎么办

APK 走 `VITE_API_BASE=https://utbabuddha.com`，加前缀后变成
`VITE_API_BASE=https://utbabuddha.com` + `VITE_BASE_PATH=/xinya`。

已确认**不需要为旧链接保留兼容入口**，所以 nginx 不必长期保留根路径 location。
但这把风险转移到了 APK 上：

> **旧版 APK 只会打 `https://utbabuddha.com/api/...`，切换后全部 404。**

所以切换前必须先发**带最低版本门禁的过渡版 APK**（见 [03](03-迁移策略.md) §6），
提前 2–4 周发布并盯升级率。**这一步不做，切换当天就是老用户集体白屏。**

## 7. 本地开发

`VITE_BASE_PATH` 留空（`""`）时一切行为与现在完全一致，
`publicUrl("/mirror")` → `http://localhost:5173/mirror`。
**这保证了本地开发不用起 nginx 也能跑**，也是选路线 (A) 的主要理由。

## 8. 验收

- [ ] `APP_BASE_PATH=/` 时，所有行为与迁移前逐字节一致（回归对拍）
- [ ] `APP_BASE_PATH=/xinya` 时：
  - [ ] SPA 能打开，静态资源 200（两份 index.html 都验）
  - [ ] 登录 → 刷新仍在线（Cookie path 正确）
  - [ ] Socket.IO 连上（活动相册实时、表单实时、唱游房间任选其一验证）
  - [ ] 二维码：转盘活动、「别人眼中的我」、公开表单，扫码能进且 token 带对
  - [ ] 分享卡片：`/event/<id>` 的 OG 图与 canonical 链接正确
  - [ ] 文件下载、视频播放（Range 请求）正常
  - [ ] `/media_file/` 走 nginx 命中与回落两条路都正常
  - [ ] CCTV 的 `auth_request` 仍然鉴权成功
- [ ] APK 版本门禁已生效，旧版本会提示更新而不是白屏
- [ ] 两个项目同域名并存时，互相登录不踢线
