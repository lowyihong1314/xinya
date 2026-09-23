# 14 · MCP 接入设计

> 目标：让 LLM（Claude Desktop / Claude Code / 自建助手）能安全地查询和操作这套系统。
> 前提：[13-API重新设计.md](13-API重新设计.md) 的 R1（统一信封）与 R2（统一分页）必须先做完。

## 1. 三个必须先想清楚的问题

### 1.1 不要 1:1 暴露 505 个接口

最容易犯的错是"把所有 API 自动转成 MCP 工具"。后果：

| 问题 | 后果 |
|---|---|
| 505 个工具塞进上下文 | 光工具定义就吃掉几万 token，模型还没看到问题就没预算了 |
| 命名风格不统一（见 [13](13-API重新设计.md) §2） | 模型选错工具 |
| 95% 的列表接口不分页 | **一次调用返回一万行，直接撑爆上下文** |
| 60 条语义错配的 POST | 模型无法从方法推断副作用，**可能误调破坏性接口** |

> **原则：MCP 工具集是"面向任务"的精选层，不是 API 的镜像。**
> 第一版目标 **25–35 个工具**，覆盖 80% 的真实提问。

### 1.2 MCP 的 SSE 与本项目的 SSE 是两回事

别混淆：

| | 本项目的实时推送 | MCP 传输 |
|---|---|---|
| 协议 | SSE（`{BASE}/api/{app}/realtime`） | **Streamable HTTP** |
| 用途 | 浏览器收广播 | LLM 调工具 |
| 说明 | 见 [12](12-SSE改造方案.md) | MCP 的旧 SSE 传输**已废弃**，不要用 |

两者都挂在同一个 FastAPI 进程里，互不相干。

### 1.3 这套系统里有真实个资

62 个账号的 NRIC、银行账号、电话、家长联络方式、法会牌位上的家属姓名。
**LLM 工具的输出会进入模型上下文、可能被转述、可能出现在日志里。**

→ 默认脱敏（见 §5），这不是可选项。

## 2. 架构

```
Claude Desktop / Claude Code
        │  Streamable HTTP + Bearer <MCP token>
        ▼
  {BASE}/mcp            ← 挂在同一个 FastAPI 进程里
        │
   xinya_mcp （FastMCP）
        │  直接调 service 层（进程内，不走 HTTP 自调用）
        ▼
   app/*/services.py  →  core/db 垫片  →  MySQL
        │
   每次调用写审计日志（谁、什么工具、什么参数、结果条数）
```

**为什么直接调 service 层而不是自己打自己的 HTTP**：少一跳、少一次序列化、
错误堆栈完整。代价是**权限检查不再由路由装饰器提供**，必须在 MCP 层显式做（见 §4）。

## 3. 工具清单（第一版，只读）

命名遵循 `xinya_{action}_{resource}`（snake_case + 服务前缀，避免与其他 MCP server 撞名）。

### 3.1 会员与组织（4）

| 工具 | 说明 | 权限 |
|---|---|---|
| `xinya_search_members` | 按姓名/电话/部门搜索会员，**默认脱敏** | `member` |
| `xinya_get_member` | 单个会员详情（脱敏） | `member_detail` |
| `xinya_list_departments` | 部门与权限分配 | `department` |
| `xinya_get_member_stats` | 会员数、入会趋势、部门分布 | `member` |

### 3.2 活动与相册（5）

| 工具 | 说明 | 权限 |
|---|---|---|
| `xinya_list_events` | 活动列表（时间范围、类型、公开与否筛选） | 公开 |
| `xinya_get_event` | 活动详情 + 统计（照片数、签到数、预算） | 公开 |
| `xinya_list_event_media` | 相册文件列表（分页，含爱心数） | 公开 |
| `xinya_get_event_checkins` | 签到名单 | `event_edit` |
| `xinya_get_event_budget` | 活动预算与实际支出对比 | `account_read` |

### 3.3 报名与表单（5）

| 工具 | 说明 | 权限 |
|---|---|---|
| `xinya_list_forms` | 报名表列表 | `form_read` |
| `xinya_get_form` | 表单配置 + 报名统计 | `form_read` |
| `xinya_list_registrations` | 报名记录（按表单/状态/缴费状态筛选，脱敏） | `form_read` |
| `xinya_get_registration` | 单条报名详情 | `form_read` |
| `xinya_get_attendance` | 考勤/出席统计 | `form_read` |

### 3.4 法会（4）

