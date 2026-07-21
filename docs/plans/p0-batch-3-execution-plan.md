# P0 批次 3 编排：生成链合流（B1→B4 全段最小竖切）

状态：v3（2026-07-21 二次校准）。范围、引擎、切片、批次 2 收口归属、B3 形态、模型归属、切换策略、编排切分共八项已经用户拍板（见「拍板记录」）；同日新增拍板 9-15：批次切分 3a/3b、G0 拆分、3b 计划结构、B3 交互形态 C、归属边界确认、云雾成本策略、OPENAI key 事实闭环。逐 WP spec 正本为 `g-line-execution-plan.md`，其契约默认项分级生效：G1-G3 范围（G0a）已随拍板 9 生效，G4/G5 范围条目为 3b 待审（拍板 10）。批次 2 关账残量作为 WP-Z0 由本批次编排方收口（B 线证据已入库，C 线生产 E2E 执行中）。

本文件只承载跨包编排事实。模块语义以 `PRODUCT-MODULES.md`（B1-B4）为正本；目标边界以 `ARCHITECTURE.md` 为正本；原型退役以 `docs/governance/prototype-retirement-ledger.md` 为正本；逐 WP 范围、验收与契约以 `g-line-execution-plan.md` 为正本，不在此复述。

## 编排约定

批次 1/2 约定全部沿用（`p0-batch-1-execution-plan.md`、`p0-batch-2-execution-plan.md`）：builder TDD 红→绿证据、非实现者真实浏览器 QA、spec 派发前用户确认（数据模型/新接口/用户可见置顶，机械改动不问）、`gh pr checks --json` 显式判定、migration 单队列与短临界区、RDS 经 SSH 隧道、`tools/aliyun`。

本批次编排形态（用户拍板，2026-07-21 由拍板 9-10 细化）：**段内单线按依赖串行**——3a = Z0→G1→G2→G3；3b = G4→G5→G6，待前置齐备后另行排程；不开双 worktree 执行线。可并行的辅助件（designer 探索稿 G4d、分割 spike G4s）由编排方交子代理在主线推进期间并行完成，不占串行槽位。

## 拍板记录（2026-07-20/21，用户确认）

