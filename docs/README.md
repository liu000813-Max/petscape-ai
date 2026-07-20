# docs 索引

本目录存放决策、执行材料和行为证据。产品与架构正本在仓库根：`PetScape-PRD.md` 负责产品承诺，`ARCHITECTURE.md` 负责系统边界与数据归属，`PRODUCT-MODULES.md` 负责能力地图与依赖。当前实现事实回到 schema、contracts、tests、CI 和运行证据，不由本索引复述。

## 子目录角色

| 目录 | 角色 | 性质 |
|---|---|---|
| decisions/ | ADR：技术选型的决定、理由、放弃的备选、代价与验证条件 | 正本；修订注明日期，不删旧文 |
| governance/ | 治理决策：Phase A 清单、目录结构方案、工程约定 | 决策记录 |
| plans/ | 现有批次计划、工作包序列与 kickoff brief | 只有文件头明确标为 active 的计划才是当前执行入口；完成或部分完成后必须写回状态 |
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