| 工具 | 说明 | 权限 |
|---|---|---|
| `xinya_list_fahui_versions` | 法会版本（年度/场次） | `fahui_read` |
| `xinya_list_fahui_orders` | 牌位订单（按版本/状态/付款筛选） | `fahui_read` |
| `xinya_get_fahui_order` | 订单详情 + 牌位明细 | `fahui_read` |
| `xinya_get_board_status` | 板位占用情况统计 | `fahui_read` |

### 3.5 财务（6）

| 工具 | 说明 | 权限 |
|---|---|---|
| `xinya_list_claims` | 报销单（状态/部门/日期/金额区间筛选） | `account_read` |
| `xinya_get_claim` | 报销详情 + 明细行 + 审批记录 | `account_read` |
| `xinya_list_payments` | 收款记录（三类付款统一入口，见 [13](13-API重新设计.md) §2-D） | `account_read` |
| `xinya_get_gl_summary` | 总账科目余额/期间汇总 | `account_read` |
| `xinya_list_assets` | 资产清单 | `asset_read` |
| `xinya_get_finance_dashboard` | 收支概览（按期间/部门） | `account_read` |

### 3.6 检索与元信息（3）

| 工具 | 说明 | 权限 |
|---|---|---|
| `xinya_search` | 跨域搜索（会员/活动/订单/报销），返回类型化命中 | 按结果类型逐条过滤 |
| `xinya_list_permissions` | 当前 token 拥有哪些权限 —— **让模型知道自己能干什么** | 公开 |
| `xinya_describe_schema` | 返回某个资源的字段说明 —— 减少模型瞎猜字段名 | 公开 |

> `xinya_list_permissions` 很关键：模型在被拒绝之前就知道自己能做什么，
> 少走一轮试错。

### 3.7 写入工具（第二阶段，见 §7）

暂不实现。先跑一段时间只读，观察真实用法再决定开哪些。

## 4. 认证与授权

### 4.1 令牌

**不用 OAuth 2.1**（对一个几十人的团队太重），用**专用 MCP 个人令牌**：

```
xinya_mcp_<32位随机>      存哈希，明文只在创建时显示一次
```

新建表 `mcp_token`：

| 字段 | 说明 |
|---|---|
| `id` | |
| `user_id` | **令牌属于某个人**，不是服务账号 |
| `name` | "我的 Claude Desktop" |
| `token_hash` | sha256，不存明文 |
| `scopes` | JSON：允许的权限子集（**只能 ≤ 用户自身权限**） |
| `expires_at` | 默认 90 天 |
| `last_used_at` / `revoked_at` | |

### 4.2 权限映射

MCP 调用的权限 = **用户部门权限 ∩ 令牌 scopes**。两者取交集，永远不放大。

```python
# core/mcp/auth.py
def require(permission: str) -> None:
    """镜像 app/auth.py 的 permission_required，但作用在 MCP 调用上。"""
    ctx = current_mcp_context()          # 由 Streamable HTTP 的 Bearer 解出
    if permission not in ctx.effective_permissions:
        raise ToolError(
            f"没有权限 {permission}。当前令牌可用权限："
            f"{sorted(ctx.effective_permissions)}。"
            f"如需开通，请让管理员在部门权限里添加，或重建令牌时勾选该 scope。"
        )
```

> 错误信息要**可执行**：告诉模型缺什么、现在有什么、怎么解决 —— 而不是干巴巴一句
> "Permission denied"。

### 4.3 ★ 绝不做的三件事

1. **不要服务账号 god token。** 每个令牌绑定到具体的人，审计才有意义。
2. **不要让 MCP 绕过权限检查。** 路由装饰器的检查不会自动生效，必须在每个工具里显式 `require()`。
3. **不要把令牌放进 URL。** 只走 `Authorization: Bearer`。

### 4.4 审计

每次工具调用落一条：`user_id / token_id / tool / 参数摘要 / 返回条数 / 耗时 / 是否被拒`。
这是财务数据被 LLM 访问后**唯一的事后追溯手段**。

## 5. ★ 个资脱敏

默认输出一律脱敏：

| 字段 | 默认输出 | 完整值 |
|---|---|---|
| NRIC | `880101-**-****` | 需 `member_detail` **且**显式传 `reveal_pii=true` |
| 银行账号 | `****6789` | 需 `account_edit` + `reveal_pii=true` |
| 电话 | `012-****678` | 需 `member_detail` |
| 邮箱 | `y***@gmail.com` | 需 `member_detail` |
| 家长联络 | 脱敏 | 需 `member_detail` |

