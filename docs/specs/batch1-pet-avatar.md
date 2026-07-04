# 批次1 Spec：照片→3D 角色 + 制造链（切片报价/下载）

> 上游依据：`../integration-mapping.md`（grilling #2/#3/#4/#5）。前置：批次0 已验收、接驳层已冻结（App 提供 `projectId` 与全量 state props）。
> 文件所有权（并行纪律）：本批次只改/新建下列文件——`app/components/landing/PetCreatorSection.jsx`、`ManufacturingSection.jsx`、`app/components/PetViewer.tsx`（新建）、`app/api/project/[id]/avatar/**`（新建）、`app/api/project/[id]/avatar-slice/**`（新建）、`app/lib/prompts/avatarStyle.ts`（新建）、`app/lib/images/triview.ts`（新建）、`app/lib/jobs/avatarJob.ts`（新建）。**`app/lib/types/project.ts` 已由接驳层预铺 `AvatarJob`/`AvatarSliceJob` 字段（avatar/avatarSlice），只消费、禁改**；`app/page.jsx` 已注入 projectId/mockMode/onAvatarGeneratedChange props，禁改。**不改其它 landing 组件、不改老 gate1/gate2 现有行为（workbench 还在用）。不执行任何 git 操作——完成后报告，由主控统一 commit。** 验证用自己起的 dev server（端口 3001），不动主控在 3000 维护的实例。需要越界改动时停下，在报告中提出，等主控裁决。

## 1. 任务

打通「上传宠物照 → fal 风格化 → 3 视图 → Tripo 图生3D → three.js 舞台展示 → 自动切片 → 真实报价 + STL/G-code 下载」全链，含管线阶段可视化 loading 与 `?mock=1` 全链 mock。

## 2. 管线设计（后端）

新建 `avatarJob.ts`（参考 `gate1Job.ts` 的 job 结构/状态回写/withTimeout 模式）：

1. **风格化**（fal edit，输入=用户宠物照）：prompt 来自 `app/lib/prompts/avatarStyle.ts` ——**这是用户要亲手调的文件**，结构：
   ```ts
   export const AVATAR_STYLE_PROMPT = `...游戏角色/手办风格、白底、单一主体居中、正面站立固定姿态...`  // 模板，含 {species}/{wearables} 插槽
   export const WEARABLE_PROMPT_WORDS: Record<string, string> = { 'knit-hat': '戴着红色针织帽', ... }  // 与 V3 wearableItems id 对齐
   export const STYLE_ENABLED = true  // 一键回退开关：false = 跳过风格化直喂原图（grilling #2 的回退路径 a）
   ```
   已选装扮 id 由前端随请求传入，拼进 prompt。
2. **3 视图网格**（fal edit）：新建 `buildTriviewGridPrompt`（`app/lib/images/triview.ts`，参考 `multiviewPrompt.ts` 的单点真相源风格）——1×3 横排（front/left/back），与裁切约定对齐。**不改老的四视图函数**。
3. **裁切 + 独立性验证**：`cropTriviewToViews`（sharp，1×3 等分）+ `validateViews`：每张检查 ① 尺寸正确 ② 四边留白 ≥3%（主体没贴边=没跨格切割）③ 内容占比 20-90%（非空白格/非全图糊满）。不合格 → 回到步骤 2 重生成（最多 2 次，仍失败则 job 失败并给出诊断信息）。
4. **3D 引擎步（2026-07-04 用户拍板：Meshy 兜底先跑）**：Tripo 余额耗尽且不充值，本步做成**引擎开关**（`avatarStyle.ts` 或独立配置常量 `MESH_ENGINE: 'meshy' | 'tripo'`，当前默认 `meshy`）：
   - **meshy 路径（当前默认）**：风格化立绘（正面单图）直接提交 **Meshy image-to-3d**——参考老仓库 `web/app/lib/meshy/client.ts`（submitImageTo3d/getImageTo3d/pollTask/glbUrlFrom，验收通过过的实现；`MESHY_API_KEY` 老仓库 .env 有）。走 meshy 时跳过三视图生成与裁切（stage 序列相应缩短为 styling→modeling）。
   - **tripo 路径（保留备切）**：三视图 front/left/back 提交 `submitMultiviewToModel`（四槽位 right 传 null/省略），轮询沿用 `pollTask` 容错，model_version=v3.0-20250812（v3.1 本账户不存在，code=2017 实测）。三视图+裁切验证代码照常实现（mock 下可验证），Tripo 恢复即切回。
5. **产物落盘**：`public/generated/{projectId}/avatar/`：styled.png、triview-grid.png、views/、model.glb。project 状态追加 `avatar: {status, stage, styledImageUrl, modelUrl, error}`，stage ∈ styling/triview/modeling/done（供前端阶段可视化）。
6. **自动切片**：avatar done 后自动触发 `avatar-slice`（新路由+job，**复制 gate2Job 的 normalize→PrusaSlicer→parseGcodeMeta 逻辑改造，跳过挖腔、直接吃 avatar 的 model.glb**）。`scaleMm` = 体型档位映射（1-5 → 80/100/120/140/160）。产物：print-{mm}.stl/.gcode + meta（重量 g、时长、体积）。换档重切：前端 1s 防抖调用，job 幂等（同 mm 已有产物直接返回）。
7. **mock 模式**：`?mock=1` 时全链走预置资产（`public/generated/9709946e-*/` 有现成 GLB/STL/G-code；风格化/三视图阶段用 mockup-assets 或该产物链的图，延时 1-2s 模拟阶段推进）。

