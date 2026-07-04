# 后端能力盘点聚合报告（PetScape / 3D宠物打印）

聚合日期：2026-07-04
被聚合源：本目录 `_map.md` + 8 份 `module-*.md`（初判）+ 8 份 `maturity-*.md`（终判取证）。
证据纪律：能力以**代码/产物/git**为唯一证据（PRD/docx 未读，不作证据）。key 只报是否非空，不输出明文。
成熟度术语：`looks-working`=读码/调用链看起来能跑（初判档）；**`能跑`**=有可复现硬证据（实跑测试 / 本地实跑脚本 / 完整非 mock 端到端产物 / typecheck 通过）坐实（终判档）；`半成品`=编排在但关键依赖或对策未坐实；`死代码`=无 caller。**maturity 终判与 module 初判冲突时，一律以 maturity 为准，并在条目注明**（全库仅 1 处实质冲突，见 §6）。

---

## 1. 执行摘要

**架构**：单体 Next.js（App Router）应用 `web/`，前后端同仓。后端无数据库，用**进程内内存单例**（`globalThis` 挂 `Map`，HMR 不丢）存 `projects`/`sessions` 两套并行状态。重计算下沉到 **Python 子进程**（`uv run` 拉 trimesh/pymeshlab/manifold3d）——这是唯一的 Node↔Python 语言边界。外部 API 三家：**fal.ai**（生图/改图/抠图，主通道）、**Tripo**（图生 3D 主引擎）、**Meshy**（已裁决降为备选，仅 legacy 可达）。LLM 走 **Codex SDK**（订阅态凭证 `~/.codex/auth.json`，非 `.env` key）。

**核心管线（当前唯一活跃主链，宿主 = tldraw 三栏工作台 `page.tsx`）**：
> 填 Brief（或 Chat 静默抽取） → **生成 2D 场景图**（fal，3 方向 i2i/t2i 分流） → 画布标注改图（fal edit） → **门1**：抠白底 → fal 四视图网格 → 像素裁切 → **Tripo 图生3D** → **carve_shell.py 混合内核挖腔** → **门2**：normalize_mesh.py 坐标归一 → **PrusaSlicer 切片** → 下载 STL/G-code。

**整体成熟度概貌**：核心管线**端到端已被一次真实非 mock 产物链坐实**（`web/public/generated/9709946e-.../`：Tripo 28MB raw GLB → carve.json(watertight) → model.glb → 120mm STL → 38MB G-code，两条 log 均 SUCCEEDED）。几何脚本经"真实输入实跑 → 逐字节比对生产产物"三重验证。全库 **无死代码级断裂**（唯一"死代码"终判是被架构主动旁路的 Meshy client，代码本身曾验收通过）。真正的成熟度短板集中在两处：**门1 无 Tripo 产物几何修复通道**（有意识 TODO），以及 **extract agent 的 LLM 抽取质量未真调验证**（受"不真调付费 API"红线所限）。大量 `looks-working` 其实是"薄封装/纯本地工具"，被主链复用、随竖切 commit 演进，质量证据扎实。第二大类资产是**冻结的 legacy 8 阶段聊天链**（session 模型 + Meshy + 5-agent 中的 4 个），功能完整、经 M1–M5 验收，但当前工作台不可达。

**能力总数**：**74 条**（含辅助/工具函数与实验条目）。核心管线关键能力约 24 条；legacy 完整链约 18 条；纯本地/工具/类型契约约 14 条；standalone-experiments 决策证据约 18 条。
**核心管线一句话**：Brief → fal 生 2D → 门1(fal 四视图 + Tripo 3D + carve 挖腔) → 门2(normalize + PrusaSlicer 切片) → STL/G-code，已有一条真实非 mock 端到端产物坐实全链。
**最弱一环**：**门1 的"Tripo 产物几何修复"缺失**（`gate1Job.ts:139` TODO；Meshy 的 analyze/repair 只吃自家 task、无法喂 Tripo GLB，故主链只做挖腔+本地诊断，挖腔失败仅回退原始 GLB 并诚实标注缺口，不做修复）。次弱：extract agent 抽取质量未真调坐实。
**可裁剪候选**：**约 32 条**（legacy 完整链 ~18 + Meshy client 8 + standalone-experiments 中纯选型残留脚本 ~6，另加若干 orphan/重复实现/dead export，详见 §4）。

---

## 2. 能力总表

列：编号 | 能力 | 入口 | 输入→输出 | 外部依赖与 key 就绪 | 调用者 | 成熟度终判 | 证据指针
key 就绪状态：`FAL_KEY`/`TRIPO_API_KEY`/`MESHY_API_KEY` 三者在项目根 `.env` **均已配置非空**；`uv`(0.9.13)/`PrusaSlicer`(233MB) 本地二进制**均已核实存在**；Codex 凭证 `~/.codex/auth.json` **存在**（登录态未过期未真调验证=残量）。

