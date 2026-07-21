# P0 批次 2 编排：B 线（B4/B5）+ C 线（B7 输入 + C1-C5）并行

状态：实现链已合入 `main`，**批次 2 收口已关账（WP-Z0，2026-07-21）**。B 线 WP-B45-0 至 B45-3、C 线 WP-SEAM-0 至 C4-1 及 WP-OPS-1 均已有对应合并提交；C 线沙箱主路径 `quote→address→payment→order` 加冲突重试恢复路径已在部署 SHA `9a344274fd` 完成真实生产浏览器 E2E，证据 receipt 见 [`docs/operations/wp-z0-c-line-e2e/`](../operations/wp-z0-c-line-e2e/README.md)。批次 1（A 线锚点闭环）已于 2026-07-19 关账（PR #32）。

本文件只承载**跨线编排事实**：两线各自的范围、工作包和验收以 `b-line-b4-b5-execution-plan.md`（v5）与 `c-line-execution-plan.md`（v6）为正本，不在此复述。

## 编排约定

- 批次 1 编排约定全部沿用（`p0-batch-1-execution-plan.md`）：builder TDD 红→绿证据、非实现者真实浏览器 QA、spec 派发前用户确认（数据模型/新接口/用户可见行为置顶，机械改动不问）、`gh pr checks --json` 显式判定、RDS 经 SSH 隧道、`tools/aliyun`。
- Codex 审核意见以「审查增补」形式写回 spec 正本；执行者只读 spec。

## 跨线接缝拍板（2026-07-19，用户确认）

1. 跨线 contract 以 C 线 `WP-SEAM-0` 为正本：C 线 session 起草、B 线 session 会签；B 线拥有 producer adapter + provider conformance test（`WP-B45-3`，挂 WP-B45-2 之后）。
2. 报价输入绑定 `SceneConfirmation`（携带 `targetInstanceId` 最终 mm 尺寸）；`ModelConfirmation` 只作快照内间接引用。
3. `temporary_catalog` 场景确认经 producer 只能生成 sandbox 下游请求；正式 Quote 门禁拒绝。
4. 「模块内默认值」旧决策 = 测试资产默认尺寸来自模型 meta，B 线正本已吸收，无需另立条目。
5. C4/C5 地址依赖矛盾已在 `PRODUCT-MODULES.md` 收敛（结算时序说明 + 运行顺序 C2→C5→C3→C4），两线正本与之一致。

## migration 跨线单队列与发布吞吐

> 2026-07-19 用户二次确认收窄：队列只保护 migration 进入生产数据库的临界区；不含 migration 的 PR、完整功能冒烟和浏览器 QA 都不占该槽位。

- **不含 migration 的 PR 不进队列**：编排方核验 exact-head 范围、必需 CI 与证据后直接按 expected head 合并，不等待任何 migration WP；用户可见 WP 合并后立即把一张或少量关键截图发给用户查看，不等回复、不阻塞下一包。
- 两线可以在各自独立 worktree 中并行修改 `schema.prisma`、生成 Draft migration、实现与测试，并在彼此隔离的临时数据库运行 CI；一个 WP 仍只产出一个职责闭合的 migration，不借机吸收后续 WP schema。
- 同一时间只允许一个 migration PR 进入生产临界区：**基于最新 `main` rebase → 重新运行完整 migration CI → expected-head 合并 → 生产 `migrate deploy` → 验证 `_prisma_migrations`、目标表/约束/索引/trigger → `/api/healthz` 返回 `db:true`**。到此立即释放槽位；完整 API 冒烟、业务浏览器 QA 和证据整理移出临界区，与下一个 PR 并行。
- 后一个 migration PR 不得复用前一个 migration 合并前、旧 base 上的 CI 结论；获得合并槽位后必须 rebase 最新 `main` 并重新验证。等待槽位不阻塞 Draft PR、实现或临时数据库 CI，但不得提前合并。
- 浏览器 QA 按 schema 状态选环境：生产已存在所需 schema 时可用本地 Compose + RDS SSH 隧道；PR 含尚未部署的 migration 时必须使用本地 Compose + 一次性 PostgreSQL 16，不得为测试 Draft schema 提前修改生产 RDS。每条线收口时各做一次真实生产浏览器 E2E；平时 WP 不重复做完整生产 E2E。
- WP-OPS-1 完成前，每个带 migration 的 PR 合并后仍由编排方立即手动 `migrate deploy` 并执行上述短临界区验证。
- **WP-OPS-1（B6-0 后立即执行）**：①让 `deploy.yml` 消费 main 上已经成功的同一 SHA CI 结果，不再原样重跑整套 CI；②把 `migrate deploy` 纳入部署链并真实演练安全顺序与失败处理；③生产部署串行且绑定精确 SHA，禁止并发 Deploy 造成旧版本后落地。OPS-1 独立成不带业务 migration 的小 PR；其合并生效后，WP-B45-2 作为新链路第一次真实 migration 演练素材。B45-2 在此之前可继续 Draft CI/QA，但不得合并 migration。

