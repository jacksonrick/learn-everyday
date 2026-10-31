#!/usr/bin/env bash
#
# 容器入口，两种模式：
#   APP_MODE=dev  （默认）前端起 Vite dev server（HMR），后端起 run.py（debug + 自动重载）。
#                          都不构建，改一行代码前端热替换、后端自动重启。
#   APP_MODE=prod         前端 vite build 到命名卷，后端起 gunicorn，Flask 单端口托管。
#
# 两种模式都不把源码打进镜像：源码是挂载进来的，改代码不用重启容器（dev 靠热更新，
# prod 靠 restart 触发重建）。启动时只补依赖，不覆盖你挂载目录里的任何东西。
#
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
STATE_DIR="${STATE_DIR:-/var/lib/learneveryday}"
WEB_DIR="$APP_DIR/web"
DIST_DIR="${WEB_DIST:-$STATE_DIR/web-dist}"
PORT="${PORT:-5001}"
VITE_PORT="${VITE_PORT:-5173}"
APP_MODE="${APP_MODE:-dev}"

log()  { printf '[entrypoint] %s\n' "$*"; }
die()  { printf '[entrypoint] 错误: %s\n' "$*" >&2; exit 1; }

# sha256sum 在 Debian 一定有；shasum 兜底只是为了能在 macOS 上本地跑这个脚本做验证
hash_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d' ' -f1
  else
    shasum -a 256 | cut -d' ' -f1
  fi
}

export APP_DIR PORT WEB_DIST="$DIST_DIR"

case "$APP_MODE" in
  dev|prod) ;;
  *) die "APP_MODE 只能是 dev 或 prod，收到：$APP_MODE" ;;
esac

# ---------------------------------------------------------------------------
# 0. 前置检查：源码没挂进来就别往下走了，否则会在 /app 建一个空库然后一脸问号
# ---------------------------------------------------------------------------
[ -f "$APP_DIR/api/run.py" ] \
  || die "在 $APP_DIR/api 没找到源码。请把项目目录挂进来，例如 -v /srv/LearnEveryday:/app"

mkdir -p "$STATE_DIR" "$DIST_DIR" || die "无法创建 $STATE_DIR / $DIST_DIR"
# 仓库目录只读也不至于起不来，只是备份和录音会失败，给个明确的警告
mkdir -p "$APP_DIR/backups" "$APP_DIR/uploads" 2>/dev/null \
  || log "警告: $APP_DIR 不可写，每日备份与背诵录音会失败（挂载时去掉 :ro）"

# ---------------------------------------------------------------------------
# 1. Python 依赖（两种模式都需要）
#    镜像里已装好一份，指纹存在 /usr/local/etc；宿主机 requirements.txt 变了才补装。
# ---------------------------------------------------------------------------
REQ_FILE="$APP_DIR/api/requirements.txt"
REQ_STAMP="$STATE_DIR/requirements.sha256"
REQ_BASELINE="/usr/local/etc/learneveryday-requirements.sha256"

if [ -f "$REQ_FILE" ]; then
  want_hash="$(hash_stdin < "$REQ_FILE")"
  have_hash="$(cat "$REQ_STAMP" 2>/dev/null || cat "$REQ_BASELINE" 2>/dev/null || true)"
  if [ "$want_hash" != "$have_hash" ]; then
    log "requirements.txt 有变化，补装 Python 依赖（需要联网；长期用请重新 build 镜像）…"
    python -m pip install --no-cache-dir -r "$REQ_FILE" || die "Python 依赖安装失败"
    printf '%s\n' "$want_hash" > "$REQ_STAMP"
  fi
fi

# ---------------------------------------------------------------------------
# 2. 前端依赖（两种模式都需要；dev 也要 node_modules 才能起 vite）
# ---------------------------------------------------------------------------
if [ "${SKIP_WEB_BUILD:-0}" != "1" ]; then
  command -v npm >/dev/null 2>&1 || die "镜像里没有 npm（可用 SKIP_WEB_BUILD=1 跳过前端）"
  [ -f "$WEB_DIR/package.json" ] || die "在 $WEB_DIR 没找到 package.json，请确认挂载目录正确"

  pkg_hash="$( { cat "$WEB_DIR/package.json"; \
                 [ -f "$WEB_DIR/package-lock.json" ] && cat "$WEB_DIR/package-lock.json" || true; \
               } | hash_stdin)"

  NM_DIR="$WEB_DIR/node_modules"
  NM_STAMP="$NM_DIR/.deps.sha256"
  need_install=0
  [ -x "$NM_DIR/.bin/vite" ] || need_install=1
  [ "$(cat "$NM_STAMP" 2>/dev/null || true)" = "$pkg_hash" ] || need_install=1

  if [ "$need_install" = "1" ]; then
    log "安装前端依赖（首次启动约 1~2 分钟，结果存在 node_modules 命名卷里）…"
    if [ -f "$WEB_DIR/package-lock.json" ]; then
      npm --prefix "$WEB_DIR" ci --no-audit --no-fund
    else
      npm --prefix "$WEB_DIR" install --no-audit --no-fund
    fi
    [ -x "$NM_DIR/.bin/vite" ] \
      || die "前端依赖装完还是找不到 vite。检查网络或换 npm 源（NPM_CONFIG_REGISTRY=https://registry.npmmirror.com）"
    printf '%s\n' "$pkg_hash" > "$NM_STAMP"
  fi
