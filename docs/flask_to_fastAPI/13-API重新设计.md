# 13 · API 现状评估与重新设计

> 结论先行：**有重复，但不是"同一段逻辑抄了很多遍"，而是"同一件事有很多种叫法"。**
> 真正的问题是**命名与形状不统一**，导致前端要写 21 个 `parseJson`、
> LLM 要理解 505 个风格各异的接口。

## 1. 实测数据

| 指标 | 数值 | 判读 |
|---|---:|---|
| URL 规则 | 574 | |
| **实际处理函数** | **505** | 69 条是同函数挂多 URL 的**兼容别名** |
| 路径中带动词 | 215 条（37%） | REST 反模式 |
| 纯 POST 路由 | 252 条（43%） | |
| └ **语义错配的 POST** | **60 条** | 30 个其实是更新、18 个是删除、12 个是读取 |
| GET 路由中做了分页 | 13 / 244（**5%**） | 绝大多数列表接口一次吐全量 |
| 响应信封形状 | **3 种** | `{"status":…}` 705 · `{"error":…}` 112 · `{"success":…}` 79 |
| 前端各自写的 `parseJson` | **21 个** | 信封不统一的直接代价 |

```bash
# 复算
PYTHONPATH=. python -c "from app.factory import create_app; app=create_app(); \
print(len({r.endpoint for r in app.url_map.iter_rules()}))"
```

## 2. 重复的四种类型（按严重度）

### 类型 A ★ 同一件事有多个 URL（兼容别名）—— 69 条

一个函数挂 2–3 个路由装饰器，老路径不敢删。典型：

```python
@lamp_bp.route("/payments/<int:payment_id>/approve", methods=["POST"])   # 新
@lamp_bp.route("/payments/approve", methods=["POST"])                    # 过渡
@lamp_bp.route("/approve_payment", methods=["POST"])                     # 老
def approve_payment_route(payment_id=None): ...
```

`lampRegistration_API` 一个模块里，**批准 / 撤销 / 删除 / 取文件各有 2–3 条 URL**。
最极端的一例是把拼写错误也永久保留了：

```
/api/payment/download_quotation/<id>
/api/payment/download_quotiton/<id>     ← typo 版本，删不掉
/api/payment/orders/<id>/quotation
```

> **这一类是纯负债，一条业务价值都没有。** 本次迁移不保留旧链接，
> 正是删掉它们的唯一窗口 —— **69 条 URL 可以直接消失。**

### 类型 B ★ 同一概念的命名各说各话

| 动作 | 现有叫法 | 出现次数 |
|---|---|---|
| 读取 | `get_` / `list` / `all` / `detail` / `info` / `search` / `query` / `read` | 38/13/13/9/8/5/2/1 |
| 新增 | `add` / `create` / `new` / `submit` / `upload` / `save` / `insert` | 9/7/6/4/9/2/1 |
| 修改 | `update` / `edit` / `set` / `change` / `save` | 11/10/3/3/2 |
| 删除 | `delete` / `remove` / `clear` | 23/8/4 |

同一个模块里同时存在 `/get_versions` 和 `/versions`、
`/edit_member` 和 `/member`、`/get_about_us_text` 和 `/about_us_text`
—— 是**一次没做完的 REST 化改造**留下的两套并存。

### 类型 C 横切能力各写一遍

| 能力 | 条数 | 分布 |
|---|---:|---|
| 文件下载 / 打印 | 53 | 9 个模块（`print_paiwei` 一家 30 条） |
| 文件上传 | 10 个独立端点 | 各自处理校验、落盘、缩略图 |
| 审批 / 签名 | 19 | 6 个模块 |
| 二维码 / 分享链接 | 28 | 9 个模块 |
| 排序 / 重排 | 11 | 5 个模块 |

这些**本该是一套通用机制**（一个文件服务、一个审批流、一个分享链接服务），
现在是每个模块自己实现一遍。

### 类型 D 付款：74 条，但**不是**同一个概念

先澄清一个容易误判的点：付款相关 74 条散在 8 个模块，看着像重复，
但底层是**三个不同的领域对象**：

| 模型 | 表 | 业务 |
|---|---|---|
| `RegisPayment` | `regis_payment` | 报名缴费 |
| `FahuiPayment` | `payment_data` | 法会订单付款 |
| `ReimbursementRequest` | `reimbursement_request` | 报销付款（方向相反：往外付） |

> **它们不该合并。** 真正该统一的是**它们的接口形状**（列表怎么筛、
> 审批怎么调、凭证怎么取），而不是把三张表塞成一张。

## 3. 重新设计

### 3.1 统一资源路径

