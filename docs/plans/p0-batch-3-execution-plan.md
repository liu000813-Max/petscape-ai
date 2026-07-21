# P0 批次 3 编排：生成链合流（B1→B4 全段最小竖切）

状态：v2（2026-07-21 校准）。范围、引擎、切片、批次 2 收口归属、B3 形态、模型归属、切换策略、编排切分共八项已经用户拍板（见「拍板记录」）；逐 WP spec 正本为 `g-line-execution-plan.md`，其契约默认项经用户过目未异议后派工。批次 2 关账残量作为 WP-Z0 由本批次编排方收口（B 线证据已入库，C 线生产 E2E 待执行）。

本文件只承载跨包编排事实。模块语义以 `PRODUCT-MODULES.md`（B1-B4）为正本；目标边界以 `ARCHITECTURE.md` 为正本；原型退役以 `docs/governance/prototype-retirement-ledger.md` 为正本；逐 WP 范围、验收与契约以 `g-line-execution-plan.md` 为正本，不在此复述。

## 编排约定

批次 1/2 约定全部沿用（`p0-batch-1-execution-plan.md`、`p0-batch-2-execution-plan.md`）：builder TDD 红→绿证据、非实现者真实浏览器 QA、spec 派发前用户确认（数据模型/新接口/用户可见置顶，机械改动不问）、`gh pr checks --json` 显式判定、migration 单队列与短临界区、RDS 经 SSH 隧道、`tools/aliyun`。

本批次编排形态（用户拍板）：**单线按依赖串行**（Z0→G0→G1→G2→G3→G4→G5→G6），不开双 worktree 执行线；可并行的辅助件（designer 探索稿 G4d、分割 spike G4s）由编排方交子代理在主线推进期间并行完成，不占串行槽位。

## 拍板记录（2026-07-20/21，用户确认）

1. **范围 = B1→B4 全段最小竖切**：项目持久化、上传走 OSS、vibe 生成迁 worker、物品提取、3D 生成迁 worker、产出 `owned_asset` 接入 viewer→沙箱报价；每段做薄，端到端优先。
2. **3D 生成引擎写轻量 ADR 定为首版**：fal 图像 + Tripo 主/Meshy 备级联，收编 `infra/vendors/` 留 provider 端口；草案 `docs/decisions/0006-3d-generation-pipeline.md`，待终审。
3. **切片/G-code 段剥离**：`avatar-slice` 原型原样保留在役；估价走 `mesh_analysis`；切片 ADR（工具选型 + AGPL 法务）挂真实制作开放前。挖腔等制造预处理同样剥离。
4. **批次 2 收口残量并入本批次**（WP-Z0）。
5. **B3 = 框选提取，交互升级**：语义流程沿用框选→白底提取→确认，但不复用 workbench 前端交互；期望交互 = 悬浮发亮、选中发光、点击生成 3D；由 designer 探索稿（G4d）定稿，用户认可后 G4 spec 才闭合。
6. **生成即归属**：worker 生成成功即登记为该用户的 owned Asset，DesignItem 指向它；不新增「采用」步骤与候选状态；viewer 内尺寸/场景确认仍走既有 ModelConfirmation/SceneConfirmation 不可变流程。
7. **landing 逐段直接切**：每 WP 完成即切该段数据源到 v1 并退役旧路径，不做 feature flag 并存；视觉零回归以实际页面对照证据兑付。
8. **单线串行派工**，可并行辅助件交子代理（见编排约定）。

## 工作包序列（详情见 g-line 正本）

| WP | 一句话 | 性质 |
|---|---|---|
| Z0 | 批次 2 收口：C 线生产 E2E + receipt + 状态行关账 | 收尾 |
| G0 | 契约与数据模型默认项过目 + ADR-0006 终审 → spec 闭合 | 决策 |
| G1 | landing 项目创建/恢复切 v1（B1） | 接线 |
| G2 | 宠物/环境照上传走 OSS Asset 链（B2 前半） | 接线 |
| G3 | vibe 生成迁持久任务 + worker（B2 后半） | 迁移 |
| G4d ∥ | designer 探索稿：框选提取交互（悬浮发亮/选中发光） | 并行辅助 |
| G4s ∥ | 分割 spike：物品级 mask 可行性三锚点证据 | 并行辅助 |
| G4 | 物品提取（B3）：新前端交互 + item_extraction 任务链 | 新建 |
| G5 | 3D 生成（B4）：级联迁 worker → owned_asset → viewer/报价接入 | 半新 |
| G6 | landing 切换收尾 + 原型退役销账 + 视觉对照 | 接线+退役 |

批次收口：生产环境真实调用一次的端到端 E2E（上传→效果图→框选→3D→确认→沙箱报价，无 `temporary_catalog` 参与目标物品）+ mock 夹具 CI 回归双绿；receipt 落 `docs/operations/`。

## 风险与开放项

- **本地门禁责任**：GitHub hosted runner 当前因 Billing 停跑，`main-ci-gate` Ruleset 已停用；恢复云端或 self-hosted runner 前，每个 WP 合并前必须在本地跑 Fast Gate，生产 Deploy 也不得宣称已由 Actions 验证。
- **对外口径冲突（需用户处理）**：2026-07-20 会议对外承诺「本周 C6→C9（07-24）+ B 线剩余 + B13」，与本批次主线冲突；正本以用户拍板为准，口径由用户对齐。
- 原型生成链零测试；合流即按工程约束补行为测试。
- `vibe/rewrite` 消费的 OPENAI key 未见于 `.env` 键名，G0 核实该功能实际可用性与去留。
- 外部服务真实调用有真金成本：CI 一律 mock 夹具，真实调用只在收口 E2E 与显式验证发生。
- avatar（宠物形象）链的产品去留不在本批次：G5 只收编其级联逻辑，avatar 入口保留在役，去留随 B12 另议（台账口径在 G5 销账时对齐）。
- 技术债回填（quotes/delivery-addresses 冲突重试统一）已挂独立任务，不占批次序列。

