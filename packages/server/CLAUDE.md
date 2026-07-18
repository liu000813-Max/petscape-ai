# packages/server（@petscape/server）

应用层 + 基础设施适配层共享包，web 与 worker 共同依赖。分层边界（domain/application 禁 next/react、Prisma 只准 `infra/db/`、`process.env` 只准 `infra/config/`）由 `eslint.config.mjs` 强制，此处不重复。

工程约束正本：`docs/governance/engineering-conventions.md`。动本包最常用的三条：

- **集成测试**（`tests/*.integration.test.mjs`，Node test runner）：
  - 本地连真实 RDS：先建 SSH 隧道（编排约定见 `docs/plans/phase-b-execution-plan.md`），导出 `DATABASE_URL` 指向转发端口后 `pnpm test`；assets 测试另需 OSS 凭证。
  - CI：service container 起一次性 PostgreSQL 16，`db:migrate:deploy` 建表后真跑（见 `.github/workflows/ci.yml`）。无 `DATABASE_URL` 时本地为 skip，CI 里直接报错——防止门禁静默退化回全 skip。
- **migration 纪律**：改 `prisma/schema.prisma` 必须 `pnpm db:migrate:dev` 生成 migration 并连同提交；生产结构变更只走 `db:migrate:deploy`，禁止绕过迁移历史的临时推送（ADR-0002）。
- **测试先行**：竞态/资金/权限类改动先写失败测试再实现，事故场景按 conventions §1 的固定清单出题；出入参运行时校验统一 zod（conventions §2）。
