#!/usr/bin/env bash
# 开发服务器的起/停/重启。
#
# ★ 为什么不用 `pkill -f run.py`：这台机器上跑着好几个项目
#   （OCR_project / BearBad / sengchong 的入口也都叫 run.py），
#   裸 pkill 会把别人的服务一起杀掉。这里只杀**同时满足**两个条件的进程：
#     ① 正在监听本项目的 dev 端口
#     ② 它的 /proc/<pid>/cwd 就是本仓库
#   两个条件都对上才动手，撞不到别的项目。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="$(sed -n 's/^DEV_PORT=\([0-9]*\).*/\1/p' "$REPO/system_config.env" 2>/dev/null | head -1)"
PORT="${PORT:-5102}"
LOG="${XINYA_DEV_LOG:-$REPO/tmp/dev_server.log}"

pids_on_port() {
  # ss 的 users:(("python",pid=123,fd=3)) → 123
  ss -ltnHp "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
}

stop() {
  local found=0
  for pid in $(pids_on_port); do
    local cwd; cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$REPO" ]; then
      echo "  停止 pid=$pid（cwd=$cwd，端口 $PORT）"
      kill "$pid" 2>/dev/null || true; found=1
    else
      echo "  ⚠ pid=$pid 也在用端口 $PORT，但 cwd=$cwd 不是本仓库 —— 不动它"
    fi
  done
  [ "$found" = 1 ] && for _ in $(seq 1 20); do pids_on_port | grep -q . || break; sleep 0.5; done
  # 还没退就 SIGKILL（同样只认本仓库的）
  for pid in $(pids_on_port); do
    [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$REPO" ] && kill -9 "$pid" 2>/dev/null || true
  done
  [ "$found" = 0 ] && echo "  端口 $PORT 上没有本仓库的进程"
  return 0
}

start() {
  mkdir -p "$(dirname "$LOG")"
  ( cd "$REPO" && setsid nohup ./venv/bin/python run.py > "$LOG" 2>&1 < /dev/null & )
  for i in $(seq 1 40); do
    curl -sf -o /dev/null "http://127.0.0.1:$PORT/healthz" && { echo "  ✓ 已就绪（${i}s）  端口 $PORT  日志 $LOG"; return 0; }
    sleep 1
  done
  echo "  ★ 40s 内没起来，日志尾部："; tail -20 "$LOG"; return 1
}

case "${1:-restart}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  log)     tail -n "${2:-40}" "$LOG" ;;
  *) echo "用法: $0 {start|stop|restart|log [行数]}" >&2; exit 2 ;;
esac
