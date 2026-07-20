# Payment recovery negative-space audit

- 日期：2026-07-20
- 方式：独立 Agent 在不知道原实现检索路径的条件下只读审计；修复后由另一独立 code-review Agent 复审
- 结论：sandbox-only 当前没有资金安全 Blocker；单 Order 幂等终点与 production fail-closed 成立

## 覆盖范围

- provider 创建失败、身份错配、payment ID 碰撞和同步终态；
- 重复、迟到、乱序、旧 attempt 与异 payload 同 event ID；
- PaymentIntent、PaymentAttempt、PaymentEvent、Order 和 history 的数据库 trigger；
- Worker 在 claim、handler、complete/fail 前后的崩溃、租约过期和尝试次数耗尽；
- production 配置、sandbox provider constructor 与部署环境；
- 管理员权限、错误脱敏和订单读取副作用。

## 审计发现与收口

| 初始发现 | 收口 | 行为门禁 |
|---|---|---|
| 首次创建失败后 UI 丢失幂等键 | 由 Quote ID 的 SHA-256 确定性派生，不依赖 localStorage | Chromium 故障注入：两次 POST key 相同，零 attempt 恢复后仅一个 attempt |
| reconcile 查 A 可应用 B | 严格核对被查询 provider payment ID | 集成测试证明 A/B 均不被推进 |
| `P2002` 一律吞掉 | 回读同一 intent/attempt，核对 provider、payment ID 和状态 | provider ID 碰撞显式 `PaymentConflictError` |
| create 接受同步 processing/终态 | sandbox 创建只接受 `requires_action` | processing 创建结果被拒，数据库无 attempt |
| event ID 重用不核对 payload | 核对 provider、payment ID、source、状态、金额、时间和规范 payload | 异 payload 返回应用冲突，HTTP 映射 409 |
| PaymentIntent、Order、Job 分次读取 | `RepeatableRead` 同快照派生公开恢复状态 | contract/集成与浏览器状态通过 |
| Job 可超限认领，过期租约仍可提交 | claim、complete、fail 与 orphan recovery 都检查租约和 `maxAttempts` | Job 事故测试 15/15 |
| 补单重试依赖英文 message | 按 Prisma code、SQLSTATE 和网络错误 code 分类 | P1001、P2024、P2034、40001、40P01、ECONNRESET、ETIMEDOUT 测试 |
| 管理员返回原始 stack | 只返回稳定 `errorCode` 与固定 `errorSummary` | strict contract 拒绝 `errorDetail`，浏览器不显示故障原文 |

修复复审另外发现 query event ID 不应哈希 adapter 的额外字段，以及 crash 耗尽日志缺少直接测试。最终实现只 fingerprint 固定规范字段，并把 orphan 结果到结构化日志的映射抽成纯函数测试。

## 仍然成立的上线门禁

- 真实 provider 外部调用不得长期位于数据库事务内，需 outbox 或等价可恢复边界；
- migration owner 与 Web/Worker runtime DB role 必须分离；
- 接真实渠道前需真实对账、退款、告警和人工处理流程。

这些边界没有被 sandbox 证据证明，不能把本轮通过描述为真实支付可上线。
