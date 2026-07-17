# 模块盘点：外部服务客户端（external-clients）

覆盖路径：`web/app/lib/tripo/**`、`web/app/lib/meshy/**`、`web/app/lib/images/**`
项目根：`<USER_HOME>/Desktop/3D宠物打印`（隔离范围：排除 `design/`、`node_modules`、`.next`、`.git` 内部对象；PRD.md / max PRD.docx 未读，能力判定只以代码 + git log 为证据）。
生成时间：2026-07-04。

## 环境变量配置现状（只查文件名/config 读取处，不输出 key 明文）

项目根 `<USER_HOME>/Desktop/3D宠物打印/.env` 存在，且以下三个 key 均已设置非空值（用 `grep -oE '^[A-Z_]+=.+'` 核实存在赋值，未打印明文）：

- `TRIPO_API_KEY` — 已配置
- `MESHY_API_KEY` — 已配置
- `FAL_KEY` — 已配置

三个 client 的 key 读取逻辑完全同构（`readApiKey`/`readFalKey`）：优先读 `process.env.X`，否则按顺序兜底读 `web/.env.local` 或项目根 `../.env`（正则 `^KEY=(.+)$` 提取，去引号），全部失败则 `throw new Error`（服务端读取失败会直接抛错，不会静默用空 key 调用）。证据：
- `web/app/lib/tripo/client.ts:15-25`
- `web/app/lib/meshy/client.ts:27-37`
- `web/app/lib/images/falClient.ts:12-22`

`web/` 目录下未发现 `.env*` 文件（`find web -maxdepth 1 -name ".env*"` 空），即当前配置完全依赖项目根 `.env` 兜底路径这一分支。

---

## 一、Tripo 模块（`web/app/lib/tripo/client.ts`，共 167 行）

职责：图生 3D 主链，`multiview_to_model`。CLAUDE.md 硬裁决标注"已落地"的门 1 3D 主引擎。

### 能力 1：`uploadImage` — 单视图上传拿 file_token
- 入口：`web/app/lib/tripo/client.ts:61`
- 输入 → 输出：本地图片绝对路径 → `{ token, ext }`（multipart 上传到 Tripo `/upload`，从响应 `data.image_token|file_token|token` 取值）
- 外部依赖：Tripo API（`https://api.tripo3d.ai/v2/openapi/upload`），需要 `TRIPO_API_KEY`，已配置
- 被谁调用：`submitMultiviewToModel`（同文件 :83，内部循环调用，非外部直接暴露）
- 成熟度：looks-working（有真实 multipart 构造、错误处理、token 多字段兜底）
- 核心管线：是（多视图上传是 Tripo 主链前置步骤）

### 能力 2：`submitMultiviewToModel` — 提交四视图转 3D 任务
- 入口：`web/app/lib/tripo/client.ts:79`
- 输入 → 输出：4 张视图路径数组（严格 FLBR 顺序：front/left/back/right）→ `{ taskId, response }`；非 4 张直接抛错
- 外部依赖：Tripo API `/task`（POST，`type=multiview_to_model`，`model_version=v3.0-20250812`，`orientation=align_image`），需要 `TRIPO_API_KEY`，已配置
- 被谁调用：`web/app/lib/jobs/gate1Job.ts:182`（真实链路，非 mock 分支）
- 成熟度：looks-working——git log 显示 3 次迭代提交（`fccb34e` 初次接入 B3 → `0122c41` E2E dry run 修三个缺陷 → `ad0afc3` 修白底图 monolith 约束+重试），有实际问题驱动的修复历史，非一次性堆砌
- 核心管线：是（门 1 3D 生成主链唯一入口）

### 能力 3：`pollTask` — 轮询任务状态直到成功/失败/超时
- 入口：`web/app/lib/tripo/client.ts:111`
- 输入 → 输出：taskId + 轮询选项（间隔默认 5s、超时默认 10 分钟、onPoll 回调）→ 成功时返回完整结果 JSON；失败/超时抛错
- 外部依赖：Tripo API `/task/{id}`（GET），需要 `TRIPO_API_KEY`，已配置
- 被谁调用：`web/app/lib/jobs/gate1Job.ts:189`
- 成熟度：looks-working——含瞬时网络抖动容错（连续 5 次失败才判死任务，CLAUDE.md 明确记录"一次 transient fetch failed 在 poll 69%/80% 处误杀过任务"这一真实踩坑，修复已固化进代码，非理论设计）
- 核心管线：是

