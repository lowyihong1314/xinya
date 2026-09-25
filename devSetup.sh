#!/usr/bin/env bash
#
# devSetup.sh — 一键部署 / 一键起开发环境
#
#   线上（脚本位于 /srv/flaskapp/ 下）：
#       ./devSetup.sh                 迁移数据库 -> 打前端包 -> 重启 xinya_flask + xinya_socket -> 健康检查
#       ./devSetup.sh --apk           上面全部再加打一个 APK/AAB
#       ./devSetup.sh --skip-build    不打前端包（只改了后端时用）
#       ./devSetup.sh --skip-migrate  不跑 flask db upgrade
#       ./devSetup.sh --no-restart    不重启服务
#       ./devSetup.sh --dry-run       只打印会做什么
#
#   本地开发（其他路径）：
#       ./devSetup.sh                 建 venv -> 装依赖 -> npm install -> 迁移 -> vite build -> python3 run.py
#       ./devSetup.sh --dev           用 vite dev server 代替 build（前端热更新，后端另开一个终端跑 run.py）
#
# 注意：不要用 sudo 跑这个脚本。root 写出来的 static/vite 文件普通用户删不掉，
#       下次 build 会 EACCES。脚本只在 systemctl restart 时才用 sudo。

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$PROJECT_ROOT/venv"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
SERVICES=(xinya_flask xinya_socket)
API_HEALTH_URL="http://127.0.0.1:5006/api/music/albums"
SOCKET_HEALTH_URL="http://127.0.0.1:8000/socket.io/?EIO=4&transport=polling"

SKIP_BUILD=0
SKIP_MIGRATE=0
NO_RESTART=0
BUILD_APK=0
DRY_RUN=0
DEV_SERVER=0

for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=1 ;;
        --skip-migrate) SKIP_MIGRATE=1 ;;
        --no-restart) NO_RESTART=1 ;;
        --apk) BUILD_APK=1 ;;
        --dry-run) DRY_RUN=1 ;;
        --dev) DEV_SERVER=1 ;;
        -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
        *) echo "未知参数: $arg（用 --help 看用法）" >&2; exit 2 ;;
    esac
done

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
run()  {
    if [[ $DRY_RUN -eq 1 ]]; then
        printf '    (dry-run) %s\n' "$*"
    else
        "$@"
    fi
}

# ---------- 通用检查 ----------

if [[ "$(id -u)" -eq 0 ]]; then
    die "请不要用 root / sudo 跑这个脚本，改用普通用户（例如 yukang）。"
fi

# 挑一个 >= 22 的 node：nvm 默认可能是 20，/usr/bin 的是 22（Capacitor 8 和 vite 8 都要 22）。
pick_node() {
    local major
    major=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
    if [[ "$major" -lt 22 && -x /usr/bin/node ]]; then
        local sys_major
        sys_major=$(/usr/bin/node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
        if [[ "$sys_major" -ge 22 ]]; then
            export PATH="/usr/bin:$PATH"
            major=$sys_major
        fi
    fi
    if [[ "$major" -lt 22 ]]; then
        die "需要 Node.js >= 22，当前是 $(node -v 2>/dev/null || echo 缺失)。"
    fi
    echo "    node $(node -v)  npm $(npm -v)"
}

# 前端产物目录如果混进了别人（root）的文件，提前说清楚，而不是 build 到一半 EACCES。
check_static_writable() {
    local dir="$PROJECT_ROOT/static/vite"
    [[ -d "$dir" ]] || return 0
    local foreign
    foreign=$(find "$dir" ! -user "$(id -un)" -print -quit 2>/dev/null || true)
    if [[ -n "$foreign" ]]; then
        die "static/vite 里有不属于 $(id -un) 的文件（例如 $foreign），先执行：sudo chown -R $(id -un):$(id -gn) $dir"
    fi
}

db_migrate() {
    log "数据库迁移"
    local current heads
    current=$(cd "$PROJECT_ROOT" && FLASK_APP=wsgi.py "$VENV_DIR/bin/flask" db current 2>/dev/null | grep -oE '^[0-9a-f]{12}' | head -1 || true)
    heads=$(cd "$PROJECT_ROOT" && FLASK_APP=wsgi.py "$VENV_DIR/bin/flask" db heads 2>/dev/null | grep -oE '^[0-9a-f]{12}' | head -1 || true)
    echo "    current=${current:-无}  head=${heads:-无}"
    if [[ -n "$heads" && "$current" == "$heads" ]]; then
        echo "    已是最新，跳过"
        return 0
    fi
    (cd "$PROJECT_ROOT" && FLASK_APP=wsgi.py run "$VENV_DIR/bin/flask" db upgrade)
}

frontend_build() {
    log "打前端包（static/vite）"
    check_static_writable
    (cd "$FRONTEND_DIR" && run npm run build)
}

frontend_deps() {
    if [[ ! -d "$FRONTEND_DIR/node_modules" ]] || [[ "$FRONTEND_DIR/package-lock.json" -nt "$FRONTEND_DIR/node_modules/.package-lock.json" ]]; then
        log "安装前端依赖"
        (cd "$FRONTEND_DIR" && run npm ci)
    fi
}

health_check() {
    local name="$1" url="$2" tries=15 code=000
    for ((i = 1; i <= tries; i++)); do
        code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)
        [[ "$code" == "200" ]] && { echo "    $name OK ($url)"; return 0; }
        sleep 1
    done
    warn "$name 健康检查失败：$url 返回 $code（看 journalctl -u ${name} -n 50）"
    return 1
}

