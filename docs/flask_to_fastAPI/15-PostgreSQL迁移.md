# 15 · MySQL/MariaDB → PostgreSQL 迁移

> 决策 D14。理由是**维护团队更熟悉 PG**，且以后全线用 PG —— 这是充分的理由，
> 不需要技术上的额外论证。

## 1. 先澄清：数据库不是 FastAPI 迁移的绊脚石

你问"如果数据库是绊脚石"—— 实测结论是**它不是**：SQLAlchemy 2.0 对
MySQL 和 PG 一视同仁，FastAPI 迁移不会因为 MariaDB 卡住。

所以这次迁 PG 是**为了团队熟悉度这个独立目标**，不是被迫的技术让步。
这点写清楚，免得以后回看时误以为是技术债倒逼。

## 2. 实测：可移植性非常好

| 检查项 | 结果 | 判读 |
|---|---|---|
| MySQL 专有类型 | **4 处**（`LONGTEXT` ×1、`mysql.JSON` 导入 ×2） | 极少 |
| `db.Enum` | 10 处 | PG 会建原生 enum 类型，需注意改值方式 |
| 原生 SQL 语句 | **2 条** | 几乎全走 ORM |
| MySQL 函数/反引号 | **0 处**（grep 命中全是文档字符串误报） | 干净 |
| 单列字符串唯一索引 | 24 个 | 见 §4 的大小写问题 |
| 现存"只差大小写"的重复值 | **0 组** | **迁移不会撞唯一约束** |

> 99 张表、47,435 行、16 MB —— 数据量很小，迁移本身是分钟级的事。
> 工作量全在**行为差异**上，不在搬数据上。

## 3. 要改的代码（很少）

```python
# models/event_data.py
- from sqlalchemy.dialects.mysql import LONGTEXT
- extra_metadata = db.Column(LONGTEXT, nullable=True)
+ extra_metadata = db.Column(db.Text, nullable=True)      # PG 的 text 无长度上限

# models/form.py（两处导入）
- from sqlalchemy.dialects.mysql import JSON
+ from sqlalchemy import JSON          # 或 postgresql.JSONB（更好，支持索引）
```

`JSONB` 比 `JSON` 更值得用（可建 GIN 索引、查询快），但要确认现有代码没有依赖
**键顺序**（JSON 保序，JSONB 不保序）。

驱动与连接串：

```python
# 旧
mysql+pymysql://user:pw@host/UTBA
# 新
postgresql+psycopg://user:pw@host/utba          # psycopg 3
```

`requirements.txt`：`PyMySQL` → `psycopg[binary]`。

## 4. ★ 最大的行为差异：大小写敏感

MariaDB 当前用 `utf8mb4_general_ci` —— **不分大小写**。PG **分**。

这意味着：

> 今天 `Yukang` 和 `yukang` 登录的是同一个账号；**迁到 PG 后不是。**

受影响的 24 个单列唯一索引里，真正要紧的是身份类：

```
user_data.username   user_data.email   user_data.phone   nric_asset.nric
asset_item.code      gl_account.code   asset_warehouse.code   ...
```

代码里有 **17 处**按字符串相等查询（`filter_by(username=...)` 之类），
迁移后语义会变。

### 处理方案（推荐 citext）

```sql
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE user_data ALTER COLUMN username TYPE citext;
ALTER TABLE user_data ALTER COLUMN email    TYPE citext;
```

`citext` 让这些列的比较与唯一约束继续不分大小写，**17 处查询代码一行都不用改**。
这是最省事且最不容易漏的做法。

替代方案（不推荐，改动面大）：查询一律 `.filter(func.lower(col) == value.lower())`
＋ 函数唯一索引 —— 17 处都要改，漏一处就是登录 bug。

- [ ] ★ 验收：用**大小写混合**的用户名/邮箱登录，行为与迁移前一致

### 其他差异清单

| 差异 | 影响 | 处理 |
|---|---|---|
| `AUTO_INCREMENT` → `IDENTITY`/序列 | 建表语句 | pgloader / alembic 自动处理 |
| 零值日期 `0000-00-00` | PG 不接受 | 迁移前扫一遍，改 NULL |
| `TINYINT(1)` 当布尔 | 语义 | 转 `boolean` |
| 无符号整数 | PG 无此概念 | 转普通 int，检查是否有溢出风险 |
| 字符串排序 | `ORDER BY name` 结果会变（大小写优先级不同） | 列表顺序可能微变，可接受 |
| 空串 vs NULL | MySQL 较宽松 | 检查 `nullable=False` + 空串的列 |
| `GROUP BY` 严格性 | PG 要求非聚合列都在 GROUP BY | 只有 2 条原生 SQL，逐条检查 |

