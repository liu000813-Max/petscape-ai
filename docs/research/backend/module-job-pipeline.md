# 模块盘点：任务管线（job-pipeline）

覆盖路径：`web/app/lib/jobs/**`（`<USER_HOME>/Desktop/3D宠物打印/web/app/lib/jobs/`）
排除：`design/` 全目录、`node_modules`、`.next`、`.git` 内部对象、PRD 正文（不作为能力证据）。
证据方式：直接读源码（7 个文件全量）+ 全项目 grep 调用点 + git log（design/ 路径改动已剔除）+ 本地文件系统核验（`.env`、二进制、脚本是否存在）。
生成时间：2026-07-04。

## 全景结论（先说明白，再逐条拆）

`web/app/lib/jobs/` 里其实并存**两条独立管线**，共享同一个 `codexQueue`/`timeouts` 基础设施，但**只有一条是活的**：

| 管线 | 文件 | 数据模型 | 触发方 | 状态 |
|---|---|---|---|---|
| **project/canvas 流（当前主链）** | `gate1Job.ts`、`gate2Job.ts` | `PetScapeProject`（`store/projects.ts`） | `web/app/page.tsx`（tldraw 工作台）→ `/api/project/[id]/gate1`、`/api/project/[id]/gate2` | **活跃**，git log 显示是最新一批提交（T2/T3/B3/B3.1/fix，最新 `ad0afc3`） |
| **session/chat 流（legacy）** | `executor.ts`、`meshyJob.ts`、`sliceJob.ts` | `Session`（`store/sessions.ts`） | `web/app/legacy/page.tsx`（旧 8 阶段聊天页，冻结）→ `/api/session/[id]/message` | **legacy，非当前主链**（项目 `CLAUDE.md` 明确「新功能加在工作台，不要动 legacy」），但代码完整可跑，非死代码/半成品 |

`codexQueue.ts`（Codex 串行队列）与 `timeouts.ts`（超时保护）是两条管线共享的基础设施层，是唯一真正"全局"的两个文件。

---

## 能力清单

### 1. Codex 任务串行队列（CodexSerialQueue）

- **名称**：Codex 串行队列
- **入口**：`web/app/lib/jobs/codexQueue.ts:15-45`（类定义），`:47-48`（globalThis 单例导出，Next dev 热重载不丢）
- **输入 → 输出**：`enqueue<T>(id, run: () => Promise<T>): Promise<T>` —— 按 FIFO 串行执行任意异步任务，同一时刻只有一个 `run` 在跑；`position(id)` 查询排队位置（0=正在执行，n=第 n 位排队，undefined=不在队列）
- **外部依赖**：无（纯内存实现）
- **被谁调用**：`executor.ts:202`（`enqueueStageJob` 内部用它包装每次 agent 回复）、`executor.ts:233`（`getQueuePosition` 转发 `position()`）。**仅 legacy session 流使用**——gate1Job/gate2Job 的 Tripo/Meshy/切片任务是 `void withTimeout(...)` fire-and-forget 后台跑，不经过这个队列（避免 3D 生成/切片这种分钟级任务阻塞后续消息响应）
- **成熟度**：looks-working（逻辑简单直接，globalThis 单例处理 dev 热重载正确）
- **核心管线能力**：是（Codex agent 回复的并发安全性基础设施），但只服务于 legacy 分支

### 2. 超时保护与统一日志（withTimeout / runCodexTurn）

