# PetScape-final 仓库结构现状盘点（只读侦察）

范围：`<REPOSITORY_ROOT>`
时间：2026-07-18。HEAD 处于 `git status --short` 仅 `M web/next-env.d.ts` 的干净状态（其余为已知未提交的 Phase A 治理改动，见下文引用的 `docs/governance/phase-a-inventory.md`）。

---

## 1. `web/app/` 完整树 + 职责判断

### 1.1 目录树

```
web/app/
├── api/
│   ├── project/
│   │   ├── route.ts                         POST 创建项目
│   │   └── [id]/
│   │       ├── route.ts                     GET 项目详情（含 recoverProjectFromDisk 兜底）
│   │       ├── avatar/route.ts               POST 启动 avatar 生成 job
│   │       ├── avatar-slice/route.ts         POST 启动切片 job
│   │       ├── upload/route.ts               POST 文件上传（写 web/public/uploads）
│   │       └── vibe/route.ts                 POST 启动场景「氛围图」生成 job
│   └── vibe/rewrite/route.ts                 POST 文案改写（直接读 process.env / 手读 ../.env，无 job 层）
├── components/
│   ├── assetIndex.ts                         模块 id → 3D/billboard 渲染方式映射表（消费 web/public/scene-assets, web/public/assets）
│   ├── ImageDropzone.jsx                     通用图片拖拽上传 UI（被 landing 内 3 处复用）
│   ├── PetViewer.tsx                         Three.js 宠物模型查看器（GLTFLoader/OrbitControls）
│   ├── SceneViewer.tsx                       Three.js 场景查看器，导入 assetIndex
│   ├── model-viewer.d.ts（其实在 app/ 根，见下）
│   └── landing/                              设计师 V3 定稿页组件集（20 个 .jsx + 1 个 data.js + 1 个 styles.css）
│       ├── data.js                           静态文案/数据表（modules/species/materialRows 等）
│       ├── styles.css                        landing 专用纯 CSS（非 Tailwind）
│       ├── Navbar / HeroFooter / DetailDrawer / SpeciesShowcase / PetCreatorSection /
│       │   IntroSection / ModuleCommunitySection / EnvironmentPreviewSection /
│       │   UploadVibeSection / RenderSection / ScenePackSection / ManufacturingSection /
│       │   MaterialSafetySection / GiftSection / OrderFlowSection / FlipCards /
│       │   ModuleCard / ProductRender / AssetPlaceholder / GridIcon
│                                               各为首页单个 section/子组件，互相仅同目录内 import + data.js
├── generated/[...path]/route.ts               GET 代理层：从 web/public/generated 按需流式返回文件（safePath 校验）
├── uploads/[...path]/route.ts                  GET 代理层：同上但对应 web/public/uploads
├── lib/                                        应用/领域逻辑（见第 4 节详细依赖图）
│   ├── images/    cropGrid.ts, falClient.ts, multiviewPrompt.ts, scenePrompt.ts, triview.ts
│   ├── jobs/      avatarJob.ts, gcodeMeta.ts, timeouts.ts, vibeJob.ts
│   ├── printability/   空目录（0 文件；旧 localCheck.ts 已迁入 archive/hackathon/workbench，见 docs/governance/phase-a-inventory.md:40-45）
│   ├── prompts/   avatarStyle.ts
│   ├── store/     projects.ts（内存 store）, recoverProject.ts（磁盘兜底恢复）
│   ├── tripo/     client.ts
│   └── types/     project.ts（PetScapeProject 类型契约）
├── globals.css                                 全局样式，被 layout.tsx 引入
├── layout.tsx                                  Next root layout
├── model-viewer.d.ts                           @google/model-viewer 的类型声明
└── page.jsx                                    首页入口（唯一 active 页面，见第 7 节）
```

### 1.2 API 路由清单（共 7 个 active）