## 5. 迁移方式

### 5.1 结构：让 alembic 重新生成基线

现有 **81 个迁移文件全是 MySQL 语境**下写的，逐个改不现实也没必要。做法：

1. 在 PG 上建空库
2. 从当前 models **生成一份全新的基线迁移**（`alembic revision --autogenerate`）
3. 归档旧的 81 个文件到 `migrations/versions/_mysql_archive/`（保留历史，不再执行）
4. 新库的 `alembic_version` 直接标记为新基线

> 代价：失去逐步回溯到任意历史版本的能力。
> 对一个即将换库的项目而言，这个能力本来就没用 —— 旧迁移只能在 MySQL 上跑。

### 5.2 数据：pgloader

```bash
pgloader mysql://user:pw@127.0.0.1/UTBA postgresql://user:pw@127.0.0.1/utba
```

pgloader 会自动处理类型映射与自增序列。但**必须逐表核对行数**
（照搬 `scripts/refresh_demo_db.sh` 里的校验思路）。

### 5.3 先在 demo 库上练

`UTBA_demo` 就是为这个准备的。完整流程先在 demo 上跑通、验收通过，再动生产。

## 6. ★ 连接数：PG 默认比 MariaDB 还紧

| | max_connections |
|---|---|
| MariaDB（现状实测） | 151 |
| **PG 默认** | **100** |

PG 的每个连接是一个进程（比 MySQL 的线程重），所以**不能靠调大 max_connections 解决**。
正确做法：

- 应用侧严格限制连接池：`pool_size=8, max_overflow=4`（4 worker → 最多 48 条）
- 并发再高就上 **PgBouncer**（transaction 模式），这是 PG 生态的标准做法
- uvicorn 的线程池也要调小（默认 40 → 12–16）

## 7. 顺序：PG 迁移排在 FastAPI 之前

**在现有 Flask 代码上先迁 PG。**

理由：同时换框架又换数据库，出问题时无法判断是哪个引起的。
先迁 PG，用**已知正确的 Flask 行为**验证 PG 侧无误；
之后 FastAPI 迁移就没有数据库这个变量了。

两次停机窗口换来的是**可归因性**，值得。

```
P0 迁 PG（Flask 上）──→ 阶段 1–5 迁 FastAPI（PG 上）
   ↑ 可独立回滚            ↑ 数据库不再是变量
```

## 8. 清单

**准备**
- [ ] 装 PG（版本？建议 16 或 17）+ 建库 + 建用户
- [ ] `CREATE EXTENSION citext;`
- [ ] 扫零值日期、空串非空列、无符号整数溢出风险

**代码**
- [ ] `LONGTEXT` → `Text`（1 处）
- [ ] `mysql.JSON` → `JSON` 或 `JSONB`（2 处导入），确认不依赖键顺序
- [ ] 连接串与驱动（`PyMySQL` → `psycopg[binary]`）
- [ ] 连接池参数（`pool_size=8, max_overflow=4`）
- [ ] 2 条原生 SQL 逐条检查方言
- [ ] 10 处 `db.Enum` 确认 PG 原生 enum 的取值改动方式

**迁移**
- [ ] alembic 生成新基线，旧 81 个文件归档
- [ ] pgloader 搬数据到 `utba_demo`
- [ ] **逐表行数核对**（99 表 / 47,435 行）
- [ ] citext 改身份列

**验收**
- [ ] ★ 大小写混合的用户名/邮箱能登录
- [ ] ★ NRIC 去重逻辑行为不变（"去重要认各种写法"那条规则）
- [ ] 报名/牌位/报销三条主流程跑通
- [ ] 列表排序结果人工抽查（`ORDER BY` 行为会微变）
- [ ] 连接数在压测下不超上限

**切换**
- [ ] 停机 → mysqldump 备份 → pgloader → 切连接串 → 冒烟
- [ ] MySQL 实例**保留至少一个月**再下线
