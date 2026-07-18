# WP-2.3 Prisma 7 + 真实 RDS tracer 报告

范围：`docs/plans/phase-b-execution-plan.md` WP-2.3。

## 落地内容

- `packages/server/prisma/schema.prisma`：Prisma 7（`prisma-client-js` generator，`output: "../src/generated/prisma"`，datasource 不设 `url`——运行时连接串由 `@prisma/adapter-pg` 显式构造，CLI 侧连接串由 `prisma.config.ts` 提供，ADR-0002 拍定路径）。含两类模型：
  - `BasecampProbe`（探针表：`id`/`label` 唯一约束/`version`/`createdAt`），够跑 CRUD/事务/唯一冲突集成测试；
  - Better Auth 核心四表 `User`/`Session`/`Account`/`Verification`（手写，字段集参考 `tracer/auth-tracer/prisma/schema.prisma`，仅把 provider 从该 tracer 的 sqlite 换成 postgresql）。正式业务表从 WP-3.1 起逐包落地，本包不提前建。
- `packages/server/prisma.config.ts`：`defineConfig({ schema, datasource: { url: process.env.DATABASE_URL } })`，对齐 `tracer/build-tracer/worker-probe` 的 WP-2.0 实测配置形态。
- `packages/server/src/infra/db/client.ts`：`createPrismaClient({ connectionString, poolMax })` —— 用 `@prisma/adapter-pg` 构造 `PrismaClient`；本模块不读 `process.env`（lint 边界规则要求，配置只从 `infra/config` 消费）。
- 依赖：`@prisma/adapter-pg@^7.8.0`、`@prisma/client@^7.8.0`、`@prisma/client-runtime-utils@^7.8.0`（Prisma 7 生成 client 运行时依赖，WP-2.0 tracer 已验证需要此包，本包沿用）、`pg@^8.22.0`、`prisma@^7.8.0`（devDep）、`better-auth@1.6.23`（对齐 `docs/operations/wp-2-1-report.md` 版本矩阵拍板）。
- `packages/server/tests/db.integration.test.mjs`：无 `DATABASE_URL` 时 `t.skip()` 并打印原因（CI 达不到 RDS 内网）；有 `DATABASE_URL` 时对真实 RDS 跑 CRUD + 事务回滚 + 唯一约束冲突（P2002）+ Better Auth adapter 冒烟共 4 个用例。
- `.gitignore` 新增 `packages/server/src/generated/`（Prisma 生成产物不入库，与既有 `.next/`、`tsconfig.tsbuildinfo` 等构建产物处理方式一致）；`packages/server/eslint.config.mjs` 的 `globalIgnores` 同步加 `src/generated/**`。
- `packages/server/src/infra/config/schema.ts`：`commonSchema` 新增 `WEB_DB_POOL_MAX`（默认 20）、`WORKER_DB_POOL_MAX`（默认 10），算式见下节。

## 本机执行环境说明（worktree 特殊性）

本次执行发生在 git worktree（`.claude/worktrees/agent-ab22748a54e15217b/`），根 `.env`（未跟踪文件）不随 worktree 复制。为在不打印/不复制凭证内容的前提下访问，在 worktree 根建立指向主工作树 `.env` 的符号链接（`ln -s <主工作树>/.env .env`，已被 `.gitignore` 的 `.env` 规则忽略，`git status` 确认未被跟踪）。连接串由脚本从 `ALIBABA_CLOUD_RDS_*` 键在 shell 内拼装并 `export DATABASE_URL=...`，全程未在任何输出中打印密钥/密码值。

## SSH 隧道

`ssh -fN -L 15432:<RDS_HOST>:5432 root@<ECS_PUBLIC_IP>`，本机免密已配置；执行期间隧道 PID 已在任务结束前 `kill` 清理（见下方"清理"节）。

## 验收证据

### 验收 1：`prisma migrate deploy` 对真实 RDS exit 0，`_prisma_migrations` 可查

