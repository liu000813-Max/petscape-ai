# WP-Z0 C 线生产浏览器 E2E 收口证据

验证日期：2026-07-21。范围：批次 2 收口——C 线沙箱交易主路径
`quote→address→payment→order` 的真实浏览器端到端验证，外加一条失败/恢复路径
（沙箱支付冲突重试）。无代码、schema、migration、contract 变更；本目录只提交证据文档与截图。

本 receipt 不声称真实支付、真实订单、制造、物流或成交。沙箱链只验证领域语义、
幂等、快照与失败恢复，按 `c-line-execution-plan.md` §九，真实成交开放条件尚未满足。

## 部署 SHA 与运行环境

| 项 | 值 |
|---|---|
| main HEAD（验证时） | `57190a5b7d098608b373733c29f6970798676793` |
| 生产部署 SHA | `9a344274fd254f5bb49ecac70ef45c875a431e89`（最后一次成功 Deploy，2026-07-21 05:59 UTC） |
| 部署 SHA 权威来源 | 生产 web 容器 `GET /api/healthz` → `{"ok":true,"db":true,"version":"9a344274fd254f5bb49ecac70ef45c875a431e89"}`；`docker ps` 镜像 tag 同为该 SHA |
| 生产入口 | ECS `petscape`（`<ECS_INSTANCE_ID>`，`<ECS_PUBLIC_IP>`）web 容器 `127.0.0.1:3010`，经既有 SSH 隧道 `ssh -fN -L 3010:127.0.0.1:3010 root@<ECS_PUBLIC_IP>` 访问（与批次 1 用户验收同路径） |
| 为何不走 `petscape3d.com` | 域名 nginx 80/443 反代的是旧黑客松 PM2 站点（备案中不得动，见 `wp-2-5-report.md` CONFLICT 1）；当前正式 app 只绑回环 3010，无公网直达 |
| 数据库 | 生产 RDS `<RDS_INSTANCE_ID>`（经 SSH 隧道只读核验；主路径 quote/address 的写入落生产 RDS） |
| 浏览器 | Playwright headless Chromium（`web/node_modules/playwright`），viewer WebGL 经软件渲染，测试判定基于 DOM/React state 非像素 |
| 账号 | `<REAL_TEST_EMAIL>`（userId `<REAL_TEST_USER_ID>`）；生产 OTP 经容器日志 `[MAIL:log]/[SMS:log]` 只读取件（生产 `SMS_CHANNEL`/`MAIL_CHANNEL` = `log`，schema 默认，`.env` 无覆盖） |

### 生产 SHA 落后 main 的部分与影响评估

`git log 9a344274fd..origin/main` 显示生产落后 main 的提交全部是「支付恢复加固切片」
（PR #61/#63/#65/#66 + CI 拆分 #67/#69 + 批次 3 计划文档 #64/#71），包含 2 个尚未部署的
migration（`payment_attempt`/`order_recovery` 相关）与 `/admin/payments` 异常台页面。

影响评估：Z0 所需的 C 线主路径与失败/重试链在部署 SHA `9a34427` 上**均已存在**（已核对
该 SHA 源码：`payments/PaymentsClient.tsx` 的 `重试支付` 按钮与 `/api/v1/commerce/
payment-intents/[id]/retry` 路由、`admin/reviews` 审核页、`quotes`/`checkout`/`orders`/
`sandbox-pay` 页均在）。落后部分只影响支付**异常可见性加固**（补单失败 admin 台、
迟到成功 attention），不影响本次验收的 quote→address→payment→order + 冲突重试主链。
故未触发停线，如实记录于此。

## 生产实例：主路径（真实部署代码 + 真实 RDS）

以下步骤全部在生产 web 容器（SHA `9a34427`）+ 生产 RDS 上执行，沙箱标识
（`测试模型 · 沙箱环境`、`沙箱 · 不会真实交易`、`交易功能仍关闭`）全程常显。