## 3. 前端（PetCreatorSection + ManufacturingSection）

- **上传（F16）**：现有 `<input type=file>` 追加真实 POST `/api/project/[id]/upload`（kind=pet），保留本地即时预览不变。
- **生成按钮（F21）**：点击 → POST avatar（body: 已选装扮 ids、物种、体型档）→ 轮询 project（沿用 workbench 2s 轮询模式）。按钮态：生成中 disabled。
- **loading 阶段可视化（grilling #4）**：舞台上叠阶段进度（"风格化立绘 → 生成三视图 → 3D 建模中 → 切片报价"，当前阶段高亮 + 已完成打勾；风格化完成后可先展示 styled.png 作中间反馈）。样式贴 V3 现有语汇（styles.css 的 HUD/徽标风格），不引入新设计语言。
- **失败态**：job 任一阶段失败（avatar.status=failed）→ 舞台显示简短失败提示 + "重试"按钮（重新 POST avatar），不白屏、不卡永久 loading；按钮恢复可点。
- **舞台（F17）**：avatar done 后，CSS avatar 替换为 `PetViewer`（新建 three.js 组件，参考老 `scene-lab/SceneLabViewer.tsx` 的 GLB 加载/灯光/OrbitControls/双挂载防御；轨道控制取代旋转滑块 F20——滑块在 GLB 态隐藏）。生成前保持 V3 原 CSS avatar 一切不变。
- **报价面板（F43）**：ManufacturingSection 接 props（slice meta）——重量、打印时长、按材料单价算出的价格区间替换写死数字；标题改"{petName} 的专属模型"（写死"森林奶酪屋套装"文案退场）；**STL / G-code 下载按钮**（`<a download>`，slice ready 才亮，样式复用现有按钮）。slice 未就绪时显示 V3 原写死内容（防空窗）。
- 装扮定妆叙事：生成后切换装扮勾选时，在装扮区提示"重新生成以应用新装扮"（复用现有徽标/文案风格）。

## 4. 完成标准

### 4A. builder 自验（每条附证据）

1. `npx tsc --noEmit` + `pnpm build` 通过。
2. **mock 链状态流转**（curl 级）：`?mock=1` 触发 avatar 后，轮询 project JSON 依次观测到 `avatar.stage` = styling → triview → modeling → done（贴各阶段 JSON 摘录）；done 后 `avatar.modelUrl` 非空且该 URL 返回 200；slice 自动触发并最终 `slice.status=done`，meta 含重量(g)与时长字段。
3. **真链 E2E 至少 1 次成功**：真实宠物照（老仓库 uploads 或 assets 找一张）走完全链，产物文件齐（styled.png/triview-grid.png/views/3张/model.glb/print-{mm}.stl/.gcode 均 >0 且 glb >100KB），报告附各阶段耗时与产物路径。**裁切验证函数对本次 3 张视图的判定输出必须贴进报告**（3 项检查各自的数值与通过判定）。
4. 换体型档触发重切：对同一 avatar 先后请求 120mm 与 160mm → 两组 stl/gcode 产物并存，两次 meta 的重量数字不同（curl 证据）。
5. `STYLE_ENABLED=false` 回退路径：mock 或真链下走通一次，证明分支不经过风格化步骤（日志/产物目录无 styled.png 佐证）。
6. 文件所有权零违规：`git diff --stat` 只含 § 头部声明的文件。

### 4B. 验收 Story（主控/独立 verifier 浏览器执行；自包含断言）

1. **mock 全流程**：访问 `/?mock=1` → 创建器上传任意本地图片 → 点"生成 3D 可旋转预览" → 按钮立即 disabled，舞台出现阶段进度（4 阶段依次高亮、已完成打勾，全程 ≤10s）→ 舞台变为 three.js canvas，鼠标拖拽可 360° 旋转模型 → 报价面板标题含当前宠物名（改名后重看标题跟随），显示"重量 N g"与打印时长，"下载 STL""下载 G-code"两按钮可点且 href 返回 200。
2. **换档重切**：体型滑块 3→5 → 1 秒内报价面板出现"计算中"态 → 数秒后重量数字变大（160mm > 120mm）。
3. **装扮定妆**：勾选装扮后生成 → 生成期间/完成后切换装扮勾选 → 装扮区出现"重新生成以应用新装扮"提示；再点生成按钮可重新走链。
4. **失败态**：断网或 mock 注入失败（实现方定义的失败注入方式写进报告）→ 舞台显示失败提示与"重试"入口，不白屏、不卡永久 loading。
5. **生成前视觉不变**：未点生成时，创建器区与批次0 验收时的截图一致（CSS avatar、转盘、HUD 原样）。

## 5. 不要做

- 不做实时换装/挂点（批次1b）。不动 vibe/环境预览/场景包区。
- 不删不改老 gate1/gate2/workbench 行为。
- 真链验证成功 1 次即停，不反复烧 Tripo 额度。
- 不改 avatarStyle.ts 之外的任何 prompt 文件。

## 6. 产出

- 报告：`docs/reports/batch1-builder-report.md`（完成标准逐条证据 + 真链产物路径 + prompt 调参入口说明）。
- stdout ≤200 字。未达标 → `INCOMPLETE:`。

## 7. 档位

opus（管线编排+three.js+真实 API，首派即高档）。
