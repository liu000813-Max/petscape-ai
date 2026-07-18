# 原型退役台账（prototype retirement ledger）

- 角色：`web/app` 黑客松原型链各部件的**挂牌账目**——每个部件归属哪个产品模块（`PRODUCT-MODULES.md`）、退役条件是什么、当前状态。回答"仓库里这段旧代码是谁、什么时候消亡"这一个问题，不承载实现细节。
- 更新纪律：模块执行文档的 DoD(b)（ARCHITECTURE §11：吸收对应原型代码）完成时，由编排方在本表划账（状态改"已退役"并附 PR 号）。账目清零 = 原型链消亡。
- 状态取值：**在役**（active 且被 landing 消费）/ **吸收中**（对应模块已开工）/ **已退役**（旧路径已删除或不再被消费，附证据）。
- 建账依据：2026-07-18 只读盘点（active 路由、import 关系、lint 豁免清单逐条核实）。

## 一、旧原型 API（内存 store 驱动，与 `/api/v1/*` 刻意隔离）

| 部件 | 归属模块 | 退役条件 | 状态 |
|---|---|---|---|
| `app/api/project/route.ts` + `[id]/route.ts` | B1 设计项目 | landing 的项目创建/恢复切到 v1 项目 API | 在役 |
| `app/api/project/[id]/upload/route.ts` | B2 空间设计 | 上传走 OSS 私有资产链（WP-3.2 已有基座） | 在役 |
| `app/api/project/[id]/vibe/route.ts` + `app/api/vibe/rewrite/route.ts` | B2 空间设计 | vibe 生成迁任务表 + worker handler | 在役 |
| `app/api/project/[id]/avatar/route.ts` | B4 3D 模型生成 | 3D 生成迁任务表 + worker handler | 在役 |
| `app/api/project/[id]/avatar-slice/route.ts` | B7 打印与成本预估 | 切片 ADR 落地后由正式估价链取代 | 在役 |

## 二、原型库代码（`web/app/lib/`）

| 部件 | 归属模块 | 退役条件 | 状态 |
|---|---|---|---|
| `lib/store/projects.ts` + `recoverProject.ts`（globalThis 内存 Map） | B1 | 全部旧 API 退役后随之删除；数据无迁移价值（内存态） | 在役 |
| `lib/types/project.ts`（job 字段契约，冻结点） | B1-B4 | 最后一个消费它的旧 route 退役时解冻删除 | 在役 |
| `lib/jobs/vibeJob.ts` | B2 | 逻辑迁 worker handler（沿用 fal 引擎，已拍板 2026-07-18） | 在役 |
| `lib/jobs/avatarJob.ts`（3D 引擎级联 + 切片编排） | B4（级联）+ B7（切片段） | 级联逻辑迁 worker；切片段等切片 ADR | 在役 |
| `lib/jobs/timeouts.ts`（withTimeout） | B2/B4 | 迁移时并入 worker 超时语义；`web/tests/timeouts.test.mjs` 随之退役 | 在役 |
| `lib/tripo/client.ts`（withTripoKey 多 key 注入） | B4 | 随 avatarJob 迁移收编进 `packages/server/src/infra/vendors/` | 在役 |
| `lib/images/`（fal 生图 client，5 文件） | B2 | 随 vibeJob 迁移收编进 infra/vendors | 在役 |
| `lib/prompts/avatarStyle.ts`（用户亲手调的文案） | B2/B4 | 迁移时保持"改文案即调效果"的可编辑性，位置另定 | 在役 |
| `lib/auth/`（getWebAuth 接驳） | A3 | 已是正式链接驳层，不退役，随 A3 演进 | 正式链 |
| `lib/printability/`（空目录） | — | 空壳，随 WP-A1 删除 | 已退役（2026-07-18） |
| `lib/server-context.ts` | 正式链 | 不退役（v1 路由公共接驳） | 正式链 |

## 三、前端与静态服务

| 部件 | 归属模块 | 退役条件 | 状态 |
|---|---|---|---|
| `app/page.jsx`（landing，唯一 active 页面；fetch 旧 `/api/project`） | A3（登录入口接入）+ B1（项目引导切 v1） | 冻结点计划内解冻：A 线加登录入口，B 线切数据源；landing 视觉零回归约束不随退役消失 | 在役 |
| `app/components/landing/`（22 文件，设计师像素定稿） | 各 B 模块 UI | 不整体退役；正式站 UI 以其视觉语言为基准延展 | 在役 |
| `app/components/landing/PetCreatorSection.jsx`（匿名页内存档案表单） | A4（档案语义）+ B1/B2（旧项目入口） | A4 正式 `/pets` 已吸收长期档案语义；待 B1/B2 将 landing 切到正式 Pet/Project 数据流后删除旧表单状态 | 吸收中（A4 语义已吸收，旧入口仍在役） |
| `app/components/PetViewer.tsx` + `assetIndex.ts` | B5 尺寸与空间确认 | three.js 查看/调参能力被 B5 正式实现吸收 | 在役 |
| `app/generated/[...path]` + `app/uploads/[...path]`（公开静态服务） | B2/B4 | 产物入 OSS 私有桶 + 签名 URL 后删除（公开运行资产是已知反模式） | 在役 |
| `public/mockup-assets/` + `web/tests/mockFixtures.test.mjs` | 横切 | 不退役：按 Phase A 拍板升级为正式测试夹具机制 | 保留 |
| `tools/demo-prep.mjs` | — | 内存 store 退役后失效，随 B1 划账时归档 | 在役 |

## 四、lint 豁免（`web/eslint.config.mjs` PROCESS_ENV_BASELINE，只降不升）

| 豁免文件 | 随谁收敛 |
|---|---|
| `app/lib/images/falClient.ts` | B2 |
| `app/lib/jobs/avatarJob.ts` | B4 |
| `app/lib/tripo/client.ts` | B4 |
| `app/api/vibe/rewrite/route.ts` | B2 |

## 五、已退役（历史记录）

| 部件 | 退役时点与证据 |
|---|---|
| `/workbench`、`/scene-lab`、Gate Job、专用 API | Phase A 迁入 `archive/hackathon/`（`docs/governance/phase-a-inventory.md`） |
| `codexQueue`（@openai/codex-sdk 队列） | Phase A 删除，无 active 测试或依赖 |
