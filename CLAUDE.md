# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

PetScape / TinyHabitat AI——把原创宠物空间物品推进到 3D 确认、自动检查、自动报价、直接付款和真实交付的产品，当前仓库代码仍是黑客松交付基线。产品定位、用户承诺与功能范围以根目录的 `PetScape-PRD.md` 为单一真相源；目标系统结构、模块与数据归属、依赖方向以 `ARCHITECTURE.md` 为单一真相源；当前实现行为以代码为准。`docs/specs/` 和 `docs/reports/` 是黑客松批次的历史 Spec 与证据，不得自动推导未来实现。

根目录的 `DEVELOPMENT-PLAYBOOK.md` 仅供用户阅读和回顾。Agent 不应读取、引用或修改该文件。

改产品流程、3D 场景或制造链时，以 PRD 的核心闭环为准：生成或上传可制造物品模型，完成 3D 场景确认、材料和颜色选择、制作与宠物安全检查、自动报价、直接付款、真实订单以及生产物流跟踪。生成结果与 3D 预览都不自动代表适合制造或宠物使用。新增正式代码同时遵守 `ARCHITECTURE.md` 的模块化单体、多客户端 API、薄 Route Handler、独立应用层和 Web/Worker 进程边界。具体技术选型尚未拍板，不得从历史 batch spec 或旧实施计划自动推导新实现。

## 常用命令

```bash
cd web && pnpm install        # 包管理统一 pnpm
pnpm dev                      # 开发（默认 3000）
pnpm build && pnpm exec next start  # demo/生产模式（无 dev overlay）
npx tsc --noEmit              # 类型检查——本仓库最主要的硬校验，改动后必跑
node ../tools/demo-prep.mjs [--real]  # demo 预热：生成第二轨项目并打印恢复 URL
```

当前 `package.json` 的 `lint` 脚本仍指向 Next 16 已移除的 `next lint`，`tests/timeoutQueue.test.mjs` 仍引用已删除模块；两者属于 Phase A 治理项，修复前不能作为验证证据。

当前原型的外部二进制依赖（切片链）：`uv`（跑 `scripts/normalize_mesh.py`，trimesh）与 PrusaSlicer CLI；路径可用 `UV_BIN` / `PRUSASLICER_BIN` 覆盖（默认见 `avatarJob.ts`）。这些信息只用于运行和迁移现有基线，正式模型处理与切片方案仍在 `ARCHITECTURE.md` 的待决策队列中；新增正式代码不得默认延续该工具组合。

当前 API key 放**项目根** `.env`（`web/` 的上一级）：`FAL_KEY`、`MESHY_API_KEY`、`TRIPO_API_KEY`、`TRIPO_API_KEY_2`。现有 client 使用“process.env 优先，兜底手读 `../.env`”的原型机制；新增正式代码不得继续复制该模式，应按 `ARCHITECTURE.md` 收敛到统一配置入口。

## 当前基线实现（不是目标架构）

目标架构以根目录 `ARCHITECTURE.md` 为准。本节仅记录迁移前的现有实现事实，不能作为新增代码继续沿用内存状态、公开运行资产或进程内后台任务的理由。

**两个前端世代并存于一个 Next.js 单体**：

- `app/page.jsx` + `app/components/landing/` = 设计师 V3 定稿页（.jsx + 纯 CSS `landing/styles.css`）。**视觉零回归是硬约束**——这是设计师交稿的像素基准，改样式前先想清楚。
- `app/workbench/`（旧三栏工作台）是历史原型；`app/scene-lab/` 是场景实验页（.tsx + Tailwind）。二者都不是未来产品架构入口，待 Phase A 查清依赖后归档或收口。
- 两套样式共存的已知坑：Tailwind preflight 会污染 landing（曾发生 `html{line-height:1.5}` 全页漂移，靠 styles.css 末尾恢复）；landing 里 `.render-photo-card img { width:100% }` 这类通用规则会以特异性压过单类名（曾把品牌 logo 拉成全幅）。

**数据层没有数据库**：`app/lib/store/projects.ts` 用 `globalThis` 挂内存 Map（HMR 保活，**server 重启即全丢**——所以 demo 前要重跑 demo-prep）。产物文件落 `web/public/generated/{projectId}/`。

**Job 模式**（所有生成类功能同构）：API route 立即 202 + 置 `project.xxx.status='running'` → 后台 async 函数干重活并回写 project → 前端 2s 轮询 `GET /api/project/[id]`。`avatar.stage` 字段（styling/triview/modeling）驱动前端管线进度可视化。超时统一走 `jobs/timeouts.ts` 的 `withTimeout`。

**3D 引擎级联**（`app/lib/jobs/avatarJob.ts`，2026-07-04 拍板）：`MESH_ENGINE='auto'` = tripo#key1 → tripo#key2 → meshy 逐级降级；每级瞬时错误重试一次，额度/认证/版本类硬错误（`isHardEngineError`）不重试直接降级。Tripo 的多 key 注入用 `tripo/client.ts` 的 `withTripoKey`（AsyncLocalStorage，并发安全，不改函数签名）。tripo 路径=三视图（fal 网格 → 裁切 → 独立性验证 → multiview_to_model）；meshy 路径=风格化立绘单图。**切片不挖腔**（用户实测 carve_shell 会过度挖导致模型残缺——老仓库的挖腔步骤被有意跳过，勿"补全"）。

**风格化 prompt 是用户要亲手调的**：`app/lib/prompts/avatarStyle.ts`（模板+装扮词表+`STYLE_ENABLED` 回退开关）。改效果先改这里的文案，不要动管线。

**mock 贯穿**（`?mock=1`）：所有生成链走 `public/mockup-assets/` 预置资产、秒级完成，是 demo 现场的保险丝。mock 资产**必须留在 git 里**（曾被 gitignore 导致 fresh clone 全链 404）。mock 切片的重量/时长按 scaleMm 立方缩放伪造——保持这个保真度，否则 demo 换档演示数字不动会露馅。

**迁移前接驳层纪律**：在正式应用层接管以前，`app/page.jsx`（projectId 引导、`?project=<id>` 恢复、props 超集下传）和 `app/lib/types/project.ts`（job 字段契约）仍是现有编排冻结点，避免在治理阶段继续制造状态分叉。它们不是目标架构中的永久边界。

## 老仓库

`../../legacy/3D宠物打印` 是本仓库的骨架来源（只读参考）：legacy 8 阶段聊天链、Meshy 旧编排、tldraw 画布、实验区（选型证据）都保留在那里。`assets-3d/` 里的 9 个 GLB（5 商品模块+4 装扮）是 Meshy 离线生成的成品资产，场景消费的归一化版本在 `web/public/scene-assets/`（烘焙脚本 `tools/bake-assets/`）。
