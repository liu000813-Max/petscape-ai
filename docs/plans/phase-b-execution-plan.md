# Phase B 执行文档：Step 2-4 工作包序列

状态：v1（2026-07-18）。目录结构前置已拍板（R3 轻 workspace，见 `docs/governance/2026-07-18-directory-structure-plan.md`）。
角色：把 Phase B 剩余范围（Step 2 工程骨架 / Step 3 基座验收链路 / Step 4 演练）展开为可独立验收的最小竖切工作包序列，供编排执行。**不复制正本**：架构与分层依 `ARCHITECTURE.md`，技术决策依 `docs/decisions/0001-0005`，目录结构依已拍板的目录结构方案（R3 轻 workspace）。本文只拥有：工作包边界、顺序依赖、机器可判验收标准。

已完成前置：Step 0 云资源（`docs/operations/phase-b-step-0-cloud-resources.md`）、Step 1 身份 tracer（`tracer/auth-tracer/`）。

## 编排约定

- 每个工作包由主控闭合 spec 后派发；执行者产出**证据**（命令输出/测试结果/截图），无证据视为未完成。
- 验收分两层：包内机器可判标准（下列各包）＋ 主控回抽终审（标 ★ 的关键包必审；其余抽查）。
- 关键包 WP-3.3 测试先行：先派测试作者出竞态测试套件，再派实现者让测试变绿；实现与测试不同 agent。
- 同一包失败两次升档；验证用全新 context 的独立 agent。
- RDS 只有内网地址：本地开发机对 RDS 的一切验证经 SSH 隧道（`ssh -L 5432:<RDS_HOST>:5432 <ecs>`）或直接在 ECS 上跑；不给 RDS 开公网地址。
- 备案未完成：ECS 不开公开 HTTP(S) 入口，部署验证一律走 SSH 隧道/内网 curl（ADR-0001）。
- 涉及阿里云操作一律 `tools/aliyun`，禁裸调。

## 目标结构（R3，已拍板）

```
PetScape-final/
├── pnpm-workspace.yaml
├── web/                 # 现 Next.js app，目录内零新增；workspace 成员
├── worker/              # Worker 进程 package（物理不依赖 next/react）
├── packages/server/     # 共享包：application / domain / infra(config|db|jobs|oss|sms|vendors) + prisma/
├── tools/  tracer/  docs/  archive/ ...
```

---

## Step 2：工程骨架 + 统一配置 + CI/CD

### WP-2.0 构建链 tracer ★

一切结构落地前，先在 Linux 容器实证构建闭环（目前无任何已验证事实）。产出 `tracer/build-tracer/`（探针代码+报告），不进正式代码。

范围：
a. 现 `web/` 开 `output:'standalone'` 构建 Docker 镜像：`public/`、`.next/static`、sharp、启动均正常；
b. worker 最小镜像：一个雏形 package（Prisma 7 + `@prisma/adapter-pg` + WASM 引擎）经 `pnpm deploy` 产出独立依赖树，容器内启动并完成一次对 PostgreSQL 的查询（本包用本地 PG 容器即可——这里验证的是构建链，DB 语义验证在 WP-2.3）；若 `pnpm deploy` 路径不通，实测 esbuild bundle 备选并记录取舍；
c. 重工具层可执行性（ADR-0001 验证条件 2）：Linux/arm64 与 ECS 实际架构（x86_64）下 uv+trimesh、PrusaSlicer CLI 能安装能跑一次样例网格处理；只验证可执行性，不接业务。

验收（机器可判）：
1. `docker build` web 镜像 exit 0，`docker run` 后容器内 `curl localhost:3000` 返回 200 且首页 HTML 含 landing 标识字符串；
2. worker 镜像 `docker run` exit 0 并打印一次真实 `SELECT 1` 查询结果；镜像内 `node_modules` 不含 `next`（`test ! -d` 断言）；
3. 报告记录两镜像压缩/解压体积、构建耗时（ADR-0001 验证条件 2）；
4. PrusaSlicer 容器内对样例 STL 出 G-code exit 0。
5. **Worker 制品契约在本包报告中拍定**（pnpm deploy / esbuild / external+精简，交主控终审）。

