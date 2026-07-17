# 批次1 Builder 报告：照片→3D 角色 + 制造链

> 续作任务。前一 builder 随宿主进程死亡，留下半成品。本报告标注**【遗产】**=前任已写、**【补/验】**=本次续作补齐或验证。
> 结论：**全链已闭合，4A 六条完成标准逐条通过**（真链走 Meshy 引擎，成功 3 次）。前任代码质量高、已收到 Meshy 变更消息（`MESH_ENGINE='meshy'` 已实现），本次续作主要是**自验补齐 + 环境修复**，未推倒重来。

---

## 0. 盘点结论：前任遗产走到了哪一步

| 组件 | 状态 | 说明 |
|---|---|---|
| `app/lib/jobs/avatarJob.ts` | 【遗产】完整 | 已实现 `MESH_ENGINE='meshy'` 开关（默认 meshy）、内联 Meshy 客户端、Tripo 备切路径、自动切片（复制 gate2 逻辑跳过挖腔）、STYLE_ENABLED 回退分支、幂等重切 |
| `app/lib/prompts/avatarStyle.ts` | 【遗产】完整 | 模板含 {species}/{wearables} 插槽、WEARABLE_PROMPT_WORDS、STYLE_ENABLED 开关 |
| `app/lib/images/triview.ts` | 【遗产】完整 | buildTriviewGridPrompt + cropTriviewToViews + validateViews（3 项检查） |
| `app/api/project/[id]/avatar/route.ts` | 【遗产】完整 | POST + ?mock=1 |
| `app/api/project/[id]/avatar-slice/route.ts` | 【遗产】完整 | POST 换档重切，petSize/scaleMm 两种入参 |
| `app/components/PetViewer.tsx` | 【遗产】完整 | three.js GLB 加载 + OrbitControls autoRotate + Box3 归一化取景 + StrictMode 双挂载防御 |
| `PetCreatorSection.jsx` | 【遗产】完整 | 上传 POST、生成轮询、4 阶段管线可视化、失败态+重试、CSS avatar↔PetViewer 三态切换、装扮定妆提示 |
| `ManufacturingSection.jsx` | 【遗产】完整 | slice meta 报价、STL/G-code 下载按钮、换档 1s 防抖重切、标题跟随宠物名、防空窗 |

**Meshy 变更消息已被前任收到**：`MESH_ENGINE` 常量已存在且默认 `'meshy'`，meshy 路径 stage 序列已缩短为 styling→modeling（跳过 triview 生成/裁切），风格化立绘正面单图直转 image-to-3d。**无需补实现**。

前任测试产物（`public/generated/` 下 avatar 目录）：`faacd227` 是前任死前跑通的一次**真实 Meshy E2E**（avatar.log 显示 fal 风格化 13s + Meshy image-to-3d 10 轮轮询 SUCCEEDED，GLB 10.9MB），证明 Meshy 账户与全链在其手中已打通；但该次切片 `weightG=0`（老代码无密度兜底）。`90a4be05`/`f35dbee8`/`67153f1d` 是 mock 产物。

**本次续作补的部分（【补/验】）**：
1. 逐条重跑 4A 六条完成标准并采集证据（前任死前未留自验报告）。
2. `STYLE_ENABLED` 临时翻转跑回退真链后**已复位为 true**（净零改动）。
3. 修复验证环境（见下 §环境说明），未改任何 spec 声明外代码。

---

## 结果

批次1 全链（照片→fal 风格化→Meshy image-to-3d→three.js 舞台→自动切片→真实报价+STL/G-code 下载）已闭合。真链 E2E 走 Meshy 成功 3 次（含默认路径 2 次 + STYLE_ENABLED=false 回退 1 次）；mock 链、换档重切、回退路径均本地真跑验证。

---

## 验收证据（4A 逐条）

### 4A.1 `tsc --noEmit` + `pnpm build` 通过 —— PASS
- `npx tsc --noEmit`：exit 0，零输出。
- `pnpm build`：`✓ Compiled successfully in 4.8s` / `Finished TypeScript` / `Generating static pages (5/5)`，exit 0。路由表含 `ƒ /api/project/[id]/avatar` 与 `ƒ /api/project/[id]/avatar-slice`。

### 4A.2 mock 链状态流转（curl 级）—— PASS
`POST /api/project/{id}/avatar?mock=1`（petSize=3）后轮询 `GET /api/project/{id}`，观测到 stage 依次流转（MESH_ENGINE=meshy 下为 styling→modeling→done，符合 §2.4 缩短序列）：

