# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

PetScape / TinyHabitat AI——把原创宠物空间物品推进到 3D 确认、自动检查、自动报价、直接付款和真实交付的产品，当前仓库代码仍是黑客松交付基线。产品定位、用户承诺与功能范围以根目录的 `PetScape-PRD.md` 为单一真相源；目标系统结构、模块与数据归属、依赖方向以 `ARCHITECTURE.md` 为单一真相源；当前实现行为以代码为准。`archive/hackathon/docs/specs/` 和 `archive/hackathon/docs/reports/` 是黑客松批次的历史 Spec 与证据，不得自动推导未来实现。

黑客松批次 Spec、报告与历史探查已统一归档在 `archive/hackathon/docs/`，不得自动推导未来实现。根目录的 `DEVELOPMENT-PLAYBOOK.md` 仅供用户阅读和回顾。Agent 不应读取、引用或修改该文件。

Phase B 基座后新代码的工程实践约束（测试策略分级、zod 运行时校验、支付上线前 checklist 及约束落点分层规则）以 `docs/governance/engineering-conventions.md` 为正本；`packages/server` 的包级注意事项见 `packages/server/CLAUDE.md`。

改产品流程、3D 场景或制造链时，以 PRD 的核心闭环为准：生成或上传可制造物品模型，完成 3D 场景确认、材料和颜色选择、制作与宠物安全检查、自动报价、直接付款、真实订单以及生产物流跟踪。生成结果与 3D 预览都不自动代表适合制造或宠物使用。新增正式代码同时遵守 `ARCHITECTURE.md` 的模块化单体、多客户端 API、薄 Route Handler、独立应用层和 Web/Worker 进程边界。具体技术选型尚未拍板，不得从历史 batch spec 或旧实施计划自动推导新实现。

## 常用命令

```bash
pnpm install                  # 在仓库根跑：pnpm workspace（web + worker + packages/server）
cd web && pnpm dev            # Web 开发（默认 3000，读根 .env）
cd web && pnpm build          # 生产构建（Next standalone）
(cd <包目录> && pnpm exec tsc --noEmit)   # 类型检查，web / packages/server / worker 三包都要过
                              # 注意：根目录裸 `npx tsc` 会拉到一个假 tsc 包，必须进包目录用 pnpm exec
cd web && pnpm lint:baseline  # 迁移期门禁：原型存量 lint 只降不升
pnpm test                     # 在各包目录内跑（Node test runner）；packages/server 集成测试
                              # 的两种跑法（本地 PG / 经隧道打真实 RDS）见 packages/server/CLAUDE.md
docker compose -f deploy/compose.local.yml up   # 本地容器化验收（web+worker，真实 RDS 经 SSH 隧道）
node tools/demo-prep.mjs [--real]  # 原型 demo 预热：生成第二轨项目并打印恢复 URL
```

CI（`.github/workflows/ci.yml`）与部署链（`deploy.yml`：push main → GHA 双镜像 → ACR → SSH ECS Compose）是行为正本；回滚用 `deploy/rollback.sh <image-tag>`。

`tests/timeouts.test.mjs` 只验证仍在使用的 `jobs/timeouts.ts`；已删除的 `codexQueue` 不再有 active 测试或依赖。

当前原型的外部二进制依赖（切片链）：`uv`（跑 `scripts/normalize_mesh.py`，trimesh）与 PrusaSlicer CLI；路径可用 `UV_BIN` / `PRUSASLICER_BIN` 覆盖（默认见 `avatarJob.ts`）。这些信息只用于运行和迁移现有基线，正式模型处理与切片方案仍在 `ARCHITECTURE.md` 的待决策队列中；新增正式代码不得默认延续该工具组合。

**阿里云操作一律走 `tools/aliyun <命令> ...`，禁止裸调 `aliyun`**：本机全局 `~/.aliyun/config.json` 的默认凭证属于用户个人账号（<PERSONAL_CLOUD_ACCOUNT_ID>），裸调必打错账号。封装脚本自动注入项目 `.env` 的 `ALIBABA_CLOUD_*` 凭证并在执行前断言账号 = PETSCAPE（<PROJECT_CLOUD_ACCOUNT_ID>），不符即拒绝。SDK 代码同理：显式传 `.env` 凭证，不依赖环境默认链。

全部密钥与资源配置放**项目根** `.env`（`web/` 的上一级）：生成类 key（`FAL_KEY`/`MESHY_API_KEY`/`TRIPO_API_KEY*`）、阿里云资源与凭证（`ALIBABA_CLOUD_*`，含 RDS/OSS/ACR）、身份（`BETTER_AUTH_SECRET`）等。**正式代码一律经 `packages/server/src/infra/config` 的统一配置入口（common/web/worker 三 schema）消费**，lint 禁止在 config 外读 `process.env`；“手读 `../.env`”的原型机制仅存于 4 个豁免文件（随对应模块吸收原型时收敛）。

