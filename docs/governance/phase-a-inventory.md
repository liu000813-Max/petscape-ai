# Phase A 仓库治理与历史资产分类

> 状态：2026-07-17 已按用户逐项批准的处置清单执行；尚未提交或推送。
>
> 范围：`current/PetScape-final`。本文记录分类、引用拓扑、处置与验收证据，不取代 `ARCHITECTURE.md`、`PetScape-PRD.md` 或代码事实。

## 1. 安全边界与起点

- 执行起点：`main`，HEAD `a2a12d52a99700cd05e136229b369cd54bf611f3`。
- 起点已有用户改动：`web/next-env.d.ts`；Phase A 保留该改动，没有回退。
- 项目根 `.env` 只确认存在，未读取内容。
- 144 GB 原始素材不在本次治理范围内，未触碰。
- `.next/`、`node_modules/`、`web/public/uploads/` 全部保留；`uploads/` 执行物理清理前后内容哈希均为 `a7c5a9c80d39343bf35c153fb3e792713308dd1c14e5786042a25787b11f3618`。
- 不做 Git 历史重写，不引入 Git LFS，不提交、不推送。

## 2. 页面、API 与历史引用拓扑

### 2.1 保留的 active 链路

当前首页 `/` 继续使用：

- `POST /api/project`；
- `GET /api/project/:id`；
- `POST /api/project/:id/upload`；
- `POST /api/project/:id/avatar`；
- `POST /api/project/:id/avatar-slice`；
- `POST /api/project/:id/vibe`；
- `POST /api/vibe/rewrite`。

首页还使用 `web/app/components/assetIndex.ts` 指向的 `web/public/scene-assets/`。共享的项目创建/读取、上传、类型和 `ImageDropzone` 均保留。

### 2.2 Workbench 历史链

旧 `/workbench` 没有来自当前产品页的链接、跳转或导入。专用实现包括：

- 页面：`web/app/workbench/`；
- UI：`WorkbenchCanvas.tsx`、`ModelStudio.tsx`；
- API：`brief`、`scenes`、`gate1`、`gate2`；
- Job：`gate1Job.ts`、`gate2Job.ts`；
- 本地检查：`printability/localCheck.ts`；
- `PATCH /api/project/:id` 的 `canvasSnapshot` 写入。

Workbench 还调用已经不存在的 `/api/project/:id/agent/extract`；`codexQueue.ts`、Agent Route Handler 和 Agent 实现本来就不在当前 checkout 中。`localCheck.ts` 和 `gate1Job.ts` 引用的 `scripts/carve_shell.py` 在执行前也不存在，旧链并非完整可运行能力。

以上专用代码已迁入 `archive/hackathon/workbench/`；共享代码保留。active `GET /api/project/:id` 保留，Workbench 专用 `PATCH` 已移除。旧 `web/README.md` 也归档到 Workbench 区，active Web README 已重写为当前入口说明。

### 2.3 Scene Lab

`web/app/scene-lab/` 没有来自当前产品页的运行依赖。两个页面文件和 9 个本机资产均已与 `legacy/3D宠物打印` 对应内容逐字节复核相同。

- 页面代码迁入 `archive/hackathon/scene-lab/`，因此 active route 消失；
- `web/public/scene-lab-assets/` 共 9 个文件、116,926,301 bytes，已移入废纸篓；
- 正式 `web/public/scene-assets/` 不受影响。

### 2.4 历史文档与验证资料

历史资料保留原文和当时语境，不改写成当前事实：

| 归档路径 | 文件数 | 角色 |
|---|---:|---|
| `archive/hackathon/docs/specs/` | 5 | 黑客松批次输入 |
| `archive/hackathon/docs/reports/` | 9 | Builder/Verifier 与风险验证证据 |
| `archive/hackathon/docs/research/` | 37 | 旧仓库探查快照 |
| `archive/hackathon/tools/verify-batch1/` | 25 | Batch 1 验证脚本与截图 |
| `archive/hackathon/tools/verify-batch2/` | 18 | Batch 2 验证脚本与截图 |
| `archive/hackathon/tools/verify-batch3/` | 22 | Batch 3 验证脚本与截图 |
| `archive/hackathon/dogfood-output/` | 18 | 现行缺陷的一手报告、截图、视频与下载样本；原第 19 项 `.DS_Store` 未入库 |