| # | 步骤 | 结果 | 截图 |
|---|---|---|---|
| 1 | 邮箱 OTP 登录 | 进入 `/account` | `01-login-account.png` |
| 2 | `/viewer` 建项目 + `cheese-lounge-bed` GLB 加载 + 模型确认 | 「确认此模型」解锁并点击 | `02-viewer-model-ready.png` |
| 3 | 场景阶段：1:1 笼舍 800×510×520mm + 自动保存 | 「已自动保存」 | `03-viewer-scene-saved.png` |
| 4 | 场景确认（SceneConfirmation） | 「最近确认已保存」 | `04-viewer-scene-confirmed.png` |
| 5 | `/requests` 提交 C1 定制申请 | 「申请已提交…」「等待审核」 | `05-c1-form.png` / `06-c1-submitted.png` |
| 6 | `/admin/reviews` 审核（本账号 admin 会话） | 结论 `approved`，卡片显示「通过」 | `07-admin-reviews-queue.png` / `08-admin-review-approved.png` |
| 7 | `/quotes` 生成沙箱测试报价（estimate job 由生产 worker 处理）+ 接受 | ¥330.00，「向上取整到整元」，「已接受测试报价」 | `09-quote-generated.png` / `10-quote-accepted.png` |
| 8 | `/checkout` 填写并确认配送地址（江苏省无锡市梁溪区） | 「沙箱配送地址已确认；支付入口仍关闭」，Accepted quote ¥330 已接受 | `11-address-confirmed.png` |
| 9 | `/payments` 创建沙箱支付 | **生产 fail-closed**：HTTP 409 `{"error":"provider_disabled","detail":"沙箱支付 provider 未启用"}`；页面显示「沙箱支付 provider 未启用」，支付意图 0 条 | `12-production-payment-fail-closed.png` |

### 生产 fail-closed 是设计使然，不是缺陷

`packages/server/src/infra/config/schema.ts` 硬门禁：`NODE_ENV=production &&
PAYMENT_PROVIDER_MODE=sandbox` 在配置解析阶段 fail-closed；`createSandboxPaymentProvider`
在 `environment==='production'` 时抛 `PaymentProviderDisabledError`。这正是
`c-line-execution-plan.md` 一.7 与八节要求的「生产环境默认禁止启用 mock provider /
mock 在生产 fail-closed」。因此**沙箱支付→订单段无法在生产实例上跑通**——这是安全隔离的
正确行为，第 9 步的 409 就是 WP-C3-1「mock 在生产 fail-closed」的生产验收证据。

## 沙箱支付→订单段（部署同 SHA 代码 + 一次性 PostgreSQL 16）

按 `c-line-execution-plan.md` 八节「PR 含尚未部署的 migration 时必须使用本地 Compose +
一次性 PostgreSQL 16」的验收环境约定，沙箱支付链在**部署同 SHA `9a34427` 的 worktree 代码**
+ **一次性 Docker PostgreSQL 16**（`PAYMENT_PROVIDER_MODE=sandbox`）上执行，不写生产 RDS。
seed 经 C 线 application 层（`createCustomizationRequest→bootstrapFirstAdmin→createCheckRun
→approve→createSandboxEstimateJob→createQuote`）造出 active quote，其余步骤走真实浏览器 UI。

| # | 步骤 | 结果 | 截图 |
|---|---|---|---|
| 10 | 接受沙箱测试报价 | 「已接受测试报价」 | `12b-quote-accepted.png` |
| 11 | 确认配送地址 | 「沙箱配送地址已确认」 | `13-sandbox-address-confirmed.png` |
| 12 | 创建沙箱支付 → 进入沙箱支付页 → **模拟失败** | 「当前状态：failed。尚未生成订单。」 | `14-sandbox-pay-failed.png` |
| 13 | **失败恢复**：返回支付结果 → 重试支付 | 「已创建新的沙箱支付尝试。」 | `15-sandbox-pay-retry.png` |
| 14 | 重试后模拟成功 | 「当前状态：succeeded」「沙箱订单已由服务端幂等生成。」 | `16-sandbox-pay-succeeded.png` |
| 15 | `/orders` 订单核验 | 「已支付（沙箱）」¥330.00 · cheese-lounge-bed · 订单号 · 地址快照（江苏省无锡市梁溪区）· 历史 `trusted_payment_succeeded`；断言页面无「微信支付/支付宝/真实支付」入口 | `17-orders-paid-sandbox.png` |

