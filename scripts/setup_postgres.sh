#!/usr/bin/env bash
# =============================================================================
# scripts/setup_postgres.sh —— PostgreSQL 落地 + 从 MariaDB 搬数据（D14 / 15 文档）
#
# ★ 这个脚本要 sudo 执行，而且**故意不做成一键到底**。
#   install / createdb / tune 三步改系统，load 步会清空目标库里的数据。
#   所以按 step 分开跑：每一步都幂等，出错立刻停（set -euo pipefail），
#   跑之前先打印这一步要干什么，让人有机会按 Ctrl-C。
#
# 它会改什么（只有这些，每一条都能原样退回去）：
#   1. apt 装 postgresql-16 / postgresql-contrib-16 / pgloader
#   2. 建角色与数据库 —— 名字取自 system_config.env（core.config），这里不写死
#   3. 在目标库里 CREATE EXTENSION citext（★ 不装的后果见 step_createdb 里的注释）
#   4. ALTER SYSTEM 写 postgresql.auto.conf（改前自动备份），然后重启 postgresql
#   5. pgloader 把 MariaDB 的数据灌进 alembic 已经建好的表
#   6. 把身份列（username / email / phone / nric / 各类 code）改成 citext
#
#   ⚠️ 全程**只读**源 MariaDB，一个字都不写。源库按 15 文档 §8 留够一个月再下线。
#   ⚠️ 不碰 /srv/flaskapp/_token.py —— 那个文件 6 个项目共用（09 文档 D11-4），
#      需要 MySQL 的连接信息就复制值出来放进 $SOURCE_ENV，不要改原文件。
#
# 怎么回滚（按步骤倒着来）：
#   citext   → ALTER TABLE ... TYPE varchar USING "col"::varchar;（或直接重跑 load 重灌）
#   load     → 目标库是我们自己新建的，DROP DATABASE 重来即可；源库没被碰过
#   tune     → sudo -u postgres psql -c 'ALTER SYSTEM RESET ALL'
#              sudo systemctl restart postgresql
#              （改之前的 postgresql.auto.conf 备份在同目录下 .bak-<时间戳>）
#   createdb → sudo -u postgres psql -c 'DROP DATABASE "<库>"' -c 'DROP ROLE "<角色>"'
#   install  → sudo apt-get remove --purge postgresql-16
#              ★ purge 会把 /var/lib/postgresql/16 整个删掉，先确认没有别的库在里面
#   整体     → system_config.env 的 DB_* 改回 MariaDB、驱动换回 PyMySQL、重启服务。
#              这就是「PG 单独切一次机」的意义：回滚时不用连 FastAPI 一起退。
#
# 用法：
#   sudo bash scripts/setup_postgres.sh install     # 装 PG16 + contrib + pgloader
#   sudo bash scripts/setup_postgres.sh createdb    # 建角色 + 建库 + citext/pg_stat_statements
#   sudo bash scripts/setup_postgres.sh tune        # 调参数（会重启 postgresql）
#   sudo bash scripts/setup_postgres.sh load        # ★ 搬数据（会先 TRUNCATE 目标表）
#        bash scripts/setup_postgres.sh verify      # 逐表行数核对（只读，不用 sudo）
#        bash scripts/setup_postgres.sh citext      # 身份列改 citext（不用 sudo）
#        bash scripts/setup_postgres.sh status      # 体检：版本/扩展/连接数/表数
#   sudo bash scripts/setup_postgres.sh all         # 按顺序跑完上面全部
#
# 前置条件：
#   * 仓库根下有 system_config.env（DB_* 已经填成 PostgreSQL 的目标值）
#   * load / verify 需要一份源 MariaDB 的连接信息，放在 $SOURCE_ENV（见下面 need_source）
#   * load 之前，目标库的表结构必须已经由 alembic 建好（15 文档 §5.1 的新基线）：
#       ./venv/bin/alembic upgrade head
# =============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$PROJECT_ROOT/venv/bin/python"

# PG 大版本。Ubuntu 24.04 的官方源就是 16，够用；要 17 得先加 PGDG 源（见 step_install）。
PG_MAJOR="${PG_MAJOR:-16}"

