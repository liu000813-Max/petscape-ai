#!/usr/bin/env bash
# WP-2.5：从仓库根 .env 挑选 web/worker 运行需要的键，生成两份 env 文件
# 并 scp 到 ECS 的 /opt/petscape-compose/（compose.yml 已在同目录，见
# deploy/compose.yml）。DATABASE_URL 用 RDS 内网地址拼装（ECS 与 RDS
# 同 VPC，直连不走隧道）。不打印任何键值。
#
# 用法（本机执行，需要 tools/aliyun 同款 SSH 免密通道）：
#   ./deploy/provision-env.sh [ecs_host]
#
# 依赖：仓库根 .env 存在且含 ALIBABA_CLOUD_RDS_* 与
# ALIBABA_CLOUD_ACR_USERNAME/PASSWORD（ACR 开通后写入，见 WP-2.5 报告）。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
ECS_HOST="${1:-<ECS_PUBLIC_IP>}"
REMOTE_DIR="/opt/petscape-compose"

if [ ! -f "$ENV_FILE" ]; then
  echo "provision-env.sh: 找不到 $ENV_FILE" >&2
  exit 1
fi

get_key() {
  grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-
}

RDS_HOST=$(get_key ALIBABA_CLOUD_RDS_HOST)
RDS_PORT=$(get_key ALIBABA_CLOUD_RDS_PORT)
RDS_DB=$(get_key ALIBABA_CLOUD_RDS_DATABASE)
RDS_USER=$(get_key ALIBABA_CLOUD_RDS_USERNAME)
RDS_PASSWORD=$(get_key ALIBABA_CLOUD_RDS_PASSWORD)

if [ -z "$RDS_HOST" ] || [ -z "$RDS_PASSWORD" ]; then
  echo "provision-env.sh: .env 缺少 RDS 连接信息（内网地址/密码），中止" >&2
  exit 1
fi

DATABASE_URL="postgresql://${RDS_USER}:${RDS_PASSWORD}@${RDS_HOST}:${RDS_PORT}/${RDS_DB}?sslmode=require"

WEB_ENV_TMP="$(mktemp)"
WORKER_ENV_TMP="$(mktemp)"
trap 'rm -f "$WEB_ENV_TMP" "$WORKER_ENV_TMP"' EXIT

cat > "$WEB_ENV_TMP" <<EOF
NODE_ENV=production
DATABASE_URL=${DATABASE_URL}
WEB_DB_POOL_MAX=$(get_key WEB_DB_POOL_MAX)
ALIBABA_CLOUD_REGION=$(get_key ALIBABA_CLOUD_REGION)
ALIBABA_CLOUD_ACCESS_KEY_ID=$(get_key ALIBABA_CLOUD_ACCESS_KEY_ID)
ALIBABA_CLOUD_ACCESS_KEY_SECRET=$(get_key ALIBABA_CLOUD_ACCESS_KEY_SECRET)
ALIBABA_CLOUD_OSS_BUCKET=$(get_key ALIBABA_CLOUD_OSS_BUCKET)
ALIBABA_CLOUD_OSS_ENDPOINT=$(get_key ALIBABA_CLOUD_OSS_ENDPOINT)
ALIBABA_CLOUD_OSS_INTERNAL_ENDPOINT=$(get_key ALIBABA_CLOUD_OSS_INTERNAL_ENDPOINT)
EOF

cat > "$WORKER_ENV_TMP" <<EOF
NODE_ENV=production
DATABASE_URL=${DATABASE_URL}
WORKER_DB_POOL_MAX=$(get_key WORKER_DB_POOL_MAX)
ALIBABA_CLOUD_REGION=$(get_key ALIBABA_CLOUD_REGION)
ALIBABA_CLOUD_ACCESS_KEY_ID=$(get_key ALIBABA_CLOUD_ACCESS_KEY_ID)
ALIBABA_CLOUD_ACCESS_KEY_SECRET=$(get_key ALIBABA_CLOUD_ACCESS_KEY_SECRET)
ALIBABA_CLOUD_OSS_BUCKET=$(get_key ALIBABA_CLOUD_OSS_BUCKET)
ALIBABA_CLOUD_OSS_ENDPOINT=$(get_key ALIBABA_CLOUD_OSS_ENDPOINT)
ALIBABA_CLOUD_OSS_INTERNAL_ENDPOINT=$(get_key ALIBABA_CLOUD_OSS_INTERNAL_ENDPOINT)
FAL_KEY=$(get_key FAL_KEY)
MESHY_API_KEY=$(get_key MESHY_API_KEY)
TRIPO_API_KEY=$(get_key TRIPO_API_KEY)
TRIPO_API_KEY_2=$(get_key TRIPO_API_KEY_2)
UV_BIN=$(get_key UV_BIN)
PRUSASLICER_BIN=$(get_key PRUSASLICER_BIN)
EOF

ssh "root@${ECS_HOST}" "mkdir -p ${REMOTE_DIR}"
scp "$ROOT/deploy/compose.yml" "root@${ECS_HOST}:${REMOTE_DIR}/compose.yml"
scp "$WEB_ENV_TMP" "root@${ECS_HOST}:${REMOTE_DIR}/web.env"
scp "$WORKER_ENV_TMP" "root@${ECS_HOST}:${REMOTE_DIR}/worker.env"
ssh "root@${ECS_HOST}" "chmod 600 ${REMOTE_DIR}/web.env ${REMOTE_DIR}/worker.env"

echo "provision-env.sh: ${REMOTE_DIR}/{compose.yml,web.env,worker.env} 已就绪（权限 600，未打印任何键值）"