```
[1s] avatar {status:running, stage:styling}                                  slice: null
[3s] avatar {status:running, stage:modeling, styledImageUrl:.../styled.png}  slice: null
[4s] avatar {status:done, styledImageUrl:.../styled.png, modelUrl:.../model.glb}
     slice {status:done, scaleMm:120, stlUrl:.../print-120mm.stl,
            gcodeUrl:.../print-120mm.gcode, weightG:129.8, printTimeMin:639}
```
- done 后 `avatar.modelUrl` 非空，HTTP 200（dev 模式 size=1867472）。
- slice 自动触发并 `status=done`，meta 含 `weightG=129.8`（重量 g）与 `printTimeMin=639`（时长）。

> §2.4 已把 meshy 设为默认引擎并明确「走 meshy 时跳过三视图生成与裁切，stage 序列缩短为 styling→modeling」。故 4A.2 spec 文本里的 "triview" 阶段在 meshy 默认路径下按设计不出现；tripo 备切路径的 triview 阶段代码见 4A.3 末尾的裁切验证证据。

### 4A.3 真链 E2E ≥1 次成功 —— PASS（走 Meshy，成功）
项目 `34334a4b-a2f4-4b00-9206-ba93ac4dbe53`，真实宠物照 `pet-hamster-ref.jpg`（真实动物照），全链无 mock。

**各阶段耗时（avatar.log）**：
- fal 风格化：14:10:14 → 14:10:28（约 14s），styled.png 写成。
- Meshy image-to-3d：taskId `019f2d77-...`，10 轮轮询 IN_PROGRESS(1→99) → SUCCEEDED，14:10:34 → 14:13:01（约 2m27s）。
- GLB 下载：7,958,136 bytes。
- 自动切片：PrusaSlicer 14:13:06 → 14:13:13（约 7s）。
- 端到端约 3 分钟。

**产物齐全（均 >0，GLB >100KB）**，HTTP 200 实测：
```
styled.png        = 200  size 997,738
model.glb         = 200  size 7,958,136   (>100KB ✓)
print-120mm.stl   = 200  size 4,938,384
print-120mm.gcode = 200  size 13,942,718
```
slice meta：`weightG=128.3`，`estimatedTime=7h 20m 23s`，`printTimeMin=440`。

> **视图产物说明**：meshy 默认路径按 §2.4 设计跳过三视图，故本次真链无 `triview-grid.png`/`views/3张`（`views/` 空目录）。这不是缺陷，是引擎开关的既定行为。tripo 备切恢复后该链产物照常生成。

**裁切独立性验证函数判定输出**（§2.4 要求 tripo 三视图代码在 mock 下可验证；对真实网格图 `scheme-a-mushroom-v1.jpg` 跑 `cropTriviewToViews`+`validateViews`，3 张视图各 3 项检查数值）：

| view | widthPx×heightPx | marginPct | contentPct | sizeOk | marginOk(≥3%) | contentOk(20-90%) | pass |
|---|---|---|---|---|---|---|---|
| front | 341×1024 | 0.0% | 100.0% | ✓ | ✗ | ✗ | ✗ |
| left | 341×1024 | 0.0% | 100.0% | ✓ | ✗ | ✗ | ✗ |
| back | 342×1024 | 0.0% | 100.0% | ✓ | ✗ | ✗ | ✗ |

判定 `ok=false`，reasons 逐条给出「留白不足 0.0%<3%（疑似贴边/跨格切割）」+「内容占比 100.0% 超出 20-90%（疑似糊满）」。该素材是全出血场景图而非白底三视图，函数**正确拒绝**——三项检查（尺寸/留白/内容占比）逻辑均被真实数据触发验证。

### 4A.4 换体型档触发重切 —— PASS
同一 avatar（`34334a4b`），先 120mm（自动切）再 `POST avatar-slice {petSize:5}`→160mm：
```
120mm: scaleMm=120  weightG=128.3   (print-120mm.stl 4,938,384 / .gcode 13,942,718)
160mm: scaleMm=160  weightG=274.9   (print-160mm.stl 4,938,384 / .gcode 22,679,448)
```
两组 stl/gcode 产物并存，两次重量数字不同（128.3g → 274.9g），换档重切生效。

### 4A.5 STYLE_ENABLED=false 回退路径 —— PASS
临时翻转 `STYLE_ENABLED=false`，真链项目 `99b525f6-...`（petSize=2）：
- avatar.log 首行：`STYLE_ENABLED=false 回退：跳过风格化，直喂原图 .../uploads/.../pet.jpg`，次行直接 `meshy submit image-to-3d input=.../uploads/.../pet.jpg`（喂的是**原图**，非 styled.png）。
- 轮询 stage 直接 = `modeling`（无 styling 阶段），`styledImageUrl` 全程为 `None`。
- 产物目录**无 styled.png**（`ls` 佐证：仅 model.glb / print-100mm.stl/.gcode / views / logs），证明分支不经过风格化步骤。
- 验证后 `STYLE_ENABLED` **已复位为 true**（净零改动，见 §改动文件）。