### 能力 4：`glbUrlFrom` — 从轮询结果提取 GLB URL
- 入口：`web/app/lib/tripo/client.ts:144`
- 输入 → 输出：`TripoPollResult` → GLB URL 字符串（`output.pbr_model || output.model || output.model_url`，缺失则抛错）
- 外部依赖：无网络调用，纯解析
- 被谁调用：`web/app/lib/jobs/gate1Job.ts:203`
- 成熟度：looks-working
- 核心管线：是

### 能力 5：`downloadFile` — 下载 GLB 文件到本地
- 入口：`web/app/lib/tripo/client.ts:151`
- 输入 → 输出：URL + 本地绝对路径 → 写入文件字节数；带 3 次重试（每次间隔 3s）
- 外部依赖：Tripo 返回的 GLB 直链（无需鉴权头，公开 URL）
- 被谁调用：`web/app/lib/jobs/gate1Job.ts:203`（落盘为 `model-raw.glb`，供后续 carve 脚本处理）
- 成熟度：looks-working
- 核心管线：是

**Tripo 模块小结**：5 条能力全部处于同一条活跃链路（gate1Job.ts 的真实分支，非 mock），无 orphan、无 TODO/FIXME、无被注释调用。是当前唯一被主工作台（`page.tsx` → `/api/project/[id]/gate1`）使用的 3D 引擎。

---

## 二、Meshy 模块（`web/app/lib/meshy/client.ts`，共 160 行）

职责：CLAUDE.md 标注"备选 3D 引擎 + printability 分析"，且明确写"Meshy 降为备选……可打印性检查=本地 trimesh 替代，不走 Meshy"。代码证据与此完全吻合。

### 能力 1：`imageFileToDataUri` — 图片转 base64 data URI
- 入口：`web/app/lib/meshy/client.ts:70`
- 输入 → 输出：本地图片路径 → `data:image/xxx;base64,...`
- 外部依赖：无（纯本地文件读取+编码）
- 被谁调用：同文件 `submitImageTo3d:76`
- 成熟度：looks-working
- 核心管线：否（仅服务于 Meshy 备选链路）

### 能力 2：`submitImageTo3d` — 提交图生 3D 任务
- 入口：`web/app/lib/meshy/client.ts:75`
- 输入 → 输出：图片绝对路径 → `{ taskId, response }`；POST `/image-to-3d`，`should_remesh/should_texture=true`，`target_polycount=100000`
- 外部依赖：Meshy API（`https://api.meshy.ai/openapi/v1`），需要 `MESHY_API_KEY`，已配置
- 被谁调用：`web/app/lib/jobs/meshyJob.ts:72`
- 成熟度：looks-working（代码本身完整）——但其唯一调用方 `meshyJob.ts` 只被 legacy 8 阶段聊天流程（`web/app/lib/jobs/executor.ts:10` → `web/app/api/session/[id]/message/route.ts`）引用，当前主工作台（`page.tsx`）走的是 gate1Job.ts + Tripo，不触达这条路径。git log 显示 `meshy/client.ts` 自 `9f8e04c`（M4 里程碑，标注"独立验收 ACCEPT，实测 watertight 修复"）之后再无改动——功能本身成熟，但**已被产品路径绕开、降级为未挂在主链上的备选**
- 核心管线：否（CLAUDE.md 显式裁决"降为备选"）

### 能力 3：`getImageTo3d` — 查询图生 3D 任务状态
- 入口：`web/app/lib/meshy/client.ts:90`
- 输入 → 输出：taskId → `MeshyPollResult`（含 status/progress/model_urls/printability）
- 外部依赖：Meshy API `/image-to-3d/{id}`（GET），需要 `MESHY_API_KEY`，已配置
- 被谁调用：`pollTask`（同文件 :119，内部分支）
- 成熟度：looks-working
- 核心管线：否

