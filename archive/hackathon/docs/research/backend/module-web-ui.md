# 模块盘点：web-ui（前端展示层）

范围：`web/app/page.tsx`, `web/app/legacy/**`, `web/app/components/**`, `web/app/scene-lab/**`
排除：`design/`、`node_modules`、`.next`、`.git`、PRD 正文（仅代码 + git log 作证据）
生成时间：2026-07-04

证据方式：直接读取源文件 + 全项目 `grep` 追踪调用点 + `git log` 追踪提交历史（design/ 路径改动已剔除）。

---

## 能力清单

### 1. 主工作台三栏布局 + Brief 表单（真相源）

- **名称**：Workbench 主页 — Brief 表单区
- **入口**：`web/app/page.tsx:35`（`export default function Workbench`），表单字段 `web/app/page.tsx:396-485`
- **输入 → 输出**：用户在左栏填写宠物名/物种/尺寸/性格/风格/氛围/禁忌/照片 → 即时 `PATCH /api/project/[id]/brief`（`web/app/page.tsx:131-152`），server 端合并进 `PetScapeProject.brief` 并回传 `missing` 缺项列表驱动必填提示
- **外部依赖**：无三方服务；依赖内部 API 路由 `api/project/[id]/brief`（同项目 `api-layer` 分片）
- **被谁调用**：`web/app/page.tsx` 自身渲染入口，Next.js 路由 `/`（`layout.tsx` 挂载）；无其它前端页面引用
- **成熟度初判**：looks-working（离散控件走 `immediate` PATCH、文本框走 400ms 去抖，已有专门设计规避“共享 timer 互相取消丢字段”问题，见 CLAUDE.md Learned Constraints）
- **核心管线能力**：是（唯一活跃前台入口，PRD 门1/门2 全流程的宿主）

### 2. 照片上传组件（宠物照 / 笼箱照）

- **名称**：`PhotoUpload`
- **入口**：`web/app/page.tsx:704-756`
- **输入 → 输出**：`<input type=file>` 选图 → `FormData` POST `/api/project/[id]/upload`（`web/app/page.tsx:727`）→ 返回 `url` 回填 `brief.petPhotoUrl`/`cagePhotoUrl` 并即时渲染缩略图
- **外部依赖**：无三方；依赖内部 `api/project/[id]/upload` 路由
- **被谁调用**：`Field` 区块两处实例化（`petPhotoUrl` 第 468-475 行、`cagePhotoUrl` 第 477-484 行），均在 `page.tsx` 内
- **成熟度初判**：looks-working（有上传中态、错误态展示）
- **核心管线能力**：否（辅助输入，非生成链路必经步骤——brief 必填三项不含照片）

### 3. 生成 2D 方案（3 张场景图）触发 + 轮询

- **名称**：`generate()` / 生成中状态卡
- **入口**：`web/app/page.tsx:166-180`（触发），轮询逻辑 `web/app/page.tsx:112-126`
- **输入 → 输出**：点击「生成 2D 方案」→ POST `/api/project/[id]/scenes`（支持 `?mock=1`）→ 立即拉一次项目状态拿 generating 卡片 → 每 2s 轮询 GET `/api/project/[id]` 直到 3 张 ready
- **外部依赖**：无直接三方调用（转发给 `job-pipeline`/`external-clients` 分片，最终落到 fal.ai nano-banana，key 在根 `.env` 的 `FAL_KEY`，**已配置**，见证据 `.env` 内 `FAL_KEY=`（非空，长度 69））
- **被谁调用**：「生成 2D 方案」按钮 `web/app/page.tsx:490`
- **成熟度初判**：looks-working
- **核心管线能力**：是（PRD 漏斗第一步，2D 方案生成）

### 4. 画布内容渲染与内容真相源同步

