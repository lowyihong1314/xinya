# api/event — 活动（Event）

> v3：已从 Flask 蓝图搬到 FastAPI（原 `backend/app/event/`）。
> `routes.py` → `router.py`，`services.py` → `service.py`，`agent.py` / `agent_worker.py` /
> `budget_pdf.py` 原样平移。URL 少了 `/api` 这一段：`/api/event_data/...` → `/event_data/...`，
> **`/event_data` 这个外部前缀保持不变**（前端和分享链接都咬死了它）。

活动本体、进行单位、流程表、待办、财政预算、附件/简章、签到，外加一个活动 AI Agent。

## 文件
- `router.py` — 37 条路由（40 个「路径 × 方法」对），全部挂在 `/event_data`。
- `service.py` — 查询与写入逻辑（原 `services.py`）。
- `agent.py` / `agent_worker.py` — 活动 AI Agent。路由只负责起任务并立刻返回
  `{job_id, room}`；真正调模型的是 `python -m backend.api.event.agent_worker` 子进程，
  算完经 `core.realtime.publish_sync("event", "event_agent_{id}", "event_agent_reply", …)`
  推回前端。
- `budget_pdf.py` — 财政报告 PDF（reportlab）。
- `ark.py` — BytePlus/Ark 聊天补全客户端（`app/form/ai_grouping.py` 的副本，见该文件头）。
- `storage.py` / `uploads.py` — 两个小垫片，解释见各自的模块 docstring。

## 命名空间提醒
`api/public_api` 那边有 `GET /event_data/{event_id:int}`，和本模块的
`/event_data/get_all_event` 这类具名路径同处一个前缀。靠 Starlette 的 `:int` 转换器
在匹配阶段分家（谁先注册都不会互相抢，已实测）。**别把任何一边的 `:int` 去掉。**

## 权限
写操作基本都是 `login_required` + `permission_required("event_edit")`，三处例外是故意的：
- `check_in/qr/create|scan` 只要登录（签到码给会员互扫）；
- `event_flow/*` 的写操作只要登录，真正授权在 `service._can_edit_event_flow`
  （`event_edit` **或** 该活动的组织者）；
- `event_budget/report/<id>` 只要登录，而同数据的 `event_budget/list/<id>` 完全公开。

## 已知欠账
`event_budget/list` 与 `event_budget/report` 会惰性 import `backend.app.form.services`，
那个文件还带 Flask —— 调用这两条路由会把 flask/werkzeug 拉进进程。
form 模块搬完后，连同 `_manual_income_rows` 的 account 依赖一起翻。详见 `service.py` 模块头。