### 能力 4：`submitPrintabilityAnalyze` / `getPrintabilityAnalyze` — 提交/查询可打印性分析
- 入口：`web/app/lib/meshy/client.ts:94`、`:99`
- 输入 → 输出：`input_task_id`（必须是 Meshy 自家 image-to-3d 任务 id）→ taskId/轮询结果
- 外部依赖：Meshy API `/print/analyze`，需要 `MESHY_API_KEY`，已配置
- 被谁调用：`web/app/lib/jobs/meshyJob.ts:95,128`（legacy 路径内部）
- 成熟度：half-done——`web/app/lib/printability/localCheck.ts:4-6` 的注释明确写出这条能力的结构性限制："Meshy print/analyze 只吃自家 image-to-3d 的 input_task_id……不支持外部 Tripo 产出的 GLB URL/文件"。这意味着自 Tripo 成为主链后，这两个函数**无法被用于当前主链路的可打印性检查**（Tripo 产出的模型无法喂给它），只能服务于已被降级的 legacy Meshy 全链路
- 核心管线：否

### 能力 5：`submitRepair` / `getRepair` — 提交/查询模型修复
- 入口：`web/app/lib/meshy/client.ts:103`、`:108`
- 输入 → 输出：`input_task_id` → taskId/轮询结果（修复后 GLB）
- 外部依赖：Meshy API `/print/repair`，需要 `MESHY_API_KEY`，已配置
- 被谁调用：`web/app/lib/jobs/meshyJob.ts:111`（legacy 路径内部，`printabilityNeedsRepair` 判定需要修复时触发）
- 成熟度：half-done（同上，仅 legacy 全链路可达，且 `gate1Job.ts:139` 明确留 TODO 注释："repair 暂不做（TODO：Tripo 产物需外部修复通道，Meshy print/repair 只吃自家 task）"——即主链需要的"修复 Tripo 产物"这个能力实际不存在，只是留白）
- 核心管线：否

### 能力 6：`pollTask`（Meshy 版）— 三种任务类型统一轮询
- 入口：`web/app/lib/meshy/client.ts:112`
- 输入 → 输出：`kind`（image-to-3d/print/analyze/print/repair）+ taskId → 成功结果；失败/超时抛错
- 外部依赖：同上三类 Meshy 端点
- 被谁调用：`web/app/lib/jobs/meshyJob.ts:78,98,114,129`
- 成熟度：looks-working（无 Tripo 版本那样的 transient-retry 容错，是两者实现细节上的差异，但功能本身完整）
- 核心管线：否

### 能力 7：`downloadFile`（Meshy 版）
- 入口：`web/app/lib/meshy/client.ts:128`
- 输入 → 输出：URL + 本地路径 → 写入文件字节数（无重试，与 Tripo 版本的 3 次重试形成对比）
- 外部依赖：Meshy 返回的直链
- 被谁调用：`web/app/lib/jobs/meshyJob.ts:90,123`
- 成熟度：looks-working（功能可用，但鲁棒性弱于 Tripo 同名函数——无重试）
- 核心管线：否

### 能力 8：`glbUrlFrom` / `printabilityNeedsRepair` / `summarizePrintability`
- 入口：`web/app/lib/meshy/client.ts:137`、`:143`、`:149`
- 输入 → 输出：纯解析函数，从 Meshy 结果对象提取 GLB URL / 判定是否需要修复（watertight=false、non_manifold_edges>0、holes>0 等）/ 生成可读摘要行数组
- 外部依赖：无网络调用
- 被谁调用：`web/app/lib/jobs/meshyJob.ts:90,110,123,140`（全部集中在 legacy 路径内部）
- 成熟度：looks-working
- 核心管线：否

**Meshy 模块小结**：8 条能力代码本身完整可用（无 TODO/FIXME 挂在 client.ts 内部），但整条模块的**唯一调用方是 `web/app/lib/jobs/meshyJob.ts`，而 meshyJob 只被 legacy 8 阶段聊天页（`/legacy` 路由，`web/app/legacy/page.tsx` → `/api/session/*`）触达**，当前主工作台（`/`，`page.tsx` → gate1Job.ts）完全不经过 Meshy。`gate1Job.ts:24` 注释明确写"Meshy client 保留不删（备选引擎裁决）"，`printability/localCheck.ts` 的存在本身就是"Meshy 的 printability 能力对当前主链结构性不适用，用本地 trimesh 顶替"这一决策的直接产物。判定为**非 dead code**（legacy 路由仍可访问、逻辑完整可跑通），但是**已被产品裁决边缘化的备选路径**，不在核心管线内。