1. **范围 = B1→B4 全段最小竖切**：项目持久化、上传走 OSS、vibe 生成迁 worker、物品提取、3D 生成迁 worker、产出 `owned_asset` 接入 viewer→沙箱报价；每段做薄，端到端优先。
2. **3D 生成引擎写轻量 ADR 定为首版**：fal 图像 + Tripo 主/Meshy 备级联，收编 `infra/vendors/` 留 provider 端口；草案 `docs/decisions/0006-3d-generation-pipeline.md`，待终审。
3. **切片/G-code 段剥离**：`avatar-slice` 原型原样保留在役；估价走 `mesh_analysis`；切片 ADR（工具选型 + AGPL 法务）挂真实制作开放前。挖腔等制造预处理同样剥离。
4. **批次 2 收口残量并入本批次**（WP-Z0）。
5. **B3 = 框选提取，交互升级**：语义流程沿用框选→白底提取→确认，但不复用 workbench 前端交互；期望交互 = 悬浮发亮、选中发光、点击生成 3D；由 designer 探索稿（G4d）定稿，用户认可后 G4 spec 才闭合。
6. **生成即归属**：worker 生成成功即登记为该用户的 owned Asset，DesignItem 指向它；不新增「采用」步骤与候选状态；viewer 内尺寸/场景确认仍走既有 ModelConfirmation/SceneConfirmation 不可变流程。
7. **landing 逐段直接切**：每 WP 完成即切该段数据源到 v1 并退役旧路径，不做 feature flag 并存；视觉零回归以实际页面对照证据兑付。
8. **单线串行派工**，可并行辅助件交子代理（见编排约定）。（2026-07-21 由拍板 9-10 细化：串行范围 = 各段内部。）
9. **批次切分 3a/3b（2026-07-21）**：3a = Z0→G1→G2→G3（B1+B2 段自成闭环：项目持久化→上传走 OSS→vibe 迁 worker），spec 已闭合，用户授权直接执行、无需逐包再确认；3b = G4→G5→G6，前置 = G4d 探索稿用户认可 + G4s 结论 + ADR-0006 终审 + 计划结构议题 grilling 决议。3a 逐 WP spec 仍以 g-line 正本为准，不重写。
10. **G0 拆分（2026-07-21）**：G0a（G1-G3 契约默认项）随拍板 9 生效；ADR-0006 终审与 G4/G5 契约过目移入 3b 前置，随 grilling 一并交用户，G0 不再作为独立串行槽位。G0a 各默认项（migration、job type、API）由 G1-G3 对应 WP 在实现中承接落地，责任归属见 g-line §一分级标注。
11. **3b 计划结构（2026-07-21）**：用户确认现行计划的结构病灶 = 粒度错位（WP 是多步大包而非单 context 可闭合的 ticket）+ 文档承载状态机（plan 兼任 spec/状态跟踪/拍板记录）。3b 改为：讨论（grilling 决议冻结决策）→ spec（含机器可判验收，只引用决策不重新论证）→ ticket 化派工（每 ticket 单 fresh context、显式依赖、worktree 隔离），ticket 状态在独立 tracker 文件（每 ticket 一文件），plan 只留索引与拍板记录。3a 继续按既有 WP 方式跑完，不返工。
12. **B3 交互形态 = C「拉框→轮廓发光」（2026-07-21）**：用户在效果图上拉粗框 → 自托管 SAM2.1-b box 提示 → 整件轮廓 mask → 按 G4d 发光语言点亮物品本体 → 底部胶囊条确认。依据 = G4d 探索稿 + G4s 实测（框提示 14/15 整件 vs 单点 hover 44%；云雾无分割、fal 锁死）。用户将过目证据/亲自实测，若实测推翻则重议。逐物品 hover（A）留作 SAM 3 实例级托管可用后的增强候选，不进 G4 spec。
13. **归属边界确认（2026-07-21）**：拍板 6「生成即归属」维持；G5 spec 增加显式契约与契约测试——「生成成功但从未确认的资产，除占用资产列表外无任何 commerce 副作用」；资产删除/隐藏能力归 B12 另议。
14. **云雾成本策略（2026-07-21，同日修订）**：**fal 账号废弃，不再解锁**（用户拍板），云雾为唯一图像供应商。低倍率令牌已闭环（同日）：`petscape-lowrate` 绑「特价banana」倍率 1.0，实测 $0.1655/图（省 54%），已入 `.env` `YUNWU_API_KEY_LOWRATE`；耦合约束 = 该分组仅含 gemini-3.1/3-pro image preview，2.5 模型仍走 2.4 倍率旧 key。默认模型随 ADR-0006 终审定（见 `reference-yunwu-api-research-2026-07-21.md`）。
15. **OPENAI key 事实闭环（2026-07-21）**：核实此前从未配置（`vibe/rewrite` 为线上死功能）；用户当日提供 key，`/v1/responses` + `gpt-4o-mini`（路由实际用法）实测可用，已入项目根 `.env`。G3 按 g-line 既定分支走「原样接线，不扩展」。

## 工作包序列（详情见 g-line 正本）

| WP | 一句话 | 性质 |
|---|---|---|
| Z0 | 批次 2 收口：C 线生产 E2E + receipt + 状态行关账 | 收尾 |
| ~~G0~~ | 已拆分（拍板 10）：G0a 随拍板生效并由 G1-G3 承接；ADR-0006 终审与 G4/G5 契约过目移入 3b 前置 | 决策 |
| G1 | landing 项目创建/恢复切 v1（B1） | 接线 |
| G2 | 宠物/环境照上传走 OSS Asset 链（B2 前半） | 接线 |
| G3 | vibe 生成迁持久任务 + worker（B2 后半） | 迁移 |
| G4d ∥ | designer 探索稿：框选提取交互（悬浮发亮/选中发光） | 并行辅助 |
| G4s ∥ | 分割 spike：物品级 mask 可行性三锚点证据 | 并行辅助 |
| G4 | 物品提取（B3）：新前端交互 + item_extraction 任务链 | 新建 |
| G5 | 3D 生成（B4）：级联迁 worker → owned_asset → viewer/报价接入 | 半新 |
| G6 | landing 切换收尾 + 原型退役销账 + 视觉对照 | 接线+退役 |

2026-07-21 起按拍板 9 切分执行：3a = Z0→G1→G2→G3（G4d/G4s 并行辅助同步启动）；3b = G4→G5→G6，待前置齐备后另行派工。

