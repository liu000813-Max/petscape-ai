# C 线执行文档:自动报价与交易骨架(B7 + C1 + C2 + C3 + C4 首版)

状态:v1(2026-07-19,用户拍板后编写;**方案已确认、尚未开工**)。上游:`docs/plans/p0-batch-1-execution-plan.md`(编排约定与 A 线现状)、`docs/plans/reference-competitor-3d-flow-2026-07-19.md`(嘉立创流程拆解,参考流程逻辑与状态机、不参考 UI)、`PRODUCT-MODULES.md`(模块正本)、`ARCHITECTURE.md` §5.7/§7.4(高风险模块全额分层纪律、不可变快照)、`docs/governance/engineering-conventions.md`(测试分级/zod/支付前 checklist)。

目标:做出"已确认设计 → 自动报价 → 提交申请 → 支付 → 真实订单"的最小竖切,报价自动、订单落 RDS——P0 主链 7 月验收(第一笔真实订单)的交易段。C 组全新、无原型对应(DoD(b) 豁免)。

## 本批次已拍板(2026-07-19,用户确认)

1. **几何来源 = 服务端解析 job**:新增 `mesh_analysis` 任务类型(现成 SKIP LOCKED 任务系统承载),服务端从 GLB 计算体积/包围盒,报价引擎只读服务端分析结果。几何不经前端,防"前端传值篡改价格"(conventions §1 资金③)。
2. **审核环节 = 支付前人工审核位**:状态机做全(已提交→审核中→通过/拒绝),v1 审核动作由人工经受保护 admin API 执行;`User` 加 `role` 列;审核界面后置给 D1;B6 自动检查将来接同一状态位。不做"自动通过打标记"——PRD"不确定的安全结论不得伪装成通过"。
3. **定价规则 = 公式在代码 + 参数版本表**:公式写死代码、带版本号;材料单价/密度/基础制作费/售价倍数/起步价/实心率系数落版本化 DB 表,改价 = 追加新版本行。Quote 永远引用具体参数版本 + 公式版本,历史报价不漂移;D6 后台将来只管参数。
   公式:`总价 = max(起步价, (基础制作费 + 材料单价 × 重量) × 售价倍数)`,`重量 = 体积 × 材料密度 × 实心率系数`(切片 ADR 未定前实心率取固定值)。表面附加费本批不做。交期 = 材料表配固定天数。
4. **数据模型 = 8 张新表 + User.role**(见"数据模型"节);地址表不建(C5 下一批)、退款表不建(状态机留语义)、确认记录表归 Viewer 批次(C 线只存 string 引用 + 快照冗余,不建表、不加 FK)。
5. **默认口径**(用户未驳,按此执行):面向宠物主只显示**单一含税价** + 构成明细(重量→价格透明推导,竞品启发已确认纳入),不做未税/含税双列;**全款**,不做定金;报价有效期 **7 天,审核通过时起算**(避免审核耗时吃掉有效期);初始定价参数放占位值(首发材料 PLA 白/黑),**真实渠道上线前必须真值化并过用户**;"第一笔真实订单"的合规口径(kickoff 开放问题③)挂账不阻塞开发。
6. 支付两段切沿用 kickoff 已拍板结论(不重议):本批次把渠道语义建真(异步通知、重复通知幂等、金额服务端为准、对账字段),只有 provider 是 mock;微信/支付宝 adapter 等资质到后另开小包。

## 边界(Boundaries)

- 不碰 3D 场景/生成链(Viewer session 的地盘);
- 不接真实支付渠道(资质未下),但架构按真实渠道语义建,不做成只能接桩;
- 不做购物车/退款/多材料扩张;不改 landing;
- 「确认方案→报价输入」contract 由本线定义、落 `packages/server/src/contracts/`,Viewer 侧消费;其未就绪前用 mock 确认数据(fixture GLB)驱动。

## 编排约定(沿用 + 增补)

p0-batch-1 的编排约定全部沿用:证据先行、builder 一律 TDD(红→绿两段证据)、独立 QA(非实现者)真实浏览器录屏、spec 派发前用户确认(数据模型/新接口/用户可见行为置顶——本批已在方案讨论中完成)、migration 串行(同一时间只允许一个在途工作包动 `schema.prisma`)、landing 零回归截图、样式作用域自包含、worktree 不含根 `.env` 需从主 checkout 复制、`gh pr checks --json` 显式判定。

