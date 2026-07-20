# C 线执行文档：报价、支付与订单骨架（B7 输入 + C1-C5 首版）

状态：v6 沙箱实现链已合入 `main`，关账证据待收口（2026-07-20 校准）。WP-SEAM-0、B7-1、C1-1、B6-0、OPS-1、C2-1、C5-1、C3-1、C4-1 均有对应合并提交；本文保留沙箱交易边界和验收要求，不表示真实支付、真实订单或履约已经完成。生产行为是否完整通过，仍以 exact SHA 的数据库、API 和浏览器证据为准。上游：`PetScape-PRD.md`、`PRODUCT-MODULES.md`、`ARCHITECTURE.md` §5.7/§6-7、`docs/plans/reference-competitor-3d-flow-2026-07-19.md`、`docs/governance/engineering-conventions.md`。

目标：先做出可验证的**沙箱交易骨架**，再在真实材料、定价、审核和支付渠道全部就绪后开放真实成交：

```text
已确认单物品 → C1 定制申请 → B6 可信审核 → B7 成本与交期输入
→ C2 正式报价 → C5 付款前确认地址 → C3 支付 → C4 订单与地址快照
```

沙箱链路可以验证领域语义、幂等、快照和失败恢复，但不得作为“真实支付”“真实订单”或“第一笔真实订单完成”的证据。C6-C9 只记录下游依赖，不在本计划定义生产、物流和收货状态机。

## 一、已确认边界

1. **单物品成交**：每次申请、报价、支付和订单只针对一个可制造物品；不制造完整场景，不做购物车或合并支付。
2. **服务端权威几何**：价格使用的体积、包围盒等结果由服务端 `mesh_analysis` job 从受控资产计算，客户端提交的几何值或金额一律不可信。
3. **B6/B7 是上游输入**：C 线定义正式报价需要什么可信语义及消费侧 contract，不替 Viewer、B6 或 B7 定义内部 Data Model。
4. **人工审核是 v1 的 B6 执行方式，不是 Request 状态别名**：申请审核进度与制作/安全结论语义分离；未来自动检查不得复用一个含义模糊的 `approved` 字段。
5. **定价规则版本化**：公式在代码并带版本号；材料密度、单价、基础制作费、售价倍数、起步价等参数采用 append-only 版本。Quote 引用明确的公式与参数版本。
6. **C5 进入本计划**：用户在付款前填写并确认本次配送地址；C4 生成订单时冻结地址快照。多地址管理和默认地址可以后补。
7. **沙箱与真实交易硬隔离**：mock provider 只能产生标记为 sandbox/test 的支付与订单，不进入生产履约、经营数据或真实成交验收；生产环境默认禁止启用 mock provider。
8. **首版支付采用全款**：不引入定金、尾款或部分支付状态；只有全额支付成功才能生成正式订单。
9. **正式报价有效期为 7 天**：从 Quote 激活时起算；设计、尺寸、材料或价格规则发生变化时，旧 Quote 失效并生成新 Quote，不原地改写。

## 二、尚未确认的产品口径

### 已拍板（2026-07-19，用户逐项确认；事实基础见 `reference-pricing-research-2026-07-19.md`）

- **首发单品** = 奶酪软垫小床（`cheese-lounge-bed`，黄色奶酪块造型，首页在售展示款）。landing 页展示的 ¥89/PETG/180g 是原型演示数据，不是拍板真值。
- **材料路线** = FDM PETG/PLA 黄色线材：颜色即材料本色、无涂层，啃咬安全语义与 landing「PETG / 圆角安全处理」承诺一致；光敏树脂+喷漆路线因啃咬宠物安全存疑被否。主色奶酪黄；候选色（奶油白/香蕉浅黄/切达橙）待线材色卡确认后再拍。
- **定价公式 v1 参数**（版本化 append-only seed）：售价 = max(起步价, (材料成本 + 基础制作费) × 倍数)；基础制作费 **¥25**（覆盖后处理/包装/包邮运费）、售价倍数 **×2.5**、起步价 **¥129**——定制定位对齐市场定制类锚点（¥184~240），高于规模化仓鼠窝成品区间（¥17~74）。
- **展示口径**：CNY、含税一口价（价内含税不单列，C 端零售惯例；发票能力后置 E4）；正式报价向上取整到整元；存储用整数分（cent）+ Decimal 计算，禁浮点。