- **名称**：`WorkbenchCanvas` / `syncItemsToCanvas`
- **入口**：`web/app/components/WorkbenchCanvas.tsx:501-545`（同步逻辑），组件挂载 `web/app/components/WorkbenchCanvas.tsx:307-375`
- **输入 → 输出**：`CanvasItem[]`（server 真相源）→ 增量在 tldraw store 创建 image shape（scene2d/item2d 用真实图，model3d 用占位缩略图 `mockup-assets/model3d-preview.jpg`）；`tldraw` snapshot 仅承载布局，600ms 去抖 PATCH 回 `/api/project/[id]`（`persistSnapshot`，`web/app/page.tsx:154-164`）
- **外部依赖**：`tldraw` npm 包（`^5.2.2`，已装，见 `web/package.json`），无外部服务/key
- **被谁调用**：`page.tsx:515`（`next/dynamic` 懒加载，`ssr:false`）
- **成熟度初判**：looks-working（专门处理了刷新恢复、React 渲染期改 store 的告警规避，CLAUDE.md 有专门约束记录）
- **核心管线能力**：是（画布是主工作台承载生成结果的唯一容器）

### 5. 画布标注工具（tldraw 自定义 StateNode）

- **名称**：`PetscapeAnnotationTool` / `PetscapeAnnotationIdle` / `PetscapeAnnotationPointing`
- **入口**：`web/app/components/WorkbenchCanvas.tsx:61-171`
- **输入 → 输出**：用户在画布上拖拽 → 创建固定红色箭头 shape + 可编辑富文本标签，用于在场景卡上做修改批注
- **外部依赖**：`tldraw` StateNode API，无外部服务
- **被谁调用**：注册进 `Tldraw` 组件的 `tools` prop（`web/app/components/WorkbenchCanvas.tsx:460`），工具栏按钮 `PetscapeToolbar`（`web/app/components/WorkbenchCanvas.tsx:196-223`）触发
- **成熟度初判**：looks-working
- **核心管线能力**：是（承载「按标注修改」这条 PRD 明确要求的交互）

### 6. 按标注修改（导出合成图 + 触发改图任务）

- **名称**：`exportAnnotatedScene` + `reviseSelected`
- **入口**：导出逻辑 `web/app/components/WorkbenchCanvas.tsx:392-413`；触发逻辑 `web/app/page.tsx:182-210`
- **输入 → 输出**：选中场景卡 + 标注箭头 → `editor.toImageDataUrl` 合成 PNG data URI + 拼接标注文字 → POST `/api/project/[id]/scenes/[sceneId]/revise`（`web/app/page.tsx:193-200`，支持 `?mock=1`）→ 新 generating 卡落画布
- **外部依赖**：转发给 job-pipeline，最终走 fal.ai `nano-banana/edit`（`FAL_KEY`，已配置）
- **被谁调用**：画布浮出按钮「✎ 按标注修改」（`web/app/page.tsx:533-539`，仅当 `selectedScene.hasAnnotations` 为真时渲染）
- **成熟度初判**：looks-working
- **核心管线能力**：是

### 7. 门 1：确认方案 + 指定物品名 → 进入 3D

- **名称**：`confirmGate1()`
- **入口**：`web/app/page.tsx:213-239`；UI 浮出条 `web/app/page.tsx:548-576`
- **输入 → 输出**：选中 ready 的 scene2d 卡 + 填写物品名 → POST `/api/project/[id]/gate1`（支持 `?mock=1`）→ 成功后本地 `viewState` 强制跳转 `tuning3d`（代码注释解释了为何不能只靠 server state diff 触发，见 `web/app/page.tsx:234-238`）
- **外部依赖**：转发 job-pipeline → fal edit 抠图 + Tripo `multiview_to_model`（`TRIPO_API_KEY` 已配置，长度 47）+ 挖腔脚本
- **被谁调用**：门 1 浮出条「确认方案，进入 3D →」按钮
- **成熟度初判**：looks-working
- **核心管线能力**：是（PRD 明确的门 1 硬裁决）

### 8. 3D 预览调参 / 门 2 覆盖层（ModelStudio）

