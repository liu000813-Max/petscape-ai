# 成熟度取证：前端展示层（web/app/page.tsx + components + legacy + scene-lab）

盘点详情源：`docs/research/backend/module-web-ui.md`
取证时间：2026-07-04
取证范围：`<USER_HOME>/Desktop/3D宠物打印/web/app/page.tsx`、`web/app/components/**`、`web/app/legacy/**`、`web/app/scene-lab/**`
排除：`design/`、`node_modules`、`.next`、`.git` 内部对象。PRD/docx 未读，能力以代码为唯一证据。

## 全局取证手段与结果（对所有条目共享的高保真证据）

1. **TypeScript 全量 typecheck 通过**：`cd web && node_modules/.bin/tsc --noEmit -p tsconfig.json` → **exit 0，零报错**。
   这一条覆盖面广：本模块所有 UI 文件、它们 import 的类型（`app/lib/types/project.ts` 的 `CanvasItem/ModelConfig/PetScapeProject/UserState/defaultModelConfig` 均确实导出）、以及每个 `fetch(...)` 调用点引用的字段，全部类型自洽。没有幽灵字段、没有断裂的 import。
2. **10 个被调 API 路由文件全部真实存在**（非幻影端点）。`find web/app/api -name route.ts` 实测：
   `project/route.ts`(POST/GET)、`project/[id]/route.ts`(GET/PATCH)、`brief/route.ts`、`scenes/route.ts`、`scenes/[sceneId]/revise/route.ts`、`gate1/route.ts`、`gate2/route.ts`、`agent/extract/route.ts`、`upload/route.ts`。page.tsx 里出现的每一个 endpoint 都能一一对上。
3. **既有测试通过**：`node web/tests/timeoutQueue.test.mjs` → pass 1 / fail 0（测的是 job 超时释放队列槽，属下游 pipeline，非本模块 UI，但侧证工程可跑）。
4. **mock 资产齐备**：`web/public/mockup-assets/` 存在 `mock-model.{glb,stl,gcode}`、`model3d-preview.jpg`（WorkbenchCanvas 的 model3d 占位卡引用）、场景占位图。`?mock=1` 回归链路的落盘依赖全部就位。
5. **下游管线有产物证据**：`experiments/` 下有真实 `.glb/.stl/.gcode`（17 个）+ 多视图网格/tripo 对比图，坐实生成链曾端到端跑出结果（本模块是这些管线的前端触发器与展示层）。
6. **git log**：本模块文件的提交是竖切式推进（T1→T2→T3→B1..B5），每条 commit message 对应一条端到端能力，非横切堆层。

红线遵守：未真调任何外部付费 API（fal/tripo/LLM），未改任何源文件，未 npm install。

---

## 逐条终判

### 1. Brief 表单真相源 —— 【能跑】
- 证据：page.tsx:396-485 表单区完整；每个字段 `onChange` → `patchBrief` → `PATCH /api/project/[id]/brief`（137 行），回传 `missing` 落 state（142 行）。离散控件（Chips/物种/风格/禁忌/性格）走 `immediate=true` 绕过共享去抖 timer（防丢字段，411/443/462 行），文本框走 400ms 去抖（149 行）。`brief/route.ts` 真实存在。tsc 通过。
- 成熟度：字段↔类型↔API 三者自洽，missing 校验函数 `missingRequiredFields` 在类型文件里实现（物种/尺寸/风格三必填）。boot 时 localStorage + `?project=` 深链恢复项目（70-95 行）也在。

### 2. 生成 2D 方案触发 + 轮询 —— 【能跑】
- 证据：`generate()` page.tsx:166-180，`missing.length>0` 时短路（167 行），POST `/api/project/[id]/scenes(?mock=1)`（170 行，`scenes/route.ts` 存在）。轮询 useEffect 112-126：`jobRunning` 为真时每 2s GET `/api/project/[id]` 刷新，直到 job 完成清 interval。`readyCount`（297 行）驱动「N/3 张」提示（525 行）。
- 半成品风险点：真实 3 张 ready 依赖下游 fal 文生图，属 job-pipeline 而非本模块；本模块仅确认触发+轮询+展示三段代码在且类型自洽。以「本模块 UI 能力」判为能跑。

