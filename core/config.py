"""全局配置的唯一读取入口。

设计背景（详见 docs/flask_to_fastAPI/10-配置中心.md）：
配置原本散在 5 个地方 —— /srv/flaskapp/_token.py（6 个项目共用）、仓库 _token.py、
.flaskenv、代码里 12 处 os.environ、以及只活在代码默认值里的「隐藏键」。
这个文件把它们收敛成一份 system_config.env。

三件必须知道的事：

1. **不能指望环境变量已就位。**生产的 systemd unit 只有 Environment="PATH=..."，
   没有 EnvironmentFile；.flaskenv 的键从来没进过进程环境。所以这里用 env_file=
   直接读文件，而不是假设 os.environ 里有值。

2. **改配置从此要重启。**旧的 env_value() 是每次调用现读文件，改 API key 免重启；
   换成这里的「进程启动读一次 + lru_cache」后，改任何键都必须重启 gunicorn/uvicorn。
   这一条要写进 runbook，否则线上会出现「改了 key 没生效」的困惑。

3. **键名不能和进程环境变量撞。**pydantic-settings 默认 case_sensitive=False 且会读
   os.environ，systemd 的 User=yukang 会注入 USER、shell 会注入 PWD。所以摄像头那几个
   键一律改名 CAM_USER / CAM_PASSWORD / CAM_PORT，DEBUG 改名 APP_DEBUG。
   **绝不给它们留旧名别名** —— 留了就等于把这个坑又挖回来。

本模块必须零副作用：不建目录、不连数据库、不 import app 包。
"""

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from pydantic import AliasChoices, Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 用 __file__ 定位仓库根，不用 cwd：gunicorn / systemd / alembic / pytest
# 各自的工作目录都不一样，靠 cwd 找配置文件迟早会在某一个入口下找不到。
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# 加载顺序 = 优先级从低到高：共享文件 → 项目文件 → 进程环境变量。
# 共享文件给多项目复用的值（DB、Twilio…），不存在时 pydantic-settings 会静默跳过。
SHARED_ENV_FILE = Path("/srv/flaskapp/system_config.shared.env")
PROJECT_ENV_FILE = PROJECT_ROOT / "system_config.env"

# DATA_ROOT 的默认值单独抽出来：validator 里要用同一个常量做空值回落，
# 避免「默认值写两处、改一处忘一处」。
_DEFAULT_DATA_ROOT = "/srv/flaskapp/xinya/database"