---

## 三、fal.ai 模块（`web/app/lib/images/**`，7 个文件）

职责：生图（nano-banana 文生图）/ 改图（nano-banana/edit 指令式编辑）/ 抠图（复用 edit 通道）/ 多视图网格生成 prompt / 像素级裁切。CLAUDE.md 标注"生图主通道，2026-07-04 实测定案"。

### 能力 1：`falGenerateImage` — 文生图
- 入口：`web/app/lib/images/falClient.ts:48`
- 输入 → 输出：prompt 字符串 → 生成图片 URL（调用 `fal-ai/nano-banana`，同步端点 `fal.run`，~8-11s）
- 外部依赖：fal.ai API，需要 `FAL_KEY`，已配置
- 被谁调用：`web/app/lib/images/renderScene.ts:40`（legacy 8 阶段流程无底图时）、`web/app/api/project/[id]/scenes/route.ts:119`（主工作台无参考图时的 t2i 分支）
- 成熟度：looks-working
- 核心管线：是

### 能力 2：`falEditImage` — 指令式改图（含抠图/多视图网格生成复用同一通道）
- 入口：`web/app/lib/images/falClient.ts:52`
- 输入 → 输出：prompt + 图片 data URI 数组 → 编辑后图片 URL（`fal-ai/nano-banana/edit`，~10-12s）
- 外部依赖：fal.ai API，需要 `FAL_KEY`，已配置
- 被谁调用（全项目 grep，5 处）：
  - `web/app/lib/images/renderScene.ts:39`（有底图时的场景改图，legacy 路径）
  - `web/app/lib/images/cleanItem.ts:31`（抠图为白底单品图，legacy 路径）
  - `web/app/lib/jobs/gate1Job.ts:123,166`（主工作台：白底抠图 + 四视图网格生成，两处调用）
  - `web/app/api/project/[id]/scenes/route.ts:118`（主工作台：有参考图时的 i2i/t2i-with-ref 分支）
  - `web/app/api/project/[id]/scenes/[sceneId]/revise/route.ts:94`（主工作台：按标注局部改图）
- 成熟度：looks-working——是当前使用面最广的单个函数，贯穿 legacy 与主工作台两条路径的绝大多数生图/改图场景
- 核心管线：是（门 1 白底图、四视图网格、场景改图、按标注改图全部依赖它）

### 能力 3：`downloadImage` — 下载 fal 生成结果到本地
- 入口：`web/app/lib/images/falClient.ts:56`
- 输入 → 输出：URL + 本地路径 + 可选 AbortSignal → 写入文件（无重试，一次 fetch 失败即抛错，与 Tripo/Meshy 的 downloadFile 均有重试形成对比——这里是三个下载函数中鲁棒性最弱的一个）
- 外部依赖：fal.ai 返回的图片直链
- 被谁调用：`renderScene.ts:41`、`cleanItem.ts:32`、`gate1Job.ts:124,167`、`scenes/route.ts:120`、`revise/route.ts:96`
- 成熟度：looks-working（功能可用，但无重试是相对薄弱点，与 gate1Job.ts 外层的 `withRetry` 包装形成互补——gate1 侧的两处调用外层都套了 `withRetry`，scenes/route.ts 同理，因此实际生产路径上单次瞬时失败会被上层重试兜住，非纯裸奔）
- 核心管线：是

### 能力 4：`publicImageToAbs` — public 相对路径转绝对路径
- 入口：`web/app/lib/images/falClient.ts:62`
- 输入 → 输出：`/generated/xxx.png` 风格路径或绝对路径 → 磁盘绝对路径（先判断是否已是存在的绝对路径，否则按 `cwd/public/...` 拼接）
- 外部依赖：无
- 被谁调用：`cleanItem.ts:31`、`gate1Job.ts:122`、`scenes/route.ts:8`（import 但用于 :101 拼参考图路径）
- 成熟度：looks-working
- 核心管线：是（工具函数，被核心路径依赖）

### 能力 5：`fileToDataUri` — 本地图片转 base64 data URI
- 入口：`web/app/lib/images/falClient.ts:68`
- 输入 → 输出：本地绝对路径 → data URI（jpg/jpeg 识别 image/jpeg，否则统一 image/png）
- 外部依赖：无
- 被谁调用：`cleanItem.ts:31`、`renderScene.ts:39`、`gate1Job.ts:122,165`、`scenes/route.ts:101`
- 成熟度：looks-working
- 核心管线：是

