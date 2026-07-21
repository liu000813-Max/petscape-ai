# Ticket 3 receipt：补单与人工关注可见

- 实现 SHA：`916bdb1589f9f48c39c79af4b1cdb8a891497d01`
- 验证日期：2026-07-20
- 环境：macOS，Node `v24.7.0`，pnpm `10.23.0`，Docker PostgreSQL `16-alpine`
- 数据库：一次性本机 `petscape_payment_916bdb1_test`，由 15 个 migration 从空库构建
- 交易边界：`NODE_ENV=test`，动态测试 secret，sandbox provider；没有真实扣款

## 红灯

初版与独立审计后的事故测试按预期失败：

- provider payment ID 碰撞被误当成幂等成功；
- 同一 provider event ID 的不同 payload 被静默去重；
- reconcile 查 A 却可应用 provider 返回的 B；
- 管理员 contract 暴露原始 `errorDetail`；
- 租约过期后仍可 complete/fail，耗尽的 Job 仍可认领，Worker 崩溃后没有 durable 终态；
- 用户首次支付初始化失败后会丢失幂等键，零 attempt 的 PaymentIntent 没有恢复入口。

## 绿灯

| 验证层 | 入口 | 结果 |
|---|---|---|
| migration | `pnpm validate:payment-recovery` | 空 PostgreSQL 16 成功应用 15/15 migrations |
| contract | 同一根入口 | 9/9 通过；恢复动作、补单状态和脱敏管理员错误为严格契约 |
| Worker 失败 | 同一根入口 | 5/5 通过；handler 失败与 crash 耗尽均映射到 durable 状态和结构化日志 |
| Job 租约与重试 | 同一根入口 | 15/15 通过；过期租约不能提交，`maxAttempts` 耗尽后不能再认领 |
| 资金、竞态与订单集成 | 同一根入口 | 28/28 通过；身份冲突拒绝，订单读取无副作用，同步与 Worker 补单共享唯一订单终点 |
| 用户与管理员浏览器 | 同一根入口 | 4/4 通过；新增零 attempt 恢复、确定性幂等键复用和 event payload 冲突 409 |
| 静态检查 | 同一根入口 | server/worker lint 与 typecheck、web typecheck、目标文件 lint 通过；既有 lint baseline 未增加 |
| production build | 同一根入口 | 通过；包含 `/payments`、`/orders`、`/admin/payments` 与相关 API |
| 活动文档 | `pnpm validate:docs` | 56 个活动 Markdown 的 whitespace 与相对链接检查通过 |

## 行为证据

- [补单中](order-recovering.png)：可信支付成功但同步建单被故障注入中断，用户页显示 `recovering`，订单列表读取后数据库仍无订单。
- [补单失败](order-failed.png)：durable Job 失败后，用户页显示 `failed`，不再给出“查看订单”动作。
- [管理员定位](admin-job-failed.png)：只读页显示稳定错误码与固定摘要，不返回原始 message 或 stack。
- [零 attempt 恢复](zero-attempt-recovery.png)：provider 初始化落库被故障注入中断后，用户看到“恢复支付初始化”，没有错误的主动查单入口。
- [确定性幂等恢复](stable-idempotency.png)：恢复请求使用由 Quote 确定性派生的同一幂等键，最终只产生一个 attempt。
- [独立 negative-space audit](negative-space-audit.md)：覆盖 provider 失败、迟到事件、数据库 trigger、Worker 崩溃和 production fail-closed；复审未发现资金安全 Blocker。

SHA-256：

- `order-recovering.png`：`a4e48a2243806e835881e1903f469da25c9f245b1a3a3bf241a4887da802f1ed`
- `order-failed.png`：`54b6652709cdda3038a025a7e710f438fe6ff8abc4cabb9b03f6f67834670cac`
- `admin-job-failed.png`：`ccadeac0ec6cbc218dac6fc73263006096af85ad5ce1c6e72f63e7048b5fc655`
- `zero-attempt-recovery.png`：`af900f509cf792d87fd2ff700de68dd45960cfe7baafe799c1014927dc5d2aed`
- `stable-idempotency.png`：`0b29a765f91797066d14d8a46d88d29ac7bdae34e4e7c183b4919877ccec02a7`

## 未验证边界

- 尚未在合并后的 GitHub CI SHA 上复跑；当前证据来自实现 exact SHA、本机隔离 PostgreSQL 16 和真实 Chromium。
- 没有连接生产 RDS、ECS 或真实支付渠道；production 继续保持支付 disabled。
- sandbox provider 创建调用仍在数据库事务内；真实渠道接入前必须满足工程约束中的 outbox 或等价可恢复边界。
- migration owner 与 runtime DB role 尚未分离；当前 trigger 是防误写护栏，不是抵御应用进程失陷的独立安全边界。

根验证曾在两个中间 SHA 上主动失败：一次发现并发 provider 创建的时间戳不应作为幂等身份；一次发现 E2E 复用手机号触发 OTP 节流。两处修复后才生成本 receipt 所引用的 exact SHA 证据。