- **名称**：`ModelStudio` 组件
- **入口**：`web/app/components/ModelStudio.tsx:28`
- **输入 → 输出**：`project.model3d` 状态 → 未 ready 时渲染进度卡（`web/app/components/ModelStudio.tsx:82-99`）；ready 后渲染 `<model-viewer>` + 右侧参数面板（尺寸滑块 80-160mm、材质色板、洞口直径锁定项说明）
- **外部依赖**：`@google/model-viewer` web component（`^4.3.1`，已装），动态 `import`（`web/app/components/ModelStudio.tsx:48`）；无外部服务 key（纯渲染层）
- **被谁调用**：`page.tsx:580`（`activeStep === 'tuning3d'` 时渲染）
- **成熟度初判**：looks-working
- **核心管线能力**：是

### 9. 材质/颜色实时渲染（scene-graph 改色，非几何）

- **名称**：颜色 `useEffect`（`hexToRgb01` + `pbrMetallicRoughness.setBaseColorFactor`）
- **入口**：`web/app/components/ModelStudio.tsx:52-74`，色板定义 `web/app/components/ModelStudio.tsx:13-18`
- **输入 → 输出**：点击材质 swatch → 更新 `modelConfig.color` → model-viewer scene-graph API 遍历所有材质设置 `baseColorFactor`（纯渲染层视觉反馈，不改几何/不影响实际打印材质）
- **外部依赖**：无
- **被谁调用**：`ModelStudio` 内部 `useEffect`，响应 `config.color` 变化
- **成熟度初判**：looks-working（组件注释明确标注"只做真实能力：不造假控件"，洞口直径显式标为锁定不可调，诚实边界清楚）
- **核心管线能力**：否（视觉糖，非打印产物必经）

### 10. 门 2：确认模型与参数 → 触发切片

- **名称**：`confirmGate2()`
- **入口**：`web/app/page.tsx:246-263`；确认按钮 `web/app/components/ModelStudio.tsx:244-251`
- **输入 → 输出**：当前 `modelConfig`（尺寸/颜色/材质）→ POST `/api/project/[id]/gate2`（支持 `?mock=1`）→ 轮询至 `slice.status === 'ready'` 展示下载区（STL/G-code）
- **外部依赖**：转发 job-pipeline → `web/scripts/normalize_mesh.py`（Y-up→Z-up 归一化）+ PrusaSlicer（本地二进制，非云 key）
- **被谁调用**：`ModelStudio` 内「确认模型与参数 ✓」按钮，及切片失败时的「重试切片」按钮（`web/app/components/ModelStudio.tsx:236-241`）
- **成熟度初判**：looks-working
- **核心管线能力**：是（PRD 门 2 硬裁决，产出最终可打印文件）

### 11. STL / G-code 下载

- **名称**：下载链接区
- **入口**：`web/app/components/ModelStudio.tsx:210-227`
- **输入 → 输出**：`slice.stlPath` / `slice.gcodePath`（server 生成的静态文件路径）→ `<a href download>` 直接触发浏览器下载
- **外部依赖**：无（静态文件由 job-pipeline 落盘到 `public/generated/{id}/`）
- **被谁调用**：`ModelStudio` 内切片 ready 分支
- **成熟度初判**：looks-working
- **核心管线能力**：是（漏斗终点交付物）

### 12. 步骤条 stepper（回退查看导航，B5 竖切）

- **名称**：`STEPS` 渲染 + `canReachStep` / `goToStep` / `viewState`
- **入口**：定义 `web/app/page.tsx:27-31`；渲染 `web/app/page.tsx:344-376`；逻辑 `web/app/page.tsx:299-331`
- **输入 → 输出**：点击已到达步骤 → 仅切换客户端 `viewState`（不改 server `userState`、不发 API）→ 驱动画布相机聚焦（`focusItemsOfKind`/`focusLatestItemOfKind`/`resetCamera`，`web/app/components/WorkbenchCanvas.tsx:414-451`）与右侧覆盖层显隐
- **外部依赖**：无
- **被谁调用**：header 内三个步骤按钮
- **成熟度初判**：looks-working（git commit `11792a7` "stepper back-navigation between reached workflow states (B5)" 为最新一条相关提交，逻辑自洽且有防止"确认了但没跳回3D"假回退的显式处理，见 `web/app/page.tsx:234-238` 注释）
- **核心管线能力**：否（导航体验，非生成链路必经）

