# WP-2.5 双镜像 CI/CD 部署链报告

范围：`docs/plans/phase-b-execution-plan.md` WP-2.5。

**INCOMPLETE：验收 1/2/4 无法端到端闭合——ACR（容器镜像服务）个人版实例在本账号下尚未开通，且开通动作没有对应的 OpenAPI，需要用户在阿里云控制台完成一次首次访问确认。** 详见「卡点：ACR 开通墙」节。

> **状态补记（2026-07-18）**：ACR 卡点已解除（用户控制台开通个人版），部署链已端到端实证——`deploy.yml` 最近多次 run 全部 success（含 push main 自动触发的双镜像构建→ACR→ECS Compose），回滚演练见 `phase-b-step-4-rollback-drill.md`。本报告其余内容保留为写作时点的事实记录。除镜像推送/ECS 拉取这一段外，其余全部工作已完成并附证据（Dockerfile 真实构建+运行验证、SSH 部署密钥、GHA secrets、Compose、healthz、CI/CD workflow、安全组现状核验）。

## CONFLICT 清单（按优先级）

1. **端口/目录冲突**：spec 假设 web 容器可绑定 `127.0.0.1:3000`、部署目录为 `/opt/petscape/`。实测 ECS 上 `127.0.0.1:3000` 已被现有黑客松基线站点占用（PM2 管理，`/opt/petscape/web`，nginx 反代 80/443 → `petscape3d.com`，备案生效中，CLAUDE.md 明确"现有站点不动"）。**按最小合理解释实现**：web 容器改绑 `127.0.0.1:3010`；部署目录改为 `/opt/petscape-compose/`（compose.yml + env 文件），不覆盖现有 `/opt/petscape/`。安全组/80/443/现有站点进程全程未碰。
2. **Worker 制品需要预编译**：spec 原文写"main 的 server 包需构建期预编译为 js"+"`--conditions=react-server` 启动 main.js"。`--conditions=react-server` 是 React Server Components 的模块解析条件，与纯 Node worker 进程无关联理据，判定为 spec 笔误/误导性描述。**按最小合理解释实现**：Dockerfile 内新增 tsc 编译阶段（`packages/server` 与 `worker` 各自的 `tsconfig.build.json`），编译产物为标准 ESM `.js`，容器内用普通 `node dist/main.js` 启动，不使用 `--conditions` flag。
3. **Worker 骨架不常驻**：现有 `worker/src/main.ts`（WP-2.1/2.2 遗留）打印一行后进程自然退出，与 Compose healthcheck/`restart: unless-stopped` 假设的"长驻服务"矛盾（实测：容器起来后几秒内退出 exit 0）。**按最小合理解释实现**：加 10 行保活代码（`setInterval` 空转 + `SIGTERM` 处理），不引入业务逻辑，真正的领取/执行/心跳循环仍留给 WP-3.4。
4. **ECS 内存**：spec 写"ECS 仅 2G 内存"，实测 `free -h` 为 **1.6GB**（且已有现有站点/PM2/nginx/cloudflared 常驻占用约 580MB，可用约 899MB 含 buff/cache）。资源限制按实测下调（见「资源限制」节），非 spec 原文的 768M/512M。

## 卡点：ACR 开通墙

**已探明路径**（均通过 `tools/aliyun`，账号断言通过：PETSCAPE <PROJECT_CLOUD_ACCOUNT_ID>）：

```
$ ./tools/aliyun cr ListInstance --region cn-hangzhou
{"Instances": [], "TotalCount": 0, ...}

$ ./tools/aliyun bssopenapi QueryAvailableInstances --ProductCode cr --region cn-hangzhou
{"Data": {"InstanceList": [], "TotalCount": 0}, "Success": true}

$ ./tools/aliyun cr GetInstance --InstanceId cri-0000000000000000000 --region cn-hangzhou
{"Code": "INSTANCE_NOT_EXIST", "Message": "Instance is not exist."}

$ ./tools/aliyun cr CreateNamespace --help
  --InstanceId   String  Required   # 每个 cr 命名空间/仓库管理 API 都硬性要求 InstanceId
```