# 源 MariaDB 的连接信息。放在仓库**外面**是有意的：放仓库里迟早被 git add 进去。
# 文件内容（chmod 600）：
#   SRC_MYSQL_HOST=127.0.0.1
#   SRC_MYSQL_PORT=3306
#   SRC_MYSQL_USER=...
#   SRC_MYSQL_PASSWORD=...
#   SRC_MYSQL_DB=UTBA_demo
# 这几个值从 /srv/flaskapp/_token.py 复制出来 —— 复制，不要改那个文件。
SOURCE_ENV="${PG_MIGRATE_SOURCE_ENV:-/root/pg_migrate_source.env}"

# 要改成 citext 的列。取自 09/15 文档里点名的身份列。
# ★ 为什么只有这几列：citext 的判据是「这个值是不是同一个人/同一个东西的标识」。
#   token / hash / 文件路径这些**必须**保持大小写敏感 —— 把 token 变成不分大小写
#   等于凭空削弱了它的熵，是安全倒退。所以下面这张表是白名单，不是「所有字符串列」。
CITEXT_COLUMNS=(
  user_data.username        # 登录名
  user_data.email           # 登录名 + 找回密码
  user_data.phone           # 登录名（马来西亚号码有人写 +60 有人写 0，但大小写这层先保住）
  nric_asset.nric           # 身份证号，含字母；「去重要认各种写法」那条规则依赖它
  asset_item.code
  asset_partner.code
  asset_warehouse.code
  gl_account.code
  department.name
)

# ─────────────────────────── 小工具 ───────────────────────────

step()  { printf '\n\033[1;36m━━━ %s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }
warn()  { printf '  \033[1;33m⚠ %s\033[0m\n' "$*"; }
die()   { printf '\n\033[1;31m❌ %s\033[0m\n' "$*" >&2; exit 1; }

need_root() {
  [[ "${EUID}" -eq 0 ]] || die "这一步要 sudo：sudo bash scripts/setup_postgres.sh $1"
}

# 目标库的连接信息一律从 core.config 读，不在脚本里写死，也不读 os.environ ——
# 保证脚本建出来的库和应用实际要连的库是同一个，不会出现「建了 utba 却连 utba_demo」。
load_target() {
  [[ -x "$PY" ]] || die "找不到 venv：$PY"
  eval "$(cd "$PROJECT_ROOT" && PYTHONPATH="$PROJECT_ROOT" "$PY" - <<'PY'
import shlex
from core.config import settings
for name in ("db_host", "db_port", "db_name", "db_user", "db_password"):
    print("PG_%s=%s" % (name[3:].upper(), shlex.quote(str(getattr(settings, name)))))
PY
)"
  [[ -n "${PG_NAME:-}" && -n "${PG_USER:-}" ]] || die "system_config.env 里的 DB_* 没读到"
}

# psql 的密码走 PGPASSFILE（chmod 600 的临时文件），不走命令行也不走 -W 交互 ——
# 命令行参数在 ps 里是所有用户可见的，密码进 argv 等于贴在公告板上。
setup_pgpass() {
  PGPASS_FILE="$(mktemp)"
  chmod 600 "$PGPASS_FILE"
  # pgpass 的字段分隔符是 ':'，密码里的 ':' 和 '\' 必须转义，否则会被截断成错的密码。
  local esc="${PG_PASSWORD//\\/\\\\}"
  esc="${esc//:/\\:}"
  printf '%s:%s:*:%s:%s\n' "$PG_HOST" "$PG_PORT" "$PG_USER" "$esc" > "$PGPASS_FILE"
  export PGPASSFILE="$PGPASS_FILE"
  TMP_FILES+=("$PGPASS_FILE")
}

