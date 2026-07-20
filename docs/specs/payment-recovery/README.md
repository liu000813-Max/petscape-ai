# 沙箱支付异常恢复 Spec

- 状态：Active
- 批准日期：2026-07-20
- 范围：PetScape sandbox-only 支付与订单恢复竖切
- 上游正本：[产品边界](../../../PetScape-PRD.md)、[架构与数据归属](../../../ARCHITECTURE.md)、[工程约束](../../governance/engineering-conventions.md)、[C 线沙箱边界](../../plans/c-line-execution-plan.md)

## 用户结果

沙箱支付出现明确失败、用户取消、迟到成功、金额冲突或补单故障时，系统必须给用户和管理员一个可解释、可恢复、不会重复成单的结果：

1. 明确失败或取消的支付，在服务端查清所有支付尝试后可以安全重新支付。
2. 任何可信成功、仍在处理或金额冲突都会阻止创建新的支付尝试。
3. 无法自动判定安全性的情况进入 `needs_attention`，用户看得到原因，管理员可以只读定位；系统不自动创建订单。
4. 可信支付成功后，同步建单与 durable `order_recovery` 补单共享幂等终点，只产生一个订单。
5. 订单列表读取没有补单副作用。补单失败由 API 状态、管理员页面、Job 状态和结构化日志共同暴露。

## 失败语义

| 事实 | 系统结果 | 用户恢复动作 | 自动建单 |
|---|---|---|---|
| 最新支付明确 `failed`，全部 attempt 均无成功、处理中或金额冲突 | 保持失败事实 | 可以查单后重新支付 | 否 |
| 最新支付明确 `canceled`，全部 attempt 均无成功、处理中或金额冲突 | 保持取消事实 | 可以查单后重新支付 | 否 |
| 任一旧 attempt 收到可信成功 | `needs_attention` + `stale_succeeded_attempt` | 等待人工处理 | 否 |
| provider 与本地状态形成可信冲突 | `needs_attention` + `provider_state_conflict` | 等待人工处理 | 否 |
| 可信事件或查单金额与 PaymentIntent 不符 | `needs_attention` + `amount_mismatch` | 等待人工处理 | 否 |
| 旧数据或无法归类的人工关注 | `needs_attention` + 对外 `unspecified` | 等待人工处理 | 否 |
| 可信成功且订单尚未生成 | 显示补单中或补单失败 | 系统同步创建或 durable job 重试 | 仅可信成功可建 |

`needs_attention` 是本轮终态。不得提供“强制成功”或“强制建单”接口。

## 公开语义

PaymentIntent 的公开响应必须包含：

- 可空的 `attentionCode`；旧数据或无法归类的人工关注对外归一为 `unspecified`；
- 服务端派生的 `recoveryAction`，客户端不得自行从零散状态推断资金安全动作；
- `orderRecoveryStatus`，区分尚未成功、补单中、订单已生成、补单失败和需要人工处理。

retry 输入的 `expectedStatus` 支持 `failed | canceled`。reconcile URL 保持不变，但必须处理该 PaymentIntent 的全部 attempts。管理员只读接口复用现有 admin 权限，不新增状态改写能力。

## 安全不变量

- PaymentIntent 的金额、币种、Quote 和地址快照不因恢复而改变。
- 只有可信 provider event 或主动查单证明可以影响资金状态。
- 任何 `needs_attention` 都不创建 Order。
- 并发恢复只能创建一个新 PaymentAttempt；merchant payment ID 与 provider 幂等输入保持确定性。
- `canceled → requires_action` 只允许发生在同一事务已创建带可信 provider proof 的新 attempt 时；其他路径由数据库拒绝。
- 生产继续 fail-closed，sandbox provider 不得在 production 启用。
- 本轮不把真实 provider 外部调用移出数据库事务；该改造是接入真实渠道的上线门禁。

## 验收终点

- 金额不符与旧 attempt 迟到成功进入 `needs_attention`，保留 append-only event，不创建订单。
- 旧 attempt 迟到失败或取消可保存为 stale event，不覆盖最新 attempt。
- `failed` 和 `canceled` 恢复前查询全部 attempts；任一可信成功、处理中或金额冲突都会拒绝重试。
- 10 个并发恢复请求只创建一个新 attempt，且支付输入快照不变。
- provider 首次创建失败后，同一幂等输入可恢复，不产生重复 attempt。
- succeeded PaymentIntent 的同步建单和 Worker 补单均幂等，只产生一个 Order。
- 补单失败可由 API、管理员只读页、durable Job 和结构化日志定位。
- 浏览器覆盖失败重试、取消重试、迟到成功人工关注以及补单中/失败/完成状态。
- 独立 Agent 完成 negative-space audit，覆盖 provider 失败、迟到事件、数据库 trigger、Worker 崩溃与 production fail-closed。
- 合并后的 exact SHA 在 CI PostgreSQL 16 完成 migration、集成测试与浏览器测试；生产仍保持支付 disabled，不做真实扣款验收。

## Ticket 顺序

三个 Ticket 共享 payment schema、migration、contract 和状态机，必须顺序实现：

1. [异常不静默](ticket-1-non-silent-anomalies.md)
2. [安全重新支付](ticket-2-safe-retry.md)
3. [补单与人工关注可见](ticket-3-recovery-visibility.md)

每张 Ticket 独立提交行为证据到 `docs/evidence/payment-recovery/<ticket>/`。若 negative-space audit 发现会改变资金安全判断的新缺口，先修订本 Spec，再扩大实现。

## 非目标

- 微信、支付宝或其他真实支付 provider；
- 退款、部分支付、定时渠道轮询、真实对账和真实扣款；
- 人工强制结算、强制建单或修改资金状态；
- Landing 正式链迁移、旧证据归档、Worktree 清理、ADR/Runbook 批量整理。