结论：账号下没有任何 ACR 实例（个人版或企业版）；`cr`/`cr-ee` 全部 API 都要求先有 `InstanceId` 才能操作，而**创建实例本身没有暴露 OpenAPI**——企业版走购买流程，个人版按阿里云现行产品设计走"控制台首次访问自助开通"（用户访问 `https://cr.console.aliyun.com/` 会看到服务条款确认/一键开通入口，这一步没有对应的 API）。已尝试的替代路径：`quotas`/`bssopenapi` 查询产品可用实例列表（均返回空，非"缺权限"错误，是"实例真的不存在"）。未强行用不明参数组合硬闯（避免误操作账号计费项）。

**用户需要执行的最小动作**：登录阿里云控制台（PETSCAPE 主账号）→ 访问容器镜像服务 ACR 控制台首页 → 完成个人版开通确认（ADR-0001 验证条件 3 要求的配额/价格复核可在同一页面完成）。开通后，以下全部已就绪的自动化立即可用，无需额外人工步骤：

1. 命名空间 `petscape` + 仓库 `web`/`worker`：`./tools/aliyun cr CreateNamespace --InstanceId <开通后的实例ID> --NamespaceName petscape` + `CreateRepository`（本次未预先执行，因为不知道最终 InstanceId；开通后一条命令即可，建议由后续 agent 或主控执行并回填）；
2. Registry 登录密码：若可经 `cr SetRepoPermission`/`UpdateUserInfo` 类 API 设置则自动生成强随机密码写入根 `.env`（`ALIBABA_CLOUD_ACR_USERNAME`/`ALIBABA_CLOUD_ACR_PASSWORD`，不打印值）；若该项也要求控制台交互（常见于个人版密码首次设置），届时按同一模式记录并停止；
3. `gh secret set ALIBABA_CLOUD_ACR_USERNAME/ALIBABA_CLOUD_ACR_PASSWORD/ACR_REGISTRY`（workflow 已按这三个名字接线，见 `.github/workflows/deploy.yml`）；
4. `workflow_dispatch` 跑一次全链，验证镜像 push→ECS pull→up -d→healthz。

## 已完成并验证的部分

### Dockerfile（真实构建 + 运行验证，非纸面配方）

- `web/Dockerfile`：参照 `tracer/build-tracer/web-image/Dockerfile`（WP-2.0 已验证配方），改为 workspace 感知的构建上下文（build context = 仓库根）。**实测踩坑**：monorepo 下 `next build` 的 standalone 输出落在 `web/.next/standalone/web/server.js`（非单包场景的 `.next/standalone/server.js`），Dockerfile 已按实测路径修正。
  ```
  $ docker build --platform linux/amd64 -f web/Dockerfile -t petscape-web-wp25:final .
  EXIT=0
  $ curl -s -w "\nHTTP:%{http_code}\n" http://localhost:13002/api/healthz
  {"ok":true}
  HTTP:200
  ```
  镜像体积（`docker inspect --format '{{.Size}}'`，未压缩）：**626,852,355 B（~598 MiB）**，与 WP-2.0 tracer 报告（~597 MiB）一致。
