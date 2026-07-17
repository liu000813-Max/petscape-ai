# ADR-0002：RDS PostgreSQL 与 Prisma 数据访问

- 状态：Accepted（2026-07-17 终审通过）
- 决定日期：2026-07-17
- 适用阶段：Phase B 起

## 背景

PetScape 需要持久保存用户、项目、资产元数据、任务、检查、报价、支付和订单状态。报价、支付与订单要求事务、唯一约束、不可变快照和可靠恢复；Web 与 Worker 必须共享同一数据模型。

团队规模小，数据库运维能力有限。数据库部署在阿里云，不随应用容器自建。

## 决定

第一阶段采用：

- 阿里云 RDS PostgreSQL 基础系列；
- 2 核 4 GB、单节点规格起步；
- 启用并验证自动备份与时间点恢复（PITR）；
- 业务增长或可用性目标提高后，升级到 RDS PostgreSQL 高可用版；
- Prisma 作为数据访问与迁移工具。

`schema.prisma` 是关系模型、约束表达和 Prisma Client 生成的代码正本；已提交的 Prisma migration 是数据库结构演进历史。生产结构变更只通过受控 migration 流程执行，不使用会绕过迁移历史的临时推送作为生产发布方式。

Web 与 Worker 使用同一份生成的 Prisma Client 和 schema，但连接池、事务入口和 Repository 适配器分别按进程管理。Prisma Client 只能出现在基础设施适配层，不得扩散到 React、Route Handler、领域模型或跨模块公共接口。

PostgreSQL 是运行时数据真相源。`schema.prisma` 作为结构定义正本，不取代数据库中的真实业务状态，也不表达 OSS 对象内容。

## 关键理由

- PostgreSQL 的事务、唯一约束、行级锁和 `SKIP LOCKED` 能同时承载交易状态与低吞吐持久任务；
- RDS 将备份、PITR、存储和后续高可用升级交给托管服务，符合小团队维护能力；
- 单节点基础系列降低第一阶段固定成本，同时保留平滑升级高可用版的路径；
- Prisma 的 schema-first 与代码生成减少 Web、Worker 数据契约漂移，适合单仓和 AI 辅助开发；
- Prisma migration 提供可审阅的数据库变更历史，比运行时自动建表或手工改库更可控；
- 选定 PostgreSQL 也保留未来采用 PostgreSQL 原生任务工具的可能，尽管当前任务方案不引入这些库。

## 放弃的备选

### RDS MySQL

MySQL 能完成主要交易需求，但本项目已依赖 PostgreSQL `SKIP LOCKED` 任务方案，PostgreSQL 在相关生态与语义上更直接。价格差异不足以抵消统一数据库与任务原语的价值。

### RDS PostgreSQL Serverless

当前负载小且需要成本可预测。RCU 弹性与按量模型没有提供足够收益，反而增加容量和账单判断复杂度；待流量形态明确后再评估。

### ECS 或 Compose 自建 PostgreSQL

会把备份、恢复、升级、高可用和磁盘故障责任转回单机，与选择托管数据库的目标冲突。

### Drizzle 或 Kysely

两者更贴近 SQL，但需要团队承担更多迁移和规范设计。当前更重视 schema 统一、迁移工作流和 Web/Worker 共享 Client。若 Prisma 对关键 SQL 或性能形成经验证的阻碍，可在不更换 PostgreSQL 的前提下重新评估。

### 托管或自建 Supabase

托管 Supabase 不在阿里云国内同 VPC 边界内；自建 Supabase 会引入当前不需要的 Auth、Realtime、Storage 等平台服务，并重新承担 PostgreSQL 运维。PetScape 通过服务端应用层访问数据库，不需要以客户端直连 Data API 作为主要价值。

## 已知代价与风险

- 基础系列单节点没有自动故障转移，实例故障会需要人工恢复或升级；
- 自动备份和 PITR 不等于恢复已经演练成功；
- Prisma migration 与数据库 provider 绑定，未来换数据库需要承担迁移历史重构成本；
- Prisma 不一定为所有 PostgreSQL 原语提供高层 API，任务认领等路径可能需要受控 raw SQL；
- Web 与 Worker 各自持有连接池，若未设总连接预算可能超过低规格 RDS 上限；
- schema 生成和 migration 发布顺序不当，可能造成新旧容器短暂不兼容；
- 单一 schema 文件可能随模块增长变大，仍需通过模块化 Repository 与命名纪律维护数据所有权。

## 验证条件

在 Phase B 数据基座成立前必须验证：

1. 在阿里云实际下单页复核 2 核 4 GB 基础系列的规格代码、PostgreSQL 版本、最大连接数、存储范围、价格和升级路径；调研中的促销价格不作为承诺；
2. 复核所选实例的自动备份、日志备份、PITR 保留窗口与恢复限制，并完成至少一次恢复到隔离实例的演练；
3. 锁定相互兼容的 Node.js、Prisma、PostgreSQL 版本，并在 CI 中执行 Client 生成和 migration 校验；
4. 证明 `prisma migrate deploy` 可以在目标 RDS 权限模型下运行，并明确失败时的停止发布和向前修复流程；
5. 为 Web 与 Worker 制定总连接预算，验证长任务、并发 API 与 migration 不会耗尽连接；
6. 对事务、唯一约束、并发更新和任务 `SKIP LOCKED` 使用真实 RDS PostgreSQL 跑集成测试，不以 SQLite 或内存替身宣称通过；
7. 记录基础版升级高可用版的操作前提、预计中断和回退限制。

RDS MySQL 活动价、Serverless 实际账单等未核实项不阻塞本决策；仅当重新打开对应备选时重新核实。

## 调研依据

- 《ADR 前置研究：PetScape 关系型数据库与数据访问方案》— 2026-07-17