阿里云 RDS PostgreSQL 基础版对业务账号 `petscape_app` **不开放 CREATEDB 权限**（真实 RDS 权限模型下的预期约束），`prisma migrate dev`（需要影子数据库）直接报错 `P3014: permission denied to create database`。改用 `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` 生成 SQL（不依赖影子库），手工放入 `prisma/migrations/20260718060543_init_basecamp_and_auth/migration.sql`，再跑 `migrate deploy`（该命令本身不需要影子库/CREATEDB 权限，只需对目标 schema 的 DDL 权限）：

```
$ pnpm exec prisma migrate deploy
1 migration found in prisma/migrations
Applying migration `20260718060543_init_basecamp_and_auth`
All migrations have been successfully applied.
EXIT_CODE=0
```

第二次运行验证幂等：`No pending migrations to apply.`，`EXIT_CODE=0`。

`_prisma_migrations` 表查询证据（真实 RDS，经隧道 psql 客户端查询）：

```
┌─────────┬─────────────────────────────────────────┬──────────┬─────────────────┐
│ (index) │ migration_name                          │ finished │ not_rolled_back │
├─────────┼─────────────────────────────────────────┼──────────┼─────────────────┤
│ 0       │ '20260718060543_init_basecamp_and_auth' │ true     │ true            │
└─────────┴─────────────────────────────────────────┴──────────┴─────────────────┘
tables: [ '_prisma_migrations', 'account', 'basecamp_probe', 'session', 'user', 'verification' ]
```

**PASS**。

### 验收 2：集成测试对真实 RDS 完成 CRUD + 事务 + 唯一约束冲突（禁 SQLite/内存替身）

`packages/server/tests/db.integration.test.mjs`，`DATABASE_URL` 指向 SSH 隧道 `localhost:15432` 转发的真实 RDS：

```
✔ CRUD：BasecampProbe 创建/读取/更新/删除对真实 RDS 完整闭环 (356ms)
✔ 事务：$transaction 中途失败应整体回滚，不留下部分写入 (246ms)
✔ 唯一约束冲突：重复 label 直接插入应抛出 Prisma 唯一约束错误（P2002） (70ms)
✔ Better Auth prismaAdapter 冒烟：初始化成功 + 对 user 表完成一次真实空查询 (424ms)
tests 4, pass 4, fail 0
```

无 `DATABASE_URL` 时的 skip 行为（供 WP-2.4 CI 依赖）：

```
$ unset DATABASE_URL && node --test tests/db.integration.test.mjs
﹣ db.integration.test.mjs skipped: DATABASE_URL not set (RDS 内网不可达，需 SSH 隧道) (0.355ms)
  # DATABASE_URL 未设置——本机需先建立到 RDS 的 SSH 隧道并导出 DATABASE_URL 才能跑此集成测试；
  # CI 环境无法直连 RDS 内网，此为预期行为（见 WP-2.4）。
tests 1, pass 0, skipped 1
```

无 SQLite/内存替身：测试文件唯一数据源是 `createPrismaClient({ connectionString: process.env.DATABASE_URL })`，`DATABASE_URL` 在有值场景下始终指向真实 RDS（经隧道）。**PASS**。

### 验收 3：Better Auth adapter 初始化 + 建表 migration 在 RDS 上成功

- 建表：`User`/`Session`/`Account`/`Verification` 四表已包含在验收 1 的同一次 `migrate deploy` 内，`information_schema.tables` 查询已确认四表存在（见上）。
- Adapter 冒烟：`db.integration.test.mjs` 的第 4 个用例——`betterAuth({ database: prismaAdapter(prisma, { provider: 'postgresql' }) })` 初始化未抛错，随后对 `user` 表执行一次真实 `findMany`（非 mock）空查询，返回 `[]`。**PASS**。

### 验收 4：连接预算 < 实测 `max_connections`

实测（真实 RDS，`SHOW max_connections;`）：

```
max_connections: 420
superuser_reserved_connections: 20
```

Step 0 报告标称 400（售卖页口径）与实测 420 不一致，**以实测 420 为准**（spec 已预判此差异）。业务可用连接上限 = `max_connections - superuser_reserved_connections` = 420 - 20 = **400**。

预算方案（写入 `packages/server/src/infra/config/schema.ts` 的 `commonSchema`）：

| 键 | 默认值 | 说明 |
|---|---|---|
| `WEB_DB_POOL_MAX` | 20 | 单个 Web 进程实例的 pg Pool `max` |
| `WORKER_DB_POOL_MAX` | 10 | 单个 Worker 进程实例的 pg Pool `max` |