- **带 migration 的 PR 合并后由编排方立即手动 `pnpm db:migrate:deploy`**(部署链不执行 migration,P2021 教训,WP-A3-2 运维事实⓪)。
- **C 线新代码是 conventions §2 的首批全量践行者**:出入参一律 zod,schema 与 DTO 落 `contracts/`;存量 `api/v1/jobs` 等路由的手工 `typeof` 校验回补记挂账,不扩本批 scope。
- **新 job 类型双注册**:worker handler map(`worker/src/main.ts`)+ `WORKER_JOB_TYPES` 环境变量(config `workerSchema`)缺一不可,漏配 env 时代码注册了也不会被认领——写进 WP-B7-1 验收。
- 归属字段模式:交易表涉及资金审计,采用带 FK 的 Project/Asset 式(`owner User @relation(...)`),不用 Job 式无约束字符串。

## 端到端状态机

```
[mock/Viewer 确认方案] → 材料选择 + 实时估价(纯函数,读服务端分析结果+当前参数版本,不落库)
  → 提交申请: CustomizationRequest(submitted) + Quote(pending,输入快照+参数版本锁定)
  → in_review ──admin 审核──→ approved: Quote 激活,validUntil = 审核通过 + 7d
  →→→→→→→→→→→→→→→→→→→→→→→ rejected(附原因,终态)
  → 用户确认报价 → PaymentIntent(幂等,金额只取服务端 Quote)
  → provider(mock,走真实异步通知路径) → 验签入账(PaymentEvent, append-only)
  → 事务生成 Order(全量购买快照) + OrderStatusHistory,Request 闭环
```

用户可见页面(挂 App 壳,循 WP-A1 视觉基准):

- 申请流程页:方案摘要 → 材料选择 → 实时价格+交期 → 联系方式+补充要求 → 单按钮提交(嘉立创式收口);
- 申请列表/详情:状态可见(审核中/通过待支付/已拒绝+原因;C8 通知未建,先靠刷新);
- 报价确认 + 支付页:价格构成明细(重量→价格透明推导)+ 支付按钮 → mock 渠道 → 结果页;
- 订单列表/详情:快照、金额、支付时间、状态。

## Contract(「确认方案→报价输入」)

落 `packages/server/src/contracts/`(本批新建目录),zod schema:

```ts
ConfirmedDesignInput = {
  confirmationId: string,   // Viewer 侧确认记录 id(mock 阶段伪造)
  projectId: string,
  assetId: string,          // 单物品成交(ARCHITECTURE §7.3)
  targetScale: number,      // 用户确认的实际尺寸
  confirmedAt: string,      // ISO datetime
}
```

Viewer 的确认记录表只需能供出这五个字段;几何(体积/包围盒)由服务端 `mesh_analysis` 按 `assetId + targetScale` 计算,幂等键即 `assetId + targetScale`。估价入口发现无分析结果时自动创建 job。

## 数据模型(本批次 schema 变更全集)

| 表 | 角色 | 关键点 |
|---|---|---|
| `Material` | 材料目录(版本化) | 名称/密度/单价/交期天数;改价 = 新版本行,旧行失效不删 |
| `PricingRule` | 计价参数(版本化) | 基础费/倍数/起步价/实心率;append-only |
| `CustomizationRequest` | 定制申请(C1) | 归属(FK User)/设计快照 JSON/材料版本引用/联系方式/补充要求/状态机 |
| `Quote` | 报价(C2) | 输入快照 + 规则版本引用 + 明细 JSON + 总额(分,Int)+ 有效期 + 状态 |
| `PaymentIntent` | 支付意图 | 幂等键/金额/状态 |
| `PaymentAttempt` | 支付尝试 | 渠道/渠道单号/状态 |
| `PaymentEvent` | 渠道事件 | append-only:通知原文 + 验签结果,对账依据 |
| `Order` + `OrderStatusHistory` | 订单 + 状态历史 | 购买全量快照;`paymentIntentId` 唯一约束;谁/何时/从何值到何值(审计) |

另:`User.role`(默认 `user`,审核用 `admin`)。金额一律分为单位的 Int。明细用 JSON(单物品、结构经 zod 校验),不建 QuoteLine 子表。

## 工作包(migration 串行,依次派 builder,全部 TDD 红→绿)

### WP-B7-1 材料目录 + 计价引擎 + 服务端几何分析

范围:
a. `contracts/` 目录落盘(`ConfirmedDesignInput` 等 zod schema);
b. `Material` / `PricingRule` 表 + migration + seed(PLA 白/黑占位参数);
c. `mesh_analysis` worker handler(GLB→体积/包围盒,纯网格几何,不依赖切片 ADR;handler map + `WORKER_JOB_TYPES` 双注册);
d. 估价用例(application 层纯函数)+ 估价 API(实时,不落库)+ mock 确认数据 fixture(预置 GLB 走真实分析,竖切保真)。

