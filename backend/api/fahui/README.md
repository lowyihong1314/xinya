# api/fahui — 盂兰盆法会（YLP）订单 / 付款 / 看板 / 牌位打印

> v3：已从 Flask 蓝图搬到 FastAPI（原 `backend/app/fahui/`）。
> **六个蓝图**一起搬进这一个包，目录名 `YLP/` 改成小写 `ylp/`，其余文件名一个没动。
> URL 只少了 `/api` 这一段（`/api/board_router/...` → `/board_router/...`）。
> Socket.IO 的四处 emit 换成了 `core.realtime.publish_sync("fahui_board", ...)`。
> `lamp/` 那个蓝图**不在本次范围内**，仍在 `backend/app/fahui/lamp/`。

## 六个 router 与 include 顺序

| 导出名 | 原蓝图 | 前缀 | 条数 |
|---|---|---|---|
| `common_payment_router` | `common/payment_routes.py` `fahui_payment_bp` | `/payment` | 14 |
| `ylp_payment_router` | `ylp/payment_routes.py` `payment_bp` | `/payment` | 13 |
| `board_router` | `ylp/board_routes.py` `board_router_bp` | `/board_router` | 61 |
| `print_paiwei_router` | `ylp/print_routes.py` `print_paiwei_bp` | `/print_paiwei` | 30 |
| `diy_paiwei_router` | `ylp/diy_paiwei.py` `diy_paiwei_bp` | `/diy_paiwei` | 17 |
| `fahui_router` | `ylp/routes.py` `fahui_bp` | `/fahui_router` | 28 |

**前两个挂在同一个前缀 `/payment` 下**，Flask 时代靠注册顺序共存（`blueprints.py`
里 common 在 YLP 之前）。include 时必须保持同样的顺序 —— 按 `__init__.py` 的
`__all__` 逐条 include 即可，理由写在那个文件的模块头里。

> 条数与 `app/fahui/route_contracts.py` 的「Flask 规则数」差 2：`diy_paiwei` 的
> `PUT|POST /<id>` 和 `fahui_router` 的 `PUT|POST /versions/<v>/event` 在 Flask 里
> 各是**一条规则两个方法**，在 FastAPI 里是两个路由对象。路径集合完全一致。

## 文件

搬过来的（与旧文件一一对应，业务逻辑逐字保留）：

- `common/` — lamp 与 YLP 共用：`access.py`（谁能读法会数据）、`payment.py`、
  `payment_review.py`（统一的付款审核）、`payment_routes.py`、`phone.py`、
  `open_window.py`（报名开放时段）、`session_state.py`、`ylp_storage.py`
- `ylp/` — 订单（`routes.py` / `services.py` / `shared.py` / `order_log.py` /
  `share_link.py`）、付款（`payment_routes.py` / `payment_services.py` /
  `payment_channel_services.py` / `receipt.py`）、看板（`board_routes.py` /
  `board_services.py` / `board_terminal.py` / `relation_option_services.py`）、
  打印（`print_routes.py` / `print_generator.py` / `print_points.py` /
  `paiwei_job.py` / `diy_paiwei.py`）、原始单据（`raw_docs.py` / `paiwei_ocr.py`）、
  导出（`export_pdf.py`）

**搬迁时新增**的三个（Flask 那边没有对应物，各自的模块头写了为什么）：

- `uploads.py` — werkzeug `request.form` / `request.files` / `FileStorage` 的垫片
- `downloads.py` — `flask.send_file` 的逐字节复刻（Content-Disposition / Cache-Control / ETag）
- `realtime.py` — 出向推送的 app 名与房间名常量

另外 `common/session_state.py` 被扩写成「会话读 + 写回 Cookie」两件事 ——
FastAPI 没有 Flask 那种「改了 session 框架自动回写」的机制，而本包有两处要写
（分享链接、看板终端）。

## 鉴权的四种形状（都是原样，不要对齐）

1. `@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)` — `fahui_read` /
   `account_read` / `account_edit` 任一，读操作。
2. `@permission_required_any("account_edit")` — 看板与订单的写操作。
3. `@login_required` — 牌位坐标配置、模板上传、导出任务：**只要登录，不看法会权限**。
4. **函数体里判**，或者压根公开 —— 公开登记页与分享链接这条线：访客没有账号，
   只有 OTP 验证过的手机号（`session["verified_phones"]`）。这些出口的 403 文案
   含「手机验证」四个字，前端靠它识别并重新弹验证框，所以**不能**换成装饰器
   （装饰器的拒绝出口是 core.auth 写死的那串）。

## 出向推送（Socket.IO → SSE）

四处，全部走 `core.realtime.publish_sync`，app 名 `fahui_board`：

| 事件 | 房间 | 触发点 |
|---|---|---|
| `fahui:order_created` | `broadcast` | `ylp/services.py` 建单 |
| `fahui:order_updated` | `fahui:order:<id>` | `ylp/board_services.py` 改单 |
| `fahui:board_changed` | `broadcast` | `ylp/board_services.py` 贴板 |
| `fahui:board_highlight` | `fahui:board-terminal:<uid>` | `ylp/board_routes.py` 点亮 |
| `paiwei:progress\|done\|error` | `paiwei_job:<job_id>` | `ylp/paiwei_job.py` 导出线程 |

本包**没有** `core.realtime.register(RealtimeApp(...))`，所以在前端从 Socket.IO
切到 SSE 之前这些消息没有订阅者（和 media / changyou_room 现在一样）。切过来时
`authorize` 回调要能认 board_terminal 的 30 天 token —— `core/realtime.py` 的
`RealtimeApp` 文档里已经把这件事记下了。

## 自检

```bash
./venv/bin/python -c "import sys;sys.path.insert(0,'.');import backend.api.fahui;\
print([m for m in sys.modules if m.split('.')[0] in ('flask','werkzeug','flask_login')])"
# 必须打印 []
```