- **名称**：Job 超时保护 + 结构化日志
- **入口**：`web/app/lib/jobs/timeouts.ts:32-52`（`withTimeout`，AbortController + race）、`:54-70`（`runCodexTurn`，日志包装版，见下方 orphan 说明）、`:13-20`（`JOB_TIMEOUT_MS` 超时表：agentReply 180s / renderImage 120s / cleanItem 120s / revise 120s / meshy 15min / slice 10min）
- **输入 → 输出**：`withTimeout(jobType, timeoutMs, run: (signal) => Promise<T>): Promise<T>`——超时则 `AbortSignal.abort()` 并抛 `JobTimeoutError`；`userTimeoutMessage(jobType)` 把超时错误翻译成用户可读中文提示
- **外部依赖**：无
- **被谁调用**：`gate1Job.ts:80`、`gate2Job.ts:65`、`meshyJob.ts:50`、`sliceJob.ts:145`（均调用 `withTimeout`，两条管线都在用）；`JobTimeoutError`/`userTimeoutMessage` 被 `executor.ts:12,222-223`、`meshyJob.ts:14,52`、`sliceJob.ts:7,147` 引用
- **成熟度**：looks-working（commit `8d73a99` "job超时保护(AbortSignal+队列释放) + 生命周期日志 + failed可恢复 (E2E发现的死锁blocker)" 表明是从真实死锁 bug 修出来的，非拍脑袋设计）
- **核心管线能力**：是，两条管线通用
- **附注（orphan 子项）**：`runCodexTurn`（`timeouts.ts:54-70`）全项目 grep 无任何调用点——是 `withTimeout` 的日志包装版本，但两条管线的实际代码都直接调 `withTimeout` 自己写 console.log（如 `gate1Job.ts` 里的 `log()` 函数），没有用上这层包装。**orphan，half-done 迹象**（写了但从未接入，可能是想统一日志格式但半途而废）。

### 3. Gate1：门1 编排（3D 生成 + 挖腔）——project/canvas 流

- **名称**：Gate1 任务编排（图生3D + 混合内核挖腔）
- **入口**：`web/app/lib/jobs/gate1Job.ts:51-94`（`startGate1`，同步建卡+置状态即返回）、`:96-254`（`runGate1`，后台异步主体）
- **输入 → 输出**：输入 = `project`（含选中场景卡 `sceneId`）+ `itemName`（选中物品名）+ `mock` 布尔；输出 = 在 `project.canvasItems` 追加 `item2d`（白底图卡）与 `model3d`（3D模型卡），落盘 `public/generated/{id}/clean-item.png`、`multiview-grid.png`、`model-raw.glb`（Tripo 原始产物）、`model.glb`（挖腔后最终产物）、`carve.json`、`gate1.log`；`project.model3d` 写入 `{status, taskId, glbPath, repairedGlbPath, printabilityIssues, progress}`
- **子步骤链**（均在 `runGate1` 内顺序执行，任一失败即整体 catch 到 `startGate1` 的 `.catch`）：
  1. fal edit 抠白底图（`falEditImage` + `withRetry`，`:107-128`）
  2. fal edit 生成 2×2 四视图网格（`buildMultiviewGridPrompt` + `falEditImage`，`:161-170`）
  3. 服务端像素裁切 4 视图（`cropGridToViews`，`:175`，非生成式、零漂移）
  4. 提交 Tripo `multiview_to_model` + 轮询 + 下载 GLB（`:180-206`）
  5. 混合内核挖腔（`carveShell` spawn `scripts/carve_shell.py`，`:211-231`，失败不阻塞、回退原始 GLB 并诚实标注可打印性缺口）
  6. mock 分支（`mock=1`）：跳过全部外部调用，直接拷贝 `public/mockup-assets/model3d-preview.jpg` + `mock-model.glb`，`progress` 用 `setTimeout` 模拟渐进（`:110-112, 146-159`）
- **外部依赖**：
  - fal.ai（nano-banana / nano-banana edit）—— key: `FAL_KEY`，**已配置**（`.env` 存在该键）
  - Tripo（`multiview_to_model` v3.0-20250812）—— key: `TRIPO_API_KEY`，**已配置**
  - 本地 Python 子进程（`uv run` + `scripts/carve_shell.py`，trimesh/manifold3d）—— 无 API key，依赖本地 `uv` 二进制，**已核实存在**（`/opt/homebrew/bin/uv`）且 `scripts/carve_shell.py` 文件存在
- **被谁调用**：`web/app/api/project/[id]/gate1/route.ts:3,26` → 该路由由 `web/app/page.tsx`（当前主工作台）触发
- **成熟度**：looks-working（git log 显示 `d94f9ae`→`fccb34e`→`8e876a2`→`0122c41`→`ad0afc3` 五次连续迭代打磨，含"E2E dry run 发现三个缺陷"和"重试机制"修复，非一次性堆砌）
- **核心管线能力**：**是**，模块地图标注的枢纽能力之一
- **TODO 证据**：`gate1Job.ts:139` 注释 `// repair 暂不做（TODO：Tripo 产物需外部修复通道，Meshy print/repair 只吃自家 task）`——**half-done 证据**：Tripo 产出的 GLB 目前没有"修复"通道（只有本地 trimesh 诊断，见 `printability/localCheck.ts` 开头注释），只做挖腔和诊断，不做几何修复。这是已知、有意识的功能缺口，非疏漏。

