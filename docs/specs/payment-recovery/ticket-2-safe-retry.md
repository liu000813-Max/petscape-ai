# Ticket 2：安全重新支付

- 状态：Blocked by Ticket 1
- 前置：[支付异常恢复 Spec](README.md)、[Ticket 1](ticket-1-non-silent-anomalies.md)
- 证据目录：`docs/evidence/payment-recovery/ticket-2/`

## 结果

用户可以恢复明确失败或取消的沙箱支付，但任何可能已经成功、仍在处理或金额冲突的 attempt 都会阻止新 attempt。

## 实施边界

- retry contract 的 `expectedStatus` 支持 `failed | canceled`。
- retry 与 reconcile 在决定恢复前查询该 intent 的全部 attempts，而非只看最后一次。
- 任一 attempt 存在可信成功、处理中或金额冲突时拒绝创建新 attempt；状态冲突进入 `needs_attention`。
- 10 个并发恢复请求最多创建一个新 attempt；merchant payment ID 与 provider 幂等输入保持确定性。
- provider 首次创建失败后，使用相同幂等输入恢复，不产生重复 attempt。
- migration 收紧状态保护：只有同一恢复事务已创建带可信 provider proof 的新 attempt，才允许 `canceled → requires_action`。
- 不重构真实 provider 的事务/outbox；“外部调用不得长期位于数据库事务内”登记为真实渠道上线门禁。

## 验收

- `failed` 与 `canceled` 浏览器流程都经过主动查单再恢复。
- 集成测试覆盖全部 attempts 的成功、处理中、金额冲突门禁。
- PostgreSQL 16 上 10 请求并发恢复只产生一个新 attempt，Quote、金额和地址快照不变。
- 数据库 trigger 直接拒绝没有可信新 attempt 的 `canceled → requires_action`。
- receipt 记录测试命令、exact SHA、数据库环境、结果和未验证边界。