# ---------- 线上 ----------

if [[ "$PROJECT_ROOT" == /srv/flaskapp/* ]]; then
    log "线上部署  $PROJECT_ROOT"
    echo "    分支 $(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo ?)  提交 $(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo ?)"
    dirty=$(git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null | grep -vc '^??' || true)
    [[ "$dirty" -gt 0 ]] && warn "工作区有 $dirty 个未提交的改动，部署的是磁盘上的当前内容。"
    pick_node
    [[ -x "$VENV_DIR/bin/flask" ]] || die "找不到 venv：$VENV_DIR"

    if [[ $SKIP_MIGRATE -eq 0 ]]; then db_migrate; fi

    if [[ $SKIP_BUILD -eq 0 ]]; then
        frontend_deps
        frontend_build
    fi

    if [[ $BUILD_APK -eq 1 ]]; then
        log "打 APK / AAB（版本取 frontend/mobile_version.env）"
        run "$FRONTEND_DIR/build_apk_ios.sh"
    fi

    if [[ $NO_RESTART -eq 0 ]]; then
        log "重启服务：${SERVICES[*]}"
        run sudo systemctl restart "${SERVICES[@]}"
        if [[ $DRY_RUN -eq 0 ]]; then
            sleep 2
            failed=0
            health_check xinya_flask "$API_HEALTH_URL" || failed=1
            health_check xinya_socket "$SOCKET_HEALTH_URL" || failed=1
            systemctl --no-pager --lines=0 status "${SERVICES[@]}" 2>/dev/null | grep -E 'Active:' | sed 's/^/    /' || true
            [[ $failed -eq 0 ]] || die "有服务没起来，见上面。"
        fi
    else
        warn "已跳过重启：后端改动要等下次 restart 才生效。"
    fi

    log "完成"
    exit 0
fi

# ---------- 本地开发 ----------

log "本地开发  $PROJECT_ROOT"
pick_node

if [[ ! -d "$VENV_DIR" ]]; then
    log "创建 venv"
    run python3 -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

log "安装 Python 依赖"
run pip install -q -r "$PROJECT_ROOT/requirements.txt"

frontend_deps

if [[ -f "$PROJECT_ROOT/_token.py" && $SKIP_MIGRATE -eq 0 ]]; then
    db_migrate
else
    [[ -f "$PROJECT_ROOT/_token.py" ]] || warn "没有 _token.py（数据库和密钥配置），跳过迁移；后端启动也会失败。"
fi

if [[ $DEV_SERVER -eq 1 ]]; then
    log "vite dev server（另开一个终端跑：source venv/bin/activate && python3 run.py）"
    (cd "$FRONTEND_DIR" && run npm run dev)
    exit 0
fi

if [[ $SKIP_BUILD -eq 0 ]]; then
    frontend_build
fi

log "启动后端  python3 run.py"
cd "$PROJECT_ROOT"
run python3 run.py
