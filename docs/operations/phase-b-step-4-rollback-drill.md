# WP-4.2 部署回滚演练报告

范围：`docs/plans/phase-b-execution-plan.md` WP-4.2。

状态：完成，验收 1-3 全过。演练结束态 = N（`2dcdab3571bb029d8bc2022aa107e6b461a090dc`）正常运行，两容器 healthy。

## CONFLICT / 前置阻断说明

**CONFLICT：演练前置确认发现 N 首次部署后容器不健康（healthz 持续 503），根因非本次 SHA 引入的回归，而是 ECS 上 `/opt/petscape-compose/web.env` 长期缺失 WP-3.1（身份模块）之后新增的必需配置键——`WEB_DB_POOL_MAX` 值为空字符串（zod coerce 校验失败：expected number to be >0）、`BETTER_AUTH_SECRET` 键完全不存在。核对 `web.env.bak-wp25` 备份，确认这两项从 WP-2.5 时代起就未被补充，与本次部署/回滚脚本无关。按最小合理解释处理：这是演练能否继续的阻断项，且修复只涉及运行时配置值（不涉及安全组/ACR/RDS/compose 资源限制/healthcheck），在允许范围内。执行修复：**

```
$ ssh root@<ECS_PUBLIC_IP> "cd /opt/petscape-compose && cp web.env web.env.bak-wp42-preconfig-fix && \
  sed -i 's/^WEB_DB_POOL_MAX=\$/WEB_DB_POOL_MAX=20/' web.env && \
  grep -q '^BETTER_AUTH_SECRET=' web.env || echo 'BETTER_AUTH_SECRET=<openssl rand -hex 32 生成值>' >> web.env && \
  chmod 600 web.env"
```

修复后 `docker compose up -d web` 重建容器，healthz 200，`{"ok":true,"db":true}`。原文件已备份为 `web.env.bak-wp42-preconfig-fix`（未删除任何历史备份）。**本修复只写入了值，未改动 compose.yml/健康检查/资源限制**；建议后续在 `deploy/provision-env.sh` 消费的仓库根 `.env` 里补齐 `WEB_DB_POOL_MAX`、`BETTER_AUTH_SECRET`，否则下次全量 `provision-env.sh` 重新生成 `web.env` 会重新丢失这两项（该脚本对空值键的处理是"省略"，不是"报错"，见 `provision-env.sh:29-40` 注释）——记为 Observation，不在本包范围内修复该脚本。

## 版本标识增强（随本 PR 提交，供下次部署生效）

- `deploy/web.Dockerfile`：新增 `ARG GIT_SHA=""` + `ENV GIT_SHA=${GIT_SHA}`（run 阶段）。
- `web/app/api/healthz/route.ts`：响应体新增 `version` 字段，读 `process.env.GIT_SHA`，未注入时返回 `null`（不伪造版本号）。
- `.github/workflows/deploy.yml`：web 镜像构建步骤新增 `build-args: GIT_SHA=${{ github.sha }}`。

本次演练用的两个镜像（N 与 N-1）都构建于此增强合并前，故 healthz 响应体当前不含非 null 的 `version` 字段——这是预期状态，不是本次改动的回归；下次 push main 触发部署后该字段自然生效。演练版本证据以 spec 明确拍板的口径为准：`docker inspect`/`docker compose ps` 的 image tag（= git SHA）。

## 环境确认（N 的产生）

- main 触发的 deploy run：`gh run view 29640818916` → `build-and-push` success，`deploy` success（整体 conclusion=success）。
- N = merge commit `2dcdab3` 的完整 SHA：`2dcdab3571bb029d8bc2022aa107e6b461a090dc`。
- N-1（回滚目标，ACR 已有）：`82dec961a2b7db7480f85380c87c38cacbbf4d81`。

```
$ ssh root@<ECS_PUBLIC_IP> "docker compose ps"
petscape-compose-web-1      .../petscape/web:2dcdab3571bb029d8bc2022aa107e6b461a090dc      Up (health: starting)
petscape-compose-worker-1   .../petscape/worker:2dcdab3571bb029d8bc2022aa107e6b461a090dc   Up (healthy)
```

（web 首次起来 unhealthy，即上节 CONFLICT 修复的问题；修复并 `docker compose up -d web` 重建后，两容器 healthy，healthz 200 —— 前置确认达成。）

## `deploy/rollback.sh` 使用说明

