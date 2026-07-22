#!/usr/bin/env bash
# WP-2.5：从仓库根 .env 挑选 web/worker 运行需要的键，生成两份 env 文件
# 并 scp 到 ECS 的 /opt/petscape-compose/（compose.yml 已在同目录，见
# deploy/compose.yml）。DATABASE_URL 用 RDS 内网地址拼装（ECS 与 RDS
# 同 VPC，直连不走隧道）。不打印任何键值。
#
# 用法（本机执行，需要 tools/aliyun 同款 SSH 免密通道）：
#   ./deploy/provision-env.sh <ecs_host>
#
# 依赖：仓库根 .env 存在且含 ALIBABA_CLOUD_RDS_* 与
# ALIBABA_CLOUD_ACR_USERNAME/PASSWORD（ACR 开通后写入，见 WP-2.5 报告）。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
ECS_HOST="${1:-}"
REMOTE_DIR="/opt/petscape-compose"

if [ -z "$ECS_HOST" ]; then
  echo "用法：$0 <ecs_host>" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "provision-env.sh: 找不到 $ENV_FILE" >&2
  exit 1
fi

get_key() {
  grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-
}

# 仅当值非空时输出 `KEY=VALUE` 行；值为空则完全省略该行。
# 原因（WP-2.5 ECS 实测踩坑）：env_file 里写 `KEY=`（空字符串）会以空串**覆盖**
# packages/server config schema 的 .default()/.optional()，触发校验失败
# （WORKER_DB_POOL_MAX 期望 >0、UV_BIN/PRUSASLICER_BIN 期望非空）。省略行 =
# 恢复"未设置"语义，让 schema 默认/可选生效。必填键（如 BETTER_AUTH_SECRET）
# 若缺失应由 schema 直接拒绝启动，不在此静默兜底。
emit_key() {
  local val
  val="$(get_key "$1")"
  [ -n "$val" ] && printf '%s=%s\n' "$1" "$val"
  return 0
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

# sslmode=disable：WP-2.5 ECS 实测该 RDS PostgreSQL 实例未启用 SSL
# （pg 探针：no-ssl 连接 OK；ssl 报 "server does not support SSL connections"），
# sslmode=require 会强制 TLS 握手并失败（P1011 TlsConnectionError）。ECS↔RDS
# 走同 VPC 内网私网（172.30.x.x），不经公网。如后续在 RDS 控制台开启 SSL，
# 再改回 require 并下发 CA。
DATABASE_URL="postgresql://${RDS_USER}:${RDS_PASSWORD}@${RDS_HOST}:${RDS_PORT}/${RDS_DB}?sslmode=disable"

WEB_ENV_TMP="$(mktemp)"
WORKER_ENV_TMP="$(mktemp)"
trap 'rm -f "$WEB_ENV_TMP" "$WORKER_ENV_TMP"' EXIT

# 必填/固定行直接写；optional 键用 emit_key（空则省略行，见上方注释）。
{
  printf 'NODE_ENV=production\n'
  printf 'DATABASE_URL=%s\n' "${DATABASE_URL}"
  emit_key WEB_DB_POOL_MAX
  emit_key ALIBABA_CLOUD_REGION
  emit_key ALIBABA_CLOUD_ACCESS_KEY_ID
  emit_key ALIBABA_CLOUD_ACCESS_KEY_SECRET
  emit_key ALIBABA_CLOUD_OSS_BUCKET
  emit_key ALIBABA_CLOUD_OSS_ENDPOINT
  emit_key ALIBABA_CLOUD_OSS_INTERNAL_ENDPOINT
} > "$WEB_ENV_TMP"

{
  printf 'NODE_ENV=production\n'
  printf 'DATABASE_URL=%s\n' "${DATABASE_URL}"
  emit_key WORKER_DB_POOL_MAX
  emit_key ALIBABA_CLOUD_REGION
  emit_key ALIBABA_CLOUD_ACCESS_KEY_ID
  emit_key ALIBABA_CLOUD_ACCESS_KEY_SECRET
  emit_key ALIBABA_CLOUD_OSS_BUCKET
  emit_key ALIBABA_CLOUD_OSS_ENDPOINT
  emit_key ALIBABA_CLOUD_OSS_INTERNAL_ENDPOINT
  emit_key FAL_KEY
  emit_key MESHY_API_KEY
  emit_key TRIPO_API_KEY
  emit_key TRIPO_API_KEY_2
  emit_key UV_BIN
  emit_key PRUSASLICER_BIN
  emit_key MESH_ANALYZER_PYTHON_BIN
  emit_key WORKER_JOB_TYPES
  emit_key WORKER_POLL_INTERVAL_MS
  emit_key WORKER_LEASE_SECONDS
  emit_key WORKER_RECOVER_ORPHANS_INTERVAL_MS
} > "$WORKER_ENV_TMP"

ssh "root@${ECS_HOST}" "mkdir -p ${REMOTE_DIR}"
scp "$ROOT/deploy/compose.yml" "root@${ECS_HOST}:${REMOTE_DIR}/compose.yml"
scp "$WEB_ENV_TMP" "root@${ECS_HOST}:${REMOTE_DIR}/web.env"
scp "$WORKER_ENV_TMP" "root@${ECS_HOST}:${REMOTE_DIR}/worker.env"
ssh "root@${ECS_HOST}" "chmod 600 ${REMOTE_DIR}/web.env ${REMOTE_DIR}/worker.env"

echo "provision-env.sh: ${REMOTE_DIR}/{compose.yml,web.env,worker.env} 已就绪（权限 600，未打印任何键值）"