### 仍未确认（不阻塞沙箱 Goal，真实交易开放前必须显式确认）

- **FDM 材料按克单价真值**：占位 0.35 元/g——定向询价（2026-07-19）实测一手区间 0.2~0.8 元/g，占位在区间内**维持但仍非真值**；PETG 加价与颜色加价均无公开证据，行业主流为人工报价，真值需联系供应商询价，随工艺/供应商选定一并拍板；PLA 白/黑只能作为禁用测试 seed，不能默认成为可售材料；
- 制作工艺细节（层高/填充率/圆角后处理标准）与供应商选定；
- 首个真实支付渠道的可用产品形态与资质完成时间。

上述三项不阻塞批次 2 沙箱 Goal：执行者不得自行把占位或 mock 升级为真实交易事实，也不得以等待真值为由停止沙箱骨架。

### 批次 2 沙箱默认授权（2026-07-19，用户确认）

#### 资产、材料与价格

- `owned_asset` 的正式候选身份使用 `Asset.id + sha256 checksum`；checksum 为空只能预览，内容变化创建新 Asset，本批不新增 AssetVersion 表。`temporary_catalog` 使用 `assetKey + checksum` 且强制 `sandbox_only`。
- 首发测试商品固定 `cheese-lounge-bed`，材料固定显示为“PETG 奶酪黄（沙箱）”，本批不做材料选择器。
- 新增不可售的 `PricingRule v0-sandbox`：材料占位价 0.35 元/g，公式沿用已拍板的 ¥25、×2.5、¥129 与整元向上取整。该规则只能生成清晰标记的沙箱预估/测试报价，正式 Quote 门禁必须拒绝。

#### 状态机与权限

- `CustomizationRequest.status = draft | submitted | superseded | canceled`；审核结论不复制进 Request，新提交产生新版本并保留历史。
- `CheckRun.status = queued | in_review | completed`，完成时 `result = approved | rejected | uncertain`；普通用户不能审核。
- Quote 只在 CheckRun approved 且 B7 输入完整后创建，`Quote.status = active | accepted | expired | superseded | canceled`；不建立 `pending_review` Quote。
- `PaymentIntent.status = requires_action | processing | succeeded | failed | canceled | needs_attention`；`Order.status = paid | canceled`。制作、生产、发货和收货状态由 C6-C9 后续定义。
- `User.role` 首版仅 `user | admin`，不建设 RBAC；角色授予通过窄用途、append-only 的持久审计记录留痕，CheckRun 自身记录审核动作与规则/checklist 版本。

#### 用户可见输入

- C1 表单只读展示物品、尺寸、资产和 SceneConfirmation；可编辑字段为 `contactName`、`contactPhone`、`usageDescription` 与可选 `additionalRequirements`。
- C5 当前结算地址字段为 `recipientName`、`mobile`、`province`、`city`、`district`、`detail` 与可选 `postalCode`；不建设地址簿，Order 冻结完整地址快照。
- C3 只实现 sandbox provider，但 provider port、异步事件去重和主动查单必须真实可替换；生产环境 mock provider fail-closed，交易 feature flag 保持关闭。

## 三、跨线输入语义

### 3.1 Viewer / 场景确认向 C 线提供的语义

C 线现在冻结消费侧最小 contract v0，不等待 Viewer 内部实现成熟。候选语义至少包括：

- `schemaVersion`；
- 服务端可验证的确认记录引用与 `projectId`；**确认记录 = B 线 `SceneConfirmation`（2026-07-19 用户拍板）**——报价输入绑定场景确认及其 `targetInstanceId` 的最终 mm 尺寸，不绑定 `ModelConfirmation`；后者只作为快照内的间接引用；
- 单物品资产 ID，以及不可变资产版本或内容校验标识；
- 用户确认的真实物理尺寸 `x/y/z`、明确单位和必要方向/姿态信息；
- 确认动作的服务端时间、来源和版本。

