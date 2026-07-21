# Gap-driven Retrieval：PetScape 单任务试验

> 状态：已完成（2026-07-20，只读）；检索精度通过，完整性未通过。显式 opt-in，不改变 `CLAUDE.md` 或 `AGENTS.md` 的默认读取行为。
>
> 通用协议正本：`<USER_HOME>/Desktop/1-第二大脑/实验簇/gap-driven-retrieval/PROTOCOL.md`

## 试验问题

定位 PetScape 订单支付恢复 / 重试的当前行为、不可变约束与潜在变更影响，产出一张不修改代码的影响图。

这个问题同时涉及当前代码、测试、目标架构和已确认决定，适合验证按知识缺口检索。第一轮只读，不访问云资源，不运行支付操作。

## 预期知识需求

执行 Agent 必须在读取前自行改写并确认 3–6 项需求，不能直接把以下内容当成文件清单：

- 当前支付重试和恢复行为；
- 订单、报价与支付之间的不可变约束；
- 幂等和可信支付事件的归属；
- 已确认的技术决定；
- 能验证结论的测试或可执行入口。

## PetScape Router

| 能力需求 | 本项目候选来源 |
|---|---|
| 当前行为 | `packages/server`、`web`、`worker` 中相关代码与测试 |
| 目标边界 | `ARCHITECTURE.md` 的支付、订单、快照与任务相关命中段 |
| 技术决定 | `docs/decisions/` 中相关 ADR；只搜索命中项，不批量阅读全文 |
| 工程约束 | `docs/governance/engineering-conventions.md` 与包级 `CLAUDE.md` 的相关段落 |
| 用户承诺 | 只有产品结果发生歧义时才检索 `PetScape-PRD.md` 的相关段落 |
| 历史 | `archive/` 只解释过去，不作为未来实现指令 |

当前行为以代码、测试和 CI 为准。`ARCHITECTURE.md` 保存目标边界，不复制 API 字段、schema 或当前实现细节。

## 检索日志

执行时逐项追加，不预填结果：

### 读取前 Working Model（2026-07-20）

| Need | Status | Evidence | Next lookup |
|---|---|---|---|
| 订单已创建后，支付失败、取消或未完成时，用户/系统目前能经由什么入口恢复或重试，以及会写入哪些状态。 | `unknown` | 尚未读取项目资料。 | 按“当前行为”搜索支付 provider、checkout、订单状态、恢复/重试及其测试。 |
| 订单、报价/金额快照、支付记录之间哪些值和状态转换必须保持不可变，哪些模块拥有写入权。 | `unknown` | 尚未读取项目资料。 | 按“稳定约束或系统边界”搜索订单、报价快照、金额、支付状态与 schema/migration 命中。 |
| webhook 或其他可信支付事件如何被认证、去重/幂等，并如何驱动订单履约或异步任务。 | `unknown` | 尚未读取项目资料。 | 按“当前行为”和“稳定约束”搜索 webhook、签名、事件 ID、幂等、worker/任务与测试。 |
| 当前实现是否受已确认技术决定或工程约定约束，且这些约束与代码是否一致。 | `unknown` | 尚未读取项目资料。 | 按“技术决定/工程约束”搜索支付、订单、webhook、idempotency 的 ADR 与工程约定命中段。 |
| 哪些现有测试、路由或脚本可在不触发真实支付的前提下验证变更影响。 | `unknown` | 尚未读取项目资料。 | 按“验证入口”搜索支付/订单测试、路由与 package scripts。 |

### 读取后重估 1（当前行为命中后）

| Need | Status | Evidence | Next lookup |
|---|---|---|---|
| 订单已创建后，支付失败、取消或未完成时，用户/系统目前能经由什么入口恢复或重试，以及会写入哪些状态。 | `inferred` | `packages/server/src/application/payments.ts:205-245` 仅允许 `failed` intent 创建新 attempt 并回到 `requires_action`；`payments.ts:351-404` 支持可信事件、查询 reconcile 和 sandbox action；`application/orders.ts:112-183,230-240` 保障成功支付补单。尚未确认 UI 是否暴露所有入口。 | 读取支付页面/契约和 E2E 的命中片段，确认用户可见路径。 |
| 订单、报价/金额快照、支付记录之间哪些值和状态转换必须保持不可变，哪些模块拥有写入权。 | `inferred` | 支付创建把 Quote 金额和确认的地址快照复制到 intent（`payments.ts:142-168`）；订单以 intent 金额和购买快照建单（`orders.ts:124-148`）。尚缺数据库级不可变/状态机证据。 | 按“当前行为/稳定约束”读取支付和订单 migration、schema 与集成测试命中段。 |
| webhook 或其他可信支付事件如何被认证、去重/幂等，并如何驱动订单履约或异步任务。 | `inferred` | `payments.ts:261-359` 验证 provider event、以 providerEventId 去重、只处理合法状态转换，成功时建立订单恢复 job；尚缺 provider 信任配置与 DB 防伪证据。 | 读取 sandbox provider、迁移和集成测试命中段。 |
| 当前实现是否受已确认技术决定或工程约定约束，且这些约束与代码是否一致。 | `unknown` | 本轮未读取 ADR/工程约定。 | 先搜索相关 ADR/工程约定关键词，只读取支付/订单命中段。 |
| 哪些现有测试、路由或脚本可在不触发真实支付的前提下验证变更影响。 | `inferred` | 路由存在 retry/reconcile/sandbox complete；`payments.integration.test.mjs` 和 `web/tests/e2e-payments.test.mjs` 命中名称。尚未读取断言与脚本。 | 读取测试关键断言及 package script 命中段。 |