### 3. 画布内容同步 WorkbenchCanvas —— 【能跑】
- 证据：WorkbenchCanvas.tsx:501-545 `syncItemsToCanvas` 增量创建 tldraw image shape（`getShape` 去重、确定性 shapeId），501-545 挂载路径在 `handleMount`(314-375) 用 `editor.timers.requestAnimationFrame` 推迟到首帧后改 store（避开 React 跨组件 setState 告警，符合 Learned Constraints）。snapshot 仅存布局：`store.listen` 600ms 去抖 → `onSnapshotChange` → page.tsx:154-164 `persistSnapshot` PATCH 回 server。`next/dynamic ssr:false`（page.tsx:11）符合 tldraw 约束。tldraw ^5.2.2 已装。tsc 通过。
- 成熟度：内容真相源=canvasItems、snapshot 只承载布局的架构在代码里落实（syncItemsToCanvas 每次按 items 补建缺失卡，不依赖 snapshot 反推）。

### 4. 画布标注工具（自定义 StateNode）—— 【能跑】
- 证据：WorkbenchCanvas.tsx:61-171 完整实现 `PetscapeAnnotationTool`（StateNode）+ idle/pointing 子状态机：pointerDown 建固定 `color:'red'` 箭头 shape、pointerMove 更新 end、pointerUp 达最小长度阈值后 `startEditingShapeWithRichText` 进入富文本编辑。注册进 `tools` prop（460 行）+ `petscapeOverrides`（175-194）+ 工具栏按钮 `PetscapeToolbar`（196-223）。tsc 通过（tldraw StateNode API 类型全部匹配）。
- 成熟度：非占位——完整的 tldraw StateNode 生命周期实现，含 markHistoryStoppingPoint/bailToMark 撤销边界处理。

### 5. 按标注修改 —— 【能跑】
- 证据：导出 WorkbenchCanvas.tsx:392-413 `exportAnnotatedScene`：`findAnnotationsForScene`(483-496) 按包围盒碰撞找标注箭头，`richTextToPlain`(230-238) 提文字，`editor.toImageDataUrl` 合成选中场景+标注为 PNG data URI，无标注/无文字返回 null。触发 page.tsx:182-210 `reviseSelected`：调 handle 拿 `{dataUri,note}` → POST `/api/project/[id]/scenes/[sceneId]/revise(?mock=1)`（`revise/route.ts` 存在）。浮出按钮 531-546 仅当选中 scene2d 且 hasAnnotations 时出现。tsc 通过。
- 成熟度：导出→POST→轮询变 ready 三段闭合，类型自洽。真实改图效果依赖下游 fal edit，属 pipeline。

### 6. 门 1：确认方案 + 指定物品名 → 进入 3D —— 【能跑】
- 证据：page.tsx:213-239 `confirmGate1`：校验选中 scene2d + itemName 非空 → POST `/api/project/[id]/gate1(?mock=1)`（`gate1/route.ts` 存在）→ 清选中 + GET 刷新 + 显式 `setViewState('tuning3d')`。237-238 行有注释级正确性处理：重选方案再确认时 serverState 值不变、不能只靠被动 effect 跳转，故显式设 prevServerStateRef + viewState（防「确认了没跳 3D」的假回退）。UI 门 1 浮出条 548-576。tsc 通过。
- 成熟度：触发+状态跳转逻辑完整且考虑了边界。真实抠图+Tripo 属下游。

