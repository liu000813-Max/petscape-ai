# Ticket 1：异常不静默

- 状态：Done（实现 `2d6e82d18611e51e0e24412b6059c945fc3851fd`；[行为证据](../../evidence/payment-recovery/ticket-1/README.md)）
- 前置：[支付异常恢复 Spec](README.md)
- 证据目录：`docs/evidence/payment-recovery/ticket-1/`

## 结果

旧 attempt 的可信成功和任何可信金额冲突不再被当作普通 stale event 静默吞掉。用户与管理员都能读到稳定的机器原因，且系统不创建订单。

## 实施边界

- 为 PaymentIntent 持久化可空的 `attentionCode`，至少支持 `amount_mismatch`、`stale_succeeded_attempt`、`provider_state_conflict`。
- 旧 attempt 的可信成功写入 append-only PaymentEvent 后，把 intent 推进到 `needs_attention`。
- 旧 attempt 的失败或取消仍可保存为 `ignored_stale`，不覆盖最新 attempt。
- PaymentIntent contract 输出 `attentionCode`；旧数据和无法归类的 `needs_attention` 输出 `unspecified`。
- 用户支付页和管理员只读入口先具备机器可读原因；管理员完整队列在 Ticket 3 闭合。
- 任何 `needs_attention` 路径禁止创建 Order。

## 验收

- 集成测试证明金额不符与旧 attempt 迟到成功都进入人工关注、事件保留且订单数为零。
- 集成测试证明旧 attempt 迟到失败/取消不覆盖最新 attempt。
- contract、API 与用户页面显示稳定原因码。
- receipt 记录测试命令、exact SHA、数据库环境、结果和未验证边界。
