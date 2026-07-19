#!/usr/bin/env bash
# Serialized ECS release primitive. The caller must hold the GitHub Actions
# production-deploy concurrency lane and must have verified this exact SHA is
# still main. Migrations always complete before application containers change.
set -euo pipefail

IMAGE_TAG="${1:-}"
ACR_REGISTRY="${2:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/petscape-compose}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
DOCKER_CONFIG_DIR="${DOCKER_CONFIG_DIR:-/root/.docker-acr}"

if [[ ! "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <exact-40-char-git-sha> <acr-registry>" >&2
  exit 2
fi
if [[ -z "$ACR_REGISTRY" ]]; then
  echo "usage: $0 <exact-40-char-git-sha> <acr-registry>" >&2
  exit 2
fi
if [[ ! -f "$REMOTE_DIR/web.env" || ! -f "$REMOTE_DIR/compose.yml" ]]; then
  echo "deploy.release failed: missing $REMOTE_DIR/web.env or compose.yml" >&2
  exit 1
fi

DEPLOY_ENV="$REMOTE_DIR/.deploy.env"
WORKER_IMAGE="$ACR_REGISTRY/petscape/worker:$IMAGE_TAG"
cleanup() {
  rm -f "$DEPLOY_ENV"
}
trap cleanup EXIT

printf 'ACR_REGISTRY=%s\nIMAGE_TAG=%s\n' "$ACR_REGISTRY" "$IMAGE_TAG" > "$DEPLOY_ENV"

echo "deploy.migrate start target=$IMAGE_TAG image=$WORKER_IMAGE"
"$DOCKER_BIN" --config "$DOCKER_CONFIG_DIR" pull "$WORKER_IMAGE"
"$DOCKER_BIN" run --rm --env-file "$REMOTE_DIR/web.env" \
  --entrypoint /bin/sh "$WORKER_IMAGE" -lc \
  'cd /workspace/packages/server && ./node_modules/.bin/prisma migrate deploy'
echo "deploy.migrate complete target=$IMAGE_TAG"

echo "deploy.switch start target=$IMAGE_TAG"
"$DOCKER_BIN" --config "$DOCKER_CONFIG_DIR" compose --env-file "$DEPLOY_ENV" pull web worker
"$DOCKER_BIN" --config "$DOCKER_CONFIG_DIR" compose --env-file "$DEPLOY_ENV" up -d web worker
echo "deploy.switch complete target=$IMAGE_TAG"
