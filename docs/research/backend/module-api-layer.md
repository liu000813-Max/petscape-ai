# 模块盘点：API 路由层（`api-layer`）

覆盖路径：`web/app/api/**`（项目根 `<USER_HOME>/Desktop/3D宠物打印`）
排除：`design/`、`node_modules`、`.next`、`.git` 内部对象、PRD 文档正文。
证据方式：逐文件读源码 + 全项目 grep 调用点 + git log（design/ 路径改动已剔除）。
生成时间：2026-07-04。

## 总体结论

本层共 12 个 route.ts 文件，分两条互不相交的调用链：

1. **`project/*`（9 个文件）— 当前活跃路径**，唯一调用方是 `web/app/page.tsx`（tldraw 工作台主页）。全部有真实调用点，无 orphan。
2. **`session/*`（3 个文件）— 冻结的 legacy 路径**，唯一调用方是 `web/app/legacy/page.tsx`（CLAUDE.md 明确标注"旧 8 阶段聊天页...保留可访问但已冻结"）。功能可跑通，但不是产品当前主线，新功能不应加在这里。

所有路由均为"薄封装转发给 jobs 层"的设计，与模块地图声称职责一致：路由文件本身只做参数校验、404/400 短路、拼装 job 调用，重逻辑都在 `web/app/lib/jobs/**`（不在本次盘点范围）。

本层内未发现 TODO/FIXME/被注释掉的调用/永远为 false 的 feature flag（`grep -rn "TODO\|FIXME\|XXX" web/app/api` 零命中）。

---

## 能力清单

### 1. 创建项目

- **名称**：新建 PetScape 项目
- **入口**：`POST /api/project`，`web/app/api/project/route.ts:8-11`
- **输入→输出**：无 body → 全量 `PetScapeProject` 初始状态（201）
- **外部依赖**：无
- **被谁调用**：`web/app/page.tsx:85`
- **成熟度初判**：looks-working
- **核心管线能力**：是（工作台入口）

### 2. 读取项目全量状态

- **名称**：GET 项目状态（含 canvasItems、生成进度、缺失必填项）
- **入口**：`GET /api/project/[id]`，`web/app/api/project/[id]/route.ts:11-16`
- **输入→输出**：路径参数 `id` → `{...project, missing}`；project 不存在则 404
- **外部依赖**：无
- **被谁调用**：`web/app/page.tsx:77,119,178,208,232,261,285`（前端轮询生成进度的核心手段，多处调用）
- **成熟度初判**：looks-working
- **核心管线能力**：是（前端轮询所有异步 job 状态的唯一入口，gate1/gate2/scenes/revise 均无独立 GET，全部靠这个路由轮询）

### 3. 更新画布视图快照

- **名称**：PATCH 画布布局快照（tldraw snapshot，仅布局，非内容真相源）
- **入口**：`PATCH /api/project/[id]`，`web/app/api/project/[id]/route.ts:20-30`
- **输入→输出**：`{canvasSnapshot}` → `{ok:true}`；project 不存在 404
- **外部依赖**：无
- **被谁调用**：`web/app/page.tsx:157`
- **成熟度初判**：looks-working
- **核心管线能力**：否（辅助能力，内容真相源是 `project.canvasItems`，此路由只存布局，符合 CLAUDE.md 约束）

### 4. 更新 Brief 表单字段

- **名称**：PATCH brief（表单是真相源，字段级即时更新）
- **入口**：`PATCH /api/project/[id]/brief`，`web/app/api/project/[id]/brief/route.ts:24-39`
- **输入→输出**：`Partial<Brief>`（白名单字段：species/petSize/style/item/scene/photoPath/petName/vibe/petPhotoUrl/cagePhotoUrl + taboos/traits 数组）→ `{brief, missing}`
- **外部依赖**：无
- **被谁调用**：`web/app/page.tsx:137`
- **成熟度初判**：looks-working（白名单字段过滤 + 类型校验完整）
- **核心管线能力**：是（表单数据落盘唯一入口）

