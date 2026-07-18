# PetScape / TinyHabitat AI

宠物空间物品定制电商：用户生成或上传一个可制造的物品模型，在 3D 场景中确认摆放与比例，选择材料颜色，通过制作与宠物安全检查，获得自动报价并直接付款，随后跟踪真实订单的生产与物流。产品定位与承诺以 `PetScape-PRD.md` 为正本。

## 仓库形态（2026-07-18 起）

pnpm workspace 三包，正式工程与黑客松原型并存、按产品模块逐步吸收：

- `packages/server` —— 正式应用层与基础设施（RDS PostgreSQL + Prisma 7、OSS 私有桶、PG 任务表 SKIP LOCKED、Better Auth、结构化日志）
- `web` —— Next.js 站点：landing 定稿页 + `/api/v1/*` 正式路由；`web/app` 内未迁移的原型链见退役台账
- `worker` —— 任务执行进程（独立镜像，物理不依赖 next/react)

原型链哪些部件归属哪个模块、何时退役：`docs/governance/prototype-retirement-ledger.md`。当前推进批次：`docs/plans/`。

## 快速开始

```bash
pnpm install                # 仓库根（workspace）
cd web && pnpm dev          # 开发（默认 3000，读项目根 .env）
cd web && pnpm build        # 生产构建（Next standalone）
pnpm test                   # 各包目录内跑；集成测试连接方式见 packages/server/CLAUDE.md
docker compose -f deploy/compose.local.yml up   # 本地容器化验收
```

部署：push main → GitHub Actions 双镜像 → ACR → SSH ECS Compose（`.github/workflows/deploy.yml` 为行为正本；回滚 `deploy/rollback.sh <image-tag>`）。

## 原型 demo（黑客松基线，迁移期仍可用）

原型链数据在内存（重启即丢），演示前预热：`node tools/demo-prep.mjs [--real]`，脚本打印恢复 URL；`?mock=1` 全链走预置资产，是现场保险丝；`?project=<id>` 恢复已有项目。风格化 prompt 在 `web/app/lib/prompts/avatarStyle.ts` 直接改文案调效果。

## 文档地图（真相源）

- `PetScape-PRD.md` —— 产品定位、核心闭环与范围边界
- `ARCHITECTURE.md` —— 目标系统结构、模块与数据归属、依赖方向、演进顺序（§11）
- `PRODUCT-MODULES.md` —— 功能模块、优先级与依赖顺序（飞书讨论稿的执行快照）
- `docs/README.md` —— docs 子目录索引（decisions / governance / plans / operations）
- `docs/governance/engineering-conventions.md` —— 工程约束正本（测试分级、zod、支付前 checklist）
- `docs/governance/prototype-retirement-ledger.md` —— 原型部件 → 模块归属 → 退役状态台账
- `archive/hackathon/` —— 黑客松历史材料统一归档，不自动约束未来实现
- `assets-3d/` —— 离线 3D 素材与参考资产；迁移或清理前先分类