`WP-SEAM-0` 负责把上述语义闭合为版本化 zod contract，落在共享 `packages/server/src/contracts/`。C 线拥有消费需求；Viewer 拥有 producer adapter 与 provider conformance test；双方共同验证兼容性。该 contract 只约束跨线输出，不规定 Viewer 的数据库表、内部状态机或确认记录如何持久化。接缝未就绪时只允许使用带 `sandbox` 来源的 fixture，不得进入正式 Quote。

### 3.2 B6 向 C2 提供的可信审核语义

无论 v1 人工审核还是未来自动检查，正式报价至少需要：

- 明确绑定的物品、资产版本、尺寸、材料和检查输入快照；
- `通过 / 拒绝 / 不确定` 三类结论，不确定不得映射为通过；
- 发现的问题、证据、调整建议和人工补充说明；
- 审核人或规则版本、结论时间和可审计来源。

人工审核通过受保护的 admin 用例执行，普通用户无权调用；角色授予与审核动作必须留痕。C 线只保存可信结果引用及报价所需的不可变摘要，不拥有 B6 的内部检查模型。B6 对象的精确 Schema 在 `WP-B6-0` 闭 spec，不计入第五节 C 线的 10 张交易表。

### 3.3 B7 向 C2 提供的成本与交期语义

- 服务端几何分析结果、单位、算法版本和适用限制；
- 材料与计价参数版本；
- 材料成本、基础制作费、其他已启用费用和预计交期；
- 预估的置信边界与尚未覆盖的制造因素。

体积×密度×固定实心率不能代表支撑、壁厚、填充、机器时间、失败率和表面处理，因此在真实参数与制造验证前只能叫**预估**，不能叫正式报价。

## 四、价格与交易语义

### 4.1 预估与正式报价

- `Estimate`：实时计算、非支付承诺、可不落库；页面必须明确标注“预估”。
- `Quote`：仅在 C1 已提交、B6 可信结论为通过、B7 输入完整后生成或激活；绑定输入快照、规则版本、金额明细、币种、税口径、交期和有效期。
- Quote 生命周期已闭合为 `active → accepted | expired | superseded | canceled`；审核等待属于 Request/CheckRun，不在 Quote 重复建 `pending_review`。
- 设计、尺寸、材料或关键规则变化不得原地改写旧 Quote；应使旧 Quote 失效并创建新版本。

### 4.2 支付成功与订单生成

- 浏览器跳转成功、前端回调或未验签通知均不代表支付成功。
- 只有可信 provider 事件或主动查单结果可以推进 `PaymentIntent`。
- 同一 provider 事件只能入账一次；同一支付只能生成一个订单。
- 支付入账、订单生成和状态历史必须在可恢复的一致性边界内完成；崩溃后必须能自动补单或进入明确的 `needs_attention`，不能只靠人工查库。
- C3 与 C4 未同时具备前不得对外开放支付入口。

### 4.3 地址

- 用户在创建支付意图前确认本次配送地址；地址不完整或校验失败时不得支付。
- v1 只要求填写、修改和确认当前结算地址；多地址与默认地址后补。
- Order 保存不可变配送地址快照。用户后来修改个人地址，不得覆盖历史订单。

## 五、数据模型框架（字段按上述默认授权逐包闭 spec）

框架为 **10 张新表 + `User.role`**；各 WP 在上述已确认状态机和用户输入边界内机械闭合精确字段与索引，不再逐项向用户重问：

| 表 | 角色 | 关键约束 |
|---|---|---|
| `Material` | 材料目录版本 | append-only；测试材料默认不可售 |
| `PricingRule` | 计价参数版本 | 公式版本、币种、税口径和舍入规则可追溯 |
| `CustomizationRequest` | C1 定制申请 | 归属、设计摘要、用途、联系方式、补充要求和申请状态 |
| `Quote` | C2 正式报价 | 输入与审核摘要、规则版本、明细、金额、有效期和状态 |
| `DeliveryAddress` | C5 当前结算地址 | 用户归属、PII 最小化和校验状态；多地址能力后补 |
| `PaymentIntent` | 支付意图 | Quote、地址确认、金额、币种、交易模式和幂等键 |
| `PaymentAttempt` | 支付尝试 | provider、渠道单号、状态和失败信息 |
| `PaymentEvent` | 渠道事件 | provider 事件唯一键、验签/查单结论；原文最小化、脱敏和受控留存 |
| `Order` | 订单 | `paymentIntentId` 唯一；购买、金额、审核与地址快照；sandbox/live 标识 |
| `OrderStatusHistory` | 订单状态历史 | 谁、何时、从何状态到何状态及原因 |

