# 批次3 Builder 报告（续作：接手半成品）

## 结果

前一个 builder 已完成大部分工作（SceneViewer.tsx 完整实现、assetIndex.ts 骨架、EnvironmentPreviewSection/ScenePackSection/OrderFlowSection/data.js 全部接线完成），但当时批次A 真资产未到位，用的是老仓库 scene-lab 3 个占位 GLB。

本次续作的核心工作：批次A 的 5 个真实 GLB（Meshy 生成，`assets-3d/modules/{id}/raw.glb`）已到位，我用 `tools/bake-assets/normalize_asset.py`（前任已建好、未使用过）逐一归一化（目标高度按模块类型分级：床类 100mm、垫类 80mm、攀爬类 120mm、层板类 60mm），烘焙产物落 `web/public/scene-assets/`，并重写 `assetIndex.ts` 让 5 个模块从 `placeholder: true` 占位映射切到真实产出。`starry-hideout`（批次A 未产出该模块）保留老仓库占位，其余 7 个模块维持 billboard。SceneViewer/接线代码本身零改动（前任的 assetIndex 抽象设计已经做到"资产到位后只换表项，代码零改动"）。

## 前任遗产 vs 本次新增

| 文件 | 归属 |
|---|---|
| `SceneViewer.tsx`（three.js 场景，双挂载防御/GLB+billboard 混合渲染/宠物位） | 前任完整实现，本次未改动 |
| `EnvironmentPreviewSection.jsx`（F31 接线 + F46 报价明细） | 前任完整实现，本次未改动 |
| `ScenePackSection.jsx`（F42 场景包假闭环按钮） | 前任完整实现，本次未改动 |
| `OrderFlowSection.jsx`（F47 订单条推导） | 前任完整实现，本次未改动 |
| `data.js` 场景包 `moduleIds` 常量 | 前任已加，本次未改动 |
| `tools/bake-assets/normalize_asset.py` | 前任已建（脚本本身未跑过真资产） |
| `assetIndex.ts` | 前任建骨架（3 占位映射）；**本次重写为 5 真实 + 1 占位 + 7 billboard** |
| `web/public/scene-assets/*.norm.glb`（5 个真资产） | **本次新增/替换**（cheese-lounge-bed、hanging-climb-baskets 从占位换真实；banana-bed、banana-layer-pad、cheese-play-mat 新增） |
| `web/public/scene-assets/starry-hideout.*` | 前任遗产，本次保留不动（批次A 未产出该模块真资产） |

## 验收证据

### 5A-1：`npx tsc --noEmit` + `pnpm build` 通过
```
tsc: PASS (exit 0)
pnpm build: EXIT 0（Turbopack 编译成功，仅 1 条与本批次无关的 pre-existing 警告：
  ./next.config.ts → app/lib/images/falClient.ts（批次A/批次2 文件，非本批次所有权））
```

### 5A-2：资产烘焙产物（5 个 .norm.glb + meta.json，全部 >50KB）
```
cheese-lounge-bed:       glb=3,503,856 bytes  meta=exists
banana-bed:              glb=3,503,696 bytes  meta=exists
banana-layer-pad:        glb=4,146,472 bytes  meta=exists
hanging-climb-baskets:   glb=3,714,416 bytes  meta=exists
cheese-play-mat:         glb=3,441,712 bytes  meta=exists
```
`assetIndex.ts` 覆盖清单（13/13）：
- glb（真实，placeholder:false）：cheese-lounge-bed / banana-bed / banana-layer-pad / hanging-climb-baskets / cheese-play-mat
- glb（占位，placeholder:true）：starry-hideout（批次A 未产出，借用老仓库 scene-lab 资产）
- billboard：vine-foraging-tray / cheese-storage-tower / sunny-climb-station / hanging-z-ladder / star-bridge-hide / mushroom-climb-tree / spiral-star-perch

### 5A-3：`data.js` 场景包子集常量，差集为空
```
森林奶酪屋: count=4 diff=[]
都市基地:   count=3 diff=[]
雨林树屋:   count=4 diff=[]
```

### 5A-4：文件所有权零违规
```
git diff --stat（所有权范围内 4 个可改文件）：
 EnvironmentPreviewSection.jsx | 108 ++++++++++++++
 OrderFlowSection.jsx          |  64 +++++++
 ScenePackSection.jsx          |  10 +-
 data.js                       |   8 +-
```
未追加改动到 page.jsx、SceneLabViewer.tsx、PetViewer.tsx 或其他批次文件。新建文件均在授权范围内：`SceneViewer.tsx`、`assetIndex.ts`、`public/scene-assets/**`、`tools/bake-assets/**`。