## 3. 资产与生成物分类

### 3.1 正式资产：保留

| 路径 | 依据 |
|---|---|
| `web/public/assets/` | 当前首页使用的设计静态资产 |
| `web/public/scene-assets/` | `assetIndex.ts` 使用的正式场景运行资产 |
| `assets-3d/` | 场景和装扮的来源、生成记录与可追溯原件 |
| `web/public/uploads/` | 用户已逐张确认，全部保留 |

根目录 `pink teapot 3d model.stl` 已用 `git mv` 迁入 `assets-3d/sources/pink-teapot/pink-teapot-3d-model.stl`；`pink-teapot.meta.json` 已同步记录新来源路径。

### 3.2 最小测试夹具：保留并建立契约

`web/public/mockup-assets/` 共 9 个文件，是 `?mock=1` 图片生成、场景修改、3D、切片和 Avatar 链路的正式夹具。`tests/mockFixtures.test.mjs` 精确限制允许文件集，并拒绝缺失、空文件或混入未分类文件。

### 3.3 固定演示与历史验收基线：保留

三条证据不再占用运行时写入目录，已用 `git mv` 迁入 `web/public/demo-baselines/`：

| ID | 文件数 | 角色 |
|---|---:|---|
| `34334a4b-a2f4-4b00-9206-ba93ac4dbe53` | 8 | 真实 Avatar E2E 与 120/160 mm 切片证据；输入图保留在 `uploads/` |
| `9709946e-699f-4223-a5f4-7e4bb28bcc56` | 20 | 旧 Gate1→Gate2 真链 |
| `faacd227-1192-4591-a022-3b8803b1691b` | 6 | 首批真实 Meshy Avatar E2E；输入图保留在 `uploads/` |

三条证据现阶段继续留在 Git，不使用 LFS；对象存储 ADR 落地后再迁往外部证据库。

### 3.4 可再生运行产物：停止 Git 跟踪

三条证据迁出后，`web/public/generated/` 剩余 35 个 tracked 项目目录、210 个文件、661,640,267 bytes。已执行 `git rm --cached`，35 个本机副本全部保留；整个目录由根 `.gitignore` 与 `web/.gitignore` 忽略。

35 个项目为：

```text
13a968fc-89af-4030-a224-c067fb127ea7
17ef6542-c180-4c52-9ecc-dcaa745c5e2e
22fc33b3-ea53-419b-aacb-6722a0919016
28c84a28-0641-48a9-95f3-49a6095bba29
309fa0c8-a6fc-4d5b-8b01-a8f55b617203
4476ce7a-c5ca-4576-81cb-97709ef0e951
4d01b153-2ee7-4525-80e0-02344c1531e5
5d11496a-7a0b-4b7b-93d9-c8c4bb8bec90
663ad1ed-03d0-4052-a890-0ae7193ef210
67153f1d-712f-4e04-9ba8-19c8b7905829
6ec0da3d-8d8c-4da1-8059-880715df7ea2
868808ce-93d1-4a1e-82bd-55a9fd5af3aa
90a4be05-2a24-4888-bfe2-81f77a4c0645
951f9ed3-26f7-43d0-b5de-11570dcfcbb3
979ad0d3-b04c-4e1d-acff-48d2da6144c6
99b525f6-29e6-426f-96cb-291929fa3800
9fd7a7ba-00cb-48a8-8a29-8f06f001fbc9
b436886d-9b81-4868-bd25-f3e397f7bb92
b4ede523-71c2-4247-9375-c4c07f3a4966
bfb8f1cc-9822-4c90-a361-618814593a19
c7fe2a6e-9db1-4efb-a475-c72cf1e3b030
cd3b9df8-aa1a-456b-80a8-f040b0a1f644
da7ad3ab-b1b0-4cb3-a371-ddf522c4d8f4
dae576fe-440c-41dd-8b47-84e955c540aa
e85368d6-f70f-411d-a772-bf3e750a6b12
e9a4b56b-5dc7-4cb7-a5b5-55d4d4337b6b
eb31f860-6a79-4f8d-b241-f08a4eaf781c
eb5d6910-2ece-4a1f-8b40-b365b4f8c1ca
f32589a3-d61c-4f87-8405-7d203844af0c
f35dbee8-d9d9-4a23-98eb-630d92ac6b0b
f89456a5-6cb6-465f-a63d-0912426ddd82
faf59638-b0f2-4a81-b535-65c075badb05
ff4bbbdb-62b5-466f-960c-453ff2ff97f0
m5-acceptance-1783081419923
m5-startjob-1783081459725
```

