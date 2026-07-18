# docs 索引

本目录存放决策与过程文档。产品与架构正本在仓库根，阅读顺序：
PetScape-PRD.md（承诺什么）→ ARCHITECTURE.md（系统怎么组织）→ PRODUCT-MODULES.md（功能清单与优先级，飞书快照）→ docs/decisions/（具体技术选型）。

## 子目录角色

| 目录 | 角色 | 性质 |
|---|---|---|
| decisions/ | ADR：技术选型的决定、理由、放弃的备选、代价与验证条件 | 正本；修订注明日期，不删旧文 |
| governance/ | 治理决策：Phase A 清单、目录结构方案、工程约定 | 决策记录 |
| plans/ | 执行文档：工作包序列、kickoff brief | 活文档，随执行推进更新 |
| operations/ | 执行与演练报告：Step 0 资源开通、PITR/回滚演练 | 事实记录，只增不改 |

## 新增文档规则

- 新文档先归入上表某目录，并在本索引相应行可被涵盖；归不进的先讨论，不自创顶层目录。
- 快照类文件命名带日期与来源（如 `feishu-*-snapshot-YYYY-MM-DD`）。
- 历史语境文档（黑客松 spec/报告）在 `archive/hackathon/`，不在本目录，不得当未来实现指令。