算式：`WEB_DB_POOL_MAX + WORKER_DB_POOL_MAX = 30`（单实例各一份，Phase B 阶段部署形态）；`30 << 400`（业务可用上限），为以下场景预留充足余量：
- migration 执行期间的临时连接（`prisma migrate deploy` 通常 1-2 条，短暂占用）；
- 运维人员经 SSH 隧道手工 `psql`/脚本探针连接；
- 未来 Web/Worker 水平扩容到多副本（当前 30 对 400 的占用率仅 7.5%，留出约 12 倍扩容空间才会触及预算上限）；
- Prisma 连接池以外，供应商 SDK/健康检查等短连接的零星占用。

本阶段单实例部署下无需更激进的预算收紧；待 WP-3.4/WP-2.5 引入多副本部署后，应按副本数重新核算（`副本数 × pool_max` 之和仍需 `< 400`），届时在部署工作包中重新评估，不在本报告预先扩大范围。**PASS**（30 < 420，也 < 400 业务可用上限，两种口径下都成立）。

## 是否触发 Prisma 6 回退

**未触发。** `migrate deploy` 在真实 RDS 权限模型下（无 CREATEDB 权限）通过"预生成 SQL migration + `migrate deploy`"路径成功，无需回退到 Prisma 6。影子数据库限制只影响 `migrate dev`（本地交互式开发场景），不影响生产发布路径 `migrate deploy`——这条路径本就不需要影子库。

## Observations（spec 之外，未处理）

- `prisma migrate diff` 在 Prisma 7 中的 CLI flag 与旧版（`--to-schema-datamodel`/`--to-schema-datasource`）不兼容，已改用新版 `--to-schema`；未见于任何既有文档记录，记入此处供后续 WP 若也要生成初始 migration 时参考，不改动其他包代码。
- `@prisma/client-runtime-utils` 未在 WP-2.0 worker-probe 报告的"落地内容"文字说明中单独提及为独立坑点，但该 tracer 的 `package.json` 已包含此依赖；本包因初次遗漏该依赖导致 `Cannot find module '@prisma/client-runtime-utils'`（生成 client 运行时硬依赖），补装后解决。建议未来任何新建 Prisma 7 + adapter-pg 的 package 直接复制 tracer 的完整依赖清单，而非逐条挑选。

## 清理

- SSH 隧道进程（本次执行开启的 PID）已在任务结束前 `kill`，确认 `lsof -i :15432` 无残留监听。
- 集成测试的 `test.after()` 钩子清理了测试写入的探针数据（`label` 前缀 `wp23-test-` 的 `basecamp_probe` 行）；`migrate deploy` 建的表结构（`basecamp_probe`/`user`/`session`/`account`/`verification`）按 spec 保留（这是本包的正式交付物，非临时探针产物）。
- 未开公网地址、未改安全组/白名单（全程走既有 SSH 隧道）。

## 改动文件清单

- `packages/server/prisma/schema.prisma`（新增）
- `packages/server/prisma.config.ts`（新增）
- `packages/server/prisma/migrations/20260718060543_init_basecamp_and_auth/migration.sql`（新增）
- `packages/server/src/infra/db/client.ts`（新增）
- `packages/server/src/infra/db/index.ts`（改：占位导出 → 真实导出 `createPrismaClient`）
- `packages/server/src/infra/config/schema.ts`（改：`commonSchema` 新增 `WEB_DB_POOL_MAX`/`WORKER_DB_POOL_MAX`）
- `packages/server/tests/db.integration.test.mjs`（新增）
- `packages/server/package.json`（改：新增 Prisma 7/adapter-pg/better-auth/pg 依赖 + `db:generate`/`db:migrate:dev`/`db:migrate:deploy` 脚本 + `./infra/db` exports 子路径）
- `packages/server/eslint.config.mjs`（改：`globalIgnores` 新增 `src/generated/**`）
- `.gitignore`（改：新增 `packages/server/src/generated/`）
- `pnpm-lock.yaml`（根，随新依赖更新）
- `docs/operations/wp-2-3-report.md`（本文件）