# 必填且不许为空白的键。缺任何一个都应当启动即失败，而不是跑到某个接口才炸。
_REQUIRED_NON_BLANK = ("secret_key", "db_host", "db_name", "db_user", "db_password")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(SHARED_ENV_FILE), str(PROJECT_ENV_FILE)),
        env_file_encoding="utf-8",
        # system_config.env 里会有前端脚本用的键、或别的项目留下的键，不认识的一律忽略，
        # 否则加一个键就要改这个类。
        extra="ignore",
        # ★ 关键：把 `KEY=`（空字符串）当成「没填」而不是「填了空值」。
        # 不开这个的话 SECRET_KEY= 也能启动成功（签名密钥变成空串），
        # 而 10 文档 §8 那条「删掉 SECRET_KEY 就启动失败」的验收会假通过。
        # 顺带也还原了 app/paths.py 原来 `os.environ.get(...) or 默认值` 的语义。
        env_ignore_empty=True,
    )

    # ─────────── 身份 / 运行 ───────────
    app_name: str = "xinya"
    app_env: str = "production"  # production | staging | development
    # 旧名是 DEBUG，改名 APP_DEBUG —— DEBUG 是通用环境变量名，太容易被外部注入。
    app_debug: bool = False
    # 本项目挂在域名的哪个路径下（见 11-BASE_PATH.md）。留空 = 挂在根，
    # 行为与迁移前完全一致，本地开发不起 nginx 也能跑。
    app_base_path: str = ""
    # 对外可点的绝对地址前缀（二维码、分享链接、OG 图用）。
    # 留空表示「用当次请求的 Host 推断」，与现有 request.host_url 的行为一致。
    app_public_origin: str = ""
    # ⚠️ 改这个 = 全部用户掉线（会话 Cookie 与所有 itsdangerous 签名都基于它）。
    # 迁移时必须从 /srv/flaskapp/_token.py 逐字节复制，不能重新生成。
    secret_key: str = Field(min_length=1)

    # ─────────── 数据库（PostgreSQL + psycopg3，见 15 文档）───────────
    db_host: str = Field(min_length=1)
    db_port: int = 5432
    db_name: str = Field(min_length=1)
    db_user: str = Field(min_length=1)
    db_password: str = Field(min_length=1)
    # ★ 池子为什么这么小：PG 默认 max_connections = 100，而且**每条连接是一个进程**，
    # 不像 MySQL 那样靠调大参数就能解决。4 个 worker × (8 + 4) = 48 条，
    # 剩下的余量留给 psql 手工连接、pg_dump、alembic 和别的项目。
    # 并发再高的正确做法是上 PgBouncer（transaction 模式），不是把这两个数字调大。
    db_pool_size: int = 8
    db_max_overflow: int = 4
    # 比连接的空闲上限（PG 侧 / PgBouncer / 中间的防火墙）短一点，
    # 让 SQLAlchemy 主动回收，而不是等到用的时候才发现连接已经被对端掐了。
    db_pool_recycle: int = 280
    db_pool_pre_ping: bool = True
    db_echo: bool = False

    # ─────────── Redis / 实时 ───────────
    redis_url: str = "redis://localhost:6379/0"
    socket_channel: str = "xinya_socket"
    # 原来是 app/extensions.py 里的白名单 + 「任意 *.utbabuddha.com」判断函数，
    # 这里用一条正则等价表达（含开发隧道子域和 5173 的 vite dev server）。
    # 子域用 `*` 不用 `?`：原函数是 host.endswith(".utbabuddha.com")，
    # a.b.utbabuddha.com 这种两级子域也放行；写成 `?` 会把它们挡在外面。
    socket_allowed_origin_regex: str = (
        r"^https?://([a-z0-9-]+\.)*utbabuddha\.com(:\d+)?$"
        r"|^http://(localhost|127\.0\.0\.1):5173$"
    )

    # ─────────── 路径 ───────────
    # 用户上传的文件一律落在这里，不能写进仓库目录 —— deploy 时 git 会把它们删掉。
    data_root: str = _DEFAULT_DATA_ROOT
    # nginx: location /media_file/ { alias <data_root>/; }
    # 做 BASE_PATH 改造时这个前缀要跟着变，且必须与 nginx 的 alias 同步改。
    media_url_prefix: str = "/media_file"
    # REST 与实时都挂在 BASE_PATH 下，不再套 /api —— BASE_PATH（如 /UTBA_DEMO）
    # 已经区分了项目，/api 这一段不带信息量。留着字段是为了需要时还能加回来。
    api_prefix: str = ""
    # 仅 Flask 阶段有效。FastAPI 没有等价项，**真正拦住大文件上传的是 nginx 的
    # client_max_body_size** —— 别把这个数字当成「已验证能传 5GB」。
    max_content_length: int = 1024 * 1024 * 5000

    # ─────────── 会话 / 移动端 ───────────
    session_lifetime_days: int = 7
    # 现状就是 Flask 默认的 "session"。11 文档计划改成 xinya_session（多项目共域名时
    # 防止互相覆盖），⚠️ 改名那一刻所有在线用户掉线一次，要挑低峰期。
    session_cookie_name: str = "session"
    # SameSite=None + Secure 是为了 APK WebView 从 https://localhost 跨域带 Cookie。
    session_cookie_samesite: str = "None"
    session_cookie_secure: bool = True
    session_cookie_httponly: bool = True
    remember_cookie_days: int = 7
    mobile_access_token_seconds: int = 1800
    mobile_refresh_token_days: int = 90
    # ⚠️ 改这个 = 所有 APK 需要重新登录。
    mobile_access_token_salt: str = "xinya-mobile-session"

    # ─────────── 签名盐（原本硬编码在各模块里，默认值必须一字不差）───────────
    # ⚠️ 改任何一个，对应的已发出链接/已印出二维码立刻作废。
    council_sign_salt: str = "council-sign"
    email_change_salt: str = "email-change-v1"
    check_in_qr_salt: str = "xinya-event-check-in-qr-v1"

    # ─────────── 外部服务：AI（BytePlus / Ark）───────────
    byteplus_api_key: str = ""
    # 代码里的次选别名（BYTEPLUS_API_KEY or ARK_API_KEY），保留以免改动业务语义。
    ark_api_key: str = ""
    # ★ 必须带 /api/v3。10 文档 §4 草案漏了这一段，照抄会让读单 / 排位 OCR /
    #   出题 / 智能分组四个功能同时 404。
    byteplus_base_url: str = "https://ark.ap-southeast.bytepluses.com/api/v3"
    byteplus_model: str = "seed-2-0-pro-260328"
    # 留空是有意的：现有代码的优先级是 VISION_MODEL > MODEL > 默认值。
    # 若这里直接给默认值，「只设了 BYTEPLUS_MODEL」的场景行为就变了。
    # 取值请走 byteplus_vision_model_name 属性。
    byteplus_vision_model: str = ""
    read_bill_default_model: str = "auto"  # auto | byteplus | local

    # ─────────── 外部服务：邮件 ───────────
    # 字段名小写 + case_sensitive=False，所以 Resend_API_KEY 和 RESEND_API_KEY 都认，
    # 不需要额外的别名表。
    resend_api_key: str = ""
    resend_base_url: str = "https://api.resend.com"
    email_domain: str = "utba.my"
    # 只有仓库根目录的一次性 SMTP 测试脚本 send_mail.py 在用，app/ 不引用。
    gmail_app_password: str = ""

    # ─────────── 外部服务：Cloudflare ───────────
    # ★ 这里是两套独立凭据，实测 token 和 zone id 的值都不一样，**不要合并**：
    #   - edit_zone_dns_* : zone 级，给 DDNS 改 A 记录（原 _token.API_TOKEN / ZONE_ID）
    #   - email_routing_* : account 级，给邮箱路由（原 .flaskenv 的 *_Cloudflare）
    #   后者对 zone 级规则会返回 403，串用就是「邮箱能建、转发规则建不了」。
    cloudflare_base_url: str = "https://api.cloudflare.com/client/v4"
    cloudflare_edit_zone_dns_token: str = ""
    cloudflare_zone_id: str = ""
    cloudflare_dns_record_name: str = ""
    # 这三个键改的是词序（Xxx_Cloudflare → CLOUDFLARE_XXX），case_sensitive=False
    # 救不了，必须显式列旧名。等 system_config.env 都换成新名后可以删掉别名。
    cloudflare_email_routing_token: str = Field(
        "",
        validation_alias=AliasChoices(
            "CLOUDFLARE_EMAIL_ROUTING_TOKEN", "Email_Routing_Address_API_KEY_Cloudflare"
        ),
    )
    cloudflare_email_routing_zone_id: str = Field(
        "",
        validation_alias=AliasChoices("CLOUDFLARE_EMAIL_ROUTING_ZONE_ID", "Zone_ID_Cloudflare"),
    )
    cloudflare_account_id: str = Field(
        "",
        validation_alias=AliasChoices("CLOUDFLARE_ACCOUNT_ID", "Account_ID_Cloudflare"),
    )

    # ─────────── 外部服务：Twilio ───────────
    # 留空默认而不是必填：app/twilio/services.py 在模块顶层就 Client(...)，
    # 设成必填会让 CI 里 `import app` 直接起不来。缺值的后果是发短信失败，不是启动失败。
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_verify_service_sid: str = ""
    # 内部万能验证码（本会人员应急用）。原本硬编码在代码里，挪进配置后应当按密钥管理。
    shortcut_otp: str = "1031"

    # ─────────── 外部服务：Google ───────────
    google_geocoding_api_key: str = ""
    # 名字骗人：它带 VITE_ 前缀，但实际是**后端**读了再经 API 下发给前端的，
    # 不是 Vite 构建变量。所以 gen_frontend_env.sh 不导出它。
    google_maps_embed_api_key: str = Field(
        "",
        validation_alias=AliasChoices(
            "GOOGLE_MAPS_EMBED_API_KEY", "VITE_GOOGLE_MAPS_EMBED_API_KEY"
        ),
    )
    google_maps_base_url: str = "https://maps.googleapis.com"

    # ─────────── 硬件 ───────────
    receipt_printer_ip: str = "192.168.68.43"
    receipt_printer_port: int = 9100
    cam_ip: str = ""
    cam_port: int = 80  # ONVIF 端口。原名 PORT，会被环境变量撞，必须用新名。
    cam_user: str = ""  # 原名 USER，systemd 的 User= 会注入同名环境变量。
    cam_password: str = ""  # 原名 PWD，shell 会注入同名环境变量。

    # ─────────── 开发 ───────────
    # ⚠️ 与 frontend/vite.config 的 4 个 dev proxy target 硬绑定，改这里要同步改那边。
    # 生产的监听端口不在这里 —— 它写死在 systemd unit 的 gunicorn -b 里，
    # 在配置文件里加 APP_PORT 只会得到一个「写了不生效」的假配置。
    dev_port: int = 5102

    # ─────────── 校验 ───────────

    @field_validator(*_REQUIRED_NON_BLANK)
    @classmethod
    def _reject_blank(cls, value, info):
        # min_length=1 拦不住全空格。这里只校验不改值 ——
        # 密码理论上可以含首尾空格，strip 掉会变成连不上库却查不出原因。
        if not str(value).strip():
            raise ValueError(f"{info.field_name} 不能为空：请在 system_config.env 里填写真实值")
        return value

    @field_validator("app_base_path")
    @classmethod
    def _normalize_base_path(cls, value):
        """统一成 "" 或 "/UTBA_DEMO" 这种形式：有前导斜杠、无尾随斜杠。

        不归一化的话，"/UTBA_DEMO/" 拼出来就是 "/UTBA_DEMO//api/..."，
        而 Cookie 的 path 也会多一层，表现为「登录后一刷新就掉线」。
        """
        text = str(value or "").strip().rstrip("/")
        if not text or text == "/":
            return ""
        return text if text.startswith("/") else "/" + text

    @field_validator("data_root")
    @classmethod
    def _fallback_data_root(cls, value):
        return str(value).strip() or _DEFAULT_DATA_ROOT

    @field_validator("read_bill_default_model")
    @classmethod
    def _normalize_read_bill_model(cls, value):
        # 原代码是 os.environ.get(...).strip().lower()，配置里写 Auto / AUTO 一样认。
        # 不归一化的话，READ_BILL_DEFAULT_MODEL=Auto 会静默走到 else 分支，
        # 表现是「读单没走 AI」，但没有任何报错。
        return str(value).strip().lower()

    @field_validator("app_env")
    @classmethod
    def _check_app_env(cls, value):
        text = str(value).strip().lower()
        if text not in {"production", "staging", "development"}:
            raise ValueError("APP_ENV 只能是 production / staging / development")
        return text

    # ─────────── 派生值 ───────────

    @property
    def sqlalchemy_uri(self) -> str:
        """psycopg3 的连接串。

        密码必须 URL 编码：@ : / ? # 出现在密码里会把连接串切错位置，
        报出来的却是「host 不存在」这种完全不相干的错。
        用 quote 而不是 quote_plus —— SQLAlchemy 解析时不会把 + 还原成空格。
        """
        user = quote(self.db_user, safe="")
        password = quote(self.db_password, safe="")
        return (
            f"postgresql+psycopg://{user}:{password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def sqlalchemy_engine_options(self) -> dict:
        """create_engine 的池子参数，集中一份，免得各处手抄。"""
        return {
            "pool_size": self.db_pool_size,
            "max_overflow": self.db_max_overflow,
            "pool_recycle": self.db_pool_recycle,
            "pool_pre_ping": self.db_pool_pre_ping,
            "echo": self.db_echo,
        }

    @property
    def data_root_path(self) -> Path:
        return Path(self.data_root)

    @property
    def byteplus_key(self) -> str:
        """还原现有代码的 BYTEPLUS_API_KEY or ARK_API_KEY 取值顺序。"""
        return (self.byteplus_api_key or self.ark_api_key).strip()

    @property
    def byteplus_vision_model_name(self) -> str:
        """还原 VISION_MODEL > MODEL > 默认值的优先级。"""
        return (self.byteplus_vision_model or self.byteplus_model).strip()

    @property
    def session_cookie_path(self) -> str:
        """Cookie 的 path 必须等于 base path，否则同域名下多个项目会互相踢下线。"""
        return self.app_base_path or "/"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


class ConfigError(RuntimeError):
    """配置缺失或非法。单独一个异常类型，方便入口处 catch 后打一条干净的日志。"""


@lru_cache
def get_settings() -> Settings:
    """全局单例。测试里用 get_settings.cache_clear() + 环境变量替换，不用碰文件。"""
    try:
        return Settings()
    except ValidationError as exc:
        # ★ 绝不能把 ValidationError 原样抛出去：pydantic 的报错带 input_value，
        # 缺一个必填键时它会把**整份配置字典**（含 DB_PASSWORD、SECRET_KEY）
        # 截断后打进 traceback，而 traceback 会进 journalctl / 监控告警。
        # 这里只留「哪个键、什么毛病」，值一个都不出现；
        # `from None` 是为了连带掐掉原始异常链（原链里同样有值）。
        problems = "\n".join(
            "  - {}: {}".format(".".join(str(x) for x in e["loc"]) or "<根>", e["msg"])
            for e in exc.errors()
        )
        raise ConfigError(
            "配置校验失败，进程拒绝启动。\n"
            f"{problems}\n"
            "请检查（后者覆盖前者）：\n"
            f"  1. {SHARED_ENV_FILE}\n"
            f"  2. {PROJECT_ENV_FILE}\n"
            "  3. 进程环境变量\n"
            "模板见 system_config.example.env。注意 `KEY=` 等于没填。"
        ) from None


# 模块级单例：import 这个模块就等于做一次配置体检。
# 缺 SECRET_KEY / DB_* 时这一行直接抛 ConfigError，进程起不来 —— 这是故意的
# （10 文档 §8 的验收项）。代价是 alembic、pytest collect、python -c "import app"
# 也会被同样拦住，所以 CI 里要准备一份最小可用的 system_config.env。
settings = get_settings()
