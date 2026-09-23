"""``flask.render_template`` 的无 Flask 复刻 —— 只给本模块的 5 张模板页用。

**搬迁时新增的文件，Flask 那边没有对应物。** 存在的理由：form 模块有 5 条路由返回的
是服务端渲染的 HTML（公开报名页 / 付款页 / 家长签名页 / 成员终端 / 积分面板），
而 core/ 里没有模板设施（迁移至今只有 web 模块在发 SPA 外壳，那是一个静态文件）。

Jinja2 本来就在依赖里（Flask 自己也只是包了它一层），所以这里直接用 Jinja2 建环境，
**不 import flask** —— 一行 ``from flask import render_template`` 会把整个 Flask 栈
拉回进程，而本轮迁移的硬约束是「进程内 Flask 系模块 = 0」。

── 照着 Flask 复刻的三件事（漏一件都会让渲染结果和生产不一样）──────────

  ① **autoescape 的判定规则**，照抄 ``Flask.select_jinja_autoescape``：
     模板名为 None 时 True，否则只有 ``.html/.htm/.xml/.xhtml/.svg`` 才转义。
     不照抄（比如统一 ``autoescape=True``）的话，今天没影响；但哪天有人加一张
     ``.txt`` 模板，输出会莫名多出一堆 ``&amp;``。

  ② **``|tojson`` 用的 dumps 函数**，照抄 ``rv.policies["json.dumps_function"] = app.json.dumps``。
     Flask 的 ``DefaultJSONProvider.dumps`` 有三个非默认值：
       · ``default=_default`` —— date/datetime 转 HTTP 日期串、Decimal/UUID 转字符串。
         **这条是必须的**：``templates/form/index.html`` 里写着
         ``window.form_data = {{ form | tojson }}``，而 ``to_dict_event()`` 出来的
         字典里就有 ``created_at``（date）和报名费（Decimal）。少了它是 TypeError → 500。
       · ``ensure_ascii=True`` —— 中文会被转成 ``\\uXXXX``。看着丑，但改了就是行为变更。
       · ``sort_keys=True`` —— 键按字典序输出。同样照抄。
     ``default`` 直接复用 ``core.responses._json_default``：它就是为了这件事从 Flask
     抄过来的（同一份规则、已对拍过），在这里再抄第三份只会埋一个「哪天两边漂移」的雷。
     名字带下划线是因为它不打算给业务代码用；本文件是框架适配层，属于例外。
     ⚠️ Jinja 的 ``do_tojson`` 会把 ``policies["json.dumps_kwargs"]``（默认
     ``{"sort_keys": True}``）**显式**传进来，所以下面的 setdefault 对 sort_keys 不生效
     —— 结果一样，但别据此以为 setdefault 那行是多余的（换个调用路径就要它了）。

  ③ **``|tojson`` 之后的 HTML 转义**由 Jinja 的 ``htmlsafe_json_dumps`` 负责
     （把 ``<`` ``>`` ``&`` ``'`` 转成 Unicode 转义），Flask 也是走这条，不用管。

── 故意**没有**复刻的 ────────────────────────────────────────────────
Flask 还往 globals 里塞了 ``url_for`` / ``config`` / ``request`` / ``session`` / ``g`` /
``get_flashed_messages``。本模块这 5 张模板一个都没用到（已 grep 确认），
所以不提供 —— 提供一个半残的 ``request`` 代理反而更危险。
真有模板用到，会在渲染时报 ``UndefinedError``（Jinja 默认的 ``Undefined`` 在
属性访问时才抛），不是静默出错。

── auto_reload 为什么写死 False ──────────────────────────────────────
Flask 取 ``TEMPLATES_AUTO_RELOAD`` 或 ``app.debug``。我们的模板是随代码一起发版的，
开了只是每次渲染多一次 stat；真要改模板得重启进程（与 core/config 的
「改配置必须重启」同一约定）。
"""

import json

from jinja2 import Environment, FileSystemLoader
from starlette.responses import HTMLResponse

from backend.core.paths import TEMPLATE_ROOT

# 见模块头 ②：这是 Flask ``DefaultJSONProvider.default`` 的等价实现，
# core.responses 为了让 jsonify 的输出和 Flask 逐字节一致已经抄了一份。
from backend.core.responses import _json_default


def _select_autoescape(template_name):
    """逐字照抄 ``flask.sansio.app.App.select_jinja_autoescape``（见模块头 ①）。"""
    if template_name is None:
        return True
    return template_name.endswith((".html", ".htm", ".xml", ".xhtml", ".svg"))


def _json_dumps(obj, **kwargs):
    """等价 ``flask.json.provider.DefaultJSONProvider.dumps``（见模块头 ②）。"""
    kwargs.setdefault("default", _json_default)
    kwargs.setdefault("ensure_ascii", True)
    kwargs.setdefault("sort_keys", True)
    return json.dumps(obj, **kwargs)


# 只挂仓库根的 templates/ —— Flask 那边是 DispatchingJinjaLoader（应用目录 + 各蓝图的
# template_folder），而 ``form_bp = Blueprint("form", __name__)`` 没给 template_folder，
# 所以实际搜索路径本来就只有这一个。
_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_ROOT)),
    autoescape=_select_autoescape,
    auto_reload=False,
)
_env.policies["json.dumps_function"] = _json_dumps


def render_template(template_name, **context):
    """等价 ``flask.render_template``，但直接返回响应对象。

    Flask 返回的是 ``str``，再由视图层包成 ``text/html; charset=utf-8`` 的响应；
    FastAPI 这边如果返回裸字符串会被当成 JSON 序列化（页面变成一串带引号的 HTML
    源码）。所以这里直接给 HTMLResponse —— 它的 media_type 正是
    ``text/html; charset=utf-8``，与 Flask 一致。

    模板不存在时抛 ``jinja2.TemplateNotFound`` → 500，与 Flask 同。
    """
    return HTMLResponse(_env.get_template(template_name).render(**context))