## 当前基线实现（不是目标架构）

目标架构以根目录 `ARCHITECTURE.md` 为准。

**2026-07-18 起，Phase B 正式基座与黑客松原型在同一仓库并存**：pnpm workspace（`web` + `worker` + `packages/server`）；正式链 = RDS PostgreSQL（Prisma 7 + adapter-pg）+ OSS 私有桶 + PG 任务表 SKIP LOCKED Worker + Better Auth 双凭证登录（手机号/邮箱验证码、双向绑定、OTP 发送节流；短信 PNVS、邮件 DirectMail，通道由 `SMS_CHANNEL`/`MAIL_CHANNEL` 配置，默认 log）+ 结构化日志 + CI/CD 部署与回滚。正式站 UI（App 壳 + `/login` + `/account`）以 WP-A1 用户认可版为视觉基准。工作包与行为验收证据见 `docs/plans/phase-b-execution-plan.md` 与 `docs/operations/`；工程约束见 `docs/governance/engineering-conventions.md`。

本节以下记录的是**尚未迁移的原型链**（`web/app` 旧代码）的实现事实——随对应产品模块（`PRODUCT-MODULES.md`）吸收后逐段消亡；不能作为新增代码继续沿用内存状态、公开运行资产或进程内后台任务的理由。

**当前 active Web 与历史原型已经分离**：

- `app/page.jsx` + `app/components/landing/` = 设计师 V3 定稿页（.jsx + 纯 CSS `landing/styles.css`）。**视觉零回归是硬约束**——这是设计师交稿的像素基准，改样式前先想清楚。
- 旧三栏 Workbench、Scene Lab、专用 API 和 Gate Job 已迁入 `archive/hackathon/`，不再参与 active build 或路由。
- 两套样式共存的已知坑：Tailwind preflight 会污染 landing（曾发生 `html{line-height:1.5}` 全页漂移，靠 styles.css 末尾恢复）；landing 里 `.render-photo-card img { width:100% }` 这类通用规则会以特异性压过单类名（曾把品牌 logo 拉成全幅）。

**原型链数据层没有数据库**（正式链已用 RDS）：`app/lib/store/projects.ts` 用 `globalThis` 挂内存 Map（HMR 保活，**server 重启即全丢**——所以 demo 前要重跑 demo-prep）。产物文件落 `web/public/generated/{projectId}/`。

**Job 模式**（所有生成类功能同构）：API route 立即 202 + 置 `project.xxx.status='running'` → 后台 async 函数干重活并回写 project → 前端 2s 轮询 `GET /api/project/[id]`。`avatar.stage` 字段（styling/triview/modeling）驱动前端管线进度可视化。超时统一走 `jobs/timeouts.ts` 的 `withTimeout`。

**3D 引擎级联**（`app/lib/jobs/avatarJob.ts`，2026-07-04 拍板）：`MESH_ENGINE='auto'` = tripo#key1 → tripo#key2 → meshy 逐级降级；每级瞬时错误重试一次，额度/认证/版本类硬错误（`isHardEngineError`）不重试直接降级。Tripo 的多 key 注入用 `tripo/client.ts` 的 `withTripoKey`（AsyncLocalStorage，并发安全，不改函数签名）。tripo 路径=三视图（fal 网格 → 裁切 → 独立性验证 → multiview_to_model）；meshy 路径=风格化立绘单图。**切片不挖腔**（用户实测 carve_shell 会过度挖导致模型残缺——老仓库的挖腔步骤被有意跳过，勿"补全"）。

**风格化 prompt 是用户要亲手调的**：`app/lib/prompts/avatarStyle.ts`（模板+装扮词表+`STYLE_ENABLED` 回退开关）。改效果先改这里的文案，不要动管线。

**mock 贯穿**（`?mock=1`）：所有生成链走 `public/mockup-assets/` 预置资产、秒级完成，是 demo 现场的保险丝。mock 资产**必须留在 git 里**（曾被 gitignore 导致 fresh clone 全链 404）。mock 切片的重量/时长按 scaleMm 立方缩放伪造——保持这个保真度，否则 demo 换档演示数字不动会露馅。

**迁移前接驳层纪律**：在正式应用层接管以前，`app/page.jsx`（projectId 引导、`?project=<id>` 恢复、props 超集下传）和 `app/lib/types/project.ts`（job 字段契约）仍是现有编排冻结点，避免在治理阶段继续制造状态分叉。它们不是目标架构中的永久边界。

## 老仓库

`../../archive/legacy/3D宠物打印` 是本仓库的骨架来源（只读参考；外层史料 2026-07-18 归拢至 `../../archive/`）；本 checkout 的黑客松历史材料统一位于 `archive/hackathon/`。`assets-3d/` 里的 9 个 GLB（5 商品模块+4 装扮）是 Meshy 离线生成的成品资产，场景消费的归一化版本在 `web/public/scene-assets/`（烘焙脚本 `tools/bake-assets/`）。
