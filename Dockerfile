# syntax=docker/dockerfile:1.7
#
# LearnEveryday 运行时镜像：Python 3.12 + Node 22
#
# 设计原则（很重要，改之前先看）：
#   1. 源码不 COPY 进镜像。运行时把仓库目录挂到 /app，改代码 = 宿主机改文件，容器里立刻生效。
#   2. db.sqlite 也不进镜像。它跟着仓库目录一起被挂载，WAL 的 -wal / -shm 同目录，不能单独挂文件。
#   3. 镜像只负责运行时：Python 依赖、Node 运行时、（生产模式的）gunicorn。
#   4. 两种模式由 APP_MODE 切换，见 docker-entrypoint.sh：
#        dev （默认）Vite dev server 5173（HMR）+ run.py 5001（debug 自动重载），不构建
#        prod        vite build 到命名卷 + gunicorn 单端口 5001
#   5. 注意版本：Python 3.12（bcrypt / SQLAlchemy 轮子齐全），Node 22 LTS（Vite 5 官方支持范围）。

ARG PYTHON_VERSION=3.12
ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# Node 运行时来源：官方镜像，只取 node 二进制 + npm，不额外跑一层 node 容器
# ---------------------------------------------------------------------------
FROM docker.m.daocloud.io/library/node:${NODE_VERSION}-bookworm-slim AS node

# ---------------------------------------------------------------------------
# 运行镜像
# ---------------------------------------------------------------------------
FROM docker.m.daocloud.io/library/python:${PYTHON_VERSION}-slim-bookworm

# ---------------------------------------------------------------------------
# pip / npm 走国内镜像
#   - 构建时：pip install 读 PIP_INDEX_URL
#   - 启动时：entrypoint 里的 pip 补装 / npm ci 读这两个环境变量
# 想换回官方或换别家：--build-arg PIP_INDEX_URL=... NPM_REGISTRY=...（compose 里也有同名 args）
# ---------------------------------------------------------------------------
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG NPM_REGISTRY=https://registry.npmmirror.com

LABEL org.opencontainers.image.title="LearnEveryday" \
      org.opencontainers.image.description="每日学习打卡系统" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LANG=C.UTF-8 \
    TZ=Asia/Shanghai \
    APP_DIR=/app \
    STATE_DIR=/var/lib/learneveryday \
    PORT=5001 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

# tzdata：日志和「今天」的计算都按 Asia/Shanghai
# libstdc++6 / libatomic1 / zlib1g：从 node 镜像搬过来的二进制依赖这些，python slim 里未必齐
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata libstdc++6 libatomic1 zlib1g \
 && rm -rf /var/lib/apt/lists/*

# 从 node 阶段搬运行时；npm 的符号链接自己建，避免 COPY 跨阶段把链接搬坏
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version

# ---------------------------------------------------------------------------
# Python 依赖：只读 requirements.txt，不复制源码
# 顺便把 requirements 的指纹写进镜像，entrypoint 用它判断宿主机的依赖有没有变
# ---------------------------------------------------------------------------
COPY api/requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
 && python -m pip install --no-cache-dir -r /tmp/requirements.txt "gunicorn>=23,<24" \
 && mkdir -p /usr/local/etc \
 && sha256sum /tmp/requirements.txt | cut -d' ' -f1 > /usr/local/etc/learneveryday-requirements.sha256 \
 && rm -f /tmp/requirements.txt \
 && python -c "import flask, flask_sqlalchemy, bcrypt, jieba, pypinyin, gunicorn; print('python deps ok')"

# 挂载点先占好位：没挂载时也不会因为目录不存在直接炸
RUN mkdir -p "$STATE_DIR/web-dist" "$APP_DIR/api" "$APP_DIR/web" "$APP_DIR/backups" "$APP_DIR/uploads"

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

WORKDIR /app
EXPOSE 5001
# dev 模式的 Vite dev server（HMR）
EXPOSE 5173

# 首次启动要 npm ci + vite build，start-period 给足；探活用查库的接口，能顺带确认 SQLite 可用
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD python -c "import os,sys,urllib.request; p=os.environ.get('PORT','5001'); r=urllib.request.urlopen('http://127.0.0.1:'+p+'/api/v1/client/children',timeout=4); sys.exit(0 if r.getcode()==200 else 1)"

# 不带参数进入 = 走默认的 gunicorn；docker run ... bash 则只做依赖/构建准备后进 shell
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