| 方法+路径 | 文件 | 职责 |
|---|---|---|
| POST /api/project | `web/app/api/project/route.ts:2` | 创建项目，调 `lib/store/projects.ts` |
| GET /api/project/:id | `web/app/api/project/[id]/route.ts:2-3` | 读项目 + 内存缺失时调 `recoverProjectFromDisk` |
| POST /api/project/:id/upload | `web/app/api/project/[id]/upload/route.ts` | 写文件到 `web/public/uploads` |
| POST /api/project/:id/avatar | `web/app/api/project/[id]/avatar/route.ts:3` | 调 `lib/jobs/avatarJob.ts:startAvatar` |
| POST /api/project/:id/avatar-slice | `web/app/api/project/[id]/avatar-slice/route.ts:3` | 调 `lib/jobs/avatarJob.ts:startAvatarSlice` |
| POST /api/project/:id/vibe | `web/app/api/project/[id]/vibe/route.ts:3` | 调 `lib/jobs/vibeJob.ts:startVibeJob` |
| POST /api/vibe/rewrite | `web/app/api/vibe/rewrite/route.ts` | 文案改写，直连外部 API，无 job 层封装 |

此外两条静态文件代理路由：`GET /generated/[...path]`、`GET /uploads/[...path]`（均调用 `web/app/lib/runtimePublicFile.ts:27`）。

与 `docs/governance/phase-a-inventory.md:20-28` 记录的 active 链路清单一致，无新增/缺失。

---

## 2. 配置与密钥读取散点（共 **9 处**代码位置，横跨 3 种模式）

| # | 文件:行 | 模式 | 读取的键 |
|---|---|---|---|
| 1 | `web/app/lib/images/falClient.ts:13` | `process.env` 直读 | `FAL_KEY` |
| 2 | `web/app/lib/images/falClient.ts:15` | 手读 `.env.local` / `../.env`（`process.cwd()` 基准） | 补全 `process.env`（未指定具体键，见下方兜底逻辑） |
| 3 | `web/app/lib/tripo/client.ts:25` | `process.env[name]` 参数化直读 | 由调用方传入 key 名（`TRIPO_API_KEY` / `TRIPO_API_KEY_2` 等，AsyncLocalStorage 多 key 注入） |
| 4 | `web/app/lib/tripo/client.ts:27` | 手读 `.env.local` / `../.env` | 同上兜底 |
| 5 | `web/app/lib/jobs/avatarJob.ts:71-72` | `process.env.MESHY_API_KEY` 直读 + 手读 `.env.local`/`../.env` 兜底 | `MESHY_API_KEY` |
| 6 | `web/app/lib/jobs/avatarJob.ts:180-181` | `process.env.TRIPO_API_KEY` 直读 + 同上兜底 | `TRIPO_API_KEY` |
| 7 | `web/app/lib/jobs/avatarJob.ts:443-444` | `process.env` 直读，无 `.env` 兜底 | `UV_BIN`（默认 `/opt/homebrew/bin/uv`）、`PRUSASLICER_BIN`（默认 PrusaSlicer.app 路径） |
| 8 | `web/app/api/vibe/rewrite/route.ts:20,26-28` | `process.env[name]` 参数化 + 手读 `../.env`/`.env`（`readFileSync`，非 dotenv 库） | 由调用方传参（同 fal/tripo key 族） |
| 9 | `tools/asset-gen/generate-modules-tripo-triview.mjs:25-26`、`generate-starry-hideout-tripo.mjs:21-22`、`generate-cloud-teapot-scene-pack.mjs:9` | 独立于 web 的一次性 tool 脚本，各自手读 `.env`/`web/.env.local`，其中 `generate-cloud-teapot-scene-pack.mjs:9` 还硬编码了 `<USER_HOME>/Desktop/3D宠物打印/.env`（另一个仓库路径，明显过时/机器相关） | 视各脚本用途（Tripo/生成相关 key） |

事实：**未使用 `dotenv` 库**（`grep -rln dotenv` 全仓库为空）；全部走手写 `readFileSync`/`fs` 解析 `.env` 文件的原型实现，与 CLAUDE.md 描述一致。`tracer/auth-tracer/` 是独立探针应用，其 `process.env` 读取（`ALIBABA_CLOUD_*`、`BETTER_AUTH_*`、`PNVS_*`、`SMS_CHANNEL`）与主 web 应用完全隔离，不共享配置入口。

