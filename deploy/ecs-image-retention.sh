#!/usr/bin/env bash
# ECS 部署磁盘门禁与镜像保留策略。
# pre：发布前记录当前运行镜像作为唯一回滚版本，并要求至少 8 GiB 可用空间。
# post <tag>：等待目标 Web/Worker healthy 且 tag 正确，再删除除此二者和上一版本外
# 的 PetScape 镜像。任何验证失败都先退出，不触碰当前/上一版本。
set -euo pipefail

readonly REMOTE_DIR="/opt/petscape-compose"
readonly PREVIOUS_IDS_FILE="${REMOTE_DIR}/.previous-image-ids"
readonly MIN_FREE_KIB=$((8 * 1024 * 1024))
readonly WEB_CONTAINER="petscape-compose-web-1"
readonly WORKER_CONTAINER="petscape-compose-worker-1"

mode="${1:-}"

container_image_id() {
  docker inspect "$1" --format '{{.Image}}' | sed 's/^sha256://'
}

container_image_ref() {
  docker inspect "$1" --format '{{.Config.Image}}'
}

container_health() {
  docker inspect "$1" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'
}

case "$mode" in
  pre)
    web_id="$(container_image_id "$WEB_CONTAINER")"
    worker_id="$(container_image_id "$WORKER_CONTAINER")"
    # 上一次发布若已切到新容器但健康验证失败，post 会有意保留此文件。此时重跑
    # pre 不能把已知健康的旧版本覆盖成失败版本，否则会丢失安全回滚锚点。
    if [[ ! -s "$PREVIOUS_IDS_FILE" ]]; then
      printf '%s\n%s\n' "$web_id" "$worker_id" > "$PREVIOUS_IDS_FILE"
    fi

    available_kib="$(df -Pk / | awk 'NR == 2 { print $4 }')"
    printf 'deploy.preflight disk_available_kib=%s required_kib=%s\n' \
      "$available_kib" "$MIN_FREE_KIB"
    if (( available_kib < MIN_FREE_KIB )); then
      echo "deploy.preflight failed: ECS 根分区可用空间不足 8 GiB；保留当前/回滚镜像并停止发布。" >&2
      exit 1
    fi

    printf 'deploy.preflight previous_web=%s previous_worker=%s\n' \
      "$(container_image_ref "$WEB_CONTAINER")" "$(container_image_ref "$WORKER_CONTAINER")"
    ;;

  post)
    target_tag="${2:-}"
    if [[ -z "$target_tag" ]]; then
      echo "usage: $0 post <target-tag>" >&2
      exit 2
    fi
    if [[ ! -s "$PREVIOUS_IDS_FILE" ]]; then
      echo "deploy.post failed: 缺少 pre 阶段记录的上一版本镜像 ID。" >&2
      exit 1
    fi

    for _ in $(seq 1 60); do
      web_health="$(container_health "$WEB_CONTAINER" 2>/dev/null || true)"
      worker_health="$(container_health "$WORKER_CONTAINER" 2>/dev/null || true)"
      if [[ "$web_health" == "healthy" && "$worker_health" == "healthy" ]]; then
        break
      fi
      sleep 2
    done

    web_health="$(container_health "$WEB_CONTAINER")"
    worker_health="$(container_health "$WORKER_CONTAINER")"
    web_ref="$(container_image_ref "$WEB_CONTAINER")"
    worker_ref="$(container_image_ref "$WORKER_CONTAINER")"
    if [[ "$web_health" != "healthy" || "$worker_health" != "healthy" ]]; then
      printf 'deploy.post failed: web_health=%s worker_health=%s；保留当前与上一版本镜像。\n' \
        "$web_health" "$worker_health" >&2
      exit 1
    fi
    if [[ "$web_ref" != *":${target_tag}" || "$worker_ref" != *":${target_tag}" ]]; then
      printf 'deploy.post failed: target=%s web=%s worker=%s；不执行镜像清理。\n' \
        "$target_tag" "$web_ref" "$worker_ref" >&2
      exit 1
    fi
    curl --fail --silent --show-error http://127.0.0.1:3010/api/healthz
    echo

    current_web_id="$(container_image_id "$WEB_CONTAINER")"
    current_worker_id="$(container_image_id "$WORKER_CONTAINER")"
    mapfile -t previous_ids < "$PREVIOUS_IDS_FILE"
    keep_ids=("$current_web_id" "$current_worker_id" "${previous_ids[@]}")

    mapfile -t candidate_ids < <(
      docker image ls --no-trunc --format '{{.ID}} {{.Repository}}' \
        | awk '$2 ~ /\/petscape\/(web|worker)$/ { sub(/^sha256:/, "", $1); print $1 }' \
        | sort -u
    )

    for image_id in "${candidate_ids[@]}"; do
      keep=false
      for keep_id in "${keep_ids[@]}"; do
        if [[ "$image_id" == "$keep_id" ]]; then
          keep=true
          break
        fi
      done
      if [[ "$keep" == false ]]; then
        docker image rm "$image_id"
      fi
    done
    docker image prune --force
    rm -f "$PREVIOUS_IDS_FILE"

    printf 'deploy.post target=%s web_health=%s worker_health=%s\n' \
      "$target_tag" "$web_health" "$worker_health"
    df -h /
    docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}' \
      | awk '$1 ~ /\/petscape\/(web|worker):/'
    ;;

  *)
    echo "usage: $0 pre | post <target-tag>" >&2
    exit 2
    ;;
esac