### 13. 右栏 Agent 静默抽取 Chat

- **名称**：`sendChatMessage()` + 聊天气泡渲染
- **入口**：`web/app/page.tsx:265-292`（发送逻辑），渲染 `web/app/page.tsx:589-641`
- **输入 → 输出**：用户输入一句话 → POST `/api/project/[id]/agent/extract` → 抽取字段落表（`brief`）+ 返回 `reply` 文案上屏 + 刷新左栏 `missing` 提示
- **外部依赖**：转发 job-pipeline → `llm-agents` 分片的 `extract` agent → Codex SDK（另一分片证据范围，此处仅确认前端调用点存在）
- **被谁调用**：输入框 Enter 键 / 发送按钮 `web/app/page.tsx:632`
- **成熟度初判**：looks-working（CLAUDE.md 标注为「已落地」的生成前静默抽取器，区别于「售中重对话」——后者 PRD 明确标注"规划中未实现"，前端本模块不涉及后者）
- **核心管线能力**：是（PRD §5 明确的 Agent 两段式之一）

### 14. `?mock=1` 回归模式贯穿开关

- **名称**：`mockParam`
- **入口**：`web/app/page.tsx:67`（读取），透传点：`generate()` 第 170 行、`reviseSelected()` 第 194 行、`confirmGate1()` 第 221 行、`confirmGate2()` 第 251 行；`ModelStudio` 内 `mock` prop 展示提示 `web/app/components/ModelStudio.tsx:252`
- **输入 → 输出**：URL 带 `?mock=1` → 所有生成类 POST 请求附加同一 query → server 端对应路由走占位资产，不烧 fal/Tripo 额度
- **外部依赖**：无（本意就是绕过外部依赖）；但**依赖本地预置的 mock 资产文件**——已核实存在：`web/public/mockup-assets/mock-model.{glb,stl,gcode}`、`model3d-preview.jpg`、多张 `scheme-*.jpg`（`ls` 证据见上），CLAUDE.md 明确标注这些是 gitignored 大文件，新检出环境需手动预置，否则 mock 链会 ENOENT
- **被谁调用**：贯穿 `page.tsx` 全部生成类交互
- **成熟度初判**：looks-working（本地资产已核实存在，非悬空引用）
- **核心管线能力**：否（测试/开发基础设施，非产品能力本身）

### 15. Legacy 旧版 8 阶段聊天页（M1-M5 遗留）

- **名称**：`Home`（legacy）
- **入口**：`web/app/legacy/page.tsx:33`
- **输入 → 输出**：单页聊天式交互，POST `/api/session`（创建）→ 消息 POST `/api/session/[id]/message`（文本+可选图片）→ 轮询 GET `/api/session/[id]` 渲染消息流（含图片卡/`<model-viewer>` 3D 预览卡/切片结果卡）
- **外部依赖**：转发 `job-pipeline`/`external-clients`（Meshy 等，`MESHY_API_KEY` 已配置，长度 40），走独立的 `session` 数据模型（非 `project`）
- **被谁调用**：**orphan（在 app 内部）**——全项目 grep 未发现任何 `<Link>`/`router.push`/`href` 指向 `/legacy`；唯一命中是 `gate2Job.ts:9` 一句注释提及"复用 legacy sliceJob 的 normalize_mesh.py"，指的是代码复用关系，不是页面跳转。只能靠用户直接输入 URL `/legacy` 访问
- **成熟度初判**：looks-working 但**已冻结**——CLAUDE.md 明确写明「旧 8 阶段聊天页在 `web/app/legacy/page.tsx`：新功能加在工作台，不要动 legacy（保留可访问但已冻结）」。git log 显示其对应提交（`c8f58a5`~`f440a55`，M1-M5 系列）均早于当前工作台系列（B/T 系列commit），是被功能上取代、非当前活跃路径的历史实现
- **核心管线能力**：否（非当前产品叙事路径，纯历史保留）