---

## 3. 路径耦合点（共 **13 处**硬编码路径依赖）

### 3.1 `.env` 相对路径耦合（详见第 2 节，此处列路径字面量）

- `web/app/lib/images/falClient.ts:15` — `path.join(process.cwd(), '..', '.env')`
- `web/app/lib/tripo/client.ts:27` — 同上
- `web/app/lib/jobs/avatarJob.ts:72,181` — `path.join(workingDir, '..', '.env')`（`workingDir` = `process.cwd()`）
- `web/app/api/vibe/rewrite/route.ts:26` — `path.join(process.cwd(), '..', '.env')`

前提假设：进程 `cwd()` = `web/`，故 `../.env` 才能落到仓库根 `.env`。**这是一个隐式约束**——若未来 worker 进程从别的目录启动，这批路径全部失效。

### 3.2 `public/generated` / `public/uploads` / `public/scene-assets` / `public/mockup-assets` 引用

- `web/app/lib/runtimePublicFile.ts:22-23` — `path.resolve(process.cwd(), 'public', baseDir, ...parts)`，`baseDir` 为 `'uploads'|'generated'`，是这两个目录唯一的运行时读口（有 `..`/斜杠注入校验）。
- `web/eslint.config.mjs:13` — ignore 规则包含 `'public/generated/**'`。
- `web/app/components/assetIndex.ts:7`（注释）+ 全文 30+ 处 `glbPath`/`imagePath` 字符串字面量 — 指向 `/scene-assets/*.glb`、`/assets/pet-products/*.png`（浏览器可直接 fetch 的 public 相对路径，非文件系统路径）。
- `web/tests/mockFixtures.test.mjs:7` — `fileURLToPath(new URL('../public/mockup-assets/', import.meta.url))`，相对测试文件自身位置耦合到 `web/public/mockup-assets`。
- `tools/asset-gen/generate-cloud-teapot-scene-pack.mjs:13-14` — `path.join(ROOT, 'web/public/scene-assets')`、`path.join(ROOT, 'web/public/assets/pet-products')`。
- `tools/bake-assets/create_cloud_teapot_modules.mjs:36` — `path.resolve('web/public/scene-assets')`。
- `tools/verify-batch0/run-stories.js:5` — 硬编码**绝对路径** `<REPOSITORY_ROOT>/web/public/assets/species-rat.png`（机器相关，非可移植）。

### 3.3 `web/app/lib/jobs/avatarJob.ts` 内的额外路径耦合

- `avatarJob.ts:529` — `path.join(workingDir, 'scripts', 'normalize_mesh.py')`：假设 `cwd()=web/` 且 `web/scripts/normalize_mesh.py` 存在（已确认存在，`web/scripts/normalize_mesh.py`）。
- `avatarJob.ts:443-444` — `UV_BIN`/`PRUSA_BIN` 默认值指向 macOS 专属绝对路径（`/opt/homebrew/bin/uv`、`/Applications/PrusaSlicer.app/...`），可被环境变量覆盖但默认值机器相关。

### 3.4 根目录脚本引用的仓库内路径

- **`run-demo.sh`**：`cd "$(dirname "$0")/web"`（`run-demo.sh:7`）后纯用 `pnpm` 命令，无进一步路径耦合。
- **`tools/demo-prep.mjs`**：不碰文件系统路径，全部通过 HTTP `fetch(base + '/api/...')` 调用本地跑起来的 server（`tools/demo-prep.mjs:13,19,23,27,38`），耦合的是"当前必须先跑 `pnpm dev`"这一运行时前提，不是路径。
- **`tools/bake-assets/`**（`create_cloud_teapot_modules.mjs`、`extract_cloud_teapot_references.mjs`、`normalize_asset.py`、`slice_cloud_teapot_image2_sheet.mjs`）：输出目标固定写 `web/public/scene-assets`（见 3.2）。
- **`tools/aliyun`**：`ROOT="$(cd "$(dirname "$0")/.." && pwd)"` + `ENV_FILE="$ROOT/.env"`（`tools/aliyun:8-9`），假设脚本位于 `tools/` 下且根 `.env` 存在。