```
{BASE}/api/v1/{resource}                    GET 列表 · POST 创建
{BASE}/api/v1/{resource}/{id}               GET 详情 · PATCH 局部更新 · DELETE 删除
{BASE}/api/v1/{resource}/{id}/{sub}         子资源
{BASE}/api/v1/{resource}/{id}:{action}      动词动作（冒号，明确区分于子资源）
{BASE}/api/{app}/realtime                   SSE（见 12 文档）
```

**动作为什么用冒号**：`approve` / `revoke` / `reveal` 这类状态跃迁不是 CRUD，
硬塞成 `PATCH {status:"approved"}` 会丢失语义（审批要记录人、时间、意见）。
用 `POST /payments/42:approve` 既保留语义又不与子资源路径混淆
（Google API 设计指南的做法）。

对照改造：

| 现在 | 改成 |
|---|---|
| `POST /api/lampRegistration_API/approve_payment` + 另外 2 条别名 | `POST /api/v1/lamp-payments/{id}:approve` |
| `GET /api/lampRegistration_API/get_all_register_by_payment` | `GET /api/v1/lamp-payments?status=pending` |
| `POST /api/form/payment/update_status/{id}` | `PATCH /api/v1/registration-payments/{id}` |
| `GET /api/info/get_about_us_text` | `GET /api/v1/content/about-us` |
| `POST /api/event_data/upload_brochure/{id}` | `POST /api/v1/events/{id}/attachments` |

### 3.2 统一响应信封

三种形状收敛成一种：

```jsonc
// 成功（单体）
{ "data": { … } }

// 成功（列表，一律分页）
{ "data": [ … ], "page": { "cursor": "…", "next_cursor": "…", "has_more": true, "total": 123 } }

// 失败（HTTP 状态码已表达类别，body 给可读细节）
{ "error": { "code": "permission_denied", "message": "没有权限：account_edit", "detail": { … } } }
```

- `code` 是**稳定的机器可读串**，前端和 MCP 都按它分支，不解析中文 message
- 前端 21 个 `parseJson` 收敛成 **1 个**

### 3.3 列表接口统一约定

5% 的分页率是个隐患（也是 MCP 的死穴，见 [14](14-MCP接入设计.md)）。统一为：

```
GET /api/v1/{resource}?q=&status=&from=&to=&sort=-created_at&limit=50&cursor=…
```

- `limit` 默认 50、上限 200
- 游标分页（不是 offset）—— 数据在变时不会漏/重
- **所有列表接口一律分页**，不再有"一次吐一万行"

### 3.4 横切能力抽成公共服务

| 公共服务 | 取代 |
|---|---|
| `POST /api/v1/files` + `GET /api/v1/files/{id}` | 10 个上传端点 + 53 个下载端点 |
| `POST /api/v1/{resource}/{id}:approve` 统一审批语义 | 19 条审批接口 |
| `POST /api/v1/share-links` 统一分享/二维码 | 28 条散落实现 |

文件服务是收益最大的一块：统一校验、统一权限、统一缩略图、统一 Range 支持。

## 4. 工作量与取舍

**这不是免费的。** 505 个处理函数换路径 = 前端 400 处 `apiFetch` 要跟着改。

| 方案 | 说明 | 成本 | 建议 |
|---|---|---|---|
| **R0 只删别名** | 删掉 69 条兼容 URL，其余不动 | 1–2 天 | ✅ **必做** |
| **R1 信封统一** | 三种响应形状收敛成一种 + 前端 1 个 parseJson | 1 周 | ✅ **必做**，MCP 的前提 |
| **R2 列表统一分页** | 244 个 GET 逐个加游标分页 | 1–2 周 | ✅ 做，MCP 的前提 |
| **R3 路径全面 REST 化** | 505 个函数重排路径 + 前端全改 | 3–5 周 | ⚠️ **建议只做新模块与 MCP 暴露的那部分** |
| **R4 横切服务抽取** | 文件/审批/分享统一 | 3–4 周 | ⏸ 迁移后单独立项 |

> **我的建议**：R0 + R1 + R2 跟 FastAPI 迁移一起做（它们本来就要逐个文件过一遍，
> 边搬边规范几乎不增加成本）。**R3 不要全量做** —— 给 505 个接口换名字对用户是
> 零价值的，风险却是全量的。改成：新接口按新规范，老接口保持路径、只统一信封。
> R4 等迁移稳定后再单独立项。

## 5. 对 MCP 的意义

MCP 让 LLM 直接调这套 API。上面的问题会被放大：

- 505 个风格各异的接口 → LLM 选错工具
- 3 种信封 → LLM 要写 3 套解析
- 5% 分页率 → **一次工具调用返回一万行，直接撑爆上下文**
- 60 条语义错配的 POST → LLM 无法从方法推断副作用，**可能误调破坏性接口**

所以 **MCP 不应该 1:1 暴露 505 个接口**，而应该是一层精选的、面向任务的工具集。
详见 [14-MCP接入设计.md](14-MCP接入设计.md)。