### 5. 上传宠物照/笼箱照

- **名称**：文件上传（pet/cage 两种 kind），落盘 + 写回 brief
- **入口**：`POST /api/project/[id]/upload`，`web/app/api/project/[id]/upload/route.ts:31-61`
- **输入→输出**：multipart form-data `{file, kind: 'pet'|'cage'}` → 落 `public/uploads/{id}/{kind}.{ext}`，写回 `brief.petPhotoUrl`/`brief.cagePhotoUrl`，返回 `{url, brief}`
- **外部依赖**：本地文件系统，无三方服务
- **被谁调用**：`web/app/page.tsx:727`
- **成熟度初判**：looks-working（MIME→ext 映射表 + 文件名兜底完整）
- **核心管线能力**：是（图片输入唯一入口，后续 scenes/gate1 均依赖这里落的图）

### 6. 场景图生成（双语义分流：i2i 改造 / t2i 置景）

- **名称**：POST scenes — 校验必填三项后触发生图，i2i（有笼箱照）走改造图分支，t2i（无笼箱照）走置景图分支
- **入口**：`POST /api/project/[id]/scenes`，`web/app/api/project/[id]/scenes/route.ts:34-83`（后台执行体 `runGeneration` 85-139）
- **输入→输出**：无 body（读 project.brief）→ 立即返回 `{items}`（202，status=generating 的 canvasItem 数组），后台 fire-and-forget 调 fal 生图，落盘后 `touch(project)` 更新状态供轮询
- **外部依赖**：**fal.ai**（`fal-ai/nano-banana` 文生图 / `fal-ai/nano-banana/edit` 改图），key = 项目根 `.env` 的 `FAL_KEY`。**已配置**（`.env` 中 `FAL_KEY` 非空，长度 69 字符，`web/app/lib/images/falClient.ts:13` 读取）
- **被谁调用**：`web/app/page.tsx:170`
- **成熟度初判**：looks-working（含 fal 瞬时错误重试一次 `withRetry`、文件版本化命名防覆盖、`?mock=1` 零成本回归通路）
- **核心管线能力**：是（生成链第一环）

### 7. 按标注修改场景图（revise）

- **名称**：POST scenes/[sceneId]/revise — 用户在画布上手绘标注 + 文字说明，触发局部改图，产出新版本卡片并用 `parentId` 溯源
- **入口**：`POST /api/project/[id]/scenes/[sceneId]/revise`，`web/app/api/project/[id]/scenes/[sceneId]/revise/route.ts:30-71`（后台执行体 `runRevise` 73-111）
- **输入→输出**：`{annotatedImageDataUri, note}`（源场景须 `status===ready`）→ 立即返回 `{item}`（202），后台调 fal edit，产出 `scheme-a-mushroom-v2.jpg` 式版本命名（`nextVersionName` 按 "方案 A · v2"→"方案 A · v3" 递增）
- **外部依赖**：**fal.ai**（`fal-ai/nano-banana/edit`），同上 `FAL_KEY`，**已配置**
- **被谁调用**：`web/app/page.tsx:194`
- **成熟度初判**：looks-working（超时保护 `withTimeout`+`JOB_TIMEOUT_MS.revise`、空文件校验、mock 通路）
- **核心管线能力**：是（画布迭代修改闭环，T2 竖切验收产物）

### 8. Chat 一句话抽取字段（静默 Agent）