此外还存在一个执行前就有的空目录 `29a328c5-89bc-449e-8846-57cdc8fe391f/`（mtime 2026-07-03，无文件、无 Git 跟踪）。它不在已批准的 10 个物理删除目标中，因此本轮保留，不擅自扩大删除范围。

`web/public/viewer.html` 在全仓库无调用方，已从 current 删除；其默认模型 `c7fe2a6e-...` 包含在上述 35 个本机保留目录中。

## 4. 可恢复的本机清理

以下内容均通过 `/usr/bin/trash` 移入废纸篓，没有使用 `rm`：

- 10 个已确认无 Git 跟踪文件的运行目录，共 70 个文件；
- `web/public/scene-lab-assets/`；
- 仓库内 11 个 `.DS_Store`。

执行后目标路径剩余 0，仓库内 `.DS_Store` 剩余 0；废纸篓中已定位到运行目录和 `scene-lab-assets`，可恢复。

## 5. 失真入口与依赖收口

### 5.1 Lint

- `next lint` 已替换为 ESLint 9 + Next.js flat config；
- 原始存量为 17 errors / 31 warnings；
- `lint-baseline.json` 按“文件 + 规则 + 数量”锁存原始错误，并设置总上限 17；
- `pnpm lint:baseline` 拒绝任何新文件、新规则桶或数量增长，允许存量下降；
- 本轮不修改业务组件来消除存量错误。

### 5.2 测试

- 旧 `tests/timeoutQueue.test.mjs` 不再引用已删除的 `codexQueue.ts`，并已重命名为 `tests/timeouts.test.mjs`；
- 当前覆盖 `withTimeout` 的超时错误、AbortSignal 和成功路径；
- `pnpm test` 同时运行 mock fixture 契约。

### 5.3 Codex SDK 与 tldraw

- Workbench 失效 Agent UI 已归档；
- `next.config.ts` 的 SDK external 配置已移除；
- `@openai/codex-sdk` 已从 `package.json`、锁文件和安装依赖中移除；
- 仅由 Workbench 使用的 `tldraw` 也已移除；
- active runtime 不再包含 `@openai/codex-sdk`、`codexQueue` 或 `/agent/extract`。

## 6. 验收

最终验收必须同时满足：

- `pnpm test`；
- `pnpm exec tsc --noEmit`；
- `pnpm lint:baseline`；
- `pnpm build`，且 production route table 不含 `/workbench` 与 `/scene-lab`；
- active runtime 无退役依赖引用；
- 三条 demo baseline 受 Git 跟踪，`generated/` 受 Git 跟踪文件数为 0；
- `.next/`、`node_modules/`、`uploads/` 仍存在；
- `git diff --check`。

2026-07-17 本轮结果：

- `pnpm test`：4/4 通过；
- `pnpm exec tsc --noEmit`：通过；保留的 `.next/dev/types` 起初仍引用旧路由，先由 production build 和 Next dev 类型生成原位刷新，没有删除 `.next/`；
- `pnpm lint:baseline`：通过，active 存量降为 11/17 errors、26 warnings；
- `pnpm build`：通过；路由表不含 `/workbench`、`/scene-lab` 及其专用 API；
- build 有一条 `runtimePublicFile.ts` 动态文件路径导致的 NFT 追踪范围警告，不影响成功结果，留待后续基础设施治理；
- active runtime 退役引用数为 0；三条 demo baseline 共 34 个 tracked 文件；`generated/` tracked 文件数为 0；
- 35 个停止跟踪的运行项目仍保留本机副本；另有一个未获删除授权的空目录按边界保留；
- `.next/`、`node_modules/`、`uploads/` 均存在，`uploads/` 哈希未变化；
- `git diff --check`：通过。

Phase A 已完成本地执行与验证，但尚未提交或推送。