### 4. Gate2：门2 编排（切片）——project/canvas 流

- **名称**：Gate2 任务编排（归一化 + PrusaSlicer 切片）
- **入口**：`web/app/lib/jobs/gate2Job.ts:58-71`（`startGate2`）、`:73-143`（`runGate2`）
- **输入 → 输出**：输入 = `project`（读 `model3d.repairedGlbPath ?? model3d.glbPath`）+ `config: ModelConfig`（scaleMm/color/material）+ `mock`；输出 = 落盘 `print-{mm}mm.stl` + `print-{mm}mm.gcode`，`project.slice` 写入 `{status, stlPath, gcodePath, estimatedTime, filament, actualExtentsMm, warnings, progress}`
- **子步骤链**：
  1. `execFile` 调 `uv run --with trimesh python3 web/scripts/normalize_mesh.py`（Y-up→Z-up 归一化 + 缩放到目标 mm，`:91-102`）
  2. `execFile` 调 PrusaSlicer CLI 导出 G-code（`:104-118`，layer-height 0.2 / fill 15% / support-material）
  3. 解析 G-code header 的打印时间/耗材（`parseGcodeMeta`，`:45-55`）+ 解析 PrusaSlicer stdout/stderr 的警告（`parseWarnings`，`:31-43`：collapsing overhang / low bed adhesion / thin fragile part 等模式匹配）
  4. mock 分支：直接拷贝 `mockup-assets/mock-model.stl`/`.gcode`（`:84-87`）
- **外部依赖**：
  - 本地 Python 子进程（`uv run` + `web/scripts/normalize_mesh.py`）——**已核实文件存在**
  - 本地 PrusaSlicer CLI 二进制（`PRUSASLICER_BIN` env 或默认路径 `/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`）——**已核实该路径下二进制真实存在**（233MB app bundle）
  - 无网络 API key 依赖
- **被谁调用**：`web/app/api/project/[id]/gate2/route.ts:4,33` → 由 `web/app/page.tsx` 触发
- **成熟度**：looks-working（PrusaSlicer 参数固定写死 layer-height/fill/support，非用户可调，但功能路径完整跑通；commit `fe15525` 记录过"独立验收 ACCEPT: STL 120mm/落底/watertight, G-code 10h49m/120cm³"的真实验收证据，虽然该验收发生在 legacy `sliceJob.ts` 阶段，但 gate2Job.ts 明确注释"复用 legacy sliceJob 的 normalize_mesh.py + PrusaSlicer"，是同一套已验证脚本的移植）
- **核心管线能力**：**是**

### 5. Meshy 任务编排（3D 生成 + 打印性分析 + 修复）——legacy session 流