# 以应用身份连目标库。-v ON_ERROR_STOP=1 很关键：psql 默认出错继续往下跑，
# 那样 set -e 也拦不住，会得到一个「跑完了但其实没做完」的假成功。
app_psql() { psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_NAME" -v ON_ERROR_STOP=1 "$@"; }

need_source() {
  [[ -f "$SOURCE_ENV" ]] || die "缺少源库连接信息：$SOURCE_ENV（格式见本脚本头部注释，chmod 600）"
  local mode
  mode="$(stat -c '%a' "$SOURCE_ENV")"
  [[ "$mode" == "600" || "$mode" == "400" ]] || warn "$SOURCE_ENV 权限是 $mode，建议 chmod 600"
  # shellcheck disable=SC1090
  set -a; source "$SOURCE_ENV"; set +a
  : "${SRC_MYSQL_HOST:?}" "${SRC_MYSQL_USER:?}" "${SRC_MYSQL_PASSWORD:?}" "${SRC_MYSQL_DB:?}"
  SRC_MYSQL_PORT="${SRC_MYSQL_PORT:-3306}"
}

TMP_FILES=()
cleanup() { [[ ${#TMP_FILES[@]} -gt 0 ]] && rm -f "${TMP_FILES[@]}" || true; }
trap cleanup EXIT

# ─────────────────────────── 1. 安装 ───────────────────────────

step_install() {
  need_root install
  step "第 1 步 · 安装 PostgreSQL ${PG_MAJOR} + contrib + pgloader"
  info "要做：apt 装 postgresql-${PG_MAJOR}、postgresql-contrib-${PG_MAJOR}（citext 在 contrib 里）、pgloader"
  info "不做：不动 MariaDB，不改任何现有服务"

  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  # postgresql-contrib 提供 citext 和 pg_stat_statements。少装它 = 后面 CREATE EXTENSION 直接报错。
  apt-get install -y "postgresql-${PG_MAJOR}" "postgresql-contrib-${PG_MAJOR}" pgloader

  # ★ 想上 PG 17 的话不要在这里临时起意：加 PGDG 源是另一件事，
  #   而且 pgloader 3.6.7 对更新的 PG 偶有兼容问题，16 是当前最省事的选择。
  #   真要升：先加 apt.postgresql.org 的源，再把 PG_MAJOR=17 传进来重跑这一步。

  systemctl enable --now postgresql
  info "已装：$(psql --version)"
  info "已装：$(pgloader --version 2>&1 | head -1)"
  info "下一步：sudo bash scripts/setup_postgres.sh createdb"
}

# ─────────────────────────── 2. 建库建角色 ───────────────────────────

step_createdb() {
  need_root createdb
  load_target
  step "第 2 步 · 建角色 ${PG_USER} / 建库 ${PG_NAME} / 装扩展"
  info "要做：CREATE ROLE、CREATE DATABASE（owner = ${PG_USER}）、CREATE EXTENSION citext + pg_stat_statements"
  info "幂等：三样东西都是「已存在就跳过」，重复跑安全"

  local sql
  sql="$(mktemp)"; chmod 600 "$sql"; TMP_FILES+=("$sql")

  # 密码写进 chmod 600 的临时 SQL 文件，用 psql -f 喂进去。
  # 不用 psql -c "...密码..."：那会进 argv。也不用 -v 变量：同样进 argv。
  # 字面量的转义交给 python 的 SQL literal 规则做，不用 shell 拼 —— 密码里有单引号就会炸。
  (cd "$PROJECT_ROOT" && PYTHONPATH="$PROJECT_ROOT" "$PY" - "$sql" <<'PY'
import sys
from core.config import settings

def lit(s):      # SQL 字符串字面量
    return "'" + str(s).replace("'", "''") + "'"

def ident(s):    # SQL 标识符
    return '"' + str(s).replace('"', '""') + '"'

user, name, pw = settings.db_user, settings.db_name, settings.db_password
with open(sys.argv[1], "w") as f:
    f.write(f"""
-- 角色：已存在就只把密码对齐成 system_config.env 里的值（幂等的关键）
DO $do$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = {lit(user)}) THEN
    CREATE ROLE {ident(user)} LOGIN PASSWORD {lit(pw)};
  ELSE
    ALTER ROLE {ident(user)} LOGIN PASSWORD {lit(pw)};
  END IF;
END
$do$;

-- 数据库：PG 没有 CREATE DATABASE IF NOT EXISTS，用 \\gexec 拼出来再执行。
-- CREATE DATABASE 不能在事务块里跑，\\gexec 是逐条独立执行，正好合适。
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8''',
              {lit(name)}, {lit(user)})
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = {lit(name)})
\\gexec
""")
PY
)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -f "$sql"

  # ★ citext —— 这是整个 PG 迁移里最要紧的一行。
  #   MariaDB 现在用 utf8mb4_general_ci，**不分大小写**：今天 `Yukang` 和 `yukang`
  #   登录的是同一个账号。PG 的 text/varchar 是**分**大小写的。
  #   不装 citext 直接迁过来，`Yukang` 和 `yukang` 当场变成两个账号 ——
  #   老用户按习惯敲大写登录会得到「用户不存在」，或者更糟：注册出一个同名影子账号。
  #   装上 citext 并把身份列改成 citext 之后，比较和唯一约束继续不分大小写，
  #   代码里那 17 处 filter_by(username=...) 一行都不用改（15 文档 §4）。
  #   扩展要装在**目标库里**，不是装在 postgres 库里 —— 扩展是 per-database 的。
  sudo -u postgres psql -d "$PG_NAME" -v ON_ERROR_STOP=1 -q \
       -c 'CREATE EXTENSION IF NOT EXISTS citext'
  # pg_stat_statements 是「最慢的请求到底慢在哪」的答案来源。09 文档 D11-2 说 nginx
  # 侧要补 $request_time 埋点，数据库侧的对应物就是它。要配合 tune 步的 preload 才生效。
  sudo -u postgres psql -d "$PG_NAME" -v ON_ERROR_STOP=1 -q \
       -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements' || \
       warn "pg_stat_statements 装不上（需要 shared_preload_libraries，先跑 tune 再回来补）"

  info "库的 collation：$(sudo -u postgres psql -Atc "SELECT datcollate FROM pg_database WHERE datname='${PG_NAME}'")"
  warn "collation 决定 ORDER BY 的顺序，和 MariaDB 不会完全一样（15 文档 §4 列为可接受差异）"
  info "下一步：sudo bash scripts/setup_postgres.sh tune"
}

# ─────────────────────────── 3. 调参 ───────────────────────────

step_tune() {
  need_root tune
  step "第 3 步 · 调 max_connections 与内存参数（会重启 postgresql）"
  info "要做：ALTER SYSTEM 写 postgresql.auto.conf（先备份）→ systemctl restart postgresql"
  info "影响：重启期间所有连接断开，几秒钟。挑低峰期。"

  local conf_dir auto_conf
  conf_dir="$(sudo -u postgres psql -Atc 'SHOW data_directory')"
  auto_conf="${conf_dir}/postgresql.auto.conf"
  if [[ -f "$auto_conf" ]]; then
    cp -a "$auto_conf" "${auto_conf}.bak-$(date +%Y%m%d%H%M%S)"
    info "已备份：${auto_conf}.bak-*（回滚就是把它拷回去，或者 ALTER SYSTEM RESET ALL）"
  fi

  local ram_mb shared_mb cache_mb maint_mb work_mb
  ram_mb="$(free -m | awk '/^Mem:/{print $2}')"
  # 经验配比，不是魔法数字：
  #   shared_buffers   25% —— PG 自己的缓存；再大收益递减，因为它还要靠 OS page cache
  #   effective_cache_size 60% —— 只是给规划器的**提示**，不占内存，写大点鼓励走索引
  shared_mb=$(( ram_mb / 4 ));  (( shared_mb > 8192 )) && shared_mb=8192
  cache_mb=$(( ram_mb * 6 / 10 ))
  maint_mb=$(( ram_mb / 16 ));  (( maint_mb > 2048 )) && maint_mb=2048; (( maint_mb < 256 )) && maint_mb=256
  # ★ work_mem 要小心：它是**每个连接的每个排序/哈希节点**各一份，不是全局一份。
  #   一条带 3 个 sort 的查询 × 150 个连接 = 450 份。按 15% 内存除以连接数算，宁小勿大。
  work_mb=$(( ram_mb * 15 / 100 / 150 )); (( work_mb < 4 )) && work_mb=4

  info "本机内存 ${ram_mb}MB → shared_buffers=${shared_mb}MB effective_cache_size=${cache_mb}MB work_mem=${work_mb}MB"

  # ★★ max_connections 这一条必须看注释再改：
  #   PG 的每一条连接是一个**操作系统进程**（MySQL 是线程）。进程比线程贵得多：
  #   每条连接固定几 MB，还要参与 snapshot 计算，连接数一多性能是**往下掉**的。
  #   所以「并发不够就把 max_connections 调大」在 PG 上是错的解法 ——
  #   调大只会让机器更早崩，而且崩得更难看。
  #   正确的顺序是：
  #     1) 应用侧死死限制连接池（core/config.py: pool_size=8, max_overflow=4
  #        → 4 worker × 12 = 48 条），uvicorn 线程池也从默认 40 调到 12–16
  #     2) 还不够就上 PgBouncer（transaction 模式），几千个客户端复用几十条真连接
  #   这里给到 150，是给 48 条应用连接之外的 psql / pg_dump / alembic / 别的项目
  #   留出余量，**不是**把它当扩容手段。PG 默认 100，比 MariaDB 的 151 还紧。
  local settings_kv=(
    "max_connections=150"
    "shared_buffers=${shared_mb}MB"
    "effective_cache_size=${cache_mb}MB"
    "maintenance_work_mem=${maint_mb}MB"
    "work_mem=${work_mb}MB"
    # SSD 上随机读几乎和顺序读一样快；留着默认的 4.0 会让规划器无脑选全表扫描
    "random_page_cost=1.1"
    "effective_io_concurrency=200"
    # checkpoint 摊平：max_wal_size 太小会频繁 checkpoint，表现为周期性的写入卡顿
    "max_wal_size=4GB"
    "min_wal_size=1GB"
    "checkpoint_completion_target=0.9"
    # 埋点：慢于 1 秒的语句记进日志。对应 09 文档 D11-2「最长请求测不出来」的数据库侧。
    "log_min_duration_statement=1000"
    "log_lock_waits=on"
    "track_io_timing=on"
    # 空闲事务是连接池的头号杀手：一个忘了 commit 的事务能把 vacuum 顶住几小时
    "idle_in_transaction_session_timeout=300000"
    "timezone=Asia/Kuala_Lumpur"
  )
  local kv
  for kv in "${settings_kv[@]}"; do
    info "ALTER SYSTEM SET ${kv}"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "ALTER SYSTEM SET ${kv%%=*} = '${kv#*=}'"
  done

  # shared_preload_libraries 是个「全局单值」，直接 SET 会把别人预加载的库挤掉。
  # 所以只在它是空的时候设，非空就交给人工合并 —— 静默覆盖别人的配置是不可接受的。
  local preload
  preload="$(sudo -u postgres psql -Atc 'SHOW shared_preload_libraries')"
  if [[ -z "$preload" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'"
    info "shared_preload_libraries = pg_stat_statements"
  else
    warn "shared_preload_libraries 已经是 '${preload}'，没动它。要加 pg_stat_statements 请手工合并。"
  fi

  systemctl restart postgresql
  info "重启完成。max_connections = $(sudo -u postgres psql -Atc 'SHOW max_connections')"
  info "下一步：先 ./venv/bin/alembic upgrade head 建表，再 sudo bash scripts/setup_postgres.sh load"
}

# ─────────────────────────── 4. 搬数据 ───────────────────────────

step_load() {
  need_root load
  load_target
  need_source
  step "第 4 步 · pgloader 从 MariaDB 搬数据到 ${PG_NAME}"
  info "源：${SRC_MYSQL_USER}@${SRC_MYSQL_HOST}:${SRC_MYSQL_PORT}/${SRC_MYSQL_DB}（★ 只读）"
  info "目标：${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_NAME}"
  warn "这一步会 TRUNCATE 目标库里的业务表。目标库里如果已经有新数据，会没。"
  warn "确认表结构已经建好：./venv/bin/alembic upgrade head"

  [[ "${CONFIRM:-}" == "yes" ]] || die "确认后重跑：sudo CONFIRM=yes bash scripts/setup_postgres.sh load"

  setup_pgpass
  local load_file
  load_file="$(mktemp --suffix=.load)"; chmod 600 "$load_file"; TMP_FILES+=("$load_file")

  # 连接串里带密码，所以 .load 文件是 chmod 600 的临时文件，trap 退出时删掉。
  # 用 python 生成是为了 URL 编码 —— 密码里有 @ / : / # 的话手拼一定拼错。
  SRC_MYSQL_HOST="$SRC_MYSQL_HOST" SRC_MYSQL_PORT="$SRC_MYSQL_PORT" \
  SRC_MYSQL_USER="$SRC_MYSQL_USER" SRC_MYSQL_PASSWORD="$SRC_MYSQL_PASSWORD" \
  SRC_MYSQL_DB="$SRC_MYSQL_DB" \
  PG_HOST="$PG_HOST" PG_PORT="$PG_PORT" PG_USER="$PG_USER" PG_PASSWORD="$PG_PASSWORD" PG_NAME="$PG_NAME" \
  "$PY" - "$load_file" <<'PY'
import os, sys
from urllib.parse import quote

def url(scheme, user, pw, host, port, db):
    return "%s://%s:%s@%s:%s/%s" % (scheme, quote(user, safe=""), quote(pw, safe=""), host, port, db)

e = os.environ
src = url("mysql", e["SRC_MYSQL_USER"], e["SRC_MYSQL_PASSWORD"],
          e["SRC_MYSQL_HOST"], e["SRC_MYSQL_PORT"], e["SRC_MYSQL_DB"])
dst = url("postgresql", e["PG_USER"], e["PG_PASSWORD"],
          e["PG_HOST"], e["PG_PORT"], e["PG_NAME"])

with open(sys.argv[1], "w") as f:
    f.write(f"""LOAD DATABASE
     FROM {src}
     INTO {dst}

-- data only：表结构以 models/alembic 为准，不让 pgloader 自己猜类型。
--   让 pgloader 建表（include drop, create tables）也能跑通，但它猜出来的类型
--   会和 ORM 模型有细微出入，之后 alembic autogenerate 会一直想改回去，没完没了。
-- truncate：每张表灌之前先清空，保证这一步可以反复重跑。
-- disable triggers：数据是**并行**灌的，不按外键依赖顺序，不关触发器（外键检查）必然失败。
--   ★ 这需要 PG 超级用户权限，所以外层脚本临时给角色 SUPERUSER，跑完立刻撤销。
-- reset sequences：MySQL 的 AUTO_INCREMENT 到 PG 变成序列，不重置的话
--   下一次 INSERT 会从 1 开始，当场撞主键冲突。
 WITH data only,
      truncate,
      disable triggers,
      reset sequences,
      workers = 4, concurrency = 1,
      multiple readers per thread, rows per range = 50000,
      batch rows = 10000

  SET PostgreSQL PARAMETERS
      maintenance_work_mem to '512MB',
      work_mem to '64MB'

  SET MySQL PARAMETERS
      net_read_timeout  = '600',
      net_write_timeout = '600'

-- 零值日期：MySQL 允许 '0000-00-00'，PG 直接拒收。不转成 NULL 这一步会在
-- 某张不起眼的表上炸掉，而且报错信息不会告诉你是哪一行。
  CAST type datetime to timestamptz using zero-dates-to-null,
       type timestamp to timestamptz using zero-dates-to-null,
       type date     to date        using zero-dates-to-null,
       type longtext to text        drop typemod

-- ★ 必须排除 alembic_version：它在 PG 侧记的是新基线的版本号（15 文档 §5.1），
--   从 MySQL 把旧的 81 个迁移里的版本号灌回来，alembic 之后会找不到那个 revision。
 EXCLUDING TABLE NAMES MATCHING 'alembic_version'
;
""")
PY

  # 临时授超级用户 —— 只为 disable triggers。用 trap 保证无论成功失败、
  # 还是中途 Ctrl-C，都会撤回去；留一个 SUPERUSER 的应用账号在线上是不能接受的。
  revoke_su() { sudo -u postgres psql -q -c "ALTER ROLE \"$PG_USER\" NOSUPERUSER" >/dev/null 2>&1 || true; }
  trap 'revoke_su; cleanup' EXIT
  info "临时授予 ${PG_USER} SUPERUSER（仅本步骤，退出时自动撤销）"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "ALTER ROLE \"$PG_USER\" SUPERUSER"

  info "开始 pgloader（99 张表 / 约 4.7 万行，分钟级）…"
  pgloader --verbose "$load_file"

  revoke_su
  info "已撤销 SUPERUSER：$(sudo -u postgres psql -Atc "SELECT rolsuper FROM pg_roles WHERE rolname='${PG_USER}'")（应为 f）"

  # 灌完立刻 ANALYZE：PG 的规划器全靠统计信息，新灌的数据没有统计信息，
  # 不跑这一下第一批查询会走出离谱的执行计划，看起来像「迁完就变慢了」。
  info "ANALYZE（刷新规划器统计信息）…"
  app_psql -q -c 'ANALYZE'

  info "下一步：bash scripts/setup_postgres.sh verify"
}

# ─────────────────────────── 5. 逐表行数核对 ───────────────────────────

step_verify() {
  load_target
  need_source
  step "第 5 步 · 逐表行数核对（只读，两边都不写）"
  info "做法：从 MySQL 拿表清单，两边各跑一次真正的 COUNT(*) 再比对"
  info "★ 不用 information_schema.tables.table_rows —— InnoDB 那一列是**估算值**，"
  info "  能差出百分之几十，拿它做迁移校验等于没校验"

  SRC_MYSQL_HOST="$SRC_MYSQL_HOST" SRC_MYSQL_PORT="$SRC_MYSQL_PORT" \
  SRC_MYSQL_USER="$SRC_MYSQL_USER" SRC_MYSQL_PASSWORD="$SRC_MYSQL_PASSWORD" \
  SRC_MYSQL_DB="$SRC_MYSQL_DB" \
  PG_HOST="$PG_HOST" PG_PORT="$PG_PORT" PG_USER="$PG_USER" PG_PASSWORD="$PG_PASSWORD" PG_NAME="$PG_NAME" \
  "$PY" - <<'PY'
import os, sys
import pymysql, psycopg

e = os.environ
my = pymysql.connect(host=e["SRC_MYSQL_HOST"], port=int(e["SRC_MYSQL_PORT"]),
                     user=e["SRC_MYSQL_USER"], password=e["SRC_MYSQL_PASSWORD"],
                     database=e["SRC_MYSQL_DB"], charset="utf8mb4")
pg = psycopg.connect(host=e["PG_HOST"], port=e["PG_PORT"], dbname=e["PG_NAME"],
                     user=e["PG_USER"], password=e["PG_PASSWORD"])

with my.cursor() as c:
    c.execute("""SELECT table_name FROM information_schema.tables
                  WHERE table_schema = %s AND table_type = 'BASE TABLE'
                  ORDER BY table_name""", (e["SRC_MYSQL_DB"],))
    tables = [r[0] for r in c.fetchall()]

# pgloader 默认把标识符**降成小写**（PG 的未加引号标识符本来就是小写语义）。
# 所以拿 MySQL 的表名去 PG 查之前先 lower()，否则 99 张表会「全部缺失」。
pg_tables = {r[0] for r in pg.execute(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'").fetchall()}

bad, total_my, total_pg = [], 0, 0
for t in tables:
    if t == "alembic_version":          # 故意没迁，跳过（见 .load 里的 EXCLUDING）
        continue
    with my.cursor() as c:
        c.execute("SELECT COUNT(*) FROM `%s`" % t.replace("`", "``"))
        n_my = c.fetchone()[0]
    key = t.lower()
    if key not in pg_tables:
        bad.append((t, n_my, "PG 里没有这张表"))
        total_my += n_my
        continue
    n_pg = pg.execute('SELECT COUNT(*) FROM "%s"' % key.replace('"', '""')).fetchone()[0]
    total_my += n_my
    total_pg += n_pg
    if n_my != n_pg:
        bad.append((t, n_my, n_pg))
        print("  ✗ %-40s MySQL %8d   PG %8s" % (t, n_my, n_pg))

print("  ── 合计 %d 张表：MySQL %d 行 / PG %d 行" % (len(tables), total_my, total_pg))
# PG 里多出来的表（models 有、MySQL 没有）也要报：说明 alembic 基线和源库对不上。
extra = pg_tables - {t.lower() for t in tables} - {"alembic_version"}
if extra:
    print("  ⚠ PG 里多出来的表（源库没有）：%s" % ", ".join(sorted(extra)))
if bad:
    print("\n  ❌ %d 张表对不上，**不要**切生产。" % len(bad))
    sys.exit(1)
print("\n  ✅ 逐表行数一致。")
PY

  info "下一步：bash scripts/setup_postgres.sh citext"
}

# ─────────────────────────── 6. 身份列改 citext ───────────────────────────

step_citext() {
  load_target
  setup_pgpass
  step "第 6 步 · 把身份列改成 citext"
  info "为什么：MariaDB 的 utf8mb4_general_ci 不分大小写，PG 的 varchar 分。"
  info "  不改的话 Yukang 和 yukang 会是两个账号，老用户按习惯敲大写就登录不上。"
  info "  改成 citext 之后比较和唯一约束继续不分大小写，代码里 17 处相等查询一行都不用动。"

  # ★ 先查「只差大小写的重复值」再改。15 文档说现存数据是 0 组，但那是**当时**的快照，
  #   数据每天在变。有重复的话 ALTER 会在重建唯一索引时失败，报错信息很难读；
  #   先查一遍能直接告诉人是哪张表哪个值，省掉一轮排查。
  local entry tbl col dup typ
  local blocked=0
  for entry in "${CITEXT_COLUMNS[@]}"; do
    tbl="${entry%%.*}"; col="${entry#*.}"
    typ="$(app_psql -Atc "SELECT format_type(a.atttypid, NULL) FROM pg_attribute a
             JOIN pg_class c ON c.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname='public' AND c.relkind = 'r'
               AND c.relname='${tbl}' AND a.attname='${col}' AND a.attnum > 0")"
    if [[ -z "$typ" ]]; then
      warn "${entry} 不存在，跳过（表结构变了？）"
      continue
    fi
    if [[ "$typ" == "citext" ]]; then
      info "${entry} 已经是 citext，跳过"
      continue
    fi
    dup="$(app_psql -Atc "SELECT count(*) FROM (
             SELECT lower(\"${col}\") FROM \"${tbl}\"
              WHERE \"${col}\" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) s")"
    if [[ "$dup" != "0" ]]; then
      warn "${entry} 有 ${dup} 组「只差大小写」的重复值，改 citext 会撞唯一约束"
      app_psql -c "SELECT lower(\"${col}\") AS 重复值, count(*) FROM \"${tbl}\"
                    WHERE \"${col}\" IS NOT NULL GROUP BY 1 HAVING count(*) > 1 LIMIT 20"
      blocked=1
      continue
    fi
    info "ALTER ${entry} → citext"
    # USING 显式写出来：varchar → citext 不是二进制兼容的转换，PG 会要求 USING。
    # 改类型会自动重建这一列上的索引与唯一约束，不用手工 DROP/CREATE。
    app_psql -q -c "ALTER TABLE \"${tbl}\" ALTER COLUMN \"${col}\" TYPE citext USING \"${col}\"::citext"
  done

  [[ "$blocked" -eq 0 ]] || die "有列因为重复值没改成。先在源库把重复值处理掉再重跑这一步。"

  info "验收（必须人工跑一遍，15 文档 §4）："
  info "  · 用大小写混合的用户名 / 邮箱登录，行为与迁移前一致"
  info "  · NRIC 去重逻辑行为不变"
  info "下一步：bash scripts/setup_postgres.sh status"
}

# ─────────────────────────── 体检 ───────────────────────────

step_status() {
  load_target
  setup_pgpass
  step "体检 · ${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_NAME}"
  app_psql -c "SELECT version()" -t
  app_psql -c "SELECT extname AS 扩展, extversion AS 版本 FROM pg_extension ORDER BY 1"
  app_psql -c "SELECT current_setting('max_connections') AS max_connections,
                      (SELECT count(*) FROM pg_stat_activity) AS 当前连接,
                      (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS 表数,
                      pg_size_pretty(pg_database_size(current_database())) AS 库大小"
  app_psql -c "SELECT c.relname AS 表, a.attname AS 列
                 FROM pg_attribute a
                 JOIN pg_class c ON c.oid = a.attrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 JOIN pg_type t ON t.oid = a.atttypid
                WHERE n.nspname='public' AND c.relkind = 'r'
                  AND t.typname='citext' AND a.attnum > 0
                ORDER BY 1, 2"
  # 序列落后于主键最大值 = 下一次 INSERT 必定主键冲突。pgloader 的 reset sequences
  # 正常会处理，但这是那种「上线第一天才发现」的问题，值得每次都看一眼。
  warn "另外人工确认：序列当前值 >= 对应主键最大值（pgloader 的 reset sequences 应已处理）"
}

# ─────────────────────────── 入口 ───────────────────────────

usage() { sed -n '/^# 用法：/,/^# 前置条件：/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  install)  step_install ;;
  createdb) step_createdb ;;
  tune)     step_tune ;;
  load)     step_load ;;
  verify)   step_verify ;;
  citext)   step_citext ;;
  status)   step_status ;;
  all)
    # all 也是一步步来的，中间任何一步失败都会因为 set -e 停在那里，不会带病往下跑。
    step_install; step_createdb; step_tune
    warn "接下来要建表结构。先跑：cd ${PROJECT_ROOT} && ./venv/bin/alembic upgrade head"
    warn "建完再跑：sudo CONFIRM=yes bash scripts/setup_postgres.sh load"
    ;;
  *) usage; exit 1 ;;
esac