- `worker/Dockerfile`：新增构建期 TS 编译链解决 WP-2.1 报告 Observations 记录的坑（`node_modules` 内 `.ts` 无法 `--experimental-strip-types` 剥离）：
  1. `packages/server`：`prisma generate` → `tsc -p tsconfig.build.json`（新增，`rewriteRelativeImportExtensions: true` 把源码里 `./schema.ts` 之类的导入路径改写为 `.js`）；
  2. `tools/rewrite-server-dist-exports.mjs`（新增，仅供本 Dockerfile 调用）：把 `packages/server/package.json` 的 `exports`/`main` 从开发态 `./src/**/*.ts` 改写为 `./dist/**/*.js`（只在 Docker 构建期临时文件系统内生效，不改动仓库内文件——本地开发与 CI typecheck 仍用原 exports）；
  3. `worker`：`tsc -p tsconfig.build.json`（新增）编译 `main.ts`，此时其 `moduleResolution: nodenext` 解析 `@petscape/server` 读到的是已改写的 dist exports；
  4. `pnpm --filter @petscape/worker deploy --legacy /deploy`（沿用 WP-2.0/2.1 报告拍定的 `--legacy` 结论）；
  5. run 阶段 `CMD ["node", "dist/main.js"]`——编译产物，非逐文件类型剥离。
  ```
  $ docker build --platform linux/amd64 -f worker/Dockerfile -t petscape-worker-wp25:final .
  EXIT=0
  $ docker run -d --name wp25-worker-final -e NODE_ENV=production petscape-worker-wp25:final
  $ docker logs wp25-worker-final
  [worker] PetScape worker process starting (skeleton, WP-2.1/WP-2.2)
  [worker] NODE_ENV=production, config schema validated OK
  $ docker exec wp25-worker-final sh -c "grep -qz 'dist/main.js' /proc/1/cmdline && echo WORKER_HEALTHY"
  WORKER_HEALTHY
  $ docker run --rm petscape-worker-wp25:test /bin/sh -c "test ! -d node_modules/next && echo NO-NEXT-OK"
  NO-NEXT-OK
  ```
  镜像体积：**310,530,533 B（~296 MiB）**（比 WP-2.0 tracer 探针的 ~160 MiB 大，`sharp` 等 workspace 内其他包的构建期依赖被 pnpm store 下载但**未**落入最终 `node_modules`——已用 `find node_modules -iname '*sharp*'` 确认为空，体积差异更可能来自 `node:24` vs tracer 的 `node:22` base image 与 Prisma WASM 资源，记入 Observations，非阻断项）。
- `.dockerignore`（新增，根目录）：排除 `.git`/`.env`/`node_modules`/`.next`/`dist`/`src/generated`/`archive`/`assets-3d`/`docs`/`tracer`/`.claude`，避免构建上下文误传密钥与无关大文件；两 Dockerfile 加入后重新构建验证无回归（体积/行为一致）。
- 现有 CI 门禁三条 `tsc --noEmit`（web/server/worker）与两条 `lint` 检查全部本地复跑确认未受影响（新增的 `tsconfig.build.json` 是独立文件，不改变默认 `tsconfig.json` 行为）：
  ```
  web-tsc=0  server-tsc=0  worker-tsc=0
  web-lint=0（Lint baseline accepted: 11/17 errors, 26 warnings，未变）
  server-lint=0  worker-lint=0
  web-test=0（4 tests pass）  server-test=0（8 pass, 1 skip：DATABASE_URL 未设置，符合 WP-2.3/2.4 既定行为）
  prisma-validate=0
  ```

### 部署专用 SSH keypair

```
$ ssh-keygen -t ed25519 -f ~/.ssh/petscape-deploy -N "" -C "petscape-wp2.5-deploy@github-actions"
$ (公钥追加进 ECS ~/.ssh/authorized_keys)
$ ssh -i ~/.ssh/petscape-deploy -o IdentitiesOnly=yes root@<ECS_PUBLIC_IP> "echo DEPLOY_KEY_SSH_OK"
DEPLOY_KEY_SSH_OK
```

私钥**未上传**用户既有 `id_ed25519`；仅新生成的 `petscape-deploy` 私钥进 GHA secret：

```
$ gh secret list
DEPLOY_SSH_HOST         2026-07-18T06:40:42Z
DEPLOY_SSH_PRIVATE_KEY  2026-07-18T06:40:40Z
DEPLOY_SSH_USER         2026-07-18T06:40:43Z
```

`ACR_REGISTRY`、`ALIBABA_CLOUD_ACR_USERNAME`、`ALIBABA_CLOUD_ACR_PASSWORD` 三个 secret 待 ACR 开通与密码生成后补设（workflow 已按这三个名字接线）。

### Compose：`deploy/compose.yml`