### 3.5 archive/hackathon 引用检查（背景已知项确认）

`grep -rln "archive/hackathon" web/app web/scripts web/tests tools run-demo.sh tracer` **返回空** — active 代码路径无任何指向 `archive/hackathon` 的引用，确认历史归档已完全解耦（与 `docs/governance/phase-a-inventory.md:34-45` 记录的迁移结果一致）。

---

## 4. `web/app/lib/` 子目录相互 import 依赖方向

基于 `grep -rn "from ['\"]\.\." web/app/lib` 的完整结果：

```
lib/images/triview.ts       → lib/prompts/avatarStyle.ts   (SPECIES_WORDS)
lib/images/scenePrompt.ts   → lib/types/project.ts         (type Brief)
lib/jobs/vibeJob.ts         → lib/store/projects.ts        (getProject, touch)
lib/jobs/vibeJob.ts         → lib/types/project.ts         (type PetScapeProject)
lib/jobs/vibeJob.ts         → lib/images/scenePrompt.ts    (buildVibePrompt)
lib/jobs/vibeJob.ts         → lib/images/falClient.ts      (falEditImage, falGenerateImage, downloadImage, fileToDataUri, publicImageToAbs)
lib/jobs/avatarJob.ts       → lib/store/projects.ts        (getProject, touch)
lib/jobs/avatarJob.ts       → lib/types/project.ts         (type PetScapeProject)
lib/jobs/avatarJob.ts       → lib/images/falClient.ts      (falEditImage, downloadImage, fileToDataUri, publicImageToAbs)
lib/jobs/avatarJob.ts       → lib/prompts/avatarStyle.ts   (buildAvatarStylePrompt, STYLE_ENABLED)
lib/jobs/avatarJob.ts       → lib/images/triview.ts        (buildTriviewGridPrompt, cropTriviewToViews, validateTriviewGridAspectRatio, validateViews, padViews)
lib/jobs/avatarJob.ts       → lib/tripo/client.ts          (多个具名导出，见 avatarJob.ts:9-17)
lib/jobs/avatarJob.ts       → lib/jobs/timeouts.ts         (withTimeout 家族，唯一消费者)
lib/store/recoverProject.ts → lib/jobs/gcodeMeta.ts        (type GcodeMeta, readGcodeMeta)
lib/store/recoverProject.ts → lib/types/project.ts         (type PetScapeProject)
lib/store/projects.ts       → lib/types/project.ts         (type PetScapeProject)
```

**依赖方向总结**：`types` 是全局叶子（被 images/jobs/store 多向依赖，自身零出边）；`jobs/*` 是唯一的"横向枢纽"，同时依赖 `images/`、`prompts/`、`tripo/`、`store/`、`types/`；`store/` 只依赖 `types/` 和 `jobs/gcodeMeta`（反向：store→jobs 只有这一条，其余都是 jobs→store）；`printability/` 目录为空、无任何 import 边；`tripo/client.ts` 只被 `jobs/avatarJob.ts` 消费，无对内其他 lib 子目录的出边。

**被 api 路由 / 页面 import 的入口面**（第 1.2 节路由表已列，此处只列 lib 侧入口点）：
- `lib/store/projects.ts`：`getProject`/`createProject`/`touch` — 被 4 个 api route 直接 import。
- `lib/store/recoverProject.ts`：`recoverProjectFromDisk` — 仅被 `api/project/[id]/route.ts:3` 消费。
- `lib/jobs/avatarJob.ts`：`startAvatar`/`startAvatarSlice`/`sizeToScaleMm` — 被 2 个 api route 消费。
- `lib/jobs/vibeJob.ts`：`startVibeJob` — 被 1 个 api route 消费。
- `lib/types/project.ts`：`missingRequiredFields` — 被 `api/project/[id]/route.ts:4` 消费；类型本身被多处 import。
- `components/assetIndex.ts`：`getAssetEntry` — 被 `page.jsx:22` 与 `SceneViewer.tsx:9` 消费（跨 components/lib 边界）。