```python
class MemberOut(BaseModel):
    id: int
    display_name: str
    nric: str = Field(description="默认脱敏；需 member_detail 权限并显式请求才返回完整值")
    ...
```

`reveal_pii` 做成**显式参数而不是隐式行为**，这样模型必须"主动要"，
审计日志里也看得见谁在什么时候要了完整个资。

## 6. 实现骨架

```python
# core/mcp/server.py
from typing import Literal, Optional
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

mcp = FastMCP("xinya_mcp")


class ListClaimsInput(BaseModel):
    status: Optional[Literal["draft", "submitted", "approved", "rejected", "paid"]] = Field(
        default=None, description="报销单状态；不传则返回全部状态"
    )
    department: Optional[str] = Field(default=None, description="部门名称，例如「心芽」")
    date_from: Optional[str] = Field(default=None, description="申请日期起，YYYY-MM-DD")
    date_to: Optional[str] = Field(default=None, description="申请日期迄，YYYY-MM-DD")
    limit: int = Field(default=20, ge=1, le=100, description="返回条数，默认 20，上限 100")
    cursor: Optional[str] = Field(default=None, description="上一页返回的 next_cursor")
    response_format: Literal["markdown", "json"] = Field(
        default="markdown", description="markdown 便于阅读，json 便于程序处理"
    )


@mcp.tool(
    name="xinya_list_claims",
    annotations={
        "title": "列出报销申请",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    },
)
async def xinya_list_claims(params: ListClaimsInput) -> str:
    """按状态、部门、日期区间查询报销申请，返回分页结果。

    金额为整单合计（等于各明细行之和）。申请人的银行资料默认脱敏。
    需要 account_read 权限。
    """
    require("account_read")
    rows, next_cursor, total = await run_in_threadpool(
        claim_services.query_claims, **params.model_dump(exclude={"response_format"})
    )
    return render(rows, next_cursor, total, fmt=params.response_format)
```

挂进 FastAPI（与业务 API 同进程）：

```python
# asgi.py
app.mount(f"{settings.app_base_path}/mcp", mcp.streamable_http_app())
```

> ⚠️ FastMCP / MCP Python SDK 的接口仍在演进，**落地前用
> `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
> 核对当前版本的挂载方式与装饰器签名**，不要照抄本文档的细节。

## 7. 分阶段

| 阶段 | 内容 | 门槛 |
|---|---|---|
| **M1 只读** | §3 的 27 个只读工具 + 令牌 + 审计 + 脱敏 | API 的 R1/R2 完成 |
| **M2 低风险写入** | 建草稿报销、加活动备注、给照片打标签 —— 都**可撤销** | M1 稳定运行 1 个月 |
| **M3 审批类写入** | 批准付款、审批报销 —— `destructiveHint: true` + **二次确认** | 有明确的责任归属约定 |

> **M3 要慎重**：让 LLM 批准付款意味着"谁批的"这个问题变得模糊。
> 建议即使做，也只做"代为提交待人工确认"，不做终审。

## 8. 评估（按 MCP 最佳实践，交付物之一）

实现后要写 **10 道评估题**，验证 LLM 真能用这套工具解决真实问题。
要求：独立、只读、需要多次工具调用、答案唯一且稳定。

示例（基于真实数据形态）：

```xml
<evaluation>
  <qa_pair>
    <question>2026 年 9 月生日的会员中，有多少位没有登录账号？</question>
    <answer>14</answer>
  </qa_pair>
  <qa_pair>
    <question>活动「净滩拾光」的相册里，获得爱心最多的照片有几个爱心？</question>
    <answer>…</answer>
  </qa_pair>
  <qa_pair>
    <question>心芽部门在 2026 年第三季度已批准的报销总额是多少？</question>
    <answer>…</answer>
  </qa_pair>
</evaluation>
```

**在 `UTBA_demo` 库上出题和验证**，不要碰生产。

## 9. 验收清单

- [ ] 工具总数 ≤ 35，工具定义总 token < 15k
- [ ] 每个工具都有 `annotations`（readOnly/destructive/idempotent/openWorld）
- [ ] 每个列表工具都分页，默认 20、上限 100，返回 `has_more` / `next_cursor`
- [ ] 每个工具都显式 `require(permission)`
- [ ] 个资默认脱敏；`reveal_pii` 需要权限且被审计
- [ ] 错误信息包含"现在有什么 / 缺什么 / 怎么解决"
- [ ] 令牌可撤销、有过期、绑定到人
- [ ] 每次调用有审计日志
- [ ] 10 道评估题通过
- [ ] 用 MCP Inspector 跑通全部工具