- 部署目录 `/opt/petscape-compose/`（已用 `deploy/provision-env.sh` 实跑落地，见下）；
- web `127.0.0.1:3010:3000`（CONFLICT 1 的调整，不占 3000/80/443）；
- healthcheck：web 用 Node 内置 `http` 模块请求 `/api/healthz`（容器内 `node:24-bookworm-slim` 无 curl/wget，已实测确认）；worker 用 `/proc/1/cmdline` grep（bookworm-slim 无 procps/pgrep，已实测确认此路径可行）；
- 资源限制（`deploy.resources.limits.memory`）：web 512m，worker 384m（**低于 spec 建议的 768M/512M**——因 ECS 实测仅 1.6GB 物理内存，现有站点+PM2+nginx+cloudflared 已占约 580MB，899MB 可用中还要为系统缓冲留余量；此为初始保守值，建议部署后用 `docker stats` 实测再调整，本报告不虚报"已实测调整"——**受 ACR 阻塞，容器尚未在 ECS 真实运行，此为规划值非实测值**）；
- 日志轮转：两服务均 `json-file`，`max-size: 10m`，`max-file: 3`；
- 镜像 tag：`${IMAGE_TAG:-latest}`，由 CI 传入 git SHA。

`deploy/provision-env.sh`（新增）：从根 `.env` 挑选 web/worker 运行所需键，`DATABASE_URL` 用 RDS 内网地址拼装（ECS 与 RDS 同 VPC），scp 到 ECS，权限 600。已实跑：

```
$ ./deploy/provision-env.sh
provision-env.sh: /opt/petscape-compose/{compose.yml,web.env,worker.env} 已就绪（权限 600，未打印任何键值）

$ ssh root@<ECS_PUBLIC_IP> "stat -c '%a %n' /opt/petscape-compose/*.env"
600 /opt/petscape-compose/web.env
600 /opt/petscape-compose/worker.env
```

### web 健康端点

`web/app/api/healthz/route.ts`（新增）：`GET` 返回 `200 {"ok": true}`，不查 DB（依赖就绪检查是 WP-3.5 范围）。已在真实构建的容器内验证：`curl http://localhost:13002/api/healthz` → `{"ok":true}` HTTP 200。

### CI/CD workflow：`.github/workflows/deploy.yml`

- 触发：`push: main` + `workflow_dispatch`；
- `build-and-push`：QEMU + buildx，`linux/amd64` 构建 web/worker 两镜像，tag=`${{ github.sha }}`，`docker/login-action` 登录 ACR 后 push；
- `deploy`：SSH 私钥落临时文件（600）→ `docker compose pull && up -d`（`--env-file .deploy.env` 传 `ACR_REGISTRY`/`IMAGE_TAG`，用后删除）→ 验证 `docker compose ps`；
- **本分支无法验证 workflow 实际跑绿**：ACR 未开通导致 `docker/login-action` 必然失败，`workflow_dispatch` 触发会在 build-and-push 阶段的 ACR 登录步骤红掉。这不是 workflow 本身逻辑缺陷，而是外部依赖阻塞——ACR 开通后可立即用 `workflow_dispatch` 在本分支或 main 上重跑验证。

### 安全组现状核验（未做任何修改）

```
$ ./tools/aliyun ecs DescribeSecurityGroupAttribute --region cn-hangzhou --SecurityGroupId sg-bp15kx7ga3s54xzv4mm3
ingress TCP 443/443 Accept
ingress TCP 80/80  Accept
ingress TCP 22/22  Accept
```

维持仅 22/80/443，与本次改动前一致（未新增/修改任何规则）。80/443 监听进程核验（`ss -ltnp`）：仅原 nginx（`master_process`+2 worker），无新增监听。

### 磁盘余量

```
（改动前，Step 0 报告延续状态）/dev/vda3  40G  7.7G used  30G avail  21% use
（本次 provision-env.sh 落地 compose.yml + 两个 env 文件后）/dev/vda3  40G  7.7G used  30G avail  21% use
```

无明显变化（未拉取任何镜像，env 文件体积可忽略）。真实镜像 pull 后的磁盘占用需等 ACR 开通后的实际部署演练补测。

## 验收逐条