### 16. Scene-lab 组合场景预览 demo（three.js）

- **名称**：`SceneLabViewer`
- **入口**：`web/app/scene-lab/page.tsx:11`（`next/dynamic` 包裹），实现 `web/app/scene-lab/SceneLabViewer.tsx:94`
- **输入 → 输出**：加载预烘焙的 `.norm.glb` 资产（定制件 + 2 个预置模块）→ three.js 场景渲染 + `OrbitControls` 自由视角 + 材质色板切换（clay 材质覆盖）+ 模块勾选显隐 + 笼箱线框（600×400×400mm 真实尺度）
- **外部依赖**：`three`（`^0.185.1`）、`@types/three`（已装）；静态资产依赖 `web/public/scene-lab-assets/*.norm.glb` + `*.meta.json`（已核实存在，`ls` 证据见上：`custom-item`/`module-climber`/`module-2` 三套齐全，均为 `Jul 4 15:36` 当日生成）；资产由根 `scripts/normalize_asset.py`（一次性烘焙，非 job-pipeline 触发）产出，此produce脚本不在本模块范围内（属 `geometry-native` 分片）
- **被谁调用**：**orphan（在 app 内部）**——全项目 grep 未发现任何页面链接到 `/scene-lab`；只能靠直接访问 URL `/scene-lab`
- **成熟度初判**：looks-working（git commit `41c4e1a` "scene-lab demo-grade — asset ingestion normalization + print-material preview (C2)" 为最新提交，CLAUDE.md 有专门的「组合场景预览」Learned Constraints 段落，记录了 Box3 归一化坑、React Strict Mode 双挂载坑等实测踩坑，说明经过真实调试验证而非空跑；资产文件当日新鲜生成，非陈旧遗留）
- **核心管线能力**：否——按 `_map.md` 与 CLAUDE.md 定位，这是「demo 用」的独立验证页，服务于黑客松演示而非当前产品主链路（主链路的组合场景展示接合点"挂起，待与 Max 对齐"）；但因其验证了「多定制件+模块共存渲染」这一 PRD 提及的能力方向，价值高于纯废弃代码，与 legacy 的"过时冻结"性质不同——建议标注为 **"demo-grade 独立验证页，非冻结，非当前主链接入点"**

### 17. Scene-lab 资产加载防御（React Strict Mode 双挂载 cancelled 标记）

- **名称**：`loadAsset` 内 `cancelled` 标记机制
- **入口**：`web/app/scene-lab/SceneLabViewer.tsx:118`（声明），应用于 `web/app/scene-lab/SceneLabViewer.tsx:168-210`
- **输入 → 输出**：dev 环境 React Strict Mode 下 `useEffect` 双挂载 → 通过 `cancelled` 布尔在所有异步回调入口短路，避免第一次挂载的失效闭包污染第二次挂载的真实场景
- **外部依赖**：无
- **被谁调用**：`SceneLabViewer` 内部初始化 effect（`web/app/scene-lab/SceneLabViewer.tsx:109-244`）
- **成熟度初判**：looks-working（CLAUDE.md 明确记录此坑是"截图对比抓到，纯代码审查看不出来"，即已有实测验证证据，非推测性防御代码）
- **核心管线能力**：否（工程健壮性细节，附属于能力 16）

---

## 汇总表