金额不使用浮点数。金额存储单位、上限、Decimal 计算和舍入规则在 WP-B7-1/WP-C2-1 中明确；结构化 JSON 必须经过 zod 校验。

## 六、运行时主链

```text
Viewer 确认引用
  → C1 CustomizationRequest(submitted)
  → B6 可信审核：in_review → approved | rejected | uncertain
  → B7 成本与交期输入
  → C2 Quote(active)
  → 用户接受 Quote
  → C5 确认本次 DeliveryAddress
  → C3 PaymentIntent（仅从服务端 Quote 取金额）
  → provider 可信事件 / 主动查单
  → C4 事务性生成 Order + OrderStatusHistory + 地址快照
  → C6-C9（本计划只记录依赖）
```

被拒绝或不确定不是无路可走的死终态：用户应能修改设计、尺寸、材料或说明后创建新的申请/审核/报价版本，历史记录保留。

## 七、工作包与顺序

### WP-SEAM-0：确认方案→报价输入 contract v0

范围：在共享 `packages/server/src/contracts/` 定义版本化 zod contract，闭合 §3.1 的消费语义、单位与不可变资产标识；为 C 线提供 consumer compatibility test，为 Viewer 明确 producer adapter 与 provider conformance test 要求。不得规定 Viewer 的数据库 Schema 或内部状态机。

关键验收：contract 有明确 `schemaVersion`；确认引用可由服务端验证；项目、资产、不可变版本/校验标识、`x/y/z` 与单位、方向/姿态、服务端确认时间与来源均可校验；Viewer provider 与 C 线 consumer 使用同一共享 contract 并通过兼容性测试；fixture 只能进入 sandbox。

### WP-B7-1：服务端几何分析、材料目录与预估引擎

范围：`mesh_analysis` job、分析算法/单位版本、Material/PricingRule、沙箱 Estimate API、测试 fixture。消费 `WP-SEAM-0` 的共享 contract，不得另建 Viewer contract，不得生成可支付 Quote。

关键验收：客户端几何和金额无效；非封闭网格、单位缺失和异常尺度失败可解释；算法版本进入结果；幂等键使用规范化尺寸与资产版本，不直接拼接浮点字符串；测试材料不可售。

### WP-C1-1：定制申请与申请状态

范围：CustomizationRequest、用途/联系方式/补充要求、提交/列表/详情、重复提交幂等。消费 `WP-SEAM-0` 的共享 contract；没有可信确认引用时仅能创建 sandbox 请求。

关键验收：越权 404、未登录 401、输入快照不漂移、拒绝/不确定后可修改并重新提交。

### WP-B6-0：v1 人工可信审核

范围：由本执行计划明确编排 B6 领域包；建立独立 `CheckRun` 或等价 B6 对象，不复用 `CustomizationRequest.status`。对象绑定物品、资产版本、尺寸、材料和检查输入快照，记录 `approved / rejected / uncertain`、问题、证据、调整建议、说明、审核人、审核时间及 checklist/规则版本。精确表结构与状态枚举在本包闭 spec，不纳入 C 线 10 张交易表。

关键验收：通过 `User.role` 与受保护 admin API 执行；普通用户不能审核；角色授予和审核动作均留痕；只改 Request 状态或直接改 DB 不算完成；被拒绝或不确定的申请可修改后重新提交；C2 只能消费可信的 `approved` 结果。

### WP-C2-1：正式报价生命周期

范围：Quote、审核与 B7 输入门禁、版本化金额明细、接受/过期/替代/取消语义和报价页面。