## 派工登记

**2026-07-19 起，批次 2 执行编排移交用户侧 Codex 编排 session 接管**（收敛与拍板由本表下方记录的前置 session 完成）；两条执行线由 Codex 编排方委派与排程。

| session | 范围 | 首个任务 | 状态 |
|---|---|---|---|
| B 线执行 | WP-B45-0 → B4-1 / B5-1 → B45-2 → B45-3 | WP-B45-0 spec 闭合 + R3F 尖峰 | 执行中（Codex task `019f78cc-1be0-7c71-9ded-5859c852e312`） |
| C 线执行 | WP-SEAM-0 → B7-1 / C1-1 → B6-0 → OPS-1 → C2-1 → C5-1 → C3-1 → C4-1 | WP-SEAM-0 contract 起草 | 执行中（Codex task `019f78cc-19ac-76c0-adea-cb6896adf897`） |
| designer 原型稿 | B4/B5 两阶段工作台视觉探索稿（非实现） | — | ✅ 完成，用户认可（2026-07-19）；快照与开放项见 `assets/b45-prototype/README.md` |
| 定价市场研究 | 淘宝/国内 3D 打印服务商定价结构与成品售价行情 | — | ✅ 完成，结论入 `reference-pricing-research-2026-07-19.md` |
| 定价嘉立创专项 | 三维猴材料单价/起步价/费用构成（一手 API 价目） | — | ✅ 完成，结论与原始数据同上 |
| FDM 定向询价 | FDM PETG/PLA 黄色线材按克单价（材料单价真值） | — | ✅ 完成（2026-07-19）：一手区间 0.2~0.8 元/g，0.35 占位维持；真值需人工询价，随供应商选定拍板 |

## 产品口径进展

- 首发单品 = 奶酪软垫小床（`cheese-lounge-bed`，2026-07-19 用户拍板）；颜色主打奶酪黄，候选色与材料/工艺待定价研究结论后一并拍板（正本记录在 C 线执行文档 §二）。

C 线仍未确认的真实材料成交价、制作工艺/供应商与真实支付渠道不阻塞沙箱骨架；它们到未来**真实交易开放**前再按「spec 派发前用户确认」逐项拍板，批次 2 执行者不得自行定值。

## 批次 2 Goal 与默认执行授权（2026-07-19，用户确认）

### Goal 完成边界

- **B 线 Goal**：完成 `WP-B45-0 → WP-B4-1 / WP-B5-1 → WP-B45-2 → WP-B45-3`，交付真实数据库上的两阶段 Viewer、不可变确认与 WP-SEAM-0 producer；不包含 AI 生成/通用上传、制造可行性、宠物安全结论、真实报价或真实成交。
- **C 线 Goal**：完成 `WP-SEAM-0 → WP-B7-1 / WP-C1-1 → WP-B6-0 → WP-OPS-1 → WP-C2-1 → WP-C5-1 → WP-C3-1 → WP-C4-1`，交付真实数据库上的完整**沙箱**交易闭环；不以真实供应商、真实材料成交价、真实支付渠道或 C6-C9 履约为完成条件。
- `WP-OPS-1` 归 C 线执行，在 `WP-B6-0` 后立即完成；migration 单队列锁与 OPS-1 落地前的手动生产 `migrate deploy` 仍由批次编排方掌握。

### 已授权执行者自行决定的范围

执行者可在不改变已确认业务语义的前提下，自行决定路由/组件拆分、内部函数与索引命名、测试 fixture、重试与防抖参数、schemaVersion 字符串等机械实现细节。以下情况必须停线回报编排方，不得先实现后补确认：

1. 需要改变跨线 Contract、数据归属、不可变历史或 migration 排队纪律；
2. 需要改变用户可见承诺、资金/权限语义、sandbox/live 隔离或启用外部真实交易；
3. 正本冲突、认证/权限阻断、不可逆外部操作，或验证层无法达到 WP 规定的真实依赖。

### 任务回报与证据

- 两条执行任务各自使用 Goal 持续推进；批次编排方保存 thread ID，通过任务等待/读取能力跟踪完成、需输入和停线状态，并负责跨线会签与 migration 放行。
- 每个 WP 的完成回报必须同时给出可定位 PR/commit、红→绿测试、真实依赖验证、非实现者浏览器 QA，以及用户可见面的截图或录屏；没有对应证据不得声称完成。用户可见 WP 合并后，编排方直接发送关键截图并标注其来自 exact-head QA 还是生产收口 E2E；该展示不等待用户回复，也不阻塞下一 WP。