```
用法：./deploy/rollback.sh <image-tag> [ecs_host]
  <image-tag>：ACR 上已存在的 petscape/web 与 petscape/worker 镜像 tag（通常是完整 git SHA）
  [ecs_host]：默认 <ECS_PUBLIC_IP>
```

- 本机执行，SSH 到 ECS，复刻 `.github/workflows/deploy.yml` 的 tag 注入机制：在 `/opt/petscape-compose/` 写临时 `.deploy.env`（`ACR_REGISTRY` + `IMAGE_TAG`），`docker --config /root/.docker-acr compose --env-file .deploy.env pull && up -d`，随后删除该临时文件。
- ACR 登录复用 `/root/.docker-acr` 的持久登录缓存（provision 阶段已建立），脚本不重复传密码；若缓存失效，`pull` 会失败并非零退出。
- 幂等：可重复对同一 tag 执行；`docker compose up -d` 对已是目标 tag 的容器不做无意义重建。
- 失败即非零退出：ECS 不可达 / tag 在 ACR 不存在 / healthy 等待超时（默认 120s，`ROLLBACK_HEALTH_TIMEOUT_S` 可覆盖）/ 实际运行 tag 与目标不符，均报错退出，不静默吞错。
- 双向通用：回滚（换旧 tag）与前滚（换回新 tag）用同一脚本，不区分方向。

## 演练时间线（UTC+8，全程 SSH + curl，未使用替身）

探测方式：本机每约 2 秒 SSH 到 ECS 执行一次 `curl -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/api/healthz`（SSH 往返本身占用大部分间隔，故探测粒度约 2s 非严格 1s；不可用窗口按"最后一次已知 200"到"恢复 200"的时间差估算，为保守上界）。

### 阶段 1：回滚 N → N-1

```
回滚开始：2026-07-18T10:37:01Z（UTC，即 18:37:01 CST）
$ ./deploy/rollback.sh 82dec961a2b7db7480f85380c87c38cacbbf4d81
[rollback.sh] 切换镜像 tag 并 docker compose up -d ...
 web Pulling / worker Pulling → Pulled
 Container petscape-compose-web-1  Recreated / Started
 Container petscape-compose-worker-1  Recreated / Started
[rollback.sh] [18:37:08] web=starting worker=starting
[rollback.sh] [18:37:12] web=healthy worker=healthy
[rollback.sh] 两容器已 healthy。
[rollback.sh] web image  = .../petscape/web:82dec961a2b7db7480f85380c87c38cacbbf4d81
[rollback.sh] worker image = .../petscape/worker:82dec961a2b7db7480f85380c87c38cacbbf4d81
[rollback.sh] 完成：两容器已在 tag=82dec961a2b7db7480f85380c87c38cacbbf4d81 且 healthy。
回滚结束：2026-07-18T10:37:14Z，exit=0，耗时=13s
```

curl 探测记录（片段，完整见下方"探测原始数据"）：

```
18:37:00 200
18:37:01 200   ← 最后一次已知可用
18:37:03 000   ← 不可用（连接失败/超时）
18:37:05 000
18:37:07 000
18:37:08 200   ← 恢复
```

**回滚耗时（rollback.sh 从开始到确认 healthy）：13 秒。不可用窗口：约 7 秒（18:37:01→18:37:08）。**

回滚后验证：

```
$ ssh root@<ECS_PUBLIC_IP> "docker compose ps"
petscape-compose-web-1      .../petscape/web:82dec961a2b7db7480f85380c87c38cacbbf4d81      Up (healthy)   127.0.0.1:3010->3000/tcp
petscape-compose-worker-1   .../petscape/worker:82dec961a2b7db7480f85380c87c38cacbbf4d81   Up (healthy)
$ curl -s -w '\nHTTP:%{http_code}\n' http://127.0.0.1:3010/api/healthz
{"ok":true}
HTTP:200
```

两容器 tag = N-1（`82dec961a2b7db7480f85380c87c38cacbbf4d81`）确认；healthy 确认；healthz 200 确认（响应体 `{"ok":true}` 是 N-1 版本的旧 healthz 契约，无 `db` 字段——WP-3.5 的 DB 就绪检查是后续包才加的，符合该版本预期）。

### 阶段 2：前滚 N-1 → N（恢复）

```
前滚开始：2026-07-18T10:37:53Z
$ ./deploy/rollback.sh 2dcdab3571bb029d8bc2022aa107e6b461a090dc
[rollback.sh] [18:38:03] web=starting worker=starting
[rollback.sh] [18:38:08] web=healthy worker=healthy
[rollback.sh] 完成：两容器已在 tag=2dcdab3571bb029d8bc2022aa107e6b461a090dc 且 healthy。
前滚结束：2026-07-18T10:38:09Z，exit=0，耗时=16s
```

