# 批次3 Spec：3D 环境预览 + 电商假闭环（F31/F42/F46/F47）

> 历史交付 Spec，不作为当前开发计划；当前产品范围见根目录 `PetScape-PRD.md`，当前实现以代码为准。
> 文件所有权：只改/新建——`app/components/landing/EnvironmentPreviewSection.jsx`、`ScenePackSection.jsx`、`OrderFlowSection.jsx`、`app/components/landing/data.js`（**只追加场景包→模块子集常量，不改现有数据**）、`app/components/SceneViewer.tsx`（新建）、`public/scene-assets/**`（新建，资产烘焙产物）、`tools/bake-assets/**`（新建）。`app/page.jsx` 已注入 projectId/selectedIds/onAddModules 及订单条推导所需 props（petImageUrl/avatarGenerated/selectedWearables/selectedIds），禁改。**不建 PetViewer（批次1 所有权）、不动模块商城组件。不执行任何 git 操作——完成后报告，由主控统一 commit。** 验证用自己起的 dev server（端口 3003）。越界需求停下报主控。
批次A 现状注记：Tripo 余额阻塞，5 模块 GLB 未产出（assets-3d/ 只有 source.png）。按 spec 预案先用老仓库 scene-lab 现有 .norm.glb 资产 + billboard 开发全部功能，资产到位后仅替换文件与 assetIndex。

## 1. 任务

三件事：① F31 环境预览画布从占位卡变成真 three.js 场景，已选模块实时出现；② 场景包假闭环（点击批量加入已选，流经真实数据流）；③ 订单条按 state 推导高亮。

## 2. 资产烘焙（离线步骤）

- 把批次A 的 5 个模块 GLB 过一遍归一化：复制老仓库 `scripts/normalize_asset.py` 到 `tools/bake-assets/`，跑出 `.norm.glb + meta.json`（uv 环境老仓库已验证），落 `app/scene-assets/` 或 `public/scene-assets/`。
- 产出 `assetIndex.ts`：模块 id → norm.glb 路径的映射表；13 模块中无 GLB 的标 `billboard`（用其白底商品图路径）。

## 3. SceneViewer（新建，参考老 `scene-lab/SceneLabViewer.tsx`）

- three.js 场景：地台 + 环境光/方向光 + OrbitControls + 双挂载防御（照抄 SceneLabViewer 的 cancelled 模式）。
- 输入 props：`selectedModules[]`（含 id）。有 GLB 的模块加载 .norm.glb，按简单网格布局摆放（2-3 列，间距按 meta 尺寸）；无 GLB 的模块渲染白底图立牌（PlaneGeometry + 商品图纹理，永远面向相机的 billboard）。
- 加/减模块实时增删场景对象（React effect diff，不整场景重建）。
- 中央预留宠物位:若 project.avatar.modelUrl 存在则加载置于中央（批次1 的产物，只读 project 状态，不依赖其代码）；不存在则空着。

## 4. 前端接线

- **F31**：EnvironmentPreviewSection 的 AssetPlaceholder 占位卡替换为 SceneViewer（16:10 容器不变）；"当前是静态demo"的自陈文案移除，换成简短操作提示（可拖动旋转视角）。
- **F42 场景包假闭环**：`data.js` 追加每个场景包的 `moduleIds` 子集常量（按主题语义从 13 模块里配：森林奶酪屋=奶酪屋/树屋/攀爬类，都市基地/雨林树屋同理，每包 3-4 个）；ScenePackSection 每卡加"加入预览"按钮（样式复用 ModuleCard 的加入按钮语汇）→ onClick 批量并入 selectedIds（通过接驳层提供的 setter props）→ 已选列表/小计/SceneViewer 全联动。已全部加入的场景包按钮显示"已加入"。
- **F46"生成场景报价"按钮**：接 onClick → 按已选模块小计 + 材料单价常量算出报价明细（弹出/展开一块简单明细卡，样式贴 V3），纯前端计算。
- **F47 订单条**：OrderFlowSection 接 props，按 state 推导高亮：传照片→"选择宠物"、生成 3D→"创建形象"、勾装扮→"添加装扮"、有 selectedIds→"添加模块"、切片完成→"确认模型"；"免费生成图"看 vibe.status（只读 project）；"3D打印/发货"保持未达态。当前步高亮样式复用 V3 现有 active 语汇。

## 5. 完成标准

### 5A. builder 自验（每条附证据）

1. `npx tsc --noEmit` + `pnpm build` 通过。
2. 资产烘焙产物：5 个（或批次A 实际 ok 数）.norm.glb + meta.json 存在且 glb >50KB；`assetIndex.ts` 覆盖全部 13 模块（GLB 项 + billboard 项），贴清单。
3. `data.js` 场景包子集常量：3 个场景包各配 3-4 个真实存在的模块 id（与 13 模块 id 集合作差为空，贴校验输出）。
4. 文件所有权零违规（git diff --stat）。

### 5B. 验收 Story（主控/独立 verifier 浏览器执行；自包含断言）

1. **画布混合渲染**：在模块商城分别加入 1 个有 GLB 的模块（如 star-bridge-hide）和 1 个 billboard 模块 → 环境预览画布同时出现 3D 网格模型与白底图立牌，鼠标拖拽可旋转视角、立牌始终面向相机；再移出其中一个 → 对应对象从场景消失，已选列表与小计同步减少。
2. **场景包假闭环**：记录当前"模块小计 ¥N₀" → 点"森林奶酪屋"卡的"加入预览" → 已选 chips 新增其子集全部模块名、小计变为 N₀+子集单价之和（精确金额断言）、画布新增对应对象；该卡按钮变"已加入"；再点另一场景包 → 叠加生效不清空前者。
3. **订单条推导**：初始仅第 2 步前置态 → 上传宠物照 → "选择宠物"点亮 → （mock）生成 3D → "创建形象"点亮 → 勾 1 件装扮 → "添加装扮"点亮 → 加 1 个模块 → "添加模块"点亮 → 切片完成 → "确认模型"点亮；"3D打印/发货"始终未达态（截图序列 ≥4 帧）。
4. **F46 报价明细**：已选 2 个模块时点"生成场景报价" → 出现明细卡：逐模块名+单价、合计=小计、材料单价行；再加 1 个模块后重新点击 → 明细与合计更新。
5. **宠物位**：project 存在 avatar 模型时（mock 即可），画布中央出现宠物模型；不存在时中央留空且不报错（console 无未捕获异常）。

## 6. 不要做

- 不做真实尺寸校验/适配评分（批次4）。不做拖拽摆放（网格自动布局即可）。
- 不动 PetViewer/创建器/vibe 区。不改 SceneLabViewer 老文件（只参考复制）。
- billboard 立牌不追求精美，够用即可——时间优先给 GLB 加载稳定性。

## 7. 产出

报告：`docs/reports/batch3-builder-report.md`；stdout ≤200 字；未达标 `INCOMPLETE:`。

## 8. 档位

sonnet（SceneLabViewer 参考实现完整，其余是常量+接线）。three.js 相关失败 1 次升 opus。