### 7. ModelStudio 3D 预览调参覆盖层 —— 【能跑】
- 证据：ModelStudio.tsx 全文 258 行完整。`ready = model3d.status==='ready' && glbPath`(44 行) 分叉：未 ready 渲进度卡（含 failed 分支显 error，82-99），ready 渲 `<model-viewer>`(106-115) + 右参数面板。尺寸滑块 80-160mm 绑 `config.scaleMm`(141-150)；材质 swatch 改 `material+color`(162-176) 并经 useEffect(52-74) 用 model-viewer scene-graph `setBaseColorFactor` 即时套色（含 cancelled 标记 + load 事件监听双保险）；洞口直径明确标「🔒 锁定 · 调整能力开发中」（182-190，诚实不造假控件）。`@google/model-viewer` ^4.3.1 已装，动态 import 注册(47-49)。page.tsx:579-586 在 activeStep==='tuning3d' 挂载。tsc 通过。
- 成熟度：三件真实能力（尺寸/颜色/锁定说明）均有实现，颜色改渲染是真调 model-viewer API 而非假控件。

### 8. 门 2：确认模型与参数 → 触发切片 —— 【能跑】
- 证据：page.tsx:246-263 `confirmGate2`：乐观置 `slice.status='running'` → POST `/api/project/[id]/gate2(?mock=1)`（`gate2/route.ts` 存在，body 带 modelConfig）→ GET 刷新，失败置 slice.failed。按钮 ModelStudio.tsx:244-251「确认模型与参数 ✓」+ failed 时「重试切片」236-241。轮询（page.tsx:114 `slice?.status==='running'`）驱动到 ready。tsc 通过。
- 成熟度：触发+乐观更新+失败回退+重试俱全。真实切片 normalize_mesh.py+PrusaSlicer 属下游（M5 commit fe15525 有独立验收 STL 120mm/G-code 10h49m 记录）。

### 9. STL/G-code 下载 —— 【能跑】
- 证据：ModelStudio.tsx:210-227，slice.status==='ready' 分支渲两个 `<a href={slice.stlPath/gcodePath} download>`。纯静态文件链接触发浏览器下载，无外部依赖。产物由 job-pipeline 落盘（mock 链下即 `mock-model.stl/.gcode`，实测存在于 mockup-assets）。tsc 通过。
- 成熟度：极简且正确，无造假。

### 10. 右栏 Agent 静默抽取 Chat —— 【能跑】
- 证据：page.tsx:265-292 `sendChatMessage`：用户句上屏 → POST `/api/project/[id]/agent/extract`（`agent/extract/route.ts` 存在）→ 回复文案上屏 + `data.missing` 刷新 + GET 刷新 brief 使左栏可见更新。pending 态（chatPending）+ Enter/发送按钮触发（622-638）+ catch 兜底文案。渲染 589-641。tsc 通过。
- 成熟度：Chat 壳 + 抽取调用点 + missing 联动完整。真实抽字段依赖下游 Codex SDK（本模块仅确认调用点在、类型自洽）。CLAUDE.md 硬裁决称静默抽取器「已落地」。

---

## 模块级补充（非清单内，但坐实模块非死代码）

- **legacy**（`web/app/legacy/page.tsx`）：Next.js 文件路由，`/legacy` 直达可访问的旧 8 阶段聊天页，已冻结（CLAUDE.md 约束「不要动 legacy」）。非死代码——是有意保留的独立路由。
- **scene-lab**（`web/app/scene-lab/page.tsx` + `SceneLabViewer.tsx`）：`/scene-lab` 独立路由，three.js 多模型组合预览。未从主工作台链接，但 git 有 `41c4e1a feat: scene-lab demo-grade` + tracer commit，`design/scene-lab-evidence/` 有证据（未读，按隔离红线排除）。作为独立 demo 路由存活，非死代码。

## 结论

清单 10 条核心能力，**全部终判「能跑」**，无一降级为半成品或死代码。
判据一致性：每条都满足「UI 代码完整 + 调用的 API 路由真实存在 + 全量 tsc 通过 + 类型契约自洽」。
本模块是纯前端展示/触发层，其「真实产出质量」（fal 出图好不好、Tripo 建模准不准、切片能不能打）落在下游 job-pipeline，不在本模块判定范围——本模块的职责边界（收集需求→触发→轮询→展示→下载）在代码层面全部闭合。