## 交付物

一张变更影响图，至少包含：

- 当前行为与证据；
- 必须保持的不可变约束；
- 可能受影响的模块与验证入口；
- 未解决的 unknown / conflict；
- 实际读取的文件和精确引用。

## 验收

- 开始时没有全文读取 PRD、Architecture、全部 ADR 或全部历史资料；
- 无关全文读取数为 0；
- 当前行为结论由代码或测试支持；
- 目标边界与历史材料没有混用；
- 至少提供三个精确引用；
- 没有修改业务代码、云资源、`CLAUDE.md`、未跟踪的 `AGENTS.md` 或其他无关文件；
- 复盘回答：少读了什么、是否漏掉关键约束、哪个 Router 入口值得固化。

## 试验结果（只读）

### 最终 Working Model

| Need | Status | Evidence |
|---|---|---|
| 当前重试与恢复路径 | `verified` | UI 对 `failed` 展示“重试支付”、对所有 intent 提供“主动查单”（`web/app/(app)/payments/PaymentsClient.tsx:17-22`）；应用层只允许 `failed` intent 新建 attempt 并回到 `requires_action`（`packages/server/src/application/payments.ts:205-245`）。 |
| 订单、报价与支付的不可变约束 | `verified` | payment intent 创建时锁定已接受 Quote、确认地址、金额和地址快照（`packages/server/src/application/payments.ts:132-172`）；数据库禁止改写 intent 金额/快照，并限制状态迁移（`packages/server/prisma/migrations/20260720001500_c3_sandbox_payments/migration.sql:178-217`）。 |
| 可信事件、去重与订单恢复 | `verified` | 事件经 provider 验签、按 `providerEventId` 去重；成功时创建 `order_recovery` job 并同步 `ensureOrderForSucceededPayment`（`packages/server/src/application/payments.ts:261-359`）。订单 insert 又要求已验证、已应用、金额一致的成功事件（`packages/server/prisma/migrations/20260720023000_c4_orders_recovery/migration.sql:60-126`）。 |
| 已确认边界及工程约束 | `verified` | Architecture 将支付与订单分别归属，并要求高风险模块具备幂等、审计、不可变快照（`ARCHITECTURE.md:232-252`）；工程约定要求重复成功通知只入账一次、渠道流水可与订单对账（`docs/governance/engineering-conventions.md:30-53`）。未找到与此相冲突的支付专用 ADR 命中。 |
| 无真实扣款的验证入口 | `verified` | Browser E2E 覆盖“失败 → 重试 → 成功 → 一个订单”，并断言无真实支付按钮（`web/tests/e2e-payments.test.mjs:201-271`）；并发集成测试验证 10 次重试只新建一个 attempt（`packages/server/tests/payments.integration.test.mjs:380-392`）。本轮未运行测试或支付操作。 |

### 订单支付恢复/重试影响图

```text
已接受 Quote + 已确认地址
  │  服务端锁定金额、币种、地址版本与快照
  ▼
PaymentIntent (requires_action, sandbox_only)
  ├─ 当前用户入口：/payments → 沙箱支付页
  │    └─ 失败可信事件
  ▼
PaymentIntent (failed)
  ├─ Web: PaymentsClient “重试支付”
  ├─ API: POST /payment-intents/:id/retry
  └─ Application: 仅 failed 可创建新 PaymentAttempt
       └─ 新 attempt + requires_action（不伪造支付事件）
            │
            ├─ sandbox action / webhook：验签、去重、状态机检查
            └─ reconcile：向 provider 主动查单后走同一事件处理
                 │
                 ▼
          verified succeeded PaymentEvent（append-only）
                 │
                 ├─ 同步 ensureOrderForSucceededPayment
                 └─ enqueue order_recovery（worker 兜底）
                      ▼
             一个 immutable paid Order（或恢复既有订单）
```

