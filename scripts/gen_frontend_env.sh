#!/usr/bin/env bash
# ============================================================================
# 从 system_config.env 生成 frontend/.env.production
# ----------------------------------------------------------------------------
# 前端不能直接读 system_config.env：Vite 的 import.meta.env 是**构建期**替换的，
# 值会被原样打进 JS 包，对所有访客可见。所以这里只导出**明确列进白名单**的几个键。
#
# 白名单，不是黑名单 —— 黑名单漏一条就是一次密钥泄漏事故，
# 而白名单漏一条只是前端少一个变量，构建时就会发现。
#
# 用法：
#   scripts/gen_frontend_env.sh                       # 默认读仓库根的 system_config.env
#   scripts/gen_frontend_env.sh <配置文件> <输出文件>
# ============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-${SYSTEM_CONFIG:-$PROJECT_ROOT/system_config.env}}"
OUT="${2:-${FRONTEND_ENV_OUT:-$PROJECT_ROOT/frontend/.env.production}}"

# 这四个词出现在结果里就说明白名单被改错了，直接中止。
# 注意 API_KEY 也在里面：GOOGLE_MAPS_EMBED_API_KEY 虽然旧名带 VITE_ 前缀，
# 但它是后端读了再经 /api 下发给前端的，不该走构建期注入这条路。
FORBIDDEN='SECRET|PASSWORD|PASSWD|_TOKEN|AUTH|API_KEY|CREDENTIAL|PRIVATE'

if [[ ! -f "$SRC" ]]; then
  echo "❌ 找不到配置文件：$SRC" >&2
  echo "   先 cp system_config.example.env system_config.env 并填好值。" >&2
  exit 1
fi

# 读某个键的值。**不 source 配置文件** —— source 会把全部密钥灌进本进程的环境，
# 而且配置文件里一旦有 $(...) 就变成任意代码执行。
read_key() {
  awk -v want="$1" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    /^[ \t]*#/ { next }
    /^[ \t]*$/ { next }
    {
      eq = index($0, "=")
      if (eq == 0) next
      key = trim(substr($0, 1, eq - 1))
      sub(/^export[ \t]+/, "", key)
      if (key != want) next

      val = trim(substr($0, eq + 1))
      sq = sprintf("%c", 39)                     # 单引号，避免和 shell 的引号打架
      if (substr(val, 1, 1) == "\"" && substr(val, length(val), 1) == "\"")
        val = substr(val, 2, length(val) - 2)
      else if (substr(val, 1, 1) == sq && substr(val, length(val), 1) == sq)
        val = substr(val, 2, length(val) - 2)
      else
        sub(/[ \t]+#.*$/, "", val)               # 去掉行尾注释（只对无引号的值）

      # `KEY=   # 说明` 这种写法，dotenv 会把 "# 说明" 当成值。
      # 这里统一当成「没填」，免得把一行注释导给前端。
      if (substr(trim(val), 1, 1) == "#") val = ""

      print trim(val)
      exit
    }
  ' "$SRC"
}

APP_BASE_PATH="$(read_key APP_BASE_PATH)"
APP_PUBLIC_ORIGIN="$(read_key APP_PUBLIC_ORIGIN)"
VITE_API_BASE="$(read_key VITE_API_BASE)"

# 与后端 core/config.py 的归一化保持一致：有前导斜杠、无尾随斜杠。
# 两边不一致的话，前端拼出来的 URL 会比后端的路由多一层斜杠。
APP_BASE_PATH="${APP_BASE_PATH%/}"
if [[ -n "$APP_BASE_PATH" && "$APP_BASE_PATH" != /* ]]; then
  APP_BASE_PATH="/$APP_BASE_PATH"
fi

# ★ VITE_API_BASE 没配就必须留空，**不能拿 APP_PUBLIC_ORIGIN 兜底**。
# frontend/src/js/apiBase.ts 里 `IS_APK = Boolean(API_BASE)` —— 非空就等于
# 「这是 APK 构建」：网页版会被当成 APK（走 nativeResponseCache、原生音乐桥），
# 并且把所有请求打成指向 APP_PUBLIC_ORIGIN 的跨域绝对地址。
# 在 dev 隧道域名下构建的话，页面会直接去请求生产站。空 = 相对路径 = 同源，这才是现状。

TMP="$(mktemp "${TMPDIR:-/tmp}/frontend-env.XXXXXX")"
# 校验没过就要删掉半成品，绝不能把一个可能含密钥的文件留在磁盘上。
trap 'rm -f "$TMP"' EXIT

{
  echo "# 本文件由 scripts/gen_frontend_env.sh 生成，请勿手改。"
  echo "# 来源：$SRC"
  echo "VITE_API_BASE=$VITE_API_BASE"
  echo "VITE_BASE_PATH=$APP_BASE_PATH"
  echo "VITE_PUBLIC_ORIGIN=$APP_PUBLIC_ORIGIN"
} > "$TMP"

# ── 硬断言 1：不许出现任何像密钥的东西 ──
# 只扫赋值行：生成的头部有一行「# 来源：<配置文件路径>」，路径里只要出现
# auth / private 之类的词（例如 /srv/oauth_staging/...）就会误报，把构建拦死。
# 路径不是密钥，注释行跳过。
if grep -vE '^#' "$TMP" | grep -Eiq "$FORBIDDEN"; then
  echo "❌ 密钥泄漏到前端 env，已中止（命中：$FORBIDDEN）" >&2
  grep -vE '^#' "$TMP" | grep -Ein "$FORBIDDEN" | sed 's/=.*/=<已隐去>/' >&2
  exit 1
fi

# ── 硬断言 2：除注释外，每一行都必须是 VITE_ 开头的赋值 ──
if grep -vE '^(#|$)' "$TMP" | grep -qvE '^VITE_[A-Z0-9_]+='; then
  echo "❌ 生成结果里有非 VITE_ 的行，已中止" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
cp "$TMP" "$OUT"
chmod 644 "$OUT"

echo "✅ 已生成 $OUT"
sed 's/^/   /' "$OUT"