- **名称**：POST agent/extract — 右栏 Chat 输入一句话，LLM 抽取结构化字段直接写回 brief，返回缺失项提示
- **入口**：`POST /api/project/[id]/agent/extract`，`web/app/api/project/[id]/agent/extract/route.ts:13-44`
- **输入→输出**：`{message}` → `{patched, missing, reply}`；内部调 `runExtractAgent`（`web/app/lib/agents/extract/agent.ts`）
- **外部依赖**：**OpenAI Codex SDK**（`@openai/codex-sdk`，本地 CLI/订阅态鉴权，非 `.env` API key），无独立 key 名可查（未在任何 `.env*` 中出现 `OPENAI_API_KEY`/`CODEX_*`，鉴权走 Codex CLI 登录态，超出本层可验证范围——**是否登录未在本次盘点验证，标注为未核实**）
- **被谁调用**：`web/app/page.tsx:273`
- **成熟度初判**：looks-working（有结构化输出 schema 校验、60s 超时、失败兜底文案 `FALLBACK_REPLY`，是本层唯一带 LLM 调用失败优雅降级的路由）
- **核心管线能力**：是（PRD 硬裁决"生成前静默抽取器已落地"对应的代码实现，见项目 CLAUDE.md）

### 9. 门 1：选场景卡 → 抠图 → 提交 3D 生成

- **名称**：POST gate1 — 从选中场景卡抠白底物品图，提交 Tripo 3D 生成 + 挖腔管线，`userState→tuning3d`
- **入口**：`POST /api/project/[id]/gate1`，`web/app/api/project/[id]/gate1/route.ts:13-31`（薄封装，实际逻辑在 `web/app/lib/jobs/gate1Job.ts` 的 `startGate1`，不在本层盘点范围）
- **输入→输出**：`{sceneId, itemName}` → `{ok:true, userState}`（202）；缺字段 400，`startGate1` 抛错 400
- **外部依赖**：**Tripo**（`multiview_to_model`），key = `.env` 的 `TRIPO_API_KEY`，**已配置**（47 字符，`web/app/lib/tripo/client.ts:16` 读取，`web/app/lib/tripo/client.ts:20` 有 `web/.env.local` 兜底路径）；同时经 fal edit 生成四视图网格（依赖同上 `FAL_KEY`）
- **被谁调用**：`web/app/page.tsx:221`
- **成熟度初判**：looks-working（本层路由本身极薄，仅做参数校验 + try/catch 转 400；真实健壮性——轮询重试、挖腔失败回退——在 `gate1Job.ts`，不在本层证据范围内）
- **核心管线能力**：是（生成链核心枢纽：2D→3D 转折点）

### 10. 门 2：3D 就绪确认 → 归一化 → 切片

- **名称**：POST gate2 — 确认 3D 模型 ready 后，normalize 到指定 scaleMm，PrusaSlicer 切片产出 STL + G-code
- **入口**：`POST /api/project/[id]/gate2`，`web/app/api/project/[id]/gate2/route.ts:14-38`（薄封装，实际逻辑在 `web/app/lib/jobs/gate2Job.ts` 的 `startGate2`）
- **输入→输出**：`{scaleMm, color, material}`（scaleMm 会被 clamp 到 [80,160]）→ `{ok:true, modelConfig}`（202）；前置校验 `project.model3d?.status==='ready'`，否则 400
- **外部依赖**：**PrusaSlicer**（本地二进制，`PRUSASLICER_BIN` env 可覆盖默认路径 `/Applications/PrusaSlicer.app/...`）+ **uv**（本地 Python 环境管理器，`UV_BIN` env 可覆盖默认 `/opt/homebrew/bin/uv`），均是本地可执行文件依赖，非云端 API key。这两个 env var 在 `.env` 中**未出现**（`.env` 只有 MESHY/TRIPO/FAL 三个 key），意味着走的是代码内硬编码默认路径，未被 `.env` 覆盖——**本地环境是否装了这两个二进制未在本次盘点验证**
- **被谁调用**：`web/app/page.tsx:251`
- **成熟度初判**：looks-working（本层路由薄封装完整；下游 `gate2Job.ts` 的本地二进制依赖健壮性不在本层证据范围）
- **核心管线能力**：是（生成链终点：可打印文件产出）

---

## Legacy 路径（session/*，冻结但可跑通）

CLAUDE.md 原文："旧 8 阶段聊天页在 `web/app/legacy/page.tsx`……保留可访问但已冻结"。以下三条能力仅服务该冻结页面，grep 全项目确认调用方唯一来自 `web/app/legacy/page.tsx`。