### A. 核心管线（当前工作台活跃主链）

| # | 能力 | 入口 | 输入→输出 | 外部依赖/key | 调用者 | 终判 | 证据指针 |
|---|---|---|---|---|---|---|---|
| A1 | 创建项目 | `api/project/route.ts:8` | 无 body → 全量 `PetScapeProject`(201) | 无 | `page.tsx:85` | 能跑 | maturity-api §1；纯内存审查即证 |
| A2 | 读取项目全量状态(轮询入口) | `api/project/[id]/route.ts:11` | id → `{...project,missing}`/404 | 无 | `page.tsx:77,119,178,208,232,261,285` | 能跑 | maturity-api §2；前端轮询所有 job 状态的唯一 GET |
| A3 | 更新 Brief 表单字段 | `api/project/[id]/brief/route.ts:24` | `Partial<Brief>`(白名单) → `{brief,missing}` | 无 | `page.tsx:137` | 能跑 | maturity-api §3；git `a58e44e` |
| A4 | 上传宠物照/笼箱照 | `api/project/[id]/upload/route.ts:31` | multipart{file,kind} → 落 `public/uploads/{id}/` + 回写 brief | 本地 FS | `page.tsx:727` | 能跑 | maturity-api §4 |
| A5 | 生成 2D 场景图(i2i/t2i 双分流) | `api/project/[id]/scenes/route.ts:34` | brief → 202 + 后台 fal 生 3 图落盘 | fal `FAL_KEY`✓ | `page.tsx:170` | 能跑 | maturity-api §5；含 `withRetry`+`?mock=1`；E2E 证据 `img2img-test/` |
| A6 | 按标注修改场景图(revise) | `api/project/[id]/scenes/[sceneId]/revise/route.ts:30` | {annotatedImageDataUri,note} → 版本卡 v2/v3 + parentId 溯源 | fal `FAL_KEY`✓ | `page.tsx:194` | 能跑 | maturity-api §6；git `9f5d6cf`(T2) |
| A7 | Chat 静默抽取字段(extract agent) | `api/project/[id]/agent/extract/route.ts:13` → `agents/extract/agent.ts:62` | 一句话 → `{patch,reply}` 合并进 brief | Codex SDK(订阅态)✓ | `page.tsx:273` | **半成品**(路由/降级能跑，LLM 抽取质量未真调坐实) | maturity-api §7 + maturity-llm-agents；白名单校验+60s超时+`FALLBACK_REPLY`；git `df1ce85`(B4) |
| A8 | 门1：抠图→四视图→Tripo→挖腔 | `api/project/[id]/gate1/route.ts:13` → `jobs/gate1Job.ts:51/96` | {sceneId,itemName} → item2d+model3d 卡 + 落 model-raw.glb/model.glb/carve.json | fal✓+Tripo✓+uv✓(carve) | `page.tsx:221` | 能跑 | maturity-job-pipeline §3；**真实非 mock 端到端产物** `generated/9709946e/`；git `d94f9ae→ad0afc3` |
| A9 | 门2：归一化→PrusaSlicer 切片 | `api/project/[id]/gate2/route.ts:14` → `jobs/gate2Job.ts:58/73` | {scaleMm,color,material} → 落 print-{mm}.stl/.gcode | uv✓+PrusaSlicer✓ | `page.tsx:251` | 能跑 | maturity-job-pipeline §4；**normalize_mesh.py 本地实跑 STL 逐字节=生产产物**；gate2.log SUCCEEDED |
| A10 | fal 文生图 `falGenerateImage` | `images/falClient.ts:48` | prompt → 图 URL | fal✓ | `renderScene.ts:40`,`scenes/route.ts:119` | 能跑 | maturity-external-clients；`img2img-test/` 产物 |
| A11 | fal 改图 `falEditImage`(含抠图/网格复用) | `images/falClient.ts:52` | prompt+图 → 编辑后 URL | fal✓ | 5 处(gate1×2/cleanItem/scenes/revise) | 能跑 | 全库使用面最广的单函数；maturity-external-clients |
| A12 | fal 下载 `downloadImage` | `images/falClient.ts:56` | URL → 落盘(无重试,上层 withRetry 兜) | fal 直链 | 多处 | 能跑 | maturity-external-clients；`stat().size===0` 校验兜底 |
| A13 | `publicImageToAbs` 路径解析 | `images/falClient.ts:62` | 相对/绝对 → 磁盘绝对路径 | 无 | cleanItem/gate1/scenes | 能跑 | **本轮本地实跑**通过 |
| A14 | `fileToDataUri` 图转 data URI | `images/falClient.ts:68` | 本地图 → data URI | 无 | 多处 | 能跑 | **本轮本地实跑**(492KB PNG) |
| A15 | `buildScenePrompts`/`buildRevampPrompts` | `images/scenePrompt.ts:50/64` | Brief → 3 方向 prompt[] | 无 | `scenes/route.ts:7,46` | 能跑 | **本轮本地实跑**；习性 hint 注入+revamp 硬约束 |
| A16 | `buildMultiviewGridPrompt` 四视图网格 prompt | `images/multiviewPrompt.ts:17` | {itemName} → FLBR 网格 prompt | 无 | `gate1Job.ts:163` | 能跑 | **本轮本地实跑**(377字)；单点真相源，与裁切约定对齐 |
| A17 | `cropGridToViews` 网格像素裁切 | `images/cropGrid.ts:21` | 2×2 网格 → 4 视图(FLBR) | sharp(本地) | `gate1Job.ts:175` | 能跑 | **本轮本地实跑(最高保真)**：1254² → 4×627² PNG |
| A18 | Tripo `uploadImage` | `tripo/client.ts:61` | 图 → file_token | Tripo✓ | `submitMultiviewToModel`内部 | 能跑 | maturity-external-clients；真实 file_token 产物 |
| A19 | Tripo `submitMultiviewToModel` | `tripo/client.ts:79` | 4 视图(FLBR) → taskId | Tripo✓ | `gate1Job.ts:182` | 能跑 | 真实 submit.json `code:0`；body 与参考脚本逐字段一致 |
| A20 | Tripo `pollTask`(transient 容错) | `tripo/client.ts:111` | taskId → 成功结果 | Tripo✓ | `gate1Job.ts:189` | 能跑 | 连续≤5次瞬时错误不判死；实录 poll 25% fetch failed 被容错 |
| A21 | Tripo `glbUrlFrom`/`downloadFile` | `tripo/client.ts:144/151` | 结果 → GLB URL/落盘(3次重试) | Tripo 直链 | `gate1Job.ts:203` | 能跑 | maturity-external-clients；真实 27M GLB 落盘 |
| A22 | carve_shell.py 挖腔全链(repair/detect_axis/carve/CLI) | `scripts/carve_shell.py:31/128/166/271` | GLB → 水密单壳 + carve.json | 本地 uv+manifold3d/pymeshlab/trimesh | `printability/localCheck.ts:97`→`gate1Job.ts:214` | 能跑 | maturity-geometry-native；**真实 GLB 实跑 exit0 产物逐字节=生产** |
| A23 | normalize_mesh.py 切片前坐标归一 | `web/scripts/normalize_mesh.py:26` | GLB → Z-up STL | 本地 uv+trimesh | `gate2Job.ts:91`(+legacy `sliceJob.ts:105`) | 能跑 | **实跑 STL 逐字节=生产**；git `fe15525` 独立验收 ACCEPT |
| A24 | withTimeout 超时保护 + runCodexTurn 日志包装 | `jobs/timeouts.ts:32/54` | run → 超时 abort+JobTimeoutError | 无 | gate1/gate2/meshy/slice + 6 agent | 能跑 | maturity-job-pipeline §2；**推翻初判 orphan**(runCodexTurn 实有 6 agent 调用含主链 extract)；测试 `timeoutQueue.test.mjs` 通过 |

