#!/usr/bin/env bash
# WP-4.2：部署回滚脚本。
#
# 用法（本机执行）：
#   ACR_REGISTRY_VPC=<registry> ./deploy/rollback.sh <image-tag> <ecs_host>
#
# <image-tag> 是 git SHA（完整或短均可，只要 ACR 上存在对应 tag 的
# petscape/web 与 petscape/worker 镜像）。脚本 SSH 到 ECS，复刻
# `.github/workflows/deploy.yml` 的 tag 注入机制（同一目录
# `/opt/petscape-compose/`、同一 `.deploy.env` 临时文件模式、同一
# `docker --config /root/.docker-acr` 登录缓存），把两个服务换到指定 tag，
# 等待两容器 healthy 后退出。
#
# 用途：既可用于回滚（换到旧 tag，如 N-1），也可用于前滚（换回 N）——
# 脚本本身不区分方向，只做"把 compose 服务切到给定 tag 并验证 healthy"。
#
# 幂等性：可重复对同一 tag 执行，docker compose up -d 对已是目标 tag 的
# 容器不做无意义重建（若镜像内容不变）。
#
# 失败退出：ECS 不可达 / tag 在 ACR 上不存在 / healthy 等待超时，均以
# 非零退出码结束，不静默吞错。

set -euo pipefail

IMAGE_TAG="${1:-}"
ECS_HOST="${2:-}"
REMOTE_DIR="/opt/petscape-compose"
SSH_KEY="${ROLLBACK_SSH_KEY:-$HOME/.ssh/petscape-deploy}"
ACR_REGISTRY_VPC="${ACR_REGISTRY_VPC:-}"
HEALTH_TIMEOUT_S="${ROLLBACK_HEALTH_TIMEOUT_S:-120}"
HEALTH_POLL_INTERVAL_S=3

if [ -z "$IMAGE_TAG" ] || [ -z "$ECS_HOST" ] || [ -z "$ACR_REGISTRY_VPC" ]; then
  echo "用法：ACR_REGISTRY_VPC=<registry> $0 <image-tag> <ecs_host>" >&2
  echo "  <image-tag>：ACR 上已存在的 petscape/web 与 petscape/worker 镜像 tag（通常是 git SHA）" >&2
  exit 1
fi

ssh_exec() {
  ssh -o IdentitiesOnly=yes -o ConnectTimeout=10 -i "$SSH_KEY" "root@${ECS_HOST}" "$@"
}

echo "[rollback.sh] 目标 tag：${IMAGE_TAG}"
echo "[rollback.sh] ECS：${ECS_HOST}，部署目录：${REMOTE_DIR}"

# 1. 切换 tag：写临时 .deploy.env（同 CI 机制），compose up -d 换容器。
#    ACR 登录复用 /root/.docker-acr 的持久缓存（provision 阶段已建立），
#    不在本脚本重复传密码；如缓存失效，pull 会失败并非零退出，需重新
#    `docker --config /root/.docker-acr login` 一次（不属于本脚本职责）。
echo "[rollback.sh] 切换镜像 tag 并 docker compose up -d ..."
ssh_exec "set -e
  cd '${REMOTE_DIR}'
  printf 'ACR_REGISTRY=%s\nIMAGE_TAG=%s\n' '${ACR_REGISTRY_VPC}' '${IMAGE_TAG}' > .deploy.env
  docker --config /root/.docker-acr compose --env-file .deploy.env pull
  docker --config /root/.docker-acr compose --env-file .deploy.env up -d
  rm -f .deploy.env
"

# 2. 等待两容器 healthy（轮询 docker inspect Health.Status）。
echo "[rollback.sh] 等待两容器 healthy（超时 ${HEALTH_TIMEOUT_S}s）..."
elapsed=0
while [ "$elapsed" -lt "$HEALTH_TIMEOUT_S" ]; do
  web_health="$(ssh_exec "docker inspect petscape-compose-web-1 --format '{{.State.Health.Status}}' 2>/dev/null" || echo "unknown")"
  worker_health="$(ssh_exec "docker inspect petscape-compose-worker-1 --format '{{.State.Health.Status}}' 2>/dev/null" || echo "unknown")"
  echo "[rollback.sh] [$(date +%H:%M:%S)] web=${web_health} worker=${worker_health}"
  if [ "$web_health" = "healthy" ] && [ "$worker_health" = "healthy" ]; then
    echo "[rollback.sh] 两容器已 healthy。"
    break
  fi
  sleep "$HEALTH_POLL_INTERVAL_S"
  elapsed=$((elapsed + HEALTH_POLL_INTERVAL_S))
done

if [ "$web_health" != "healthy" ] || [ "$worker_health" != "healthy" ]; then
  echo "[rollback.sh] 失败：等待 healthy 超时（web=${web_health}, worker=${worker_health}）" >&2
  exit 1
fi

# 3. 校验实际运行 tag 与目标一致（防止 pull 失败但 up -d 复用旧容器的假阳性）。
web_image="$(ssh_exec "docker inspect petscape-compose-web-1 --format '{{.Config.Image}}'")"
worker_image="$(ssh_exec "docker inspect petscape-compose-worker-1 --format '{{.Config.Image}}'")"
echo "[rollback.sh] web image  = ${web_image}"
echo "[rollback.sh] worker image = ${worker_image}"

case "$web_image" in
  *":${IMAGE_TAG}") ;;
  *)
    echo "[rollback.sh] 失败：web 容器 tag 与目标不符（期望 ${IMAGE_TAG}）" >&2
    exit 1
    ;;
esac
case "$worker_image" in
  *":${IMAGE_TAG}") ;;
  *)
    echo "[rollback.sh] 失败：worker 容器 tag 与目标不符（期望 ${IMAGE_TAG}）" >&2
    exit 1
    ;;
esac

echo "[rollback.sh] 完成：两容器已在 tag=${IMAGE_TAG} 且 healthy。"