### 能力 6：`generateCleanItemImage`（`cleanItem.ts:17`）— legacy 抠图封装
- 入口：`web/app/lib/images/cleanItem.ts:17`
- 输入 → 输出：sessionId + 场景图路径 + 物品描述 → 白底单品图相对路径（内部拼 prompt→调用 falEditImage→下载→校验非空文件）
- 外部依赖：fal.ai（经由 falClient），需要 `FAL_KEY`，已配置
- 被谁调用：`web/app/lib/jobs/executor.ts:9,109`（legacy 路径 `handleSelecting` 内）
- 成熟度：looks-working，但**仅服务 legacy 路径**——主工作台的白底抠图走的是 `gate1Job.ts:110-126` 内联实现（更严格的"物理约束：单一连续实体"prompt，见 gate1Job.ts:120），并未复用这个函数。两套白底抠图 prompt 并存、逻辑不共享（`cleanItem.ts:25-27` 的 prompt 明显比 gate1Job.ts 内联版本简单，缺少"单一连续实体"物理约束）——存在同职责代码在两条路径下分叉维护的情况
- 核心管线：否（legacy 专属；主链有自己的内联版本）
- 附注：同文件 `nextCleanItemImageIndex`（`cleanItem.ts:8`）是内部辅助函数（扫描目录找下一个可用文件名序号），仅被 `generateCleanItemImage` 内部调用（:20），不构成独立能力，未单独列条。

### 能力 7：`buildInitialScenePrompt` / `generateSceneImage`（`renderScene.ts`）— legacy 场景生图封装
- 入口：`web/app/lib/images/renderScene.ts:9`、`:29`
- 输入 → 输出：`buildInitialScenePrompt`：Session brief → 初始场景 prompt 字符串；`generateSceneImage`：sessionId+prompt+索引+可选底图 → 场景图相对路径
- 外部依赖：fal.ai（经由 falClient），需要 `FAL_KEY`，已配置
- 被谁调用：`web/app/lib/jobs/executor.ts:8,26,42`（legacy 路径 `handleCollecting`/`renderImageForSession` 内）
- 成熟度：looks-working，**仅服务 legacy 路径**。主工作台的场景生图走 `web/app/api/project/[id]/scenes/route.ts` 内联实现（复用 `scenePrompt.ts` 的 `buildScenePrompts`/`buildRevampPrompts`，与本文件的 `buildInitialScenePrompt` 是两套不同的 prompt 组装逻辑）
- 核心管线：否（legacy 专属）

### 能力 8：`buildScenePrompts` / `buildRevampPrompts`（`scenePrompt.ts`）— 主工作台场景 prompt 组装
- 入口：`web/app/lib/images/scenePrompt.ts:50`（t2i 三方向）、`:64`（i2i 改造图三方向）
- 输入 → 输出：`Brief` → 3 个差异化方向的完整 prompt 数组（`{name, prompt}[]`）
- 外部依赖：无网络调用，纯字符串组装
- 被谁调用：`web/app/api/project/[id]/scenes/route.ts:7,46`
- 成熟度：looks-working（三方向语义区分明确：贴合风格/自然有机/简洁结构；习性→功能暗示表 `TRAIT_HINTS` 覆盖 6 种常见习性）
- 核心管线：是（主工作台场景生成唯一 prompt 来源）

### 能力 9：`buildMultiviewGridPrompt`（`multiviewPrompt.ts:17`）— 一致性四视图网格 prompt
- 入口：`web/app/lib/images/multiviewPrompt.ts:17`
- 输入 → 输出：`{ itemName }` → 四视图网格生成 prompt（硬约束：同一物体、几何比例一致、纯白背景、2×2 固定顺序 front/back/left/right）
- 外部依赖：无
- 被谁调用：`web/app/lib/jobs/gate1Job.ts:163`
- 成熟度：looks-working——文件头注释显式标注"单点真相源""之后会用 A2 实验调优后的版本原地替换，请保持单点可换"，且与 A2 实验结论（CLAUDE.md 记录"一致性锚点=fal edit 通道喂白底件为参考"）对齐，非孤立猜测
- 核心管线：是（Tripo 多视图输入的唯一 prompt 来源）

