# api/lamp — 点灯法会登记

> v3：已从 Flask 蓝图搬到 FastAPI（原 `backend/app/fahui/lamp/`）。
> `routes.py` → `router.py`，`services.py` → `service.py`，`serializers.py` 原样平移，
> 另新增两个搬迁件：`fahui_common.py`（延迟 import 桥）和 `uploads.py`（FileStorage 替身）。
> URL 少了 `/api` 这一段：`/api/lampRegistration_API/...` → `/lampRegistration_API/...`。

原来是 `fahui` 包下面的一个子目录，这次单独成包 —— 它自成一体（登记 + 供灯明细），
和 YLP 那堆（牌位、打印、PDF）没有任何耦合，唯一的共用面是「付款」。

★ **前缀 `/lampRegistration_API` 是驼峰 + 下划线混写，照抄不要规范化。**
  前端和可能存在的外部调用方按这个字符串拼 URL。

## 文件
- `router.py` — 30 条路由（新老两套路径并存，与 Flask 侧一一对应）。
- `service.py` — 登记的增删改查 + 付款提交；付款审核转手给 fahui 的共用件。
- `serializers.py` — 一行转发，实现在 `fahui/common/payment_review.py`（与审核页共用）。
- `fahui_common.py` — 到 `backend/api/fahui/common/*` 的**延迟 import 桥**，
  跨包路径只出现在这一个文件里。
- `uploads.py` — starlette `UploadFile` → werkzeug `FileStorage` 的最小替身
  （`.filename` / 真值判断 / `.save()`）。

## 路由（`/lampRegistration_API`）
| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/ping`、`/health` | 公开 |
| POST | `/registrations`、`/register` | **公开**（开放时间窗口只挡未登录） |
| GET | `/registrations`、`/get_all_register` | `fahui_read` / `account_read` / `account_edit` |
| POST | `/registrations/query`、`/registrations/by-ids`、`/get_by_ids` | **公开**，无管理权限时只返回已验证手机号名下的记录 |
| PATCH | `/registrations/{id}` ／ POST `/registrations/update`、`/edit` | `account_edit` |
| DELETE | `/registrations/{id}` ／ POST `/registrations/delete`、`/delete` | `account_edit` |
| GET | `/payments/review`、`/payments`、`/get_all_register_by_payment` | `account_read` / `account_edit` |
| POST | `/payments`、`/make_payment`（multipart） | **公开**（访客交款上传凭证） |
| DELETE | `/payments/{id}` ／ POST `/payments/delete`、`/remove_payment` | `account_edit` |
| GET | `/payments/{id}/file`、`/payment_file/{id}` | `account_read` / `account_edit` |
| POST | `/payments/{id}/approve`、`/payments/approve`、`/approve_payment` | `account_edit` |
| POST | `/payments/{id}/revoke`、`/payments/revoke` | `account_edit` |

「带 id 的路径」单独写了一个函数（不是和别名共用一个），理由见 `router.py` 模块头：
照搬 Flask 的 `registration_id=None` 默认值会让 id 变成那两条别名路径上的**查询参数**。

## 与 fahui 的共用面
付款的序列化 / 审核 / 删除 / 凭证下载 / 落盘全在 `fahui/common/` 里，点灯只是带着
`payment_type="lamp"` 去调（`type` 字段区分 lamp 与 ylp）。这些调用**全部经过
`fahui_common.py` 的延迟 import 桥**：

- import 期不碰 fahui，本模块的 import 自检才能保持「进程内 flask 系模块 = 0」；
- fahui 的包 `__init__` 将来若按惯例 `from .router import router`，也不会因为
  四个函数把整棵 YLP 路由树拉起来。

⚠️ 代价：**桥里的路径写错不会在启动时暴露，而是第一次调用该路由时 500。**
fahui 完全搬完后，请按 `fahui_common.py` 顶部的签名对照表打一遍这九个出口
（本次交付已逐个核对过：九个目标全部存在且签名一致）。

## 已知差异（相对 Flask，全部记在 router.py 模块头）
- `/ping`、`/health` 的 Content-Type 从 `text/html` 变成 `text/plain`，正文仍是 `pong`。
- 请求体不是合法 JSON 时：Flask 的 `get_json(silent=True)` 当空字典继续走（落到
  「缺少 id」这类 400），这里是 FastAPI 的 422。没有调用方在这么发。
- multipart 同名字段重复出现时，werkzeug 取第一个、starlette 取最后一个。

## 故意保留的「像 bug」
见 `service.py` 模块头那份清单（新建登记写死 `status="draft"`、随缘供斋金额不
quantize、`int(payment_id)` 不带 try 会 500、500 响应体里带 `str(exc)` 等）。
