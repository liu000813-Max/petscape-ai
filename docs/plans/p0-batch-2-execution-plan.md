# P0 批次 2 编排：B 线（B4/B5）+ C 线（B7 输入 + C1-C5）并行

状态：2026-07-19 立卷。批次 1（A 线锚点闭环）已于 2026-07-19 关账（PR #32）。

本文件只承载**跨线编排事实**：两线各自的范围、工作包和验收以 `b-line-b4-b5-execution-plan.md`（v3）与 `c-line-execution-plan.md`（v4）为正本，不在此复述。

## 编排约定

- 批次 1 编排约定全部沿用（`p0-batch-1-execution-plan.md`）：builder TDD 红→绿证据、非实现者真实浏览器 QA、spec 派发前用户确认（数据模型/新接口/用户可见行为置顶，机械改动不问）、`gh pr checks --json` 显式判定、RDS 经 SSH 隧道、`tools/aliyun`。
- Codex 审核意见以「审查增补」形式写回 spec 正本；执行者只读 spec。

## 跨线接缝拍板（2026-07-19，用户确认）

1. 跨线 contract 以 C 线 `WP-SEAM-0` 为正本：C 线 session 起草、B 线 session 会签；B 线拥有 producer adapter + provider conformance test（`WP-B45-3`，挂 WP-B45-2 之后）。
2. 报价输入绑定 `SceneConfirmation`（携带 `targetInstanceId` 最终 mm 尺寸）；`ModelConfirmation` 只作快照内间接引用。
3. `temporary_catalog` 场景确认经 producer 只能生成 sandbox 下游请求；正式 Quote 门禁拒绝。
4. 「模块内默认值」旧决策 = 测试资产默认尺寸来自模型 meta，B 线正本已吸收，无需另立条目。
5. C4/C5 地址依赖矛盾已在 `PRODUCT-MODULES.md` 收敛（结算时序说明 + 运行顺序 C2→C5→C3→C4），两线正本与之一致。

## migration 跨线单队列

- 同一时间只允许一个在途 WP 动 `schema.prisma`（沿用批次 1）；两线窗口进同一队列，由编排方按各 WP 实际就绪顺序放行，不预排死全序。
- 每个带 migration 的 PR 合并后由编排方立即手动 `migrate deploy` 并验证（部署链缺口未修复前的强制人工步骤）。
- **WP-OPS-1（本批新增）**：`migrate deploy` 进部署链（`deploy.yml`）并实际演练安全的 migration/部署顺序。必须在 C 线 WP-C3-1 开工前完成；不阻塞两线前段。批次 1 遗留拍板项就此吸收。

## 派工登记

**2026-07-19 起，批次 2 执行编排移交用户侧 Codex 编排 session 接管**（收敛与拍板由本表下方记录的前置 session 完成）；两条执行线由 Codex 编排方委派与排程。

| session | 范围 | 首个任务 | 状态 |
|---|---|---|---|
| B 线执行 | WP-B45-0 → B4-1 / B5-1 → B45-2 → B45-3 | WP-B45-0 spec 闭合 + R3F 尖峰 | 待开（Codex 编排接管） |
| C 线执行 | WP-SEAM-0 → B7-1 / C1-1 → B6-0 → C2-1 → C5-1 → C3-1 → C4-1 | WP-SEAM-0 contract 起草 | 待开（Codex 编排接管） |
| designer 原型稿 | B4/B5 两阶段工作台视觉探索稿（非实现） | — | ✅ 完成，用户认可（2026-07-19）；快照与开放项见 `assets/b45-prototype/README.md` |
| 定价市场研究 | 淘宝/国内 3D 打印服务商定价结构与成品售价行情 | — | ✅ 完成，结论入 `reference-pricing-research-2026-07-19.md` |
| 定价嘉立创专项 | 三维猴材料单价/起步价/费用构成（一手 API 价目） | — | ✅ 完成，结论与原始数据同上 |
| FDM 定向询价 | FDM PETG/PLA 黄色线材按克单价（材料单价真值） | — | ✅ 完成（2026-07-19）：一手区间 0.2~0.8 元/g，0.35 占位维持；真值需人工询价，随供应商选定拍板 |

## 产品口径进展

- 首发单品 = 奶酪软垫小床（`cheese-lounge-bed`，2026-07-19 用户拍板）；颜色主打奶酪黄，候选色与材料/工艺待定价研究结论后一并拍板（正本记录在 C 线执行文档 §二）。

C 线自列的未确认产品口径（首个可售物品/材料/工艺、价格真值与税口径、真实支付渠道形态）不阻塞沙箱骨架，到对应 WP 闭 spec 时按「spec 派发前用户确认」逐项拍板。
