# SDNC 全栈镜像：前端静态资源 + Node 后端（单进程托管 API 与 SPA）
# 构建：docker compose build sdnc-console
# 运行：docker compose up -d

FROM node:20-bookworm-slim AS frontend-build
WORKDIR /build/frontend
RUN npm config set registry https://registry.npmmirror.com
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/patches ./patches
RUN npm ci
COPY frontend/ ./
ENV NODE_OPTIONS=--max-old-space-size=4096
ENV GENERATE_SOURCEMAP=false
ENV REACT_APP_PRODUCT_FLAVOR=sdnc
RUN npm run build

FROM node:20-bookworm-slim AS backend-build
WORKDIR /build/backend
# 国内 apt 镜像，避免 deb.debian.org 极慢/超时
RUN set -eux; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
  fi; \
  if [ -f /etc/apt/sources.list ]; then \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list; \
  fi
# sqlite3 等原生模块需要编译链（slim 默认没有）
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm config set registry https://registry.npmmirror.com
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /opt/sdnc

RUN set -eux; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
  fi; \
  if [ -f /etc/apt/sources.list ]; then \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list; \
  fi
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm config set registry https://registry.npmmirror.com
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=backend-build /build/backend/dist ./dist
COPY --from=frontend-build /build/frontend/build ./public

ENV NODE_ENV=production
ENV PORT=5001
ENV PRODUCT_FLAVOR=sdnc
ENV DB_PATH=/opt/sdnc/data/data.sqlite
ENV TOWER_AUTO_RESTART_ON_UPGRADE=false

EXPOSE 5001
VOLUME ["/opt/sdnc/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/index.js"]