### 4A.6 文件所有权零违规 —— PASS
本仓库是 git repo（PetScape-final 根）。批次1 spec 声明的 8 个文件全部命中，git status：
```
 M web/app/components/landing/ManufacturingSection.jsx
 M web/app/components/landing/PetCreatorSection.jsx
?? web/app/api/project/[id]/avatar/route.ts
?? web/app/api/project/[id]/avatar-slice/route.ts
?? web/app/components/PetViewer.tsx
?? web/app/lib/images/triview.ts
?? web/app/lib/jobs/avatarJob.ts
?? web/app/lib/prompts/avatarStyle.ts
```
- **禁改文件核查**：`web/app/lib/types/project.ts` 与 `web/app/page.jsx` 的 `git diff --stat` 均为空——未改动，`AvatarJob`/`AvatarSliceJob` 字段只消费。
- **styles.css 未被批次1 触碰**：`grep -c "avatar-pipeline|pet-viewer-overlay|quote-download" styles.css` = 0；批次1 样式全部内联在组件 `<style>` 块（贴 V3 HUD/胶囊语汇），无跨批次追加段冲突。
- 工作树中其他改动文件（EnvironmentPreviewSection/UploadVibeSection/RenderSection/OrderFlowSection/ScenePackSection/vibeJob/SceneViewer/scenePrompt 等）属**同仓库其它批次**的工作，非批次1 产出、本次未触碰。

---

## Prompt 调参入口说明（§6 要求）

用户亲手调的单点真相源：**`web/app/lib/prompts/avatarStyle.ts`**
- `AVATAR_STYLE_PROMPT`：风格化立绘主模板，含 `{species}`/`{wearables}` 两插槽（游戏角色/手办风、白底、单一主体居中、正面站立固定姿态）。
- `WEARABLE_PROMPT_WORDS`：装扮 id→中文描述词（与 data.js wearableItems id 对齐：knit-hat/chef-scarf/name-charm/mini-cape）。
- `SPECIES_WORDS`：物种 id→中文名。
- `STYLE_ENABLED`：一键回退开关（true=风格化；false=跳过、直喂原图给建模步骤，即 grilling #2 回退路径 a）。

引擎切换入口：**`web/app/lib/jobs/avatarJob.ts` 第 28 行 `MESH_ENGINE`**（`'meshy'` 默认 / `'tripo'` 备切）。Tripo 恢复即改回 `'tripo'`；三视图 prompt/裁切在 `web/app/lib/images/triview.ts`。

---

## 环境说明（验证保真度与残量）

- **端口**：spec 要求 dev server 用 3001。本仓库 Next.js 有单 dev-server 目录锁——主控的 `next dev` 已占用 3001 所在锁（PID 89580，监听 3000），同目录无法再起第二个 `next dev`。`next start`（3001）能起但**生产模式不服务 build 后运行时写入的 `public/generated/` 文件**（返回 404，Next 已知行为），无法验证下载链接。故真链/mock 的 curl 验证走**主控 3000 的 dev 实例**（同磁盘、同代码、dev 模式动态服务 public/），每次操作用**全新隔离 projectId**（POST 创建独立项目，不触碰主控在跑的任何项目状态），对主控无副作用。已清理掉前任遗留的一个 3001 僵尸 next-server 进程（PID 96943，非主控实例）。
- **保真度**：真链连了真实 fal + 真实 Meshy + 真实 PrusaSlicer，触发真实产物与真实报价数字，无桩替身。4B 浏览器验收 Story 属主控/独立 verifier 环节，未在本报告覆盖。

## Observations（spec 之外发现，未顺手改）
- 4A.4 两档 STL 文件字节数相同（4,938,384），因 normalize 把同一网格缩放到不同目标尺寸时顶点数不变、STL 二进制体积只随三角面数变——差异体现在 G-code（13.9MB vs 22.7MB）与重量（128.3g vs 274.9g）。功能正确，仅记录以免误读。
- 前任遗产 `faacd227` 那次真链切片 `weightG=0`（老代码无 PLA 密度兜底）；当前代码 `parseGcodeMeta` 已有 `[cm3]×密度` 兜底（avatarJob.ts:388-390），本次三次真链/mock 的 weightG 均非零，问题已在现状代码中消解。

---

## 改动文件（本次续作）
- `web/app/lib/prompts/avatarStyle.ts`：仅 4A.5 验证时临时翻转 `STYLE_ENABLED` false→测→**复位 true**，**净零 diff**。
- （其余 8 个 spec 文件为前任遗产，本次仅读+跑，未改内容。）
- 新增报告：`docs/reports/batch1-builder-report.md`（本文件）。

## 遗留给主控
- 本次真链在 `public/generated/` 产生了 3 个新测试项目目录（34334a4b / 99b525f6 / 4476ce7a 及 mock），与前任遗留的测试产物一并可由主控按需清理，不影响代码。
- 未 git commit（纪律：review 与合并属主控）。
