# G 线执行正本：生成链合流（B1→B4）

状态：v1（2026-07-21）。编排事实见 `p0-batch-3-execution-plan.md`（八项拍板不复述）；本文是逐 WP 的 spec 正本。§一的契约默认项经用户过目未异议后即生效；G4 spec 需另等 G4d 探索稿获用户认可。

范围提醒：本线交付的是**真实数据库/OSS/持久任务上的生成链 + 沙箱报价资格**；不含切片/挖腔等制造预处理、真实报价、真实支付、B6 正式安全规则、avatar（宠物形象）产品链与 B12/B13。

## 一、契约与数据模型默认项（G0）

以下按「机械改动不问、语义决策置顶」原则给出默认值；数据模型与新接口已在此置顶列出，用户过目未异议即生效，builder 不得自行更改语义。

### 1. Asset.kind 扩展（migration，进跨包单队列）

| kind | 含义 | OSS 前缀（ADR-0005） |
|---|---|---|
| `upload_raw`（已有） | 用户上传原图 | `uploads/raw/` |
| `generated_render` | vibe 空间效果图 | `uploads/generated/` |
| `extracted_item` | 白底隔离的单物品图 | `uploads/generated/` |
| `generated_model` | 生成的 3D 模型（GLB + meta） | `assets/3d/` |

产物 Asset 一律记 `ownerUserId`、`projectId`、`checksum`；来源关系（哪张效果图、哪个选区、哪次任务）记在 DesignItem 与 Job，不在 Asset 上复制。

### 2. 持久任务 job type（ADR-0003 机制，不新增基建）

| type | 输入 → 产物 | 外部调用 |
|---|---|---|
| `vibe_render` | brief + 上传 Asset → `generated_render` Asset | fal |
| `item_extraction` | render Asset + 选区/mask → `extracted_item` Asset + DesignItem | fal edit |
| `model_generation` | extracted_item Asset → 四视图 → GLB 归一化 + meta → `generated_model` Asset（owned） | fal + Tripo 主/Meshy 备（ADR-0006） |

粗粒度三型；阶段进度写 `Job.progress`，外部任务号写 `vendorTaskId`，失败按 `errorClass` 区分 retryable/permanent/manual（级联全部耗尽 → manual）。

### 3. API 端点草案（`/api/v1`，Route Handler 只做传输层）

- `POST /api/v1/projects/:id/renders` → 建 `vibe_render` job；状态查询走既有 jobs 端点。
- `POST /api/v1/projects/:id/design-items` → 传 render assetId + 选区（或 mask 引用）→ 建 `item_extraction` job → 成功产出 DesignItem。
- `POST /api/v1/design-items/:id/model-generation` → 建 `model_generation` job → 成功后 DesignItem.modelRef 更新为 `owned_asset`（`quoteEligible: true`）。

端点具体形状（字段名、错误码）在各 WP spec 内定稿，语义不得偏离上表。客户端不得注入产物字段、金额或 sandboxOnly 类门禁字段（沿用 C 线 contract 测试口径）。

### 4. 登录态前提（用户可见）

生成即归属要求 owner：landing 浏览免登录；进入生成流程（建项目/上传/生成）需登录，未登录引导至既有 A1 登录壳。这是现有 A 线能力的接线，不新做注册流程。

### 5. mock 夹具（既有拍板的落实）

`?mock` 语义升级为 provider 端口的 fixture 实现（server 侧注入，mock 资产从 `public/mockup-assets/` 收编为测试夹具资源）；CI 与日常回归零外部调用；真实调用只在收口 E2E 与显式验证发生。

### 6. 旧链退役节奏（台账为准）

内存 store（`lib/store/projects.ts`）承载着旧链 vibe/avatar 任务状态，**不能在 G1 一次退役**：G1 只切项目身份与 brief，内存 store 降级为「未迁段的临时状态缓存」；G3 迁走 vibe 段、G5 收编级联后，G6 统一销账。avatar 产品入口保留在役（见批次编排文件开放项）。

## 二、逐 WP spec

### WP-Z0 批次 2 收口（立即，不依赖 G0）