### 能力 10：`cropGridToViews`（`cropGrid.ts:21`）— 网格图像素级四等分裁切
- 入口：`web/app/lib/images/cropGrid.ts:21`
- 输入 → 输出：2×2 网格图绝对路径 + 输出目录 → `{ front, back, left, right, orderedForTripo }`（后者按 FLBR 顺序，直接对接 Tripo 上传）
- 外部依赖：无网络调用；用 `sharp` 库做本地像素裁切（非生成式手段，CLAUDE.md 明确要求"代码裁切为主，禁止用生成式重绘做拆分"）
- 被谁调用：`web/app/lib/jobs/gate1Job.ts:175`
- 成熟度：looks-working（每个视图重新构造独立 `sharp` 实例，注释解释了这是为规避 pipeline 状态污染的已知坑）
- 核心管线：是（Tripo 上传前必经步骤）

**fal.ai 模块小结**：10 条能力中 6 条（falGenerateImage/falEditImage/downloadImage/publicImageToAbs/fileToDataUri + buildMultiviewGridPrompt/cropGridToViews/buildScenePrompts 视角度可再细分）是主工作台核心管线共享的基础设施，2 条（cleanItem.ts 的 `generateCleanItemImage`、renderScene.ts 的两个函数）是 legacy 专属、与主链的内联实现平行存在但不共享代码——这是本模块内唯一的"重复实现"信号，不是 half-done，而是两条产品路径（legacy 全冻结 vs 主工作台）各自独立演化后留下的分叉。未发现 TODO/FIXME/被注释调用/恒 false 的 feature flag。

---

## 四、被注释/TODO/假 flag 证据汇总（跨三个模块）

1. `web/app/lib/jobs/gate1Job.ts:139` —— 注释 `// repair 暂不做（TODO：Tripo 产物需外部修复通道，Meshy print/repair 只吃自家 task）`。这是唯一一条明确的 TODO，指向"Tripo 产物的自动修复"这一能力目前不存在，只有失败兜底（回退用原始 GLB + 诚实标注可打印性缺口，见 `gate1Job.ts:219-231`）。
2. `web/app/lib/printability/localCheck.ts:6` —— 注释 `// 修复暂不做（报告记 TODO）`，与上一条同一处能力缺口的另一侧记录。
3. 未发现任何"永远为 false 的 feature flag"模式（`mock` 参数是显式的运行时布尔，来自请求 query，非写死常量）。
4. 未发现被注释掉的调用代码块（三个模块内грep `^\s*//.*\w+\(` 均为解释性注释，非注释掉的函数调用）。

---

## 五、跨模块调用关系速览

```
主工作台 page.tsx
  └─ /api/project/[id]/gate1  → gate1Job.ts
       ├─ falEditImage ×2（白底抠图、四视图网格）─ falClient.ts
       ├─ cropGridToViews ─ cropGrid.ts
       ├─ submitMultiviewToModel/pollTask/glbUrlFrom/downloadFile ─ tripo/client.ts
       └─ checkPrintabilityLocal/carveShell ─ printability/localCheck.ts（非本次盘点范围，仅作旁证）
  └─ /api/project/[id]/scenes(+revise)  → 内联 runGeneration/runRevise
       ├─ buildScenePrompts/buildRevampPrompts ─ scenePrompt.ts
       └─ falGenerateImage/falEditImage/downloadImage ─ falClient.ts

legacy 页面 legacy/page.tsx （/legacy 路由，独立可访问，非主链）
  └─ /api/session/[id]/message → executor.ts
       ├─ buildInitialScenePrompt/generateSceneImage ─ renderScene.ts ─ falClient.ts
       ├─ generateCleanItemImage ─ cleanItem.ts ─ falClient.ts
       └─ startMeshyJob ─ meshyJob.ts
            └─ submitImageTo3d/pollTask/submitPrintabilityAnalyze/submitRepair/downloadFile/glbUrlFrom/printabilityNeedsRepair/summarizePrintability ─ meshy/client.ts
```

`experiments/**` 目录（fidelity-test 系列）虽然也调用过 Tripo/Meshy 概念，但有独立 package.json、不被 `web/` import，本次盘点范围明确排除（与 `_map.md` 的 `standalone-experiments` 分片一致，不重复验证）。