### B. 支撑能力（数据层 / 前端 UI / 前端工具）

| # | 能力 | 入口 | 输入→输出 | 外部依赖/key | 调用者 | 终判 | 证据指针 |
|---|---|---|---|---|---|---|---|
| B1 | projects 单例 Map(HMR 保活) | `store/projects.ts:5` | import → 跨请求 Map | 无 | getProject/createProject | 能跑 | maturity-data-store §1；真源码实跑同实例 |
| B2 | createProject() | `store/projects.ts:17` | → 新 project + 入 Map | crypto.randomUUID | `api/project/route.ts` | 能跑 | maturity-data-store §2 |
| B3 | getProject(id) | `store/projects.ts:33` | id → project/undefined | 无 | 10 处路由/job | 能跑 | maturity-data-store §3 |
| B4 | touch(project) 时间戳 | `store/projects.ts:37` | 原地改 updatedAt | 无 | 26 处 | 能跑 | maturity-data-store §4；支撑前端轮询 |
| B5 | PetScapeProject 类型契约族 | `types/project.ts:5` | 纯类型 | 无 | api/**,gate1/gate2,page,ModelStudio | 能跑 | maturity-data-store §5；**注释漂移**：`taskId` 注释写 Meshy 实为 Tripo |
| B6 | defaultModelConfig() | `types/project.ts:90` | → {120,#C08A5A,PLA木纹} | 无 | page/ModelStudio/gate1/gate2 | 能跑 | maturity-data-store §6；SSOT 单点默认值 |
| B7 | missingRequiredFields(brief) | `types/project.ts:95` | Brief → 缺失项[] | 无 | 4 处(route/scenes/extract/brief) | 能跑 | maturity-data-store §7；生图前置闸门 |
| B8 | nowIso()(projects 版) | `store/projects.ts:13` | → ISO 串 | 无 | createProject/touch | 能跑 | **SSOT 违规**：与 sessions.ts:12 逐字重复 |
| B9 | Brief 表单三栏真相源 | `page.tsx:35`(字段 396-485) | 填字段 → PATCH brief | 内部 API | Next 路由 `/` | 能跑 | maturity-web-ui §1；tsc 通过；immediate/400ms去抖分治 |
| B10 | 照片上传组件 PhotoUpload | `page.tsx:704` | 选图 → POST upload | 内部 API | page.tsx 两处 | 能跑 | maturity-web-ui；辅助输入(非必填) |
| B11 | 生成 2D 触发+轮询 generate() | `page.tsx:166`(轮询 112-126) | 点击 → POST scenes + 2s 轮询 | 内部 API | 「生成2D」按钮 | 能跑 | maturity-web-ui §2 |
| B12 | 画布内容同步 WorkbenchCanvas | `WorkbenchCanvas.tsx:501`(挂载 307) | CanvasItem[] → tldraw image shape | tldraw ^5.2.2 | `page.tsx:515` | 能跑 | maturity-web-ui §3；内容真相源=canvasItems,snapshot只存布局 |
| B13 | 画布标注工具(StateNode) | `WorkbenchCanvas.tsx:61` | 拖拽 → 红箭头+富文本标签 | tldraw StateNode | tools prop | 能跑 | maturity-web-ui §4；完整生命周期非占位 |
| B14 | 按标注修改(导出合成图) | `WorkbenchCanvas.tsx:392`+`page.tsx:182` | 场景+标注 → PNG dataURI → revise | 内部 API | 画布浮出按钮 | 能跑 | maturity-web-ui §5 |
| B15 | 门1 确认 UI confirmGate1() | `page.tsx:213`(UI 548-576) | 选卡+物品名 → POST gate1 + 强跳 tuning3d | 内部 API | 门1 浮出条 | 能跑 | maturity-web-ui §6；防"确认没跳3D"假回退 |
| B16 | ModelStudio 3D 调参覆盖层 | `components/ModelStudio.tsx:28` | model3d → model-viewer + 参数面板 | @google/model-viewer ^4.3.1 | `page.tsx:580` | 能跑 | maturity-web-ui §7；尺寸80-160mm 滑块 |
| B17 | 材质/颜色渲染层改色 | `ModelStudio.tsx:52` | swatch → setBaseColorFactor | 无 | ModelStudio useEffect | 能跑 | maturity-web-ui；纯渲染糖，洞口直径诚实标锁定 |
| B18 | 门2 确认 UI confirmGate2() | `page.tsx:246`(按钮 ModelStudio 244) | modelConfig → POST gate2 + 轮询 | 内部 API | ModelStudio 确认按钮 | 能跑 | maturity-web-ui §8；乐观更新+失败重试 |
| B19 | STL/G-code 下载区 | `ModelStudio.tsx:210` | slice 路径 → `<a download>` | 无(静态文件) | 切片 ready 分支 | 能跑 | maturity-web-ui §9；漏斗终点交付 |
| B20 | Stepper 回退导航 | `page.tsx:27,299-331` | 点步骤 → 切 viewState(不发API) | 无 | header 步骤按钮 | 能跑 | maturity-web-ui；git `11792a7`(B5) |
| B21 | 右栏 Agent 静默抽取 Chat(前端) | `page.tsx:265`(渲染 589-641) | 一句话 → POST extract + missing 联动 | 内部 API→A7 | 输入框/发送按钮 | 能跑 | maturity-web-ui §10；前端壳闭合(抽取质量见 A7) |
| B22 | `?mock=1` 回归模式贯穿开关 | `page.tsx:67` | URL 参数 → 生成类 POST 走占位资产 | 本地 mock 资产(已核实存在) | 贯穿生成交互 | 能跑 | maturity-web-ui；`mockup-assets/` 文件齐全 |

### C. 支撑能力（demo / 离线工具，非主链但非死）

| # | 能力 | 入口 | 输入→输出 | 外部依赖/key | 调用者 | 终判 | 证据指针 |
|---|---|---|---|---|---|---|---|
| C1 | scene-lab 组合场景预览(three.js) | `scene-lab/SceneLabViewer.tsx:94` | .norm.glb 资产 → three.js 场景 | three ^0.185.1；静态资产✓ | **orphan**(仅 URL `/scene-lab` 直达) | 能跑(demo-grade) | module-web-ui #16；git `41c4e1a`(C2)；非冻结,非主链接入点 |
| C2 | scene-lab 双挂载防御(cancelled 标记) | `SceneLabViewer.tsx:118` | Strict Mode 双挂载 → 短路 | 无 | 附属 C1 | 能跑 | module-web-ui #17；截图对比抓到的实测坑 |
| C3 | normalize_asset.py 资产入库烘焙 | `scripts/normalize_asset.py:42` | GLB → .norm.glb + meta.json | 本地 uv+trimesh | **无 job 调用**(手工 CLI，产物被 C1 静态消费) | 能跑(离线工具) | module-geometry-native 能力5；**偏离"被 job-pipeline 调用"的模块描述** |

### D. Legacy 完整链（冻结，`/legacy` 可达但工作台不可达；裁剪候选）

| # | 能力 | 入口 | 输入→输出 | 外部依赖/key | 调用者 | 终判 | 证据指针 |
|---|---|---|---|---|---|---|---|
| D1 | Legacy 8 阶段聊天页 | `legacy/page.tsx:33` | 聊天式 → session 流 | 内部 API(session) | **orphan**(仅 URL 直达,无站内链接) | 能跑但已冻结 | module-web-ui #15；git M1-M5 早于工作台 B/T 系列 |
| D2 | 创建 Session | `api/session/route.ts:7` | → session(201) | 无 | `legacy/page.tsx:60` | 能跑(legacy) | module-api §11 |
| D3 | 读取 Session 状态 | `api/session/[id]/route.ts:10` | id → session+readyToRender | 无 | `legacy/page.tsx:54` | 能跑(legacy) | module-api §12 |
| D4 | 发送消息(旧 Agent 对话) | `api/session/[id]/message/route.ts:42` | multipart/JSON → 202+pendingJob | Codex(经 executor) | `legacy/page.tsx:78` | 能跑(legacy) | module-api §13；per-session 锁防并发 |
| D5 | Stage 状态机编排器 executor.ts | `jobs/executor.ts:184/195` | sessionId+文本 → 分派 8 handler | fal+Meshy+Codex | `api/session/[id]/message` | 能跑(legacy) | module-job-pipeline §7；M1-M5 验收最扎实的一段历史 |
| D6 | Codex 串行队列 CodexSerialQueue | `jobs/codexQueue.ts:15` | enqueue FIFO 串行 | 无 | `executor.ts:202,233` | 能跑(仅 legacy 用) | maturity-job-pipeline §1；测试 `timeoutQueue.test.mjs` 通过 |
| D7 | Meshy 图生3D 编排 meshyJob | `jobs/meshyJob.ts:43/61` | cleanItemImage → session.meshy | Meshy `MESHY_API_KEY`✓ | `executor.ts:112,129,139,155` | 能跑(legacy) | module-job-pipeline §5；git `9f8e04c` watertight 修复 ACCEPT |
| D8 | Legacy 切片管线 sliceJob | `jobs/sliceJob.ts:87/139` | meshy GLB → session.slice | uv+PrusaSlicer | `executor.ts:151,174` | 能跑(legacy) | module-job-pipeline §6；与 gate2Job **高度重复**(SSOT 分裂) |
| D9 | collecting agent(NLU+阶段推进) | `agents/collecting/agent.ts:46` | session+文本+照片 → brief/推进 | Codex✓ | `executor.ts:4,32` | 能跑但仅 legacy 可达 | module-llm-agents 能力1 |
| D10 | preview agent(意图理解,正则短路) | `agents/preview/agent.ts:39` | 文本 → 4 类 action | Codex✓ | `executor.ts:7,146` | 能跑但仅 legacy；LLM 分支实际调用率存疑 | module-llm-agents 能力4 |
| D11 | rendering agent(反馈+prompt改写) | `agents/rendering/agent.ts:39` | 文本 → regenerate/proceed | Codex✓ | `executor.ts:5,59` | 能跑但仅 legacy 可达 | module-llm-agents 能力5 |
| D12 | selecting agent(定位物品,多模态+正则短路) | `agents/selecting/agent.ts:57` | 文本+图 → selectedItem | Codex✓ | `executor.ts:6,88` | 能跑但仅 legacy；历史有 REJECT 记录 | module-llm-agents 能力6 |
| D13 | sessions 单例 Map | `store/sessions.ts:4` | import → session Map | 无 | createSession/getSession | 能跑(legacy) | module-data-store §6 |
| D14 | makeMessage / createSession / getSession | `store/sessions.ts:16/20/40` | 构造/建/取 session | crypto.randomUUID | executor/slice/meshy/session 路由 | 能跑(legacy) | module-data-store §7-9 |
| D15 | Session 类型契约族 | `types/session.ts:1` | 纯类型 | 无 | legacy 全链 | 能跑(legacy) | module-data-store §13 |
| D16 | renderScene.ts(legacy 场景生图封装) | `images/renderScene.ts:9/29` | brief/prompt → 场景图 | fal✓ | `executor.ts:8,26,42` | 能跑但仅 legacy；与主链内联版**平行不共享** | module-external-clients fal 能力7 |
| D17 | cleanItem.ts(legacy 抠图封装) | `images/cleanItem.ts:17` | 场景图+描述 → 白底图 | fal✓ | `executor.ts:9,109` | 能跑但仅 legacy；prompt 比主链内联版**弱**(缺"单一连续实体"约束) | module-external-clients fal 能力6 |

### E. Meshy client 8 函数（终判死代码，裁剪候选）

| # | 能力 | 入口 | 外部依赖/key | 调用者 | 终判 | 证据指针 |
|---|---|---|---|---|---|---|
| E1-E8 | imageFileToDataUri/submitImageTo3d/getImageTo3d/submitPrintabilityAnalyze/getPrintabilityAnalyze/submitRepair/getRepair/pollTask/glbUrlFrom 等 | `meshy/client.ts:70/75/90/94/99/103/108/112/128/137/143/149` | Meshy `MESHY_API_KEY`✓ | 仅 `meshyJob.ts`(=D7,legacy) | **死代码**(现主链未接；代码本身曾验收通过) | maturity-external-clients §Meshy：「现主链未接，死代码」；analyze/repair 结构性只吃自家 task、无法喂 Tripo GLB(module-external-clients 能力4/5 half-done) |

### F. standalone-experiments（决策证据仓，零 import 耦合，裁剪候选）

| # | 能力簇 | 路径 | 终判 | 证据指针 |
|---|---|---|---|---|
| F1 | E2 保真度矩阵(meshy×tripo×single/multi) | `experiments/fidelity-test/` | 能跑(报告类) | maturity-standalone §1；四配置产物齐+独立复现 geom；结论=CLAUDE.md 选型依据 |
| F2 | A2 一致性网格+挖洞报告 | `experiments/fidelity-test-v2/`(无前缀) | 能跑(独立复现坐实) | maturity-standalone §2-3；venv 复现 vol/hull=0.8944 逐项吻合 |
| F3 | A3 质心射线检测器 + 黑洞证伪 | `.../a3-*.py`,`a3-report.md` | 能跑(独立执行验证) | maturity-standalone §4-5；venv 复现 vol/hull=0.9465；**血缘→生产 localCheck.ts** |
| F4 | img2img 5 路径选型 | `experiments/img2img-test/` | 部分能跑(含 dead-code 失败探索 test2) | module-standalone §3；test2 订阅通道 400/图片被忽略=证伪路径 |
| F5 | meshy-test / meshy-test-2 首测二测 | `experiments/meshy-test{,-2}/` | 能跑(文档/产物记录) | module-standalone §4-5；有 API 积分账本；结论被 CLAUDE.md 推翻(Meshy 降备选) |
| F6 | E3-1/E3-3 多视图对比驱动 | `experiments/multiview-test/run-e3-*.mjs` | 能跑(deps齐+产物+usage 日志) | maturity-standalone §6 |
| F7 | E3-2 一致性人工评审 | `.../e3-2-review.md` | **半成品** | maturity-standalone §7：发现"视图语义漂移"风险，但对策"视图语义校验"**无实现代码** |
| F8 | Tripo 原生多视图图片对比素材 | `.../compare-*.jpg` | **半成品** | maturity-standalone §8：对比图在但**生成脚本缺失不可复核**；结论=CLAUDE.md 禁用裁决 |
| F9 | tripo-asset-demo(GLB 消费教学) | `experiments/tripo-asset-demo/` | 能跑(教学 demo,**未提交 git**) | module-standalone §7；README 自称 throwaway |
| F10 | threejs 螺旋岩石窝原型 | `threejs-mouse-spiral-nest/` | 能跑(唯一有 Playwright 视觉回归) | module-standalone §8；`visual-check-report.json` passed:true |

---

## 3. 核心管线端到端链路图（文字版，标每跳成熟度）

```
[前端] page.tsx 三栏工作台 (B9 能跑)
  │  用户填 Brief(B9 能跑) 或 Chat 一句话 → extract(A7 半成品*)
  │  * 唯一非"能跑"跳：LLM 抽取质量未真调坐实；但失败兜底转手填表,不阻塞
  ▼
[生成2D] POST /api/project/[id]/scenes (A5 能跑)
  │  fal buildScenePrompts(A15 能跑) → falGenerateImage/falEditImage(A10/A11 能跑)
  │  → downloadImage(A12 能跑) → 3 张场景卡落画布(B12 能跑)
  │  可选：画布标注(B13 能跑) → revise(A6 能跑, fal edit)
  ▼
[门1] POST /api/project/[id]/gate1 (A8 能跑)  ← 2D→3D 转折点
  │  ① falEditImage 抠白底(A11 能跑)
  │  ② buildMultiviewGridPrompt(A16) → falEditImage 四视图网格(A11)
  │  ③ cropGridToViews 像素裁切 FLBR(A17 能跑,最高保真实跑)
  │  ④ Tripo submitMultiviewToModel→pollTask→downloadFile(A19/A20/A21 能跑)
  │  ⑤ carve_shell.py 混合内核挖腔(A22 能跑,逐字节复现)
  │     ⚠️ 缺"Tripo 产物几何修复"通道(gate1Job.ts:139 TODO)=最弱一环
  │        挖腔失败仅回退原始 GLB+诚实标注,不修复
  ▼
[门2] POST /api/project/[id]/gate2 (A9 能跑)  ← 可打印文件产出
  │  ⑥ normalize_mesh.py Y-up→Z-up 归一(A23 能跑,逐字节复现)
  │  ⑦ PrusaSlicer CLI 切片(本地二进制✓)
  │  ⑧ parseGcodeMeta/parseWarnings
  ▼
[交付] STL/G-code 下载(B19 能跑)

全链真实性锚点：generated/9709946e-.../ 一条真实非 mock 产物链
  model-raw.glb(28MB Tripo) → carve.json(watertight=true,minWallMm=5.59)
  → model.glb(2.4MB) → print-120mm.stl(6.8MB) → print-120mm.gcode(38MB,21h14m)
  两条 log(gate1.log/gate2.log)均 SUCCEEDED
```

**链条最弱一环**：**门1 第⑤跳的"Tripo 产物几何修复"缺失**。挖腔脚本 `carve_shell.py` 自带 `repair_watertight` 水密化，但对 Tripo 原始 GLB 的**独立几何修复通道不存在**（`gate1Job.ts:139` TODO）；原设想用 Meshy `print/repair`，但 Meshy 的 analyze/repair 结构性只吃自家 image-to-3d 的 task_id、无法喂外部 Tripo GLB（module-external-clients 能力4/5）。当前策略=挖腔失败则回退原始 GLB + 诚实标注可打印性缺口，不做修复。次弱：**A7 extract 抽取质量**（受红线未真调）——但其失败兜底不阻塞表单，风险被校验白名单封顶。此外一处**跨门集成缺口**：门2 `scaleMm` 缩放会破坏门1 按 150mm 标定的 Ø69mm 入口物理尺寸，当前无联动修正（`localCheck.ts:78` TODO）。

---

## 4. orphan 与死代码清单（裁剪候选，约 32 条）

**A. 终判死代码 / dead export（可直接删或明确旁路）**
1. **Meshy client 全 8 函数**（E1-E8，`meshy/client.ts`）—— maturity 终判**死代码**：现主链未接，唯一 caller 是 legacy meshyJob。代码曾验收通过，被架构主动旁路。裁剪需连带 D7(meshyJob)。
2. **`enqueueAgentReply`**（`executor.ts:230`）—— `enqueueStageJob` 的别名导出，全项目零 import，**dead export**。
3. **img2img-test/test2**（F4 内）—— 订阅通道 `/images/edits` 返回 400 + 图片被静默忽略，是**已证伪的失败探索**，仅作记录。

**B. orphan（有代码无站内入口，仅 URL 直达或纯实验残留）**
4. **legacy 8 阶段聊天页 D1**（`legacy/page.tsx`）—— 全项目无 `<Link>`/`router.push` 指向 `/legacy`，仅 URL 直达。连带 D2-D16 整条 legacy 链（session 路由/executor/meshyJob/sliceJob/4 个 agent/session store/renderScene/cleanItem）。
5. **scene-lab C1/C2**（`scene-lab/`）—— 无站内链接，仅 URL `/scene-lab` 直达（但性质=刻意保留的独立 demo，非冻结）。
6. **standalone-experiments 全部**（F1-F10）—— 零 import 耦合，纯决策证据仓；其中 F9(tripo-asset-demo)**未提交 git**、F7/F8 半成品。

**C. 重复实现 / SSOT 分裂（技术债，非死代码，收敛候选）**
7. **gate2Job.ts ↔ sliceJob.ts**（D8）—— normalize→PrusaSlicer→parseWarnings 四步几乎逐行重复，改一处另一处静默漂移。
8. **`extractJson` 5 份逐字拷贝**（collecting/extract/preview/rendering/selecting agent 各一份）+ 2-attempt 重试 4 份拷贝。
9. **`nowIso()` 重复**（B8，projects.ts:13 ↔ sessions.ts:12）。
10. **主链内联抠图 vs cleanItem.ts / 内联场景 prompt vs renderScene.ts**（D16/D17）—— 同职责两套 prompt 分叉维护。
11. **实验内重复**：`a3-crop-grid.py`/`a3-crop_grid.py`、`a3-render-check.py`/`a3-render_and_check.py`（并发执行事故遗留，产物一致）。

**D. 半成品残点（功能缺口，非可删）**
12. **门1 Tripo 产物几何修复缺失**（`gate1Job.ts:139` TODO）—— 最弱一环，见 §3。
13. **门2 scaleMm↔Ø69 入口尺寸未联动**（`localCheck.ts:78` TODO）—— 跨门集成缺口。
14. **A7 extract 抽取质量未真调坐实**——受红线限，非代码缺失。

> 裁剪计数口径：legacy 完整链 D1-D16(~16) + Meshy client E1-E8(8) + 实验纯选型脚本残留(~6，F1/F2/F4/F5/F6 中 .mjs 驱动脚本) + dead export/重复实现若干 ≈ **32 条候选**。注意 legacy 与 Meshy 相互依赖（删 legacy 才好删 Meshy），实验区 F3 的检测逻辑是生产 localCheck.ts 的血缘源头（裁剪前需确认已固化进生产）。

---

## 5. 未决问题（取证后仍判不了的点）

1. **Codex 登录态活性**：`~/.codex/auth.json` 存在，但 token 是否未过期、真调是否成功——受"不真调付费 API"红线，未验证。影响 A7(extract) 及 D9-D12(legacy agents) 的运行时可用性。
2. **A7 extract 真实抽取质量**：species slug 映射 / trait chip 映射 / vague-input 不落表——校验白名单逻辑已坐实，但真实 LLM 输出未观察。属"能爬没爬"之外的红线不可达档。
3. **fal / Tripo 真实 HTTP 往返**：付费 API 红线未真调；已有 experiments 真实成功响应作替代证据（非低保真桩），但当前 key 额度/线上连通性未即时验证。
4. **carve_shell.py L2 兜底 + 壁厚收敛失败兜底**：主路径(L1/round0 达标)已实跑坐实；L2 与收敛失败分支需特定"难素材"才触发，本轮未覆盖。
5. **HMR 跨热重载不丢**：B1 单例的 global 回退机制已实跑坐实，但真实 Next dev HMR 下跨热重载不丢未在运行态坐实（机制层=社区标准写法）。
6. **门2 PrusaSlicer 切片参数写死**（layer 0.2/fill 15%/support）：是设计选择还是待参数化，无法从代码判定意图。
7. **实验区不可复核段**：F8(Tripo 多视图图片生成脚本缺失)、multiview-test/3d 的建模提交脚本缺失——只有产物无生成源码，不可重跑。
8. **视图语义校验是否落地主链**：E3-2(F7) 提出"非对称物体 front/left 标注错位需校验"，本聚合未在 job-pipeline/external-clients 找到对应实现，悬置为产品要求。

---

## 6. maturity 与 module 初判冲突（以 maturity 为准）

全库仅 **2 处**实质改判，均已在正文按 maturity 采纳：

1. **Meshy client：module 判"looks-working(legacy 可达,非死)" → maturity 判"死代码(现主链未接)"**（E1-E8）。
   采纳 maturity=**死代码**。二者不矛盾：maturity 的"死代码"指**当前主链无 caller**（legacy 链本身也是 orphan），module 的"非死"强调**代码曾验收通过、legacy 路由技术上可跑**。裁剪语境下按 maturity 归入死代码候选。

2. **runCodexTurn：module-job-pipeline 初判"orphan/half-done(全项目零调用)" → maturity 判"能跑"**（A24 的一部分）。
   采纳 maturity=**能跑**。初判 grep 漏了 `agents/` 目录，实测 `runCodexTurn` 被 6 个 agent 全部调用（含主链 extract），是 LLM agent 层统一超时+日志包装器，有活跃主链调用点。

其余全部条目 module 初判 `looks-working` → maturity 终判 `能跑`（无降级），仅 **A7 extract** 由 looks-working 降为**半成品**（LLM 抽取质量未真调坐实，路由/降级层能跑），及实验区 **F7/F8** 由 half-done 维持**半成品**。
```