else
  log "SKIP_WEB_BUILD=1，跳过前端依赖"
fi

# ---------------------------------------------------------------------------
# 3. 起服务
# ---------------------------------------------------------------------------
if [ "$#" -gt 0 ]; then
  log "执行自定义命令: $*"
  exec "$@"
fi

# 任一端挂掉就整体退出，交给 restart 策略重启，别留半死不活的容器
stop_all() {
  local code="${1:-0}"
  trap - INT TERM
  log "关闭前后端…"
  kill -TERM "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
  exit "$code"
}

run_dev() {
  export FLASK_DEBUG=1
  log "开发模式：Flask :$PORT（debug + 自动重载）  Vite :$VITE_PORT（HMR，不构建）"
  log "客户端 http://<宿主机IP>:$VITE_PORT/    后台 http://<宿主机IP>:$VITE_PORT/admin"
  log "API 直连 :$PORT；若 HMR 不触发，给容器加 VITE_USE_POLLING=1 重新起"

  ( cd "$APP_DIR/api" && exec python run.py ) &
  api_pid=$!

  ( cd "$WEB_DIR" && exec npm run dev -- --host 0.0.0.0 --port "$VITE_PORT" --strictPort ) &
  web_pid=$!

  trap 'stop_all 0' INT TERM

  # 不用 wait -n：macOS 自带 bash 3.2 没有这个选项，轮询 1 秒两种 bash 都能跑
  while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
    sleep 1
  done

  code=0
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid" || code=$?
    log "后端已退出（exit=$code）"
  else
    wait "$web_pid" || code=$?
    log "前端已退出（exit=$code）"
  fi
  stop_all "$code"
}

run_prod() {
  # 是否要重新构建：dist 缺失 / 依赖变了（文件数变化算）/ 有源文件比上次构建的戳记新。
  # 只用 find -newer + 文件数，不用 -printf，宿主机上也能直接跑这段逻辑做验证。
  if [ "${SKIP_WEB_BUILD:-0}" != "1" ]; then
    src_count="$( { find "$WEB_DIR/src" "$WEB_DIR/public" -type f 2>/dev/null || true; } | wc -l | tr -d ' ')"
    build_stamp="$pkg_hash|$src_count"
    STAMP_FILE="$DIST_DIR/.build-stamp"

    need_build=0
    if [ "${FORCE_WEB_BUILD:-0}" = "1" ]; then need_build=1; fi
    if [ ! -f "$DIST_DIR/index.html" ]; then need_build=1; fi
    if [ ! -f "$STAMP_FILE" ]; then need_build=1; fi
    if [ "$need_build" = "0" ]; then
      changed="$(find "$WEB_DIR/src" "$WEB_DIR/public" "$WEB_DIR/index.html" "$WEB_DIR/vite.config.ts" \
                   -type f -newer "$STAMP_FILE" -print -quit 2>/dev/null || true)"
      if [ -n "$changed" ]; then need_build=1; fi
      if [ "$(cat "$STAMP_FILE" 2>/dev/null || true)" != "$build_stamp" ]; then need_build=1; fi
    fi

    if [ "$need_build" = "1" ]; then
      log "构建前端 → $DIST_DIR"
      npm --prefix "$WEB_DIR" run build -- --outDir "$DIST_DIR" --emptyOutDir \
        || die "前端构建失败，修好源码后重启容器即可重试"
      printf '%s\n' "$build_stamp" > "$STAMP_FILE"
      log "前端构建完成"
    else
      log "前端源码无变化，跳过构建"
    fi
  fi

  # SQLite 是单写者，多 worker 只会互相等锁；一个 worker 配多线程就够家里几台设备用了。
  # timeout 要给足：大模型生成题库是同步调用，慢的时候确实要一分多钟。
  log "生产模式：gunicorn 0.0.0.0:$PORT（workers=${GUNICORN_WORKERS:-1} threads=${GUNICORN_THREADS:-8}）"
  exec gunicorn \
    --chdir "$APP_DIR/api" \
    --bind "0.0.0.0:$PORT" \
    --worker-class gthread \
    --workers "${GUNICORN_WORKERS:-1}" \
    --threads "${GUNICORN_THREADS:-8}" \
    --timeout "${GUNICORN_TIMEOUT:-180}" \
    --graceful-timeout 20 \
    --access-logfile - \
    --error-logfile - \
    --log-level "${GUNICORN_LOG_LEVEL:-info}" \
    run:app
}

if [ "$APP_MODE" = "dev" ]; then
  run_dev
else
  run_prod
fi