| # | 能力 | 入口 | 成熟度 | 核心管线 | 调用方 |
|---|---|---|---|---|---|
| 1 | Brief 表单真相源 | `page.tsx:35` | looks-working | 是 | Next 路由 `/` |
| 2 | 照片上传 | `page.tsx:704` | looks-working | 否 | `page.tsx` 内两处 |
| 3 | 生成2D方案触发+轮询 | `page.tsx:166` | looks-working | 是 | 「生成2D方案」按钮 |
| 4 | 画布内容同步 | `WorkbenchCanvas.tsx:501` | looks-working | 是 | `page.tsx:515` |
| 5 | 画布标注工具 | `WorkbenchCanvas.tsx:61` | looks-working | 是 | Tldraw `tools` prop |
| 6 | 按标注修改 | `WorkbenchCanvas.tsx:392` / `page.tsx:182` | looks-working | 是 | 画布浮出按钮 |
| 7 | 门1确认+进3D | `page.tsx:213` | looks-working | 是 | 门1浮出条按钮 |
| 8 | ModelStudio 3D调参覆盖层 | `ModelStudio.tsx:28` | looks-working | 是 | `page.tsx:580` |
| 9 | 材质/颜色渲染层改色 | `ModelStudio.tsx:52` | looks-working | 否 | swatch 点击 |
| 10 | 门2确认+触发切片 | `page.tsx:246` | looks-working | 是 | ModelStudio 确认按钮 |
| 11 | STL/G-code下载 | `ModelStudio.tsx:210` | looks-working | 是 | 切片ready分支 |
| 12 | Stepper回退导航 | `page.tsx:27,299-331` | looks-working | 否 | header步骤按钮 |
| 13 | Agent静默抽取Chat | `page.tsx:265` | looks-working | 是 | 右栏输入框 |
| 14 | `?mock=1` 回归开关 | `page.tsx:67` | looks-working | 否 | 贯穿全部生成交互 |
| 15 | Legacy旧8阶段聊天页 | `legacy/page.tsx:33` | looks-working（已冻结） | 否 | **orphan**（仅URL直达） |
| 16 | Scene-lab组合场景预览 | `scene-lab/SceneLabViewer.tsx:94` | looks-working（demo-grade） | 否 | **orphan**（仅URL直达） |
| 17 | Scene-lab双挂载防御 | `SceneLabViewer.tsx:118` | looks-working | 否 | 附属于#16 |

---

## 外部依赖 key 配置状态（核实自根 `.env`，仅报告是否非空，不输出明文）

| 服务 | env key | 状态 |
|---|---|---|
| fal.ai | `FAL_KEY` | 已配置（非空） |
| Tripo | `TRIPO_API_KEY` | 已配置（非空） |
| Meshy | `MESHY_API_KEY` | 已配置（非空） |

以上三个 key 均由本模块下游（api-layer → job-pipeline → external-clients）间接消费；前端展示层本身不直接持有任何 key（`falClient.ts` 的读取逻辑属于 `external-clients` 分片，此处仅作为「被消费方」交叉验证）。

## Half-done / dead-code 证据核查结果

- 全模块范围内 `grep TODO\|FIXME\|XXX` **零命中**。
- 未发现被注释掉的调用块或永远为 false 的 feature flag。
- 未发现悬空的 mock 资产引用（`mockup-assets/`、`scene-lab-assets/` 涉及的文件全部存在于磁盘）。
- 结论：本模块内目前**没有 half-done 证据**；两个 orphan 页面（legacy、scene-lab）不是"半成品"，而是"完整但未接入当前主导航"的独立页面——性质不同：legacy 是被主动冻结的历史实现，scene-lab 是刻意保持独立的 demo 验证页（CLAUDE.md 原文："组合场景预览" 接合点"挂起，待与 Max 对齐"，"不作为独立前台形态展示"）。

## 模块间边界确认（防止误判为本模块内能力）

- fal.ai / Tripo / Meshy 的实际 HTTP 调用代码不在本模块范围内（属 `external-clients` 分片：`web/app/lib/tripo/**`、`web/app/lib/meshy/**`、`web/app/lib/images/**`），本文档只确认前端发起的 API 路由调用点与轮询逻辑。
- `scripts/normalize_asset.py`（scene-lab 资产烘焙脚本）属 `geometry-native` 分片，不在本文档盘点范围，仅作为「本模块消费的静态产物来源」交叉引用。
- Codex SDK / LLM agent 内部实现属 `llm-agents` 分片，本文档仅确认 `page.tsx` 发起 `/api/project/[id]/agent/extract` 调用这一前端事实。
