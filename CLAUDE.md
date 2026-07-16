# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

PetScape / TinyHabitat AI——从 AI 宠物空间灵感走向单件 3D 打印交付的产品，当前仓库代码仍是黑客松交付基线。产品定位、用户承诺与 Web V1 范围以 `docs/TinyHabitat-PRD.md` 为单一真相源；`docs/integration-mapping.md` 只记录黑客松时期的已交付能力、降级方案和拍板历史；各批次闭合 spec 在 `docs/specs/`。

改产品流程、3D 场景或制造链时，以 PRD 中的 Web V1 顺序为准：先用 2D 整体方案完成选择，再将用户框选的单个原创躲避屋推进到 3D 候选确认、人工制造审核和正式报价。2D 效果图与 3D 候选都不代表生产批准。具体实现尚未拍板，不得从历史 batch spec 自动推导新实现。

## 常用命令

```bash
cd web && pnpm install        # 包管理统一 pnpm
pnpm dev                      # 开发（默认 3000）
pnpm build && pnpm start      # demo/生产模式（无 dev overlay）
npx tsc --noEmit              # 类型检查——本仓库最主要的硬校验，改动后必跑
pnpm lint                     # next lint
node tests/timeoutQueue.test.mjs   # 唯一单测（node 直跑，无测试框架）
node ../tools/demo-prep.mjs [--real]  # demo 预热：生成第二轨项目并打印恢复 URL
```

外部二进制依赖（切片链）：`uv`（跑 `scripts/normalize_mesh.py`，trimesh）与 PrusaSlicer CLI；路径可用 `UV_BIN` / `PRUSASLICER_BIN` 覆盖（默认见 `avatarJob.ts`）。

API key 放**项目根** `.env`（`web/` 的上一级）：`FAL_KEY`、`MESHY_API_KEY`、`TRIPO_API_KEY`、`TRIPO_API_KEY_2`。Next dev 不会自动读它——各 client 里有"process.env 优先，兜底手读 `../.env`"的机制，新增 key 读取时沿用该模式。

## 大图架构

**两个前端世代并存于一个 Next.js 单体**：

- `app/page.jsx` + `app/components/landing/` = 设计师 V3 定稿页（.jsx + 纯 CSS `landing/styles.css`）。**视觉零回归是硬约束**——这是设计师交稿的像素基准，改样式前先想清楚。
- `app/workbench/`（旧三栏工作台）与 `app/scene-lab/` = 老项目调试页（.tsx + Tailwind）。
- 两套样式共存的已知坑：Tailwind preflight 会污染 landing（曾发生 `html{line-height:1.5}` 全页漂移，靠 styles.css 末尾恢复）；landing 里 `.render-photo-card img { width:100% }` 这类通用规则会以特异性压过单类名（曾把品牌 logo 拉成全幅）。

**数据层没有数据库**：`app/lib/store/projects.ts` 用 `globalThis` 挂内存 Map（HMR 保活，**server 重启即全丢**——所以 demo 前要重跑 demo-prep）。产物文件落 `web/public/generated/{projectId}/`。

**Job 模式**（所有生成类功能同构）：API route 立即 202 + 置 `project.xxx.status='running'` → 后台 async 函数干重活并回写 project → 前端 2s 轮询 `GET /api/project/[id]`。`avatar.stage` 字段（styling/triview/modeling）驱动前端管线进度可视化。超时统一走 `jobs/timeouts.ts` 的 `withTimeout`。

**3D 引擎级联**（`app/lib/jobs/avatarJob.ts`，2026-07-04 拍板）：`MESH_ENGINE='auto'` = tripo#key1 → tripo#key2 → meshy 逐级降级；每级瞬时错误重试一次，额度/认证/版本类硬错误（`isHardEngineError`）不重试直接降级。Tripo 的多 key 注入用 `tripo/client.ts` 的 `withTripoKey`（AsyncLocalStorage，并发安全，不改函数签名）。tripo 路径=三视图（fal 网格 → 裁切 → 独立性验证 → multiview_to_model）；meshy 路径=风格化立绘单图。**切片不挖腔**（用户实测 carve_shell 会过度挖导致模型残缺——老仓库的挖腔步骤被有意跳过，勿"补全"）。

**风格化 prompt 是用户要亲手调的**：`app/lib/prompts/avatarStyle.ts`（模板+装扮词表+`STYLE_ENABLED` 回退开关）。改效果先改这里的文案，不要动管线。

**mock 贯穿**（`?mock=1`）：所有生成链走 `public/mockup-assets/` 预置资产、秒级完成，是 demo 现场的保险丝。mock 资产**必须留在 git 里**（曾被 gitignore 导致 fresh clone 全链 404）。mock 切片的重量/时长按 scaleMm 立方缩放伪造——保持这个保真度，否则 demo 换档演示数字不动会露馅。

**接驳层纪律**（多 agent 并行开发的遗产，仍然有效）：`app/page.jsx`（projectId 引导、`?project=<id>` 恢复、props 超集下传）和 `app/lib/types/project.ts`（job 字段契约）是编排冻结点——landing 各 section 组件只消费 props/轮询 project，不要把跨组件状态私自搬进单个组件。

## 老仓库

`<USER_HOME>/Desktop/3D宠物打印` 是本仓库的骨架来源（只读参考）：legacy 8 阶段聊天链、Meshy 旧编排、tldraw 画布、实验区（选型证据）都留在那边未迁移。`assets-3d/` 里的 9 个 GLB（5 商品模块+4 装扮）是 Meshy 离线生成的成品资产，场景消费的归一化版本在 `web/public/scene-assets/`（烘焙脚本 `tools/bake-assets/`）。
