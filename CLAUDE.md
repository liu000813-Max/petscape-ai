# PetScape Agent 入口

PetScape 把原创宠物空间物品从想法推进到 3D 确认、制作与安全审核、报价、付款和交付。产品承诺以 [PetScape-PRD.md](PetScape-PRD.md) 为正本；系统边界与数据归属以 [ARCHITECTURE.md](ARCHITECTURE.md) 为正本。

## 硬边界

- 代码、schema、contract、migration、测试、CI 和运行 receipt 共同说明当前实现；文档或合并提交本身不证明生产行为。
- 3D 预览、模型确认、场景确认、制作与安全审核、报价、付款、订单和履约是不同承诺，不得互相推导。
- `sandboxOnly` 链路不代表真实价格、真实支付、真实订单、制造或物流已经开放。
- `archive/hackathon/` 和未标为 active 的计划只提供历史语境，不得作为新任务指令。
- 改动前先核对当前分支、相关代码和真实依赖；不要把本文件写成当前进度快照。

## 按任务读取

| 任务 | 从这里开始 |
|---|---|
| 产品范围、用户流程、交易边界 | [PetScape-PRD.md](PetScape-PRD.md)，再按需读 [PRODUCT-MODULES.md](PRODUCT-MODULES.md) |
| 系统结构、模块边界、数据归属、重要取舍 | [ARCHITECTURE.md](ARCHITECTURE.md)，再读相关 [ADR](docs/decisions/) |
| 领域语义、数据库或 API 契约 | [领域词典](docs/context/glossary.md) → [schema](packages/server/prisma/schema.prisma) / [migrations](packages/server/prisma/migrations/) → [contracts](packages/server/src/contracts/) |
| 原型吸收或旧路径退役 | [prototype retirement ledger](docs/governance/prototype-retirement-ledger.md)，再核对当前 consumer；不要从旧计划推断现状 |
| 部署、迁移、回滚、云资源 | [ADR-0001](docs/decisions/0001-deployment-runtime.md) → [workflows](.github/workflows/) 与 [deploy](deploy/) → 对应 [运行 receipt](docs/operations/) |
| 测试、行为验收、完成声明 | [工程约束](docs/governance/engineering-conventions.md) → 根验证入口 `pnpm validate:payment-recovery` / `pnpm validate:docs` → [CI](.github/workflows/ci.yml) → 对应行为证据 |

完整文档分流规则见 [docs/README.md](docs/README.md)。正式代码还应遵守目录级说明；改 `packages/server` 先读 [packages/server/CLAUDE.md](packages/server/CLAUDE.md)。

## 全局操作约束

- landing 是既有视觉基准；视觉改动必须给出实际页面对照证据。
- 密钥放项目根 `.env`；正式代码只经 `packages/server/src/infra/config` 读取配置。
- 阿里云操作只走 `tools/aliyun`，不得使用本机默认账号的裸 `aliyun`。
- 完成任务时，同时关闭过期计划状态，并把稳定结论写回对应正本；不要在 Agent 入口复制字段、命令清单或阶段进度。