`lib/images/*`、`lib/prompts/*`、`lib/tripo/*`、`lib/jobs/gcodeMeta.ts`、`lib/jobs/timeouts.ts` 均无 api route/页面直接 import，只经由 `avatarJob.ts`/`vibeJob.ts` 间接消费——即它们是纯内部实现细节，未构成对外入口面。

---

## 5. `web/tests/`、`web/scripts/` 清单

### 5.1 `web/tests/`（2 个文件，`pnpm test` = `node --test tests/*.test.mjs`，见 `web/package.json:11`）

| 文件 | 行数 | 测什么 |
|---|---|---|
| `mockFixtures.test.mjs` | 36 | 断言 `web/public/mockup-assets/` 目录**恰好**包含 9 个指定文件（`mockFixtures.test.mjs:12-22`），且每个文件不小于指定字节数（防空占位符）——是 `?mock=1` 演示链路的契约测试，非业务逻辑测试。 |
| `timeouts.test.mjs` | 31 | 直接 import `../app/lib/jobs/timeouts.ts`，测 `withTimeout`：hung job 超时抛 `JobTimeoutError` 并 abort signal（第 5-20 行）、正常完成路径返回值且 signal 仍标记 aborted（第 22-31 行）。CLAUDE.md 已注明"只验证仍在使用的 `jobs/timeouts.ts`"，本次读取确认导入路径与断言内容与之一致。 |

### 5.2 `web/scripts/`（2 个文件，非测试，非 api，工具脚本）

| 文件 | 职责 |
|---|---|
| `check-lint-baseline.mjs` | 被 `pnpm lint:baseline`（`web/package.json:10`）调用，比对当前 lint 存量与 `web/lint-baseline.json` 锁存基线，迁移期只许降不许升。 |
| `normalize_mesh.py` | 被 `web/app/lib/jobs/avatarJob.ts:529` 以子进程方式调用（`uv run` + trimesh），是 3D 网格切片链的归一化步骤，非测试脚本。 |

---

## 6. `web/app/generated`、`web/app/uploads`、`web/public/` 各子目录身份（`git ls-files` 判定，未 `du`）

| 路径 | git ls-files 结果 | 身份判定 |
|---|---|---|
| `web/app/generated/[...path]/route.ts` | tracked | 代码（动态代理路由），非产物 |
| `web/app/uploads/[...path]/route.ts` | tracked | 代码（动态代理路由），非产物 |
| `web/public/assets/` | 72 个 tracked 文件 | 资产正本（landing 首页设计静态资产） |
| `web/public/scene-assets/` | 36 个 tracked 文件 | 资产正本（`assetIndex.ts` 消费的正式场景 GLB/meta，见 CLAUDE.md「老仓库」节 + `assetIndex.ts:1-13`） |
| `web/public/mockup-assets/` | 9 个 tracked 文件 | 测试夹具正本（受 `mockFixtures.test.mjs` 精确锁定，`web/.gitignore:7` 注释明确"必须入库"） |
| `web/public/demo-baselines/` | 34 个 tracked 文件 | 固定演示/历史验收证据（按 `docs/governance/phase-a-inventory.md:86-96`，3 个项目目录：Avatar E2E 切片证据、Gate1→Gate2 真链、首批 Meshy Avatar E2E），"不参与运行时项目恢复"（`web/README.md:11`）。 |
| `web/public/generated/` | **0 个 tracked 文件** | 纯运行时产物目录，整体被 `web/.gitignore:3` + 根 `.gitignore:22` 双重 ignore；本机仍有 35 个未跟踪项目目录残留（`docs/governance/phase-a-inventory.md:100-140`，本次未重新验证残留是否仍是这 35 个，见"未知项"）。 |
| `web/public/uploads/` | **0 个 tracked 文件（除 `.gitkeep`）** | 纯运行时产物目录（用户上传），被根 `.gitignore:18-19` ignore（保留 `.gitkeep`）。 |