- B 线证据与会议纪要已随 PR #64 入库。
- 补做 C 线生产浏览器 E2E：覆盖 quote→address→payment→order 沙箱主路径 + 至少一条失败/恢复路径（支付冲突重试或订单补单）；exact SHA + 运行环境记入 receipt，落 `docs/operations/`。
- 完成后更新 `p0-batch-2-execution-plan.md`、`b-line-…`、`c-line-…` 三处状态行为关账，并统一 c-line 文内新旧状态行措辞。
- 验收：receipt 存在且可 10 秒核验；三处状态行一致。

### WP-G1 项目持久化（B1，接线）

- 目标：landing 的项目创建与 `?project=` 恢复走 `/api/v1/projects`，进程重启不丢项目。
- 改动面：`web/app/page.jsx` 项目初始化与登录引导；brief 字段写入 v1 Project。旧 `app/api/project` 的创建/恢复段退役；内存 store 按 §一.6 降级。
- 不做：vibe/avatar 状态迁移（G3/G5）；项目列表/归档 UI（B1 候选子功能里的历史记录界面按最小竖切延后）。
- TDD 验收：v1 项目归属越权返回 404（已有口径）；landing 数据源行为测试（建项目→重启→恢复）红→绿。
- QA 验收：真实浏览器建项目→重启服务→URL 恢复；未登录进入生成流程被引导登录。
- 销账：台账 `app/api/project/*` 创建/恢复条目。

### WP-G2 上传走 OSS（B2 前半，接线）

- 目标：宠物照/环境照走 v1 Asset 上传链（`uploads/raw/`，WP-3.2 基座），brief 引用 assetId。
- 改动面：landing 上传组件接 v1；退役 `upload/route.ts` 与 `app/uploads/[...path]` 静态路由。
- TDD 验收：上传登记 Asset（owner/checksum/mime 服务端裁定，客户端文件名不可信——ADR-0005 口径）；签名 URL 本人可读、他人 404。
- QA 验收：真实浏览器上传→重启→图仍可见；越权直链不可读。
- 销账：台账 upload 条目。

### WP-G3 vibe 迁 worker（B2 后半，迁移）

- 目标：效果图生成变成可恢复的持久任务；产物入 OSS + Asset。
- 改动面：新增 `vibe_render` handler（worker）；fal 客户端收编 `packages/server/src/infra/vendors/`（配置经 `infra/config`，清理 `falClient.ts` 落盘读 `.env` 的旧路径与 lint 豁免）；landing 轮询走 v1 jobs/assets；退役 `vibe/route.ts`、`vibeJob.ts` 与 `app/generated/[...path]` 的 vibe 段。
- `vibe/rewrite`（OpenAI）：G0 核实 OPENAI key 配置事实后二选一——key 从未配置即线上死功能，随本 WP 退役；确认在用则原样接线，不扩展。
- 不做：生成参数/风格体系扩展；多引擎。
- TDD 验收：handler 中断后可恢复、幂等（同 idempotencyKey 不重复扣费调用）；失败 errorClass 语义测试；contract 禁止客户端注入产物字段；fixture provider 跑通全链。
- QA 验收：mock 全链回归 + 一次真实 fal 调用产出效果图；worker 重启后任务续跑。
- 销账：台账 vibe 两条目 + `lib/images/` 条目。

### WP-G4d designer 探索稿（并行辅助，非实现）

- 产出：框选提取交互的 HTML 探索稿——悬浮发亮、选中发光、点击生成 3D；以 landing 视觉基准为底，参照 `assets/b45-prototype/` 的快照与开放项格式落 `docs/plans/assets/`。
- 约束：只探索交互与视觉，不写数据层；发光/高亮如何依赖 mask 由 G4s 结论约束。
- 验收：用户认可（口头即可，记入本文件），随后 G4 spec 才闭合。

### WP-G4s 分割 spike（并行辅助，只读 + 一次性调用）

- 问题：悬浮发亮/选中发光需要物品级轮廓，位图效果图上如何获得？
- 验证路径（按序）：fal 侧分割能力 → 开源分割（SAM 类）服务端可行性 → 退化方案（用户拉框后选区高亮，无逐物品 hover）。
- 产出三锚点证据：mask 质量（典型效果图 5 张）、延迟、成本；结论写回本文件供 G4 spec 引用。允许少量真实付费调用，报编排方备案。

### WP-G4 物品提取（B3，新建）

