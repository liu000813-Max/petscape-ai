# docs 索引

本目录存放决策、执行材料和行为证据。产品与架构正本在仓库根：`PetScape-PRD.md` 负责产品承诺，`ARCHITECTURE.md` 负责系统边界与数据归属，`PRODUCT-MODULES.md` 负责能力地图与依赖。当前实现事实回到 schema、contracts、tests、CI 和运行证据，不由本索引复述。

## 按任务读取

| 要回答的问题 | 必读正本 | 继续核对 |
|---|---|---|
| 产品承诺什么，哪些仍待确认 | [PetScape-PRD.md](../PetScape-PRD.md) | [PRODUCT-MODULES.md](../PRODUCT-MODULES.md) 的能力与依赖 |
| 系统如何分层，谁拥有数据 | [ARCHITECTURE.md](../ARCHITECTURE.md) | 相关 [ADR](decisions/) 与当前代码 |
| 一个领域名词承诺什么 | [领域词典](context/glossary.md) | schema、contract 与调用方；词典不定义字段 |
| 数据库目前实现了什么 | [Prisma schema](../packages/server/prisma/schema.prisma) | [migrations](../packages/server/prisma/migrations/)、集成测试和真实数据库 evidence |
| API 或跨进程输入目前长什么样 | [Zod contracts](../packages/server/src/contracts/) | Route Handler、应用层、调用方和契约测试 |
| 原生小程序内容/社区与养护如何验收 | [小程序内容规范](specs/miniapp-content.md) | [整合说明](miniapp-integration.md)、`miniapp/`、对应单元与集成用例 |
| Windows 本机如何做真实数据库联调 | [运行手册](runbooks/miniapp-local-postgres.md) | [数据库验收记录](operations/miniapp-database-2026-10-16.md)、独立运行目录中的原始日志 |
| 小程序 HTTP 是否已连真实库、怎样准备账号 | [HTTP 验收记录](operations/miniapp-http-2026-10-16.md) | [账号准备指引](runbooks/miniapp-account-setup.md)、[整合说明](miniapp-integration.md) |
| 个人版入口与宠物表单是否可用 | [个人版验收](operations/miniapp-personal-2026-10-16.md) | [客户端说明](../miniapp/README.md)、配置诊断与真实 HTTP 证据 |
| 多宠物养护和快速筛选是否会串数据 | [养护与筛选验收](operations/miniapp-care-2026-10-16.md) | 原生页面竞态回归、真实 HTTP 与 PostgreSQL 证据 |
| 微信测试号是否已接入，预览在哪里阻塞 | [测试号接入记录](operations/miniapp-test-account-2026-10-16.md) | [账号准备指引](runbooks/miniapp-account-setup.md)、脱敏 receipt 和原生预览入口 |
| 旧原型是否可以删除 | [prototype retirement ledger](governance/prototype-retirement-ledger.md) | 当前 import、路由、consumer 和行为回归证据 |
| 如何部署、迁移或回滚 | [ADR-0001](decisions/0001-deployment-runtime.md) | [workflows](../.github/workflows/)、[deploy](../deploy/) 与对应运行 receipt |
| 小程序后端如何与既有官网分别发布 | [独立后端发布记录](operations/miniapp-backend-2026-10-28.md) | prepare、备份实际恢复、release 与原生真机证据分别验收 |
| 一项工作是否已经完成 | 当前 Spec/Ticket 的验收终点 | tests、CI、exact SHA、真实依赖行为与 `operations/` / `evidence/` receipt |

只读最少的一组正本即可开始；需要证明当前状态时再下钻到实现和证据。会议、历史计划和归档只能解释来源，不能替代正本或当前行为。

## 子目录角色

| 目录 | 角色 | 性质 |
|---|---|---|
| context/ | 少量稳定领域语义与跨模块上下文 | 语义入口；不复制字段、接口或进度 |
| decisions/ | ADR：技术选型的决定、理由、放弃的备选、代价与验证条件 | 正本；修订注明日期，不删旧文 |
| governance/ | 治理决策：Phase A 清单、目录结构方案、工程约定 | 决策记录 |
| plans/ | 现有批次计划、工作包序列与 kickoff brief | 只有文件头明确标为 active 的计划才是当前执行入口；完成或部分完成后必须写回状态 |
| specs/ | 已批准竖切的用户结果、失败语义、验收终点与顺序 Ticket | 当前实现合同；状态关闭后仍保留为验收索引，不复制代码字段细节 |
| operations/ | 执行与演练 receipt：环境、exact SHA、结果、边界与证据索引 | 事实记录；新事实追加，错误结论用更正说明取代静默改写 |
| meetings/ | 项目会议原始材料、机器转写与行动来源 | source，不是产品、架构或任务状态正本；决定和任务必须写回对应正本或 tracker |

真实使用已经需要以下职责，后续新材料按此分流，旧文件不为目录整齐一次性搬迁：

- `reference/`：竞品、定价、工具链等只读事实，不承载执行决定；当前 `plans/reference-*` 文件在再次消费时再迁移。
- `evidence/<ticket>/`：新的行为 receipt 与截图、录屏索引放在同一生命周期；现有 `operations/` 与根 `screenshots/` 暂不搬动。
- `runbooks/`：需要重复执行的部署、迁移、回滚和恢复入口；命令行为仍以脚本、CLI help 和 CI 为准。

## 新增文档规则

- 新文档先确认它是决定、执行终点、执行路径、来源、运行手册还是证据，再进入对应目录；归不进的先讨论，不自创顶层目录。
- 快照类文件命名带日期与来源（如 `feishu-*-snapshot-YYYY-MM-DD`）。
- 历史语境文档（黑客松 spec/报告）在 `archive/hackathon/`，不在本目录，不得当未来实现指令。
- 完成一张工作票时同步检查：长期结论是否需要写回 PRD、Architecture、ADR 或术语表；原计划状态是否需要关闭；旧原型 consumer 是否满足退役条件。