关键验收：未通过或不确定不得激活；旧规则/材料变化不改历史 Quote；过期或被替代 Quote 不可支付；Estimate 不得冒充 Quote。

### WP-C5-1：付款前地址确认

范围：当前结算地址的填写、修改、校验与确认；多地址和默认地址后补。

关键验收：未确认地址不得创建支付意图；他人地址不可读写；订单使用地址快照，后续修改不影响历史订单。

### WP-C3-1：支付抽象与沙箱 provider

范围：PaymentIntent/Attempt/Event、provider port、异步通知、主动查单、去重、沙箱支付页与结果页。

关键验收：重复和乱序通知、金额篡改、并发创建、支付失败重试、未验签事件、他人 Quote、过期 Quote；mock 在生产 fail-closed，所有沙箱记录可识别且不进入真实履约。

### WP-C4-1：订单、快照与异常恢复

范围：Order/OrderStatusHistory、支付成功后生成唯一订单、购买与地址快照、补单/needs_attention、订单列表/详情。

关键验收：同一支付并发只成一个订单；支付已入账但订单事务中断后可恢复；状态变化留痕；沙箱订单不进入生产/物流。

### 实现顺序

```text
构建顺序：WP-SEAM-0
          → Viewer producer adapter、WP-B7-1、WP-C1-1 可并行
          → WP-B6-0 → WP-OPS-1 → WP-C2-1 → WP-C5-1 → WP-C3-1 → WP-C4-1
运行顺序：C1 → B6 → B7 → C2 → C5 → C3 → C4
```

## 八、统一验证与发布门禁

- builder 对资金、权限、并发和失败恢复执行 TDD 红→绿；进程边界统一用 zod。
- 用户可见流程由非实现者在真实浏览器验收；沙箱 UI 必须常显测试标识。
- `pnpm lint:baseline`、三包 `tsc --noEmit`、`pnpm build` 和 CI 必须明确通过。
- 不含 migration 的 PR 不进队列；schema migration 的短生产临界区串行，结束于生产 `migrate deploy`、`_prisma_migrations`/目标 schema 核验和 `/api/healthz db:true`，完整功能冒烟与浏览器 QA 移出槽位并行执行。两线仍可并行开发 schema、Draft migration 和一次性 PostgreSQL 16 CI；后一个 migration PR 获槽后必须 rebase 最新 `main` 并重跑完整 migration CI（详见 `p0-batch-2-execution-plan.md`）。**WP-OPS-1 在 B6-0 后立即完成**：消除 Deploy 对同一 SHA 的重复整套 CI、把 `migrate deploy` 纳入部署链，并保证生产部署串行且绑定精确 SHA；WP-B45-2 作为第一次真实 migration 演练。
- 用户可见 WP 的日常浏览器 QA 在本地 Compose 完成：生产已有 schema 可经 RDS SSH 隧道，Draft schema 必须使用一次性 PostgreSQL 16；C 线收口时再做一次真实生产浏览器 E2E。WP 合并后直接发送关键截图给用户，不等待回复、不阻塞下一包。
- C1-C5、订单恢复和地址快照未全部完成前，交易 feature flag 保持关闭。
- 真实支付开放前清零 engineering conventions §3 checklist：PITR 恢复、回滚、限流、监控告警、对账、异常处理和审计。
- webhook 原文不得无边界持久化；明确脱敏、加密/访问控制和保留期限。

## 九、真实成交开放条件

只有以下条件全部有行为证据时，才可称为真实成交链：

1. Viewer/场景确认、B6 和 B7 的跨线接缝已冻结并由真实上游数据驱动；
2. 首发物品、材料、工艺、价格、税口径、币种和报价有效期已确认；
3. C1-C5 全部完成，订单冻结地址与购买快照；
4. 至少一个真实支付渠道验签、主动查单、对账和异常恢复通过；
5. PITR、回滚、监控、限流和人工异常入口通过；
6. 真实浏览器完成一笔真实付款，系统生成 live 订单；后续 C6-C9 另按正本验收履约。

当前状态：**已按批次 2 编排开工**。开发期允许在独立 worktree 与隔离临时数据库推进；进入 main、生产 migration 和真实交易启用仍分别受本节门禁约束。
