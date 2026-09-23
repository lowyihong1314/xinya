#!/usr/bin/env bash
# 用生产库 UTBA 的一致性快照刷新开发库 UTBA_demo。
#
# 安全设计：
#   - 只读生产：mysqldump --single-transaction（InnoDB 快照，不锁表、不阻塞线上写入）
#   - 目标库硬编码为 UTBA_demo，且开头断言目标 != 源，防手滑把生产库当目标
#   - 密码走临时 defaults-file（chmod 600），不出现在命令行里（ps 看不到）
#
# 用法：  bash scripts/refresh_demo_db.sh
set -euo pipefail

SRC_DB="UTBA"
DST_DB="UTBA_demo"
[[ "$SRC_DB" != "$DST_DB" ]] || { echo "❌ 源库与目标库相同，拒绝执行"; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

CNF="$(mktemp)"
trap 'rm -f "$CNF" "$DUMP"' EXIT
chmod 600 "$CNF"

./venv/bin/python - "$CNF" <<'PY'
import sys
from _token import DB_HOST, DB_USER, DB_PASSWORD
with open(sys.argv[1], "w") as f:
    f.write(f'[client]\nhost={DB_HOST}\nuser={DB_USER}\npassword="{DB_PASSWORD}"\n')
PY

DUMP="$(mktemp)"
echo "→ 导出 $SRC_DB（一致性快照，不锁表）…"
mysqldump --defaults-file="$CNF" --single-transaction --quick \
          --routines --triggers --events --default-character-set=utf8mb4 \
          "$SRC_DB" > "$DUMP"
echo "  dump 大小：$(du -h "$DUMP" | cut -f1)"

CHARSET=$(mysql --defaults-file="$CNF" -N -B -e \
  "SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$SRC_DB'")
COLL=$(mysql --defaults-file="$CNF" -N -B -e \
  "SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$SRC_DB'")

echo "→ 重建 $DST_DB（$CHARSET / $COLL）…"
mysql --defaults-file="$CNF" -e "DROP DATABASE IF EXISTS \`$DST_DB\`;
                                 CREATE DATABASE \`$DST_DB\` CHARACTER SET $CHARSET COLLATE $COLL;"
mysql --defaults-file="$CNF" --default-character-set=utf8mb4 "$DST_DB" < "$DUMP"

echo "→ 校验…"
mysql --defaults-file="$CNF" -N -B -e "
  SELECT CONCAT('  $SRC_DB: ', COUNT(*), ' 表') FROM information_schema.tables WHERE table_schema='$SRC_DB';
  SELECT CONCAT('  $DST_DB: ', COUNT(*), ' 表') FROM information_schema.tables WHERE table_schema='$DST_DB';"
echo "✅ 完成。本项目的 _token.py 已把 DB_NAME 覆盖为 $DST_DB。"