- 前置：G4d 用户认可 + G4s 结论。
- 目标：用户在效果图上按认可稿交互选定单物品 → `item_extraction` job（fal edit 白底隔离）→ `extracted_item` Asset + DesignItem（保留与 render/项目关系及选区元数据）。
- 硬约束：选件粒度 = 单体模块（既有实证定律：组合体在 3D 端碎裂），spec 与提示词都要体现；歧义提取允许重试，重试不产生孤儿 Asset。
- 不做：自动物品清单拆解（Max PRD 终态，另议）；多物品批量提取。
- TDD 验收：越权/非法选区/资源不存在错误路径；重复提交幂等；DesignItem 关系可查询。
- QA 验收：真实浏览器走通选定→提取→预览→确认；提取物与原效果图的关系在界面可见。
- 销账：无（本段是新建，无对应在役原型路由）。

### WP-G5 3D 生成（B4，半新）

- 目标：`extracted_item` → 四视图（单图 2×2，沿用既有拍板与裁切实现）→ Tripo 主/Meshy 备级联（ADR-0006，双 key 顺序 tripo#1→tripo#2→meshy）→ GLB 归一化 + 尺寸 meta（沿用 `scene-assets` 的 norm+meta 约定，viewer 可直接消费）→ `generated_model` Asset（owned）→ DesignItem.modelRef = `owned_asset`（`quoteEligible: true`）。
- 接入面：viewer 支持 `owned_asset` 经签名 URL 加载；`mesh_analysis` 的 `owned_asset` 真实路径打通（去 temporary_catalog 白名单依赖）；沙箱报价链自然可用（批次 2 已留口，无需改 commerce）。
- 级联实现收编 `infra/vendors/`（Tripo 客户端迁移收编、Meshy 内联实现抽出），avatar 产品入口不动。
- 不做：挖腔/功能结构/可打印性修复（随切片 ADR）；模型编辑（B9）；贴图（B10）。
- TDD 验收：级联切换单测（夹具模拟 Tripo 失败/限流）；`vendorTaskId` 轮询中断恢复；owned_asset 生产契约（归属、checksum、quoteEligible）；viewer 加载行为测试；级联耗尽 → manual errorClass 可见可重试。
- QA 验收：mock 全链回归 + 一次真实生成 → viewer 里旋转查看 → 尺寸确认 → 沙箱报价出价（端到端预演，生产收口 E2E 的彩排）。
- 销账：台账 `avatar/route.ts`、`lib/tripo/client.ts` 条目按「级联逻辑已收编、产品入口另议」口径部分销账，措辞与台账维护人对齐。

### WP-G6 landing 切换收尾（接线 + 退役）

- 目标：landing 全部数据源走 v1；旧原型路由清仓退役。
- 改动面：退役 `app/api/project/*` 余量、`lib/store/projects.ts`、`recoverProject.ts`、`lib/jobs/`（vibe/avatar 已迁段）、`app/generated/[...path]` 余量；lint PROCESS_ENV_BASELINE 豁免清理；`?mock` 保留为正式夹具语义。
- TDD 验收：全仓 grep 无旧 API 消费方；夹具链 CI 绿。
- QA 验收：landing 逐屏视觉对照（改前/改后截图并列，含移动端 390×844），零回归；台账逐条销账记录。

## 三、批次收口验收

1. 生产环境真实调用一次的端到端 E2E：登录 → 建项目 → 上传 → 效果图 → 框选提取 → 3D 生成 → viewer 确认 → 沙箱报价；全程目标物品无 `temporary_catalog` 参与。录屏 + 关键截图 + exact SHA 记入 receipt，落 `docs/operations/`。
2. mock 夹具 CI 回归绿（零外部调用）。
3. 退役台账与 `ARCHITECTURE.md` §2「原型链」段落同步更新；`PetScape-PRD.md` 验证边界表按事实推进一格。

## 四、开放项

- 本地门禁责任与对外口径冲突：见批次编排文件「风险与开放项」；前者按已确认的本地优先策略执行，后者仍待用户处理。
- OPENAI key 事实核实（G0，决定 rewrite 去留）。
- G4s 三条路径全部不达标时，B3 交互降级为「拉框后选区高亮」并回报用户重新确认交互期望。
- Tripo/Meshy 配额与单次成本以 G4s/G5 首次真实调用实测为准，超预期时报编排方暂停。