### WP-2.1 workspace 骨架落地 ★

范围：`pnpm-workspace.yaml`；web lockfile 上移合并；`packages/server` 骨架（application/domain/infra 目录、`server-only` 入口防线、package.json 无 next/react 依赖）；`worker/` 骨架（独立 tsconfig，Node target，无 DOM lib）；根 `packageManager`+`engines`；lint 边界规则（application/domain 禁 import next/react/@prisma/client，Prisma 只准出现在 infra/db；禁新建 `web/src/app`；禁 config 外读 `process.env`——对存量 9 处散点用 baseline 豁免清单锁存，只降不升）。**版本矩阵在本包落定并写入报告**（Node/pnpm/Next/TS/Prisma/Better Auth 具体版本 + CI frozen-lockfile）。

验收：
1. `pnpm install` 全绿无 peer 警告；`npx tsc --noEmit` 三个 package 全过；
2. `pnpm build`（web）exit 0；`pnpm test` 现有测试全绿；
3. lint 边界生效证明：临时提交一个违规 import（如 domain import next），lint 非零退出；移除后归零；
4. **landing 行为验收**：`pnpm build && next start` 后真实浏览器访问首页，截图与改动前对照无视觉回归（构建面变了，物理不动文件不算证据）。

### WP-2.2 统一配置入口

范围：`packages/server/src/infra/config/`——`common`/`web`/`worker` 三个 zod schema，各进程启动只校验自己的集合，fail-fast 并输出缺失键名；本地开发 `--env-file` 指向根 `.env`，部署由 Compose 注入。

验收：
1. 单测：缺必需键启动抛错且错误信息含键名；全键通过；web schema 不含 worker 专属键（如切片器路径），反之亦然；
2. `pnpm dev` 正常启动（读根 `.env`）；
3. lint 禁散点规则对新代码生效（见 WP-2.1 验收 3 同法）。

### WP-2.3 Prisma 7 + 真实 RDS tracer ★（ADR-0002 修订版前置条件)

范围：`packages/server/prisma/` 首个 schema（可只含探针表）；`prisma.config.ts` + adapter-pg；经 SSH 隧道对真实 RDS `<RDS_INSTANCE_ID>` 跑 `migrate deploy`；Better Auth prismaAdapter 在 Prisma 7 client 上初始化冒烟。失败→按 ADR 回退 Prisma 6（回退成本仅配置文件）。

验收：
1. `prisma migrate deploy` 对真实 RDS exit 0，`_prisma_migrations` 表可查到记录（psql 证据）；
2. 集成测试对真实 RDS 完成 CRUD + 事务 + 唯一约束冲突三用例（禁 SQLite/内存替身，ADR-0002 验证条件 6）；
3. Better Auth adapter 初始化 + 建表 migration 在 RDS 上成功；
4. 连接预算落定：web/worker 各自 pool max 写入 config，两者之和 + migration 连接 < 实例上 `SHOW max_connections;` 实测值（Step 0 报告标称 400，属售卖页口径，以实测为准），实测值与预算一并写入报告。

### WP-2.4 CI 门禁

范围：GHA workflow：`pnpm install --frozen-lockfile` → tsc → lint（含边界与散点 baseline）→ `pnpm test` → `prisma validate` + generate 可通过。跑在 PR 与 main push。

验收：
1. 一个真实 PR 上全链绿（Actions run URL + 截图）；
2. 逐项人为破坏（类型错误/违规 import/坏 schema）各触发一次红，修复后恢复绿（三条 run 记录）。

### WP-2.5 双镜像 CI/CD 部署链 ★

