# Ticket 2 receipt：安全重新支付

- 实现 SHA：`a22879021f2839683b947a4e80393556f0bfc12f`
- 验证日期：2026-07-20
- 环境：macOS，Node `v24.7.0`，pnpm `10.23.0`，Docker PostgreSQL `16-alpine`
- 数据库：一次性本机 `petscape_ticket2_test`，由 15 个 migration 从空库构建
- 交易边界：`NODE_ENV=test`，动态测试 secret，sandbox provider；没有真实扣款

## 红灯

实现前的事故测试按预期失败：

- contract 不接受 `canceled` retry，也不能产生取消沙箱事件；
- canceled PaymentIntent 不能恢复；
- 旧 attempt 已在 provider 成功但事件丢失时，retry 没有查它，仍创建了第三个 attempt。

## 绿灯

| 验证层 | 命令或入口 | 结果 |
|---|---|---|
| migration | `pnpm --filter @petscape/server db:migrate:deploy` | 空 PostgreSQL 16 成功应用 15/15 migrations |
| provider trust | `pnpm --filter @petscape/server db:configure:sandbox-payment-test` | 一次性测试库 trust 配置成功 |
| contract | `node --test tests/payments-contract.test.mjs` | 7/7 通过 |
| 资金、竞态与订单集成 | `node --test --test-concurrency=1 tests/payments.integration.test.mjs tests/orders.integration.test.mjs` | 23/23 通过 |
| 用户浏览器 | `node --test --test-concurrency=1 tests/e2e-payments.test.mjs` | 3/3 通过；failed 恢复、迟到成功人工关注、canceled 查单后重新支付 |
| 静态检查 | server lint/typecheck，web targeted eslint/typecheck，`lint:baseline` | 通过；baseline 为 11/17 errors、26 warnings，没有新增 error |
| production build | `pnpm --filter web build` | 成功 |
| schema | `prisma validate` | 通过 |

集成场景还证明：全部 attempts 都被查询；可信成功、处理中或金额不符都会拒绝新 attempt；首次 provider create 失败可用同一幂等输入恢复；10 个并发恢复请求只有一个成功，PaymentIntent 的 Quote、金额与地址快照不变；数据库拒绝没有当前 provider proof 的 `canceled → requires_action`。

## 行为证据

- [取消后重新支付](canceled-retry.png)：页面显示“已查清全部渠道尝试”，恢复后为第二次 `requires_action` attempt。
- SHA-256：`73cd43b3261fd4f07c7469c860131e76fd98496072f83aee26bd45392c7567d4`

## 未验证边界

- 尚未在 GitHub CI 的合并后 exact SHA 上复跑；将在全部 Ticket 合并后验收。
- 没有连接生产 RDS、ECS 或真实支付渠道；production 仍应 fail-closed。
- sandbox provider 的创建调用仍位于数据库事务内；真实渠道接入前必须完成 outbox 或等价可恢复边界，门禁已写入工程约束。
