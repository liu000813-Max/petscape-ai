# Ticket 3：补单与人工关注可见

- 状态：Done（实现 `97e3f95ac975d04c905f28d89ae7b3d68ebebe63`；[行为证据](../../evidence/payment-recovery/ticket-3/README.md)）
- 前置：[支付异常恢复 Spec](README.md)、[Ticket 2](ticket-2-safe-retry.md)
- 证据目录：`docs/evidence/payment-recovery/ticket-3/`

## 结果

用户能区分付款尚未成功、补单中、订单已生成和需要人工处理；管理员能只读查看支付异常；补单失败留下 durable、可检索证据。

## 实施边界

- PaymentIntent contract 输出服务端派生的 `recoveryAction` 与 `orderRecoveryStatus`。
- 移除 Order 列表读取时的静默补单副作用；补单只走同步创建和已有 durable `order_recovery` Job。
- Worker 补单失败更新 Job 状态并写结构化日志。
- 新增复用现有 admin 权限的支付异常只读 API 与页面，不提供状态修改动作。
- 根目录增加 `pnpm validate:payment-recovery`，串联 payment/order 静态检查、集成测试与浏览器测试。缺少测试数据库或浏览器前置条件时失败，不允许 skip。
- 根目录增加 `pnpm validate:docs`，检查 whitespace 与活动 Markdown 相对链接。
- 根 `CLAUDE.md` 只指向统一验证入口，不复制底层命令。
- 只在语义真正改变时更新 Architecture、工程约束或 Glossary；PRD 继续明确 sandbox 不代表真实成交。

## 验收

- API 与浏览器显示补单中、失败、完成和人工关注状态。
- 同步建单与 Worker 补单并发或重复执行只产生一个 Order。
- Worker 崩溃或补单失败后，Job 状态和结构化日志保留定位信息。
- 普通用户不能读取管理员异常队列，管理员只能读取、不能改写支付状态。
- 两个根验证入口在所需前置条件齐备时通过，缺失条件时明确失败。
- receipt 记录测试命令、exact SHA、数据库环境、截图/录屏索引、结果和未验证边界。