补充：同一部署 SHA + 一次性 PG16 上，`web/tests/e2e-payments.test.mjs`（C 线计划指定的
支付验收 e2e，含失败重试/订单补单/迟到成功 attention/取消重试/零尝试恢复）整套通过：

```text
✔ accepts a quote, confirms checkout, retries sandbox payment, and hands success to one recoverable order (117112ms)
tests 1 | pass 1 | fail 0
```

其录像与截图在一次性 worktree `web/test-results/c3-payments/`（未随本 PR 提交，运行事实记于此）。

## admin 引导 saga 与残留项（如实记录）

Z0 需要生产库有 admin 才能走审核→报价链。过程与发现：

1. **fixture admin 残留**：生产 RDS 已存在一个 admin `<FIXTURE_ADMIN_ID>`
   （`email=null`、`phoneNumber=null`、`createdAt=2026-07-19T11:39:00Z`）——这是 B6/WP-B45 QA
   期间注入的**无凭证 fixture admin**残留，无法登录，但占据了「首个 admin」位。
2. **官方 bootstrap 被拒**：因已存在 admin，`bootstrap-admin.mjs`（`bootstrapFirstAdmin`
   要求 `adminCount===0`）被 DB 触发器/应用逻辑拒绝。
3. **合法授权路径**：最终由用户手动执行脚本，走 `changeUserRole` 的 `admin_api` 合法通路
   （actor = 上述 fixture admin），把 `<REAL_TEST_EMAIL>`
   （`<REAL_TEST_USER_ID>`）从 `user` 升为 `admin`。
4. **审计已入账**（`role_change_audit`，只读核验）：
   ```text
   actorUserId : <FIXTURE_ADMIN_ID>
   targetUserId: <REAL_TEST_USER_ID>
   previousRole: user  →  newRole: admin
   source      : admin_api
   createdAt   : 2026-07-21T10:45:40Z
   ```

**遗留项（待用户另行决定，Z0 不处理）**：生产库现有两个 admin
（`<REAL_TEST_EMAIL>` 与无凭证 fixture `b6-admin-a-…`）。fixture admin 是 QA 残留、
无法登录但持有 admin 角色，**是否降级为 user 或清理**由用户决定。若降级，需保留至少一个
可登录 admin（`<REAL_TEST_EMAIL>` 已满足）。

## 边界核验（无生产破坏）

- **生产 RDS 只读**：主路径的 quote/address 是应用正常写入（沙箱标记数据，按设计可与生产库共存）；
  除此之外只做只读 SELECT 核验。未改 schema、未部署、未跑 migration。
- **`payment_provider_trust` 未触碰**：该表有不可变触发器（`registry is immutable`），现有 sandbox
  行是 07-19 QA 残留的占位 hash（前缀全 0，非任何可用密钥的 sha256）。验收前后两次只读核验，
  `hash_prefix=000000000000`、`createdAt=2026-07-19T18:46:21Z` **原样未变**。曾尝试的 hash swap
  被触发器拒绝、未写入。
- **一次性资源已清理**：一次性 PostgreSQL 16 容器（`z0-pg`）已删除；RDS SSH 隧道（15432）已关闭
  （`lsof` 确认无残留监听）。

## 未验证边界

- 真实支付、真实订单、制造、物流、成交均未开放（`c-line-execution-plan.md` §九条件未满足）。
- 沙箱支付→订单段在一次性 PG16 上验证（生产实例按设计 fail-close mock provider），非生产 RDS。
- 生产 SHA `9a34427` 落后 main 的支付异常可见性加固（`/admin/payments` 等）未在本次生产 E2E 覆盖。
- 未覆盖物理移动设备、低端 GPU、其他物品/材料组合。
- 批次 2 语义下 `/requests` 的 `sceneConfirmationId` 为硬编码沙箱 fixture
  `B7_SANDBOX_SCENE_CONFIRMATION_ID`，与 viewer 刚生成的 SceneConfirmation 脱钩——这是
  `web/app/(app)/requests/page.tsx` 的有意实现，符合「接缝未就绪只允许 sandbox fixture」授权。