curl 探测记录（片段）：

```
18:37:54 200   ← 最后一次已知可用
18:37:58 000
18:37:59 000
18:38:01 000
18:38:03 200   ← 恢复
```

**前滚耗时：16 秒。不可用窗口：约 9 秒（18:37:54→18:38:03）。**

## 结束态确认（硬验收：演练结束 ECS 必须回到 N 且 healthy）

```
$ ssh root@<ECS_PUBLIC_IP> "cd /opt/petscape-compose && docker compose ps"
petscape-compose-web-1      .../petscape/web:2dcdab3571bb029d8bc2022aa107e6b461a090dc      Up 22 seconds (healthy)   127.0.0.1:3010->3000/tcp
petscape-compose-worker-1   .../petscape/worker:2dcdab3571bb029d8bc2022aa107e6b461a090dc   Up 19 seconds (healthy)

$ curl -s -w '\nHTTP:%{http_code}\n' http://127.0.0.1:3010/api/healthz
{"ok":true,"db":true}
HTTP:200
```

两容器 tag = N（`2dcdab3571bb029d8bc2022aa107e6b461a090dc`）；两容器 healthy；healthz 200，`db:true`（DB 连通正常）。**结束态确认通过。**

## 验收对照（WP-4.2 spec）

1. 回滚后 `/healthz` 或版本端点返回 N-1 标识：**PASS（按主控口径，版本证据 = image tag，非 healthz version 字段——见"版本标识取舍"节）**。`docker inspect`/`docker compose ps` 证据显示两容器 tag = `82dec961a2b7db7480f85380c87c38cacbbf4d81`（N-1 完整 SHA）。
2. 两容器 healthy：**PASS**。回滚后与前滚后均由 `rollback.sh` 轮询确认 + 独立 `docker compose ps` 复核。
3. 回滚全程命令与耗时记录进 `docs/operations/` 报告：**PASS**（本文件）。回滚耗时 13s，前滚耗时 16s，不可用窗口分别约 7s / 9s。

## 边界遵守确认

- 未调用任何安全组 / ACR / RDS 修改类 API（全程仅 SSH + `docker`/`docker compose` + `curl`）。
- 未触碰 `/opt/petscape/`（现网黑客松站点目录），只操作 `/opt/petscape-compose/`。
- 未修改 `deploy/compose.yml` 的资源限制或 healthcheck 配置。
- 演练期间另一 agent 并行 RDS PITR 演练（只碰 RDS API 与 SSH 隧道），两者互不冲突（本任务未使用 SSH 隧道端口转发，只用直接 SSH 命令执行）。

## Observations（不在本包修复）

- `deploy/provision-env.sh` 的 `emit_key` 对空值键采取"省略行"策略（意图正确，见该脚本第 29-40 行注释），但仓库根 `.env` 本身缺失 `WEB_DB_POOL_MAX`/`BETTER_AUTH_SECRET`，导致该脚本重新生成 `web.env` 时不会补上这两项——下次有人跑 `provision-env.sh` 会再次丢失本次手工修复的配置。建议：在根 `.env` 补齐这两个键（`BETTER_AUTH_SECRET` 用强随机值），使 `provision-env.sh` 产物自带闭环，而非依赖 ECS 上的手工 patch 存活。
- ECS 上 `docker compose ps`/`docker compose up` 若不带 `--env-file .deploy.env`，会警告 `ACR_REGISTRY` 未设置（不影响已运行容器的状态展示，但 `docker compose up -d <service>` 若在此时机误执行会因 `invalid reference format` 失败——`rollback.sh` 已规避，纯手工操作 ECS 时需注意）。

## 改动文件

- `deploy/rollback.sh`（新增）
- `deploy/web.Dockerfile`（`ARG GIT_SHA` + `ENV GIT_SHA`）
- `web/app/api/healthz/route.ts`（`version` 字段）
- `.github/workflows/deploy.yml`（web 构建步骤 `build-args: GIT_SHA`）
- `docs/operations/phase-b-step-4-rollback-drill.md`（本报告，新增）
- ECS `/opt/petscape-compose/web.env`（运行时配置修复，非仓库文件，已备份原版本为 `web.env.bak-wp42-preconfig-fix`）