范围：开通 ACR（个人版，先复核配额/价格——ADR-0001 验证条件 3，不采信调研旧数字）；GHA build web+worker 镜像→git SHA 不可变 tag 推 ACR→SSH ECS `docker compose pull && up -d`；Compose 定义两服务的资源限制、healthcheck、日志轮转（ADR-0001 验证条件 5）；最小 `/healthz` 端点；GHA secrets 管理 ACR 与 SSH 凭证。**不开公网入口**：验证走 SSH 隧道。

验收：
1. push main 触发全链，ECS 上 `docker ps` 两容器 running 且 healthcheck healthy，镜像 tag = 本次 SHA；
2. SSH 隧道 `curl localhost:3000/healthz` 返回 200；worker 容器日志出现启动+配置校验通过行；
3. 安全组维持仅 22/80/443（`tools/aliyun` 查询证据）；80/443 无监听进程或仅原站点；
4. 两容器资源限制与日志轮转配置在 `docker inspect` 中可证。

---

## Step 3：基座验收链路（ARCHITECTURE §11 竖切）

### WP-3.1 身份模块正式化

范围：以 `tracer/auth-tracer/` 为参考实现（不是复制粘贴——收编进 `packages/server` 分层：Better Auth 配置在 infra，PNVS 适配器在 infra/sms，Route Handler 薄层在 web）；User+credentials 数据模型 migration（手机号是 credential 非主键，ADR-0004）；登录/会话/受保护路由。

验收：
1. 真实 RDS 上 OTP 登录闭环集成测试：send-otp（SMS_CHANNEL=log）→verify→受保护路由 200，无 session 401；
2. 一次 PNVS 真发实测收码成功（沿用 tracer 脚本路径，模板 100001 传 code+min）；
3. migration 后 `User` 与 credential 表关系符合 ADR-0004（手机号换绑不改 User.id 的用例测试）；
4. tracer 目录不被正式代码 import（grep 证据）。

### WP-3.2 持久项目 + 私有资产（OSS 小文件链）

范围：Project 表+创建/查询用例（owner 归属+授权检查）；Asset 表（owner/类型/大小/校验/OSS 引用）；服务端签发 V4 签名 URL 完成小文件上传/下载；上传完成后服务端校验并推进 Asset 状态。**本包边界**：只做签名 URL 小文件路径；STS 分片直传/断点续传属大文件能力，Phase C/D 实现前再关闭其验证条件（ADR-0005），本包不假装解决。

验收：
1. 集成测试：用户 A 创建项目→上传→登记→读回全链 200；用户 B 访问 A 的项目/资产 404 或 403；
2. 未签名直访 OSS 对象 403（AccessDenied 证据）；过期签名 URL 访问失败（TTL 设短实测）；
3. 上传完成校验：伪造 key/尺寸不符时 Asset 不进入可用态；
4. 数据库无二进制内容，OSS 无未登记对象（前缀 list 对账）。

### WP-3.3 任务系统核心 ★（测试先行 + 双 builder 选优）

范围：任务表 schema（ADR-0003 要求的全部字段）+ 认领/续租/完成/失败的 SKIP LOCKED SQL（infra/jobs，受控 raw SQL）+ 八条机制中除 Worker 进程本体外的全部（租约心跳、孤儿恢复判断、防迟到覆盖、业务幂等唯一索引、错误分类、归档策略字段、原子状态变化）。

流程：①主控出测试 spec→测试作者写六类竞态测试（并发认领/杀 Worker/租约过期/供应商已完成本地未落/旧任务迟到/重复幂等）对真实 RDS，全红；②同一 spec 并行两个 builder 实现；③code-reviewer 选优；④主控终审。