- **名称**：Meshy 图生3D + 可打印性分析/修复
- **入口**：`web/app/lib/jobs/meshyJob.ts:43-59`（`startMeshyJob`）、`:61-148`（`runMeshyJob`）
- **输入 → 输出**：输入 = `session.cleanItemImage`（白底图路径）；输出 = `session.meshy = {taskId, glbPath, repairedGlbPath, printability: {issues, repaired}}`，落盘 `model-{n}.glb`、（若需修复）`model-{n}-repaired.glb`，`session.stage` 推进到 `'preview'`
- **子步骤链**：提交 `image-to-3d`（`:72`）→ 轮询生成（`:78-87`）→ 下载 GLB（`:90`）→ 提交 `print/analyze`（`:95`）→ 若 `printabilityNeedsRepair` 为真则提交 `print/repair`（`:110-125`）→ 修复后复检 `print/analyze`（`:128-131`，代码注释写"免费复检"）
- **外部依赖**：Meshy API（`image-to-3d` / `print/analyze` / `print/repair`）——key: `MESHY_API_KEY`，**已配置**（`.env` 存在该键），来自 `web/app/lib/meshy/client.ts:28`
- **被谁调用**：仅 `executor.ts:112,129,139,155`（`handleSelecting`/`handleCleaningItem`/`handleGenerating3d`/`handlePreview` 四处调用）——即**仅 legacy session 流可达**，当前主工作台（`page.tsx`）不会触发这条路径（走的是 gate1Job.ts 的 Tripo 链路）
- **成熟度**：looks-working **但已被 gate1Job.ts 的 Tripo 链路取代为主链**（项目 CLAUDE.md 明确写"Meshy 降为备选：Meshy 的 analyze/print API 不吃外部模型…前台只暴露…不暴露引擎流水线"）。代码本身完整、无 TODO/半成品迹象，是历史上跑通验收过的功能（commit `9f8e04c` "M4: Meshy管线...独立验收ACCEPT，实测watertight修复"）
- **核心管线能力**：**否**（当前主链是 Tripo/gate1Job；这条是 legacy 分支里的对应能力，功能完整但不在当前用户可达路径上）

### 6. 切片任务编排（归一化 + PrusaSlicer）——legacy session 流

- **名称**：Legacy 切片管线（`runSlicePipeline` / `startSliceJob`）
- **入口**：`web/app/lib/jobs/sliceJob.ts:87-137`（`runSlicePipeline`，核心逻辑，可被直接 await 调用）、`:139-154`（`startSliceJob`，fire-and-forget 包装）
- **输入 → 输出**：输入 = `session.meshy.repairedGlbPath ?? glbPath` + `session.brief.petSize`（解析成 mm，`parsePetSizeMm:28-38` 支持 mm/cm/m/中文单位）；输出 = `session.slice = {stlPath, gcodePath, warnings, estimatedTime, filament, normalize}`，`session.stage` 推进到 `'done'`
- **外部依赖**：与 Gate2 相同（`uv` + `web/scripts/normalize_mesh.py` + PrusaSlicer CLI），路径与 gate2Job.ts 完全一致（同一批脚本/二进制，两处硬编码路径重复）
- **被谁调用**：`executor.ts:151,174`（`handlePreview`/`handleSlicing`）——仅 legacy session 流可达
- **成熟度**：looks-working（这是 gate2Job.ts 的"前身"，commit `fe15525` 的原始实现，后被移植给 gate2Job.ts 复用同一套脚本）
- **核心管线能力**：**否**（legacy 分支对应能力，功能完好但非当前主链）
- **附注**：`runSlicePipeline` 与 `gate2Job.ts` 的 `runGate2` 高度重复（几乎相同的 normalize→PrusaSlicer→parseWarnings→parseGcodeMeta 四步、甚至 `PRUSA_BIN`/`UV_BIN` 常量定义重复），是典型的"新旧管线并存导致的逻辑重复"，SSOT 已经分裂成两份（若未来只改 gate2Job.ts 的切片参数，legacy 分支会静默漂移不同步）。

### 7. Stage 状态机编排器（executor.ts）——legacy session 流

