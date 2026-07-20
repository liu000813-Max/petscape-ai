# Ticket 3 receipt：补单与人工关注可见

- 实现 SHA：`97e3f95ac975d04c905f28d89ae7b3d68ebebe63`
- 验证日期：2026-07-20
- 环境：macOS，Node `v24.7.0`，pnpm `10.23.0`，Docker PostgreSQL `16-alpine`
- 数据库：一次性本机 `petscape_ticket3_full_test`，由 15 个 migration 从空库构建
- 交易边界：`NODE_ENV=test`，动态测试 secret，sandbox provider；没有真实扣款

## 红灯

实现前的事故测试按预期失败：

- PaymentIntent contract 拒绝 `recoveryAction` 和 `orderRecoveryStatus`；
- 管理员 contract 不接受补单 Job 摘要；
- 订单列表 GET 会调用 `recoverOwnerOrders()`，通过 `Promise.allSettled` 静默补单。

## 绿灯

| 验证层 | 入口 | 结果 |
|---|---|---|
| migration | `pnpm validate:payment-recovery` | 空 PostgreSQL 16 成功应用 15/15 migrations |
| contract | 同一根入口 | 8/8 通过；恢复动作和五种补单状态为严格枚举 |
| Worker 失败 | 同一根入口 | 1/1 通过；Job durable `needs_attention`，JSON 日志含 `jobId`、`errorClass=manual`、`outcome=needs_attention` |
| 资金、竞态与订单集成 | 同一根入口 | 24/24 通过；订单读取无副作用，同步与 Worker 补单共享唯一订单终点 |
| 用户与管理员浏览器 | 同一根入口 | 3/3 通过；覆盖失败重试、取消重试、迟到成功、补单中、补单失败、订单已生成和管理员定位 |
| 静态检查 | 同一根入口 | server/worker lint 与 typecheck、web typecheck、目标文件 lint 通过；既有 lint baseline 未增加 |
| production build | 同一根入口 | 通过；包含 `/payments`、`/orders`、`/admin/payments` 与相关 API |
| 活动文档 | `pnpm validate:docs` | 55 个活动 Markdown 的 whitespace 与相对链接检查通过 |

## 行为证据

- [补单中](order-recovering.png)：可信支付成功但同步建单被故障注入中断，用户页显示 `recovering`，订单列表读取后数据库仍无订单。
- [补单失败](order-failed.png)：durable Job 失败后，用户页显示 `failed`，不再给出“查看订单”动作。
- [管理员定位](admin-job-failed.png)：只读页显示 PaymentIntent、Job ID、Job 状态和错误分类，没有资金状态改写入口。

SHA-256：

- `order-recovering.png`：`e1a7e3ff12e8c713581e42801857a0594b2f7326001ac40588077418fffba926`
- `order-failed.png`：`b91685e7288ed10877ccff6621d82321d091693bcd0f295db358b4f8629d8af2`
- `admin-job-failed.png`：`da628ec461b18baf888153898e72ebde570e0565fb4eb1c6e19d13ab97e3996c`

## 未验证边界

- negative-space audit 尚未执行；它将在独立 Agent 不依赖原检索路径的条件下检查 provider 失败、迟到事件、数据库 trigger、Worker 崩溃和 production fail-closed。
- 尚未在合并后的 GitHub CI exact SHA 上复跑；当前证据来自本机隔离 PostgreSQL 16 和真实 Chromium。
- 没有连接生产 RDS、ECS 或真实支付渠道；production 继续保持支付 disabled。
- sandbox provider 创建调用仍在数据库事务内；真实渠道接入前必须满足工程约束中的 outbox 或等价可恢复边界。