结论：`web/app/generated` 与 `web/app/uploads` 目录本身只含路由代码，不含数据；真正的文件产物落在同名的 `web/public/generated`、`web/public/uploads`（两套"generated/uploads"命名容易混淆，是潜在重构关注点，但不在本报告建议范围内）。

---

## 7. landing 定稿页物理边界

**核心文件集**（CLAUDE.md 已知：`app/page.jsx` + `app/components/landing/` 是设计师 V3 定稿页，视觉零回归硬约束）：

- 入口：`web/app/page.jsx`（1 个文件，172 行左右，见第 1.1 节 import 列表）。
- 组件目录：`web/app/components/landing/`，共 **22 个文件**：20 个 `.jsx` section/子组件 + `data.js`（纯数据）+ `styles.css`（纯 CSS，非 Tailwind）。
- 样式文件位置：`web/app/components/landing/styles.css`，仅被 `web/app/page.jsx:23` 一处 import（`import './components/landing/styles.css'`）。
- 全局样式 `web/app/globals.css` 独立于 landing，仅被 `web/app/layout.tsx:2` import——两套样式共存（CLAUDE.md 已知坑：Tailwind preflight 污染 landing）。

**跨边界依赖**：
- `page.jsx` 额外 import 了边界外的 `web/app/components/assetIndex.ts`（`page.jsx:22`，用于 `getAssetEntry`）和 `web/app/components/ImageDropzone.jsx`（经由 `landing/IntroSection.jsx:3`、`landing/UploadVibeSection.jsx:3`、`landing/PetCreatorSection.jsx:8` 三处相对路径 `../ImageDropzone` 引入）——即 `ImageDropzone.jsx` 物理上不在 `landing/` 目录内，但被 landing 内 3 个组件依赖，是唯一跨出 `landing/` 边界又被拉回的共享组件。
- `landing/EnvironmentPreviewSection.jsx`、`landing/PetCreatorSection.jsx` 通过 `next/dynamic` 间接加载 `SceneViewer.tsx`/`PetViewer.tsx`（`grep -rln "PetViewer|SceneViewer"` 命中这两个文件，具体 dynamic import 语句本次未逐行摘取，见"未知项"）。
- **无其他文件 import landing/ 内任何组件**：`grep` 未发现 `landing/` 之外（除 `page.jsx` 本身）有任何 import 语句指向 `components/landing/*`——即整个 `landing/` 目录是 `page.jsx` 的私有实现，物理边界干净。

---

## 未知项 / 盲区（本次侦察未覆盖或未深挖）

1. **`web/public/generated/` 本机残留是否仍是 Phase A 记录的 35 个目录**：本次只用 `git ls-files` 判定 tracked=0，未重新枚举本机文件系统实际残留内容（任务要求不 `du` 大目录，已按此约束跳过）。
2. **`EnvironmentPreviewSection.jsx`/`PetCreatorSection.jsx` 的 `next/dynamic(...)` 具体导入路径**：只确认了文件名命中 grep，未逐行读取 dynamic import 语句本身（可能是 `dynamic(() => import('../PetViewer'))` 一类，未核实具体相对路径）。
3. **`tools/` 目录下 `.venv`（`tools/asset-gen/.venv/`）与 `tools/verify-batch0/node_modules/`**：确认均未被 git 跟踪（`git ls-files` 为空），但未评估其是否应被 `.gitignore` 显式排除（本次只读侦察未检查这两处是否已在忽略规则中）。
4. **`tracer/auth-tracer/` 与主 web 应用的进程/依赖边界**：只确认了其 `process.env` 读取键名（`ALIBABA_CLOUD_*`、`BETTER_AUTH_*`、`PNVS_*`），未盘点其目录树内部结构（任务背景已声明"身份验证探针"为已知事实，故未展开）。
5. **`docs/`、`screenshots/`、`assets-3d/` 顶层目录本身未纳入本次盘点范围**（任务聚焦 `web/app/` 与路径耦合点，未要求盘点这些目录，仅在证据链中引用了 `docs/governance/phase-a-inventory.md` 作为交叉验证源）。