#### 任何变更必须保持的约束

- 不得让客户端、普通 route 或人工 SQL 直接把 payment/attempt 改成成功；状态推进需要新的可信事件。失败重试是唯一回到 `requires_action` 的例外，但必须有新的 provider attempt，且不改写 `lastAppliedEventId`（`packages/server/prisma/migrations/20260720001500_c3_sandbox_payments/migration.sql:185-217`）。
- Quote 金额/币种、确认地址版本和支付快照进入 intent 后不可改；支付事件必须与对应 attempt 同源，并带有效 persistence proof；事件 ledger 不可改写或删除（`packages/server/prisma/migrations/20260720001500_c3_sandbox_payments/migration.sql:138-183,292-312`）。
- 订单只能来自同一 owner、已接受/已批准的 sandbox Quote，以及金额和币种一致的已验证成功事件；订单快照不可改，唯一合法更新是带可信 owner proof 的 `paid → canceled`（`packages/server/prisma/migrations/20260720023000_c4_orders_recovery/migration.sql:75-94,152-177`）。
- 重试/恢复改动必须维持并发语义：并发十次重试只能一个成功、九个域冲突、总 attempt 数为二（`packages/server/tests/payments.integration.test.mjs:380-392`）。

#### 变更影响与验证入口

| 若改动 | 至少会影响 | 需要回归的入口 |
|---|---|---|
| 重试资格、attempt 创建或并发处理 | `packages/server/src/application/payments.ts`、retry route、支付 UI、C3 database guards | `packages/server/tests/payments.integration.test.mjs:380-392`；`web/tests/e2e-payments.test.mjs:241-267` |
| 事件验签、去重、reconcile 或成功状态处理 | payment provider port/adapter、`ingestPaymentEvent`、payment event guards、reconcile/webhook routes | `packages/server/tests/payments.integration.test.mjs:199-378`（事件、金额、伪造与 append-only 断言）；支付 E2E |
| 成功支付后的订单恢复 | `application/orders.ts`、`order_recovery` job、worker handler 与注册、C4 guards | `packages/server/src/application/orders.ts:112-163,230-240`；`worker/src/handlers/orderRecovery.ts:6-19`；`worker/src/main.ts:76-94`；订单集成测试 |
| 从 sandbox 接入真实渠道 | provider trust/config、callback route、契约、运维对账与异常恢复 | 先补真实渠道验签/重复回调/对账的环境测试；上线前 checklist 的备份恢复、回滚、监控、对账、审计必须清零（`docs/governance/engineering-conventions.md:44-55`）。 |

### 未解决缺口

| Gap | Status | 为什么保留 |
|---|---|---|
| 真实微信/支付宝的 provider adapter、回调签名与生产运行状态 | `unknown` | 本轮按试验边界不访问云资源、不读取无关部署资料，也不运行支付；当前 UI 明确为 sandbox，不可据此推断真实渠道已接入或可上线。 |
| 真实渠道的退款、部分履约、支付超时与人工异常处置策略 | `unknown` | Architecture 把部分履约列为后续演进，退款细则仍是模块/运营决策（`ARCHITECTURE.md:304,390-392`）；本轮未得到已确认实现或决定。 |
| 来源冲突 | `conflict`：无 | Architecture 的微信/支付宝目标边界与当前 sandbox-only 实现属于阶段差异：前者未声称已实现，后者也明确禁止将 sandbox 成功视为真实成交；因此不是冲突。 |

### 检索日志（实际读取）

| 缺口 | 查询能力 | 实际命中并读取的片段 | 结论状态 |
|---|---|---|---|
| 当前重试/恢复 | 当前行为 | `packages/server/src/application/payments.ts:118-245,247-404`; `packages/server/src/application/orders.ts:73-240`; `web/app/(app)/payments/PaymentsClient.tsx:9-22`; retry/reconcile routes | `verified` |
| 不可变与可信状态机 | 当前行为、稳定约束 | `packages/server/prisma/migrations/20260720001500_c3_sandbox_payments/migration.sql:138-217,292-312`; `packages/server/prisma/migrations/20260720023000_c4_orders_recovery/migration.sql:60-126,152-177` | `verified` |
| 订单恢复 worker | 当前行为 | `worker/src/handlers/orderRecovery.ts:1-19`; `worker/src/main.ts:76-94` | `verified` |
| 已确认边界/工程规则 | 目标边界、工程约束 | `ARCHITECTURE.md:232-252,295-316,362-370,382-392`; `docs/governance/engineering-conventions.md:30-55` | `verified` |
| 可执行验证入口 | 测试 | `web/tests/e2e-payments.test.mjs:201-271`; `packages/server/tests/payments.integration.test.mjs:199-392`（仅命中断言片段） | `verified` |