- **名称**：会话阶段状态机（8 阶段：collecting/rendering/selecting/cleaningItem/generating3d/preview/slicing/done）
- **入口**：`web/app/lib/jobs/executor.ts:184-193`（`stageHandlers` 路由表）、`:195-228`（`enqueueStageJob`，对外主入口）、`:230`（`enqueueAgentReply` 别名导出）、`:232-234`（`getQueuePosition`）
- **输入 → 输出**：输入 = `sessionId` + 用户文本 + 可选图片路径；按 `session.stage` 分派给对应 handler（`handleCollecting`/`handleRendering`/`handleSelecting`/`handleCleaningItem`/`handleGenerating3d`/`handlePreview`/`handleSlicing`/`handleDone`），驱动调用五个 LLM agent（collecting/rendering/selecting/preview + 隐式）、`renderImageForSession`（fal 生图）、`generateCleanItemImage`（fal 抠图）、`startMeshyJob`、`startSliceJob`
- **外部依赖**：间接依赖 fal.ai（`FAL_KEY`，经 `renderImageForSession`/`generateCleanItemImage`）+ 上述 Meshy/切片依赖；直接依赖 Codex SDK（经五个 `llm-agents`，本模块外）
- **被谁调用**：`web/app/api/session/[id]/message/route.ts:5,59`（`enqueueStageJob`）；`web/app/api/session/[id]/route.ts:2,15`（`getQueuePosition`）——这两个 API 路由仅被 `web/app/legacy/page.tsx` 调用
- **成熟度**：looks-working（8 个里程碑 commit `c8f58a5`→`fe15525` 逐阶段验收通过，含多次"独立验收 ACCEPT/REJECT 后修复"记录，是这个代码库里质量证据最扎实的一段历史）
- **核心管线能力**：**否**（这是 legacy 会话流的编排核心，非当前主链的一部分；但它是 gate1Job.ts/gate2Job.ts 编排范式的直接前身——三段确认门/状态机思路是从这里迭代出来的）
- **导出但零调用点**：`enqueueAgentReply`（`executor.ts:230`，`enqueueStageJob` 的别名导出）——grep 全项目未见任何 import 使用该名字，是历史重命名后留下的 alias，**dead export**（不影响功能，因为 `enqueueStageJob` 本体仍被使用，只是这个别名本身是死的）。

---

## 交叉证据汇总

### 外部依赖与 key 配置一览

| 服务 | Key 变量名 | 配置状态（`.env` 是否存在该键） | 用到的能力 |
|---|---|---|---|
| fal.ai | `FAL_KEY` | 已配置 | Gate1（白底图/四视图网格）、legacy renderImage/cleanItem（executor.ts 间接） |
| Tripo | `TRIPO_API_KEY` | 已配置 | Gate1（multiview_to_model） |
| Meshy | `MESHY_API_KEY` | 已配置 | legacy meshyJob.ts（image-to-3d/analyze/repair） |
| 本地 uv + Python | 无 key，依赖二进制 | `/opt/homebrew/bin/uv` 已核实存在 | Gate1 挖腔（carve_shell.py）、Gate2/legacy 切片归一化（normalize_mesh.py） |
| 本地 PrusaSlicer | 无 key，依赖二进制 | `/Applications/PrusaSlicer.app/.../PrusaSlicer` 已核实存在 | Gate2/legacy 切片 |

（注：仅核实 `.env` 中键名是否存在与本地二进制文件是否存在，未读取/输出任何 key 明文。）

### half-done / dead 证据清单

1. `runCodexTurn`（`timeouts.ts:54-70`）—— 全项目 grep 零调用，orphan。写了统一日志包装但两条管线都绕过去自己写 log，未接入。
2. `enqueueAgentReply`（`executor.ts:230`）—— `enqueueStageJob` 的别名导出，全项目 grep 零调用，dead export。
3. `gate1Job.ts:139` 注释掉的 TODO —— Tripo 产物无修复通道，是有意识的功能缺口（非误报），当前只做挖腔+本地诊断、不做几何修复。
4. Gate2（`gate2Job.ts`）与 legacy 切片（`sliceJob.ts`）逻辑高度重复（normalize→PrusaSlicer→parseWarnings 四步骤几乎逐行相同）—— 不是"死代码"，而是新旧管线并存导致 SSOT 分裂，存在后续维护漂移风险。
5. 没有发现任何"永远为 false 的 feature flag"——`mock` 参数是走 query string `?mock=1` 驱动的合法开发态开关，不是写死条件。

### 两条管线的关系定性

`web/app/lib/jobs/` 表面是"一个模块"，实际上是**新旧两代编排范式共存**：legacy（session 状态机 + Meshy + Codex 串行队列）功能完整、经过验收，但已被 `page.tsx` 工作台绕开；project/canvas 流（gate1/gate2 + Tripo + 混合内核）是当前唯一用户可达的主链，且是模块地图里标注的"唯一枢纽"。两条链路目前互不冲突（各自独立的 store 单例、独立 API 路由），但共享 `codexQueue.ts`/`timeouts.ts` 基础设施。legacy 分支不建议作为"核心管线能力"来评估质量或投入重构精力——它是历史验证残留，具备考古价值（证明了 8 阶段状态机范式和 Meshy 全链路可行），但不是当前产品体验的一部分。
