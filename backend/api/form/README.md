# Form

报名表模块：建表、报名流程、报名费、额外字段、分组与积分、点名、成员终端、
青少年佛学班报名与付款。外部前缀保持 `/form`（原 `/api/form`，`/api` 段已随
BASE_PATH 改造整体取消）。

原 `backend/app/form/`（4815 行，整个项目里最大的单体模块）。

## 文件

| 文件 | 内容 | 原文件 |
|---|---|---|
| `router.py` | 76 条路由。装饰器 / 参数提取 / 响应构造，无业务逻辑 | `routes.py` |
| `service.py` | 报名表 CRUD、报名、付款、额外字段、分组、点名、成员终端、青少年班 | `services.py` |
| `permissions.py` | 九组「任一即可」权限名；判定函数转出自 `core.auth` | `permissions.py` |
| `score_panel.py` | 小组积分面板（Redis token + 积分日志 + 广播） | `score_panel.py` |
| `ai_grouping.py` + `ai_group_worker.py` | AI 分组对话助手（子进程调 Ark） | 同名 |
| `form_agent.py` + `form_agent_worker.py` | 报名表 AI Agent（子进程调 Ark） | 同名 |
| `realtime.py` | 出向推送：`publish_sync("form", room, …)` | `realtime.py` |
| `pdf.py` | HTML → PDF 合并下载（weasyprint + pypdf） | `pdf.py` |
| `templating.py` | **新增**：`flask.render_template` 的无 Flask 复刻 | — |
| `uploads.py` | **新增**：`request.form` / `request.files` 的垫片 | — |

每个文件顶部的模块 docstring 里写着「这一处为什么这么改」和「哪些看着像 bug 但
故意保留」，改之前先读那里。

## 权限模型

- 公开：报名页、付款提交、家长签名、成员终端、积分面板（token 鉴权）、
  `html_to_pdf`、青少年班报名与 NRIC 预检。
- `form_read`：报名表工作台、表单详情、收费项列表、额外字段列表（只读）。
- `form_edit`：建表/改表/删表、收费项、额外字段、关联活动、成员记录、分组落地。
- `member_detail`：成员完整资料（含家长同意书与付款记录）、点名、分组积分日志、
  AI 分组问答。
- `/payment/*` 的**写**操作绑财政的 `account_edit`；付款截图的**读**同时放行
  财政与 `member_detail`。
- `youth_class_read` / `youth_class_edit`：青少年班工作台的读 / 写；
  `council_approve` 只读（理事只能看、不能改财政状态）。

## 实时

出向事件已从 Socket.IO 换成 SSE（`core.realtime`，app 名 `form`）。
房间名一个字没改：`wait_register_{form_id}`、`youth_class_registration`、
`form_score_{form_id}`、`ai_group_{form_id}`、`form_agent_{form_id}`
（后两个同时出现在 `/group/ai_chat`、`/agent/chat` 的响应体里让前端订阅）。

**入向没有东西要转**：form 一个 Socket.IO handler 都没注册，
`docs/flask_to_fastAPI/16-入向事件转POST.md` 那套规则这里用不上。

⚠️ 本模块**还没有** `core.realtime.register(RealtimeApp(...))` ——
前端切到 SSE 时要补上 authorize / snapshot 回调，在那之前这些推送没有订阅者
（与 quiz / changyou_room / event 当前处境一致，业务本身不受影响）。

## 搬完之后可以收掉的两处（留给接线的人）

1. `backend/api/user_control/form_services.py` 里 11 个函数体内的
   `from backend.app.form.services import X` 可以改成
   `from backend.api.form.service import X`。函数名**一个都没变**，改完那个文件
   就只剩一层转发、可以整个删掉。（本轮没动它，避免和接线撞车。）
2. `backend/api/event/service.py:1177` 附近同样有一处延迟 import 指向
   `backend.app.form.services`。
3. `backend/api/event/ark.py` 当初是因为 `ai_grouping.py` 顶上有
   `from flask import jsonify` 才被迫抄了一份 Ark 客户端。那行现在没了，
   两份可以合并进 `core/`。