### 浏览器实机抽样验证（Playwright, 复用现有 dev server localhost:3000，同 workdir 反映最新代码；3003 因项目内已有 next dev 实例占用锁无法另起，属 Next.js 自身限制，非人为绕过）

- **混合渲染**：加入 billboard 模块（星桥拱门躲屋）后画布同时显示真实 3D 网格（奶酪床/藤篮阶梯）+ 白底立牌，小计 ¥148→¥207；移出模块后画布对象消失、小计同步回落 ¥148。截图：`shot2-mixed-render.png`。
- **场景包假闭环**：初始小计 ¥148 → 点"森林奶酪屋" → 小计精确变为 ¥296（148+89+59=296，新增 banana-bed/cheese-play-mat）、按钮变"已加入" → 再点"都市基地" → 叠加至 ¥483（296+187），森林奶酪屋 4 项全部保留未清空。截图：`shot4/5`。
- **F46 报价明细**：2 模块点击生成 → 明细卡逐模块+单价+材料单价行+合计=小计 ¥148；加 1 模块重新点击 → 明细与合计更新为 ¥207。截图：`shot7-quote-detail-3mod.png`。
- **订单条**：初始态"添加模块"步骤黑底高亮（因默认 mock 已选模块非空）、"3D打印/发货"白底未达态，computed style 验证 `background-color: rgb(0,0,0)` 仅命中该步。
- **拖拽旋转 + 宠物位空**：鼠标拖拽画布前后视角明显变化（俯视→近水平），console 全程无 SceneViewer/OrderFlow 相关报错；宠物位为空（默认无 avatar.modelUrl）画布中央无内容，无未捕获异常。截图：`shot12/13`。
- 全程唯一一条 console error 来自 `SpeciesShowcase`（setState-in-render 警告），与本批次代码无关，记入 Observations。

## Observations

- `web/app/components/landing/SpeciesShowcase.jsx`（非本批次所有权）在页面加载/交互时报 React 警告："Cannot update a component (App) while rendering a different component (SpeciesShowcase)"，浏览器验证全程稳定复现 1 次。不影响本批次功能，建议后续批次或主控排查。
- SceneViewer 初始相机默认角度偏俯视，画面观感一般（但 spec §6 明确"billboard 立牌不追求精美，时间优先给 GLB 加载稳定性"，地台/光照/相机角度调优不在本批次验收范围内，未处理）。
- `assets-3d/modules/*/raw.norm.glb`、`raw.meta.json` 中间产物（normalize 脚本默认输出到源文件同目录）已清理删除，只保留 `web/public/scene-assets/` 下最终产出，避免同一资产多处留存造成漂移。

## 改动文件

- `<USER_HOME>/Desktop/PetScape-final/web/app/components/assetIndex.ts`（重写：占位映射→5 真实+1 占位+7 billboard）
- `<USER_HOME>/Desktop/PetScape-final/web/public/scene-assets/cheese-lounge-bed.norm.glb`（+meta.json，真实资产替换占位）
- `<USER_HOME>/Desktop/PetScape-final/web/public/scene-assets/hanging-climb-baskets.norm.glb`（+meta.json，真实资产替换占位）
- `<USER_HOME>/Desktop/PetScape-final/web/public/scene-assets/banana-bed.norm.glb`（+meta.json，新增）
- `<USER_HOME>/Desktop/PetScape-final/web/public/scene-assets/banana-layer-pad.norm.glb`（+meta.json，新增）
- `<USER_HOME>/Desktop/PetScape-final/web/public/scene-assets/cheese-play-mat.norm.glb`（+meta.json，新增）
- `<USER_HOME>/Desktop/PetScape-final/docs/reports/batch3-builder-report.md`（本报告，新建）

未改动（前任遗产，验证后确认符合 spec，本次未动）：
- `<USER_HOME>/Desktop/PetScape-final/web/app/components/SceneViewer.tsx`
- `<USER_HOME>/Desktop/PetScape-final/web/app/components/landing/EnvironmentPreviewSection.jsx`
- `<USER_HOME>/Desktop/PetScape-final/web/app/components/landing/ScenePackSection.jsx`
- `<USER_HOME>/Desktop/PetScape-final/web/app/components/landing/OrderFlowSection.jsx`
- `<USER_HOME>/Desktop/PetScape-final/web/app/components/landing/data.js`
- `<USER_HOME>/Desktop/PetScape-final/tools/bake-assets/normalize_asset.py`