TDD 出题:估价随参数版本正确切换;客户端传几何值无效(篡改防线);分析结果归属校验(A 用户读不到 B 的分析);同一 `assetId+targetScale` 重复请求不重复建 job(幂等)。

### WP-C1-1 定制申请 + 状态机 + 人工审核位

范围:
a. `CustomizationRequest` / `Quote` 表 + migration;提交用例(事务内:锁定输入快照 + 参数版本 → 建 Request(submitted) + Quote(pending));
b. `User.role` 列 + admin 审核用例/API(approve:激活 Quote、起算 7 天有效期;reject:附原因);审核动作 v1 用 curl/脚本调 API,不做界面;
c. UI:申请流程页(材料选择+实时估价+联系方式+单按钮提交)、申请列表/详情。

TDD 出题(权限照单 conventions §1):A 用户持 B 的 requestId 读/改 404;未登录 401;普通用户调 admin 审核 API 被拒;重复提交幂等;快照锁定后改材料参数不影响已生成 Quote;非 approved 状态发起支付被拒。

### WP-C3-1 支付抽象 + mock 渠道 + 支付页

范围:
a. `PaymentIntent` / `PaymentAttempt` / `PaymentEvent` 表 + migration;
b. `PaymentProvider` port(发起→用户完成→异步通知→验签;按微信/支付宝真实语义设计,不预设具体产品形态)+ mock provider(config 门控,走真实 notify 路径以演练幂等);
c. 支付用例:从 approved + 有效期内的 Quote 创建 intent(金额只取服务端 Quote,按 quote 幂等)→ 可信事件入账 → 状态推进;
d. UI:报价确认 + 支付页(价格构成明细)+ 结果页。

TDD 出题(资金照单 conventions §1):渠道成功通知重复送达只入账一次;金额以服务端报价为准、前端传值无效;并发创建 intent 幂等;过期 Quote 拒付;金额 0/负数/超大值被拒;他人 Quote 发起支付 404。

### WP-C4-1 订单生成 + 快照 + 订单页

范围:
a. `Order` / `OrderStatusHistory` 表 + migration;支付成功→事务生成订单(全量购买快照:方案、材料版本、金额、用户、联系方式)+ 状态历史 + Request 闭环;
b. UI:订单列表/详情。

TDD 出题:同一支付不重复生成订单(`paymentIntentId` 唯一约束兜底,并发只成一个);订单快照不随项目/参数后续修改漂移;越权读订单 404;状态变更留痕(谁/何时/从何值到何值)。

### 各包统一验收

`pnpm lint:baseline`、三包 `tsc --noEmit`、`pnpm build` 全过;TDD 红→绿两段证据;独立 QA(非实现者)真实浏览器录屏进 qa-evidence release;landing 零回归截图;CI `gh pr checks --json` 显式判定;带 migration 的 PR 合并后编排方立即手动 migrate deploy 并复验。

## 挂账清单(不阻塞本批,记录在案)

1. **定价参数真值化 + 首发材料清单**——真实渠道上线前必须过用户(PRD 待确认问题 5);
2. **C5 收货地址**——第一单真实发货的硬前置,下一批排;
3. **真实渠道接入包**(微信/支付宝 adapter)——资质到后开;开工前先清支付 checklist(conventions §3:限流/监控告警/对账入口/审计)+ PITR 恢复演练(`docs/operations/phase-b-step-4-pitr-drill.md`);
4. **存量 `api/v1/*` 路由 zod 回补**——conventions §2 与现状的缝,不扩本批 scope;
5. **竞品拆解文档合并**——`reference-competitor-3d-flow-2026-07-19.md` 仍在 worktree 分支 `worktree-reference-competitor-3d-flow`,开工前先合(本文引用其为正本);
6. **"第一笔真实订单"合规口径**(kickoff 开放问题③)——本批建到"mock 渠道全链绿",月底资质未下时口径由用户拍板。

## 顺序与依赖

```
WP-B7-1(contract+目录+计价+分析)→ WP-C1-1(申请+审核)→ WP-C3-1(支付)→ WP-C4-1(订单)
Viewer 接缝:contract 就绪即交 Viewer 侧消费;C 线全程可用 mock 确认数据独立推进
```

当前状态(2026-07-19):方案经用户逐项拍板,执行文档落盘;**未开工**,待用户确认开工后从 WP-B7-1 起闭 spec 派工。