1. **push main 触发全链，ECS 上 `docker ps` 两容器 running 且 healthcheck healthy，镜像 tag = 本次 SHA** —— **FAIL（受 ACR 阻塞）**。Compose/Dockerfile/workflow 全部就绪且本地构建-运行验证通过（见上），但 ACR 未开通导致镜像无法 push，ECS 侧无法执行 `docker compose pull`。无法达成，非降级验收（未在 ECS 上伪造容器运行）。
2. **SSH 隧道 `curl localhost:3000/healthz` 返回 200；worker 容器日志出现启动+配置校验通过行** —— **部分 PASS，非 ECS 环境**：本地 Docker 容器内验证 `curl localhost:13002/api/healthz` → `{"ok":true}` 200；worker 容器日志确认 `NODE_ENV=production, config schema validated OK`。ECS 上尚无法验证（依赖验收 1 的镜像存在）。
3. **安全组维持仅 22/80/443（`tools/aliyun` 查询证据）；80/443 无监听进程或仅原站点** —— **PASS**（见上「安全组现状核验」，证据完整，未做任何修改）。
4. **两容器资源限制与日志轮转配置在 `docker inspect` 中可证** —— **部分验证**：`deploy/compose.yml` 已定义资源限制（memory limits）与日志轮转（json-file, max-size/max-file），Compose 文件本身可读可证；但 `docker inspect` 需要容器已在 ECS 上真实运行，本地 `docker run`（非 compose up）未走这条配置路径，未生成可供 `docker inspect` 核验的真实实例。ACR 解除阻塞、`docker compose up -d` 执行后，该验收项可在下一轮直接补验。

## Observations（spec 之外，未处理）

- Worker 镜像体积（~296 MiB）比 WP-2.0 tracer 探针（~160 MiB）大约 1.85 倍；已排除 `sharp` 落入 `node_modules` 的可能性（`find` 确认为空），差异来源未细查（`node:24` vs tracer 用的 `node:22` base、或 Prisma WASM 资源大小差异），不阻断本包验收，留待后续镜像瘦身时核查。
- `prisma generate` 在 `node:24-bookworm-slim` 构建阶段打印 OpenSSL 检测警告（"Prisma failed to detect the libssl/openssl version... Defaulting to openssl-1.1.x"）；本项目用 `@prisma/adapter-pg`（WASM query compiler，无原生 query engine 二进制），该警告在本次真实容器运行的配置校验与既有集成测试（WP-2.3）中未观察到实际功能影响，但生产环境长期运行建议后续显式装 `openssl` 包消除此警告的不确定性，不在本包处理。
- `deploy/compose.yml` 的资源限制数值（web 512m / worker 384m）是基于 ECS 实测 1.6GB 内存与现有站点占用的**规划值**，尚未在真实负载下用 `docker stats` 校准；ACR 解除阻塞后的首次真实部署应把这一步作为验收 4 补验的一部分。
- ECS 上 `/opt/petscape-compose/compose.yml` 权限是默认 `644`（非 600）——该文件不含密钥（密钥都在 `web.env`/`worker.env`，已 600），未按 spec 额外收紧，因 compose.yml 本身無敏感内容，判定合理，如需更严格可后续统一 `chmod 600`。

## 改动文件清单

- `.dockerignore`（新增）
- `.github/workflows/deploy.yml`（新增）
- `deploy/compose.yml`（新增）
- `deploy/provision-env.sh`（新增，已实跑落地 ECS `/opt/petscape-compose/`）
- `docs/operations/wp-2-5-report.md`（本文件）
- `packages/server/tsconfig.build.json`（新增，容器构建期专用）
- `tools/rewrite-server-dist-exports.mjs`（新增，容器构建期专用）
- `web/Dockerfile`（新增）
- `web/app/api/healthz/route.ts`（新增）
- `worker/Dockerfile`（新增）
- `worker/tsconfig.build.json`（新增，容器构建期专用）
- `worker/src/main.ts`（改：加保活循环 + SIGTERM 处理，理由见 CONFLICT 3）

ECS 侧改动（未纳入 git，运维产物）：
- `/opt/petscape-compose/{compose.yml,web.env,worker.env}`（已用 `deploy/provision-env.sh` 落地，权限 600）
- `~/.ssh/authorized_keys` 追加了 `petscape-deploy` 部署公钥