批次收口分两级：**3a 收口** = 生产环境走通 项目持久化→上传→vibe 效果图 的真实一次 E2E + mock 夹具回归绿，receipt 落 `docs/operations/`；**全批次（3b）收口**维持原判据：生产环境真实调用一次的端到端 E2E（上传→效果图→框选→3D→确认→沙箱报价，无 `temporary_catalog` 参与目标物品）+ mock 夹具 CI 回归双绿；receipt 落 `docs/operations/`。

## 风险与开放项

- **本地门禁责任**：GitHub hosted runner 当前因 Billing 停跑，`main-ci-gate` Ruleset 已停用；恢复云端或 self-hosted runner 前，每个 WP 合并前必须在本地跑 Fast Gate，生产 Deploy 也不得宣称已由 Actions 验证。
- **对外口径冲突（需用户处理）**：2026-07-20 会议对外承诺「本周 C6→C9（07-24）+ B 线剩余 + B13」，与本批次主线冲突；正本以用户拍板为准，口径由用户对齐。
- 原型生成链零测试；合流即按工程约束补行为测试。
- ~~`vibe/rewrite` 消费的 OPENAI key 未见于 `.env` 键名，G0 核实该功能实际可用性与去留。~~ 已闭环（拍板 15）。
- 外部服务真实调用有真金成本：CI 一律 mock 夹具，真实调用只在收口 E2E 与显式验证发生。
- **fal 账号被平台锁定（2026-07-21 发现，双重复核）**：`.env` 的 FAL_KEY 调任何端点均 403 "<PROVIDER_ACCOUNT_UNAVAILABLE>"。阻塞：G3 真实调用验收、G4 白底提取、G4s 路径①实测；生产 landing 的 vibe 生成大概率同受影响（账号级锁，未逐一核实）。mock/fixture 开发不受影响。解锁或换账号需用户处理；处理前 G3 只能推进到「mock 绿 + 真实调用验收挂起」。**2026-07-21 用户拍板：生图供应商切换为云雾 API（中转，文档 yunwu.apifox.cn，key=`.env` `YUNWU_API_KEY`）**；调研已完成，正本=`reference-yunwu-api-research-2026-07-21.md`：vibe/白底提取/四视图三用途实测可承接（gemini-2.5-flash-image），分割 mask 无能力；**成本红旗待用户决策**（当前 key 倍率 2.4 → $0.36/图 ≈ 官方 9 倍，选项=低倍率专用令牌 or 云雾仅作兜底）。G3/G5 spec 与 ADR-0006 终审引用该正本；断连仍扣费 → provider 幂等重试为硬要求。**2026-07-22 WP-G3 已闭合此项（vibe 部分）**：云雾 provider 收编 `infra/vendors/yunwu.ts`，默认低倍率 key + gemini-3.1-flash-image-preview（$0.1655/图），幂等重试落地（idempotencyKey→job.id 透传 + 任务级产物复用，断连不重复扣费）；真实调用 2 次产出效果图，照片经 assetId→OSS 真实入图人眼可辨（证据见 G3 PR）。G4 白底提取 / G4s 路径① 仍在 3b 范围，不受本 WP 影响。
- **G2→G3 过渡窗口 vibe 照片断链（2026-07-22 WP-G3 已修复）**：G2 把上传切到 v1 Asset 后，UploadVibeSection 拿到的 assetId/downloadUrl 只存组件本地 state、未接入旧 vibe 内存链（旧 vibe 读 `project.brief.cagePhotoUrl` 内存路径，已随 G2 断开）。G3 把 vibe 输入改为经 assetId 引用（`renders` 契约 `environmentAssetId`/`petAssetId`），worker 从 OSS 读字节作参考图传入 provider——照片真实入图已由真实调用 + handler 单测（「照片真实入图」用例断言两张照片字节传入 provider）双重验证。
- **旧 `/api/project` 过渡态债务（2026-07-22 WP-G3 部分销账）**：`app/api/project/[id]/route.ts` GET 的 vibe 段已随 G3 迁走（RenderSection/UploadVibeSection/OrderFlowSection 的 vibe 读改走 v1 jobs/assets）；该 GET 现仅剩 avatar/avatar-slice 未迁段轮询源，整体退役随 G5。`vibe/route.ts` + `vibeJob.ts` 已删除。
- avatar（宠物形象）链的产品去留不在本批次：G5 只收编其级联逻辑，avatar 入口保留在役，去留随 B12 另议（台账口径在 G5 销账时对齐）。
- 技术债回填（quotes/delivery-addresses 冲突重试统一）已挂独立任务，不占批次序列。