未整份读取任何 PRD、`ARCHITECTURE.md`、ADR 集合、archive 或无关代码；无关全文读取数为 **0**。未访问 `PetScape-PRD.md`（产品结果未发生歧义），未读取 archive，也未对云资源或支付执行操作。

### 验收与复盘

- 通过：读取前已列 5 个知识需求；读取后已在“读取后重估 1”重新评估；每个结论都有命中片段；给出超过三个精确引用；本试验只更新本文件。
- 可执行门禁：**尚未运行**。这是只读影响分析，协议允许以不少于三个精确代码/测试引用验收；真实运行、真实 provider 和上线状态均未验证。
- 少读了什么：整份 PRD、整份 Architecture、全部 ADR、archive、无关 Web/worker 文件和真实云部署资料。
- 是否漏掉关键约束：未发现会改变当前影响图的冲突；数据库 guards 显示约束由持久化层强制，这一点不能只靠 UI 或应用层结论替代。真实渠道/退款仍为明确保留缺口。
- 值得固化的 Router 入口：先从“当前支付行为”命中 `payments.ts`、支付 E2E 与 C3/C4 migration，再仅补读 Architecture 的数据归属/不可变快照片段；它能最快区分 sandbox 当前事实、目标边界与上线缺口。

## 独立完整性审计

独立 Agent 没有继承上面的检索路径，从当前代码、测试、配置、CI、Architecture 与有效 ADR 重新建立对照。它确认试验答案命中的重试、事件、数据库约束和补单路径基本准确，同时发现了会改变变更影响判断的遗漏。

| 试验未建模的缺口 | 为什么会改变判断 | 证据 |
|---|---|---|
| 首次 provider 创建失败后的修补路径 | intent 可能已经存在但没有 attempt；恢复入口不是 `retryPaymentIntent`，而是用原幂等键再次调用创建入口 | `packages/server/src/application/payments.ts:90-116,171-184` |
| 旧 attempt 迟到成功 | 新 attempt 创建后，旧 attempt 的可信成功事件会被记为 `ignored_stale`；真实渠道可能已经扣款，却不建单也不进入异常状态 | `packages/server/src/application/payments.ts:280-286` |
| `canceled` 与 `needs_attention` 的恢复死路 | retry 只接受 `failed`，同一 Quote 又只能有一个 intent；当前没有恢复或人工解除入口 | `packages/server/src/application/payments.ts:205-245`; `packages/server/prisma/schema.prisma:668` |
| 没有自动查单或渠道对账 | reconcile 只有用户按钮/API；Worker 只补已 succeeded 但缺订单的情况，不能发现 provider 已成功、本地仍 processing | `packages/server/src/application/payments.ts:362-384`; `worker/src/handlers/orderRecovery.ts:1-19` |
| 三层补单中的静默失败 | 除同步补单和 Worker 外，订单列表会机会式补最老的 10 笔缺失订单，但 `Promise.allSettled` 的异常没有记录或返回 | `packages/server/src/application/orders.ts:165-183` |
| 恢复测试边界 | Browser E2E 证明同步补单；没有证明 Web 在事件落库后崩溃时 Worker 最终补单，也没有完整覆盖 Job 的认领、错误分类和五次重试 | `web/tests/e2e-payments.test.mjs:241-267`; `packages/server/tests/orders.integration.test.mjs:101-175` |
| 外部调用位于 Serializable 事务内 | 重试持锁期间调用 provider；事务冲突或连接中断可能重放调用，真实 provider 必须保证 merchant key 幂等 | `packages/server/src/application/payments.ts:210-235` |
| 生产与多 provider 边界 | 生产配置禁用支付，DTO 与 action URL 仍是 sandbox；provider event/payment ID 又是全局唯一，接微信与支付宝前需重新确认命名空间 | `packages/server/src/infra/config/schema.ts:103-139`; `packages/server/prisma/schema.prisma:706,731` |

### 试验判定

- **检索精度：通过。** 无关全文读取数为 0，已命中的结论有准确代码、migration 和测试证据。
- **检索完整性：未通过。** 执行 Agent 在自评中写“未发现会改变当前影响图的冲突”，但独立审计发现了多项未进入 Working Model 的高风险缺口。
- **协议结论：暂不固化到项目入口。** 第一版能控制无关读取，但“Agent 先决定自己缺什么”仍受未知盲区限制。通用协议增加一次 negative-space audit 后，再进行第二轮不同任务试验。