### 11. 创建 Session

- **名称**：POST session — 新建旧版会话
- **入口**：`POST /api/session`，`web/app/api/session/route.ts:7-9`
- **输入→输出**：无 body → 全量 session（201）
- **外部依赖**：无
- **被谁调用**：`web/app/legacy/page.tsx:60`
- **成熟度初判**：looks-working（代码本身能跑，但服务的页面是冻结路径）
- **核心管线能力**：否（legacy，非当前产品主线）

### 12. 读取 Session 状态

- **名称**：GET session — 轮询旧版会话状态（stage/messages/brief/renderRounds/sceneImages/meshy/slice 等）
- **入口**：`GET /api/session/[id]`，`web/app/api/session/[id]/route.ts:10-33`
- **输入→输出**：路径参数 `id` → 全量 session 状态 + `readyToRender` 派生字段
- **外部依赖**：无
- **被谁调用**：`web/app/legacy/page.tsx:54`
- **成熟度初判**：looks-working
- **核心管线能力**：否（legacy）

### 13. 发送消息（旧版 Agent 对话，含图片上传）

- **名称**：POST session/[id]/message — 旧版聊天式交互，支持文字+图片，per-session 锁防并发，enqueue 到 Codex 串行队列
- **入口**：`POST /api/session/[id]/message`，`web/app/api/session/[id]/message/route.ts:42-66`
- **输入→输出**：multipart（`message`/`text` + 可选 `image`）或 JSON `{message}` → `{ok:true, sessionId, pendingJob}`（202）；已有 pendingJob 未失败时返回 409
- **外部依赖**：Codex SDK（经 `enqueueStageJob`→`web/app/lib/jobs/executor.ts`，不在本层范围）
- **被谁调用**：`web/app/legacy/page.tsx:78`
- **成熟度初判**：looks-working（并发锁设计合理：先占位再解析 multipart，消除竞态窗口）
- **核心管线能力**：否（legacy，5 个 M1-M5 里程碑的产物，早于当前 T/B 系列 workbench）

---

## Orphan 检查

全部 12 条能力均有真实调用点（9 条 project/* 被 `page.tsx` 调用，3 条 session/* 被 `legacy/page.tsx` 调用）。**本层无 orphan 路由**。

## 成熟度分布

| 成熟度 | 数量 | 说明 |
|---|---|---|
| looks-working | 13/13 | 无 half-done 或 dead-code；本层未发现 TODO/FIXME/被注释调用/恒 false flag |
| half-done | 0 | — |
| dead-code | 0 | — |

注：looks-working 判断仅基于本层（route.ts 薄封装）代码质量与调用链完整性；gate1/gate2 背后 `web/lib/jobs/gate1Job.ts`/`gate2Job.ts` 的深层健壮性（轮询重试、挖腔失败回退等）需在 `job-pipeline` 分片盘点时单独验证，不在本文档证据范围内。

## Key 配置状态汇总（仅报告是否非空，不输出明文）

| 变量名 | 来源文件 | 状态 |
|---|---|---|
| `FAL_KEY` | 项目根 `.env` | 已配置（非空） |
| `TRIPO_API_KEY` | 项目根 `.env`（`web/.env.local` 兜底） | 已配置（非空） |
| `MESHY_API_KEY` | 项目根 `.env` | 已配置（非空，但本层路由 gate1/gate2 均不直接依赖 Meshy——据 CLAUDE.md "Meshy 降为备选"，可打印性检查已改走本地 trimesh） |
| Codex SDK 鉴权 | `@openai/codex-sdk` 本地 CLI/订阅态 | 未在 `.env*` 中以 key 形式出现，是否已登录**未核实**（超出静态代码盘点范围，需运行时验证） |
| `PRUSASLICER_BIN` / `UV_BIN` | 代码内硬编码默认路径，可用同名 env 覆盖 | `.env` 未设置，走默认路径；本地二进制是否存在**未核实** |
