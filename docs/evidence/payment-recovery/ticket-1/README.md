# Ticket 1 receipt：异常不静默

- 实现 SHA：`2d6e82d18611e51e0e24412b6059c945fc3851fd`
- 验证日期：2026-07-20
- 环境：macOS，Node `v24.7.0`，pnpm `10.23.0`，Docker PostgreSQL `16-alpine`
- 数据库：一次性本机 `petscape_ticket1_test`，由 14 个 migration 从空库构建
- 交易边界：`NODE_ENV=test`，动态测试 secret，sandbox provider；没有真实扣款

## 红灯

实现前的事故测试按预期失败：

- payment contract 2 个失败：`attentionCode` 被 strict schema 拒绝；
- payment integration 3 个失败：普通 intent 没有 `null` 原因、金额不符没有 `amount_mismatch`、旧 attempt 迟到成功仍停在 `requires_action`。

这组失败把缺失能力定位在公开 contract、持久化原因和迟到事件状态机，而不是测试环境。

## 绿灯

| 验证层 | 命令或入口 | 结果 |
|---|---|---|
| migration | `pnpm --filter @petscape/server db:migrate:deploy` | 空 PostgreSQL 16 成功应用 14/14 migrations |
| provider trust | `pnpm --filter @petscape/server db:configure:sandbox-payment-test` | 一次性测试库 trust 配置成功 |
| contract | `node --test tests/payments-contract.test.mjs` | 6/6 通过 |
| 资金、竞态与订单集成 | `node --test --test-concurrency=1 tests/payments.integration.test.mjs tests/orders.integration.test.mjs` | 18/18 通过；含金额不符、旧 attempt 成功/失败/取消、provider 冲突、补单门禁、10 请求并发 |
| 用户浏览器 | `node --test --test-concurrency=1 tests/e2e-payments.test.mjs` | 2/2 通过；含 401/403 管理队列权限、旧 attempt 迟到成功原因可见、订单数为 0 |
| 静态检查 | server lint/typecheck，web targeted eslint/typecheck，`lint:baseline` | 通过；baseline 为 11/17 errors、26 warnings，没有新增 error |
| production build | `pnpm --filter web build` | 成功；包含 `/admin/payments` 与 `/api/v1/admin/payment-attention` |

## 行为证据

- [旧 attempt 迟到成功页面](stale-succeeded-attempt.png)：用户看到“需要关注”、中文原因与机器码 `stale_succeeded_attempt`。
- SHA-256：`f2a781a618acabf36884a299bc1eb50277d8b68e0f879bb941eaddd4663a68af`

管理员只读队列由 contract、真实 PostgreSQL 权限测试和 production build 覆盖；普通用户调用返回 403。没有提供 POST、PATCH、DELETE 或强制建单入口。

## 未验证边界

- 尚未在 GitHub CI 的合并后 exact SHA 上复跑；将在全部 Ticket 合并后验收。
- 没有连接生产 RDS、ECS 或真实支付渠道；production 仍应 fail-closed。
- 本 Ticket 没有单独录制管理员页面视觉证据；其 API 权限与只读数据行为已自动验证，完整管理员恢复可见性留在 Ticket 3。