验收：
1. 六类竞态测试全绿（真实 RDS，ADR-0003 验证条件 1-7 对应用例逐条映射进测试名）；
2. 两个并发认领进程跑 100 任务，无双认领（断言每 attempt 单租约持有者）；
3. 幂等并发请求 10 连发只成立 1 个任务（唯一索引证据）；
4. 争用小测：预期峰值 10 倍任务量下认领延迟记录在案（重评触发指标，ADR-0003 验证条件 9）；
5. 任务与 attempt 的在线保留期、归档去向、查询索引与清理失败告警口径作为决策写入包报告（ADR-0003 验证条件 8）；清理的实现可后置，决策不后置，订单证据引用不入普通清理规则。

### WP-3.4 Worker 端到端 + 重启恢复 ★

范围：`worker/` 正式入口：领取→执行→心跳→写结果（样例任务：合成长任务，产物上传 OSS+进度回写；不接真实供应商——那是 Phase C）；Compose 部署更新。

验收（= ARCHITECTURE §11 Phase B 成立标准的行为化）：
1. 端到端：登录用户创建项目→上传资产→创建任务→worker 容器执行→结果 Asset 可查可下载（签名 URL）；
2. 执行中 `docker kill` worker→容器重启后任务被恢复执行且最终完成，无重复副作用（幂等键证据）；
3. `docker compose restart`（模拟部署）后 Web 侧项目/资产/任务状态全部还在（内存 store 时代的"重启全丢"正式终结）；
4. 用户 B 全链访问 A 的任务/结果被拒。

### WP-3.5 可观测性基线

范围：结构化日志（JSON，request-id/user-id/project-id/job-id 关联）+ 任务耗时与失败计数（先日志聚合口径，不引监控产品）+ `/healthz` 扩展依赖就绪检查（DB 连通）。§10 分级中"随基座建立"的部分；完整监控告警在支付/订单前补。

验收：
1. 一次 API 调用与其触发任务在日志中可用同一关联 ID 串起（grep 证据）；
2. `/healthz` 在 DB 断开时转 unhealthy（停 RDS 白名单或断隧道实测）；
3. 日志为 JSON 行式，`docker logs | jq` 可解析。

---

## Step 4：演练

### WP-4.1 RDS 恢复演练 ★

范围：用 PITR 把 RDS 恢复到一个按量付费临时实例→核对已知数据（WP-3.x 写入的真实行）→记录 RTO→释放临时实例（费用小时级）。产出 `docs/operations/` 演练报告。

验收：1. 临时实例上查到恢复点前已存在的具名数据行（psql 证据）；2. 恢复耗时记录；3. 临时实例已释放（`tools/aliyun` 查询证据）；4. 报告落盘；5. 报告含基础版→高可用版升级的操作前提、预计中断与回退限制成节（ADR-0002 验证条件 7——操作前提 Step 0 报告已核验一半，本包补齐中断与回退限制并整合）。

### WP-4.2 部署回滚演练

范围：部署 tag N（含可观察版本标识）→执行回滚流程恢复 N-1→验证。回滚步骤脚本化（`deploy/rollback.sh` 或文档化命令序列）。

验收：1. 回滚后 `/healthz` 或版本端点返回 N-1 标识；2. 两容器 healthy；3. 回滚全程命令与耗时记录进 `docs/operations/` 报告。

---

## 顺序与依赖

```
WP-2.0 ──► WP-2.1 ──► WP-2.2 ──► WP-2.3 ──► WP-2.4 ──► WP-2.5
                                     │
                                     ▼
                       WP-3.1 ──► WP-3.2 ──► WP-3.3 ──► WP-3.4 ──► WP-3.5
                                                                      │
                                                          WP-4.1 ◄────┴────► WP-4.2
```

WP-3.1 可在 WP-2.4 后与 WP-2.5 并行（部署链不阻塞身份开发）；WP-4.1/4.2 需 Step 3 数据与部署链在位。**Phase B 完成判据 = WP-3.4 验收 1-4 全过 + WP-4.1/4.2 报告落盘**；此后进入 Phase C 迁移。
