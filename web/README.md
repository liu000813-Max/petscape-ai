# PetScape Web

> 文档边界：本文件记录旧 `/workbench` 的工程形态与历史生成管线，不是当前首页或产品需求的单一真相源。产品方向与用户故事见 [`../PetScape-PRD.md`](../PetScape-PRD.md)，目标架构与技术决策队列见 [`../ARCHITECTURE.md`](../ARCHITECTURE.md)，当前首页与黑客松交付说明见 [`../README.md`](../README.md)。

旧三栏工作台承载「对话落表 → 改造图 → 门 1 选件 → 2D→3D → 挖腔 → 调参 → 门 2 → 切片下载」的生成链 E2E。本文件只保留历史工程入门和指针。下文的 trimesh、PrusaSlicer 等名称只描述旧链路的实际依赖，不代表目标架构已经确认这些技术。

## 启动

```bash
cd web
npm install --legacy-peer-deps   # three 引入后有 peer 冲突，必须带此 flag
npm run dev
```

`dev` 脚本使用 `next dev -H 0.0.0.0`，可让局域网同伴访问 `http://<本机 IP>:3000`。

服务端凭证/依赖：

- 生图/改图/抠图 + **一致性四视图网格**走 fal.ai nano-banana（`app/lib/images/falClient.ts`），需要项目根 `.env` 的 `FAL_KEY`。
- 3D 主链 = Tripo `multiview_to_model`（`app/lib/tripo/client.ts`，`v3.0-20250812`），需要 `TRIPO_API_KEY`。可打印性检查 = 本地 trimesh（`app/lib/printability/localCheck.ts`），不走外部 API。Meshy client（`app/lib/meshy/client.ts`，`MESHY_API_KEY`）保留为备选，不在主链。
- `.env` 不入库（gitignored）：新 checkout / worktree 需从主仓库手动拷贝。
- 门 1 挖腔依赖本机 Python（`scripts/carve_shell.py`，voxel 重网格 + manifold 布尔）；门 2 切片依赖本机 PrusaSlicer（`/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`，可用 `PRUSASLICER_BIN` 覆盖）和 `uv`（`/opt/homebrew/bin/uv`，可用 `UV_BIN` 覆盖；跑 `scripts/normalize_mesh.py`），见 `app/lib/jobs/gate2Job.ts`。mock 链路不需要这些。

## 当前架构：三栏工作台

以下内容描述旧 workbench 的当前实现。目标用户旅程见产品 PRD。

- **左栏 · Brief 表单（真相源）**：PetProfile 语义（物种 slug、petName、习性 chips、vibe、宠物/笼箱照上传、目标物品、禁忌），即时 PATCH 落到服务端 `app/lib/store/projects.ts` 的 in-memory 单例（`PetScapeProject`）。
- **中栏 · 画布（tldraw）**：`app/components/WorkbenchCanvas`，展示 2D 方案卡 / 标注反馈 / 3D 预览。内容真相源是 `project.canvasItems`，不是 tldraw snapshot（snapshot 只存布局）。
- **右栏 · Chat**：接了 Agent **生成前静默抽取**——用户自然语言 → 一次 Codex SDK 调用抽取已表达字段 → 并入 Brief + 回一句确认/追问缺口（`app/api/project/[id]/agent/extract/route.ts`）。售中重对话（调参/确认尺寸）尚未接入，属规划中。

旧「8 阶段聊天页」（旧状态机）已冻结在 `web/app/legacy/page.tsx`，可访问但不再开发，新功能一律加在 `web/app/page.tsx`。

组合场景预览 demo（three.js 多 GLB 共存 + 打印材质预览）在 `web/app/scene-lab/page.tsx`（`/scene-lab`），为 Max「加入 3D 场景」形态探路。

## API Routes

`api/project/*` 服务当前工作台：

- `POST /api/project`：创建项目
- `GET /api/project/:id`：读取项目全量状态（含轮询用的生成/切片进度）
- `PATCH /api/project/:id/brief`：表单字段落表
- `POST /api/project/:id/agent/extract`：Chat 自然语言 → Codex SDK 抽字段落表
- `POST /api/project/:id/scenes`：生成 2D 场景方案（有笼箱照 → i2i 改造 Before/After，无照 → t2i）
- `POST /api/project/:id/scenes/:sceneId/revise`：按画布标注修改指定场景
- `POST /api/project/:id/gate1`：门 1，确认场景 + 目标物品名 → 白底隔离 → fal edit 四视图网格 → Tripo multiview → 挖腔 → 本地可打印性检查
- `POST /api/project/:id/gate2`：门 2，确认参数 → normalize → PrusaSlicer 切片

`api/session/*` 只服务 `web/app/legacy/page.tsx` 的旧聊天状态机，不要在新功能里接入。

## 开发要点

- `?mock=1`：scenes / revise / gate1 / gate2 均支持，走 `public/mockup-assets` 占位图/模型，不烧 fal/Tripo/PrusaSlicer 额度，回归优先用这个（mock gate1 不 spawn 挖腔脚本，恒 ready）。
- mock 3D 资产（`mock-model.{glb,stl,gcode}`）是 gitignored 大文件，新 checkout 环境需手动从 `experiments/meshy-test/` 产物拷入 `web/public/mockup-assets/`，否则 gate1/gate2 的 mock 链会 ENOENT。
- 正式生成的产物落 `public/generated/<projectId>/`（gitignored），通过 Next 静态路径下载。门 1 产物用固定文件名（`model.glb` 等），重跑同一项目会覆盖历史产物（已挂修复任务，见 `CLAUDE.md` Learned Constraints）。
