# 前端侦察笔记 — 设计师前端页面（TinyHabitat AI / PetScape 前端原型）

> 隔离声明：本笔记仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现（组件、交互、素材、文案），不涉及、不引用、不猜测任何后端项目或其它 PRD。凡涉及数据/持久化/生成能力之处，一律用"该功能需要一个能 X 的服务"的中立表述。

## 0. 项目基本信息

- 技术栈：React 18 + Vite + `motion`（Framer Motion 继任者）+ `lucide-react` 图标。纯前端 SPA，无路由库，单页长滚动。
- 入口：`index.html:10`（源码开发态）挂载 `#root`，加载 `/src/main.jsx`。
- 语言：界面文案全部简体中文，`<html lang="zh-CN">`（index.html:2）。`<title>TinyHabitat AI</title>`（index.html:5）——注意站点内部标题仍是 "TinyHabitat AI"，与文件夹/资产命名的 "PetScape"（logo 文件名、CSS class 前缀）并存，属于命名漂移，非功能缺陷。
- 唯一源文件：`src/main.jsx`（266 行，含 JSX 内联即最终态，无拆分子文件）+ `src/styles.css`（2471 行）。没有 `src/components/` 目录，所有组件都在 main.jsx 一个文件里定义。
- `tools/process_pet_assets.py`：离线图片后处理脚本（PIL），把设计师提供的原始 PNG 裁剪成 1400×980 圆角白底图并生成 contact sheet，输出到 `public/assets/pet-products/`。**这是构建时的素材加工脚本，不是运行时前端逻辑**，与页面交互无关，纯属资产流水线证据（说明白底商品图是预处理产物，不是运行时生成）。

## 1. 组件清单与真实交互 vs 占位壳判定（逐个过 src/main.jsx）

结论先行：**main.jsx 里没有"纯壳/空函数"式的占位组件**——每个组件都返回真实 JSX 且承载至少一部分展示逻辑；"占位"体现在**数据层面**（用静态数组/AssetPlaceholder 代替真实生成结果），而不是组件本身未实现。按有无 state/交互回调，分两档：

### 1A. 有状态、有真实交互回调的组件（能点、能改、能联动）

| 组件 | 行号 | 交互 |
|---|---|---|
| `Navbar` | 107-118 | 品牌按钮（纯展示）、"菜单"按钮 `onOpen` 打开抽屉、"白底标品"按钮 `onBrowseModules` 滚动到模块区 |
| `HeroFooter` | 120-131 | "开始定制" `onOpen`、"浏览标品" `onBrowseModules`，均驱动 App 级 state |
| `DetailDrawer` | 133-135 | 受 `open` 控制的 AnimatePresence 抽屉，关闭按钮 `onClose` |
| `SpeciesShowcase` | 137-182 | 5 物种横向轮转卡片：自动轮播定时器（4200ms interval，147-156）、点击卡片切换 `chooseSpecies`（158-162）、点选圆点导航（species-dots）、"创建专属宠物档案"按钮打开抽屉。轮转位姿计算 `getCardPose`（164-179）是真实几何运算（offset/scale/opacity/rotateY），非静态 CSS |
| `PetCreatorSection` | 188-192 | 全套宠物创建器：改名字 input、5 物种切换按钮、体型 range slider（1-5）、真实文件上传 `<input type="file">`→`URL.createObjectURL` 生成本地预览、"生成 3D 可旋转预览"按钮切 `avatarGenerated`、旋转角度 range slider（0-360deg，驱动 CSS 变量 `--avatar-rotate`）、4 件穿戴品可勾选切换并实时反映在 avatar 上（叠加 CSS 类），装扮合计价格实时求和 |
| `ModuleCard` | 184-186 | "加入 3D 场景" / "已加入预览" 切换按钮，驱动父级 selectedIds |
| `ModuleCommunitySection` | 195-206 | "查看更多"/"收起" 折叠状态，展开时 `requestAnimationFrame` 平滑滚动到 `marketRef`；模块网格 3→全量切换；每张卡的加入/移出联动 |
| `EnvironmentPreviewSection` | 208-211 | 纯派生展示：接收 App 传入的 `selectedModules`，`useMemo` 实时算价格总计（209）、渲染已选模块 chips 和明细列表、"适配评分"写死 92%（210，硬编码非计算）、"生成场景报价"按钮**无 onClick，是唯一一个"看起来能点但没绑定处理器"的按钮**（210 行末尾 `<button type="button">生成场景报价</button>`） |
| `App` | 245-263 | 顶层状态容器：drawerOpen / selectedSpeciesId / selectedIds / petName / petSize / petImageUrl / avatarGenerated / avatarRotation / selectedWearables，7 个 state + 1 个 ref，串联全页 |

### 1B. 纯静态展示组件（数据来自写死数组，无交互回调，但渲染逻辑真实存在，不是空壳）

| 组件 | 行号 | 说明 |
|---|---|---|
| `GridIcon` | 78-80 | 纯 SVG 图标，无状态，非"壳"，是可复用的小型展示单元 |
| `AssetPlaceholder` | 82-84 | 通用占位卡片（图标+标题+比例文案），被 6+ 处复用来表达"这里将来是真实生成内容/上传内容"的位置。**这是全项目最重要的"占位语义"载体**，凡是用到 `<AssetPlaceholder>` 的地方，都是产品明确标注的"当前 demo 用占位、后续接入真实能力"的区域（例如 preview-section 210 行文案原文写明"当前是静态 demo，后续可接入 Three.js / GLB 模型和真实尺寸校验"） |
| `ProductRender` | 86-105 | 有真实图有真实图，无真实图退化为 CSS 形状占位（`print-object` + shape class），是白底商品图的双态渲染器，非壳 |
| `IntroSection` | 213-215 | 写死的"Nomi 的档案"示例卡 + 习性适配规则说明，纯展示，无交互 |
| `UploadVibeSection` | 217-219 | 有一个"生成"按钮（218 行）**同样无 onClick 绑定**，prompt-box 文案写死；两个 AssetPlaceholder 上传位无真实 `<input type="file">`（对比 PetCreatorSection 里是真实文件输入，这里只是展示壳） |
| `RenderSection` | 221-223 | 三张 AssetPlaceholder（改造前/AI 改造效果图/小红书分享图），纯展示，无任何交互 |
| `ScenePackSection` | 225-227 | 3 个场景包卡片，数据来自写死数组 `scenePacks`（71-75），有真实图（scene-*.jpg），无交互回调 |
| `ManufacturingSection` | 229-231 | 报价示例面板，材料价目表来自写死数组 `materialRows`（76），无交互 |
| `GiftSection` | 233-235 | 首单礼物展示卡，纯静态，无交互 |
| `OrderFlowSection` | 237-239 | 8 步流程条（flowSteps 数组，70 行），纯展示 |
| `FlipCards` | 241-243 | 8 张卡片翻转展示（CSS hover 翻转，workflowCards 数组 59-68），无 JS 交互，靠 CSS `:hover` 驱动 flip-inner（需查 styles.css 确认，未在 main.jsx 内找到 hover state） |

### 1C. 唯二"看起来可点但未绑定真实动作"的按钮（需在功能点提取时特别标注为"UI 已就绪、动作待接入"）

1. `EnvironmentPreviewSection` 内"生成场景报价"按钮 — main.jsx:210 末尾，`<button type="button">生成场景报价</button>`，无 onClick。
2. `UploadVibeSection` 内"生成"按钮 — main.jsx:218，`<button type="button">生成</button>`，无 onClick。

这两处是全部 20 个组件里唯一"结构完整但缺处理器"的交互点，其余按钮均有真实 onClick 回调（即便只是切换本地 state）。

## 2. src vs dist 版本一致性核查

**结论：不一致，src 比 dist 新，dist 落后。分片提取以 src/main.jsx 为准。**

证据：
- 文件 mtime：`src/main.jsx` 2026-07-04 17:41:14；`dist/assets/index-DEUQjTNj.js`（构建产物）2026-07-04 17:15:02——src 在最后一次构建之后又被编辑过。
- 内容级差异（用 Python 提取 dist JS 里的中文字符串，逐条比对 src 是否包含）：dist 中有 2 条字符串在当前 src 里找不到：
  - `爱宠社区已展开` — dist 里"查看更多"按钮展开态显示这段文案；当前 src（main.jsx:205）展开态显示的是 `收起`。说明这颗按钮的文案在 src 里被改过，dist 是旧版本。
  - `首单挂件图` — dist 里 GiftSection 用的是 `<AssetPlaceholder title="首单挂件图" ratio="1:1" icon={Iu}>`（即 Gift 图标占位卡）；当前 src（main.jsx:234）已经换成真实 `<img src="/assets/gift-keychains.jpg">`。说明"首单礼物"卡片的素材是后来才换上真图的，dist 仍是占位态。
- 其余全部 344 条 dist 中提取到的中文字符串（物种名、模块名、文案等）均能在 src 中找到，说明除上述 2 处外两边内容一致，不存在 dist 独有的隐藏组件或功能。
- `public/assets/` 与 `dist/assets/` 的素材文件清单完全相同（同名同目录结构），无新增/缺失资产。

**结论对分片提取的影响**：不需要以 dist 为准；直接依据 src/main.jsx + src/styles.css 提取功能点即可，dist 只是稍早一次构建的副本，唯一已知差异（按钮文案 + 礼物卡素材）已在上文列出，提取分片时若涉及这两处，以 src 当前态为准。

## 3. 素材清单（public/assets，与 dist/assets 一致）

- 视频/首屏：`hero-mouse.mp4` + `hero-mouse-poster.jpeg`
- Logo：`petscape-logo.png` / `petscape-logo-raw.png`
- 物种档案图（5 张，4:5）：`species-{rat,gecko,snake,parrot,spider}.png`
- 白底商品图（13 张，1:1，见 `tools/process_pet_assets.py` 加工产物）：`pet-products/` 下 banana-bed / banana-layer-pad / cheese-lounge-bed / cheese-play-mat / cheese-storage-tower / hanging-climb-baskets / hanging-z-ladder / mushroom-climb-tree / spiral-star-perch / star-bridge-hide / starry-hideout / sunny-climb-station / vine-foraging-tray
- 场景包效果图（3 张，16:9）：`scene-cheese-house.jpg` / `scene-rainforest-treehouse.jpg` / `scene-urban-base.jpg`
- 其它：`model-preview.jpg`（3D 模型预览图，manufacturing-section 用）、`gift-keychains.jpg`（首单礼物图，src 独有，dist 里此处仍是占位符，见上节）

注：穿戴装扮商品（`wearableItems`，52-57 行）**没有对应的真实图片素材**，`PetCreatorSection` 里穿戴商店用的是纯 `AssetPlaceholder`（icon=Gift），说明穿戴品类目前只有数据结构和交互（可勾选、联动 avatar 上叠加 CSS 层），没有真实商品图——这是一个明确的"数据结构已就绪、视觉素材缺失"的功能点，分片提取时需标注。

## 4. 分片清单（按页面 section 划分，6 片）

分片顺序与页面从上到下的 DOM 顺序一致（对应 `App` 组件 245-263 行内的渲染顺序）。

### shard-01-hero-nav
- **名称**：首屏 Hero + 导航 + 详情抽屉
- **覆盖范围**：`Navbar`（main.jsx:107-118）、`HeroFooter`（120-131）、`DetailDrawer`（133-135）、hero 视频区（App 内 `<section className="hero-shell">`，263 行内联）
- **关键交互**：菜单按钮开抽屉、"白底标品"按钮滚动锚点、"开始定制"/"浏览标品" CTA、抽屉内 4 条能力摘要（Camera/Rotate3D/ShoppingBag/BadgeCheck 图标+文案）
- **素材**：hero-mouse.mp4/poster、petscape-logo.png

### shard-02-species-carousel
- **名称**：大众物种入口轮播
- **覆盖范围**：`SpeciesShowcase`（137-182），数据源 `species` 数组（28-34 行，5 个物种：花枝鼠/守宫/蛇/鹦鹉/蜘蛛，每个含 traits/material/habitat/modules 关联字段）
- **关键交互**：自动轮播定时器（4.2s/次，147-156）、点击卡片/圆点手动切换（158-162）、"创建专属宠物档案"入口按钮
- **数据需求**：该功能需要一个能提供物种档案信息（名称、习性标签、材料说明、栖息环境描述、关联模块 id 列表）并支持后续扩展新物种的服务

### shard-03-pet-creator
- **名称**：宠物档案创建器 + 3D 角色预览 + 装扮商店
- **覆盖范围**：`PetCreatorSection`（188-192），数据源 `wearableItems` 数组（52-57 行，4 件装扮）
- **关键交互**：命名 input、物种切换、体型 range(1-5)、真实文件上传生成本地预览（`URL.createObjectURL`，261 行）、"生成 3D 可旋转预览"按钮、旋转角度 range(0-360)、4 件装扮可勾选并联动 avatar 视觉、装扮合计价格实时计算
- **已知缺口**：穿戴品无真实商品图（仅 AssetPlaceholder），"生成 3D 可旋转预览"当前只是切换本地 state（`avatarGenerated`），角色形象本身是 CSS 拼出的示意图（`avatar-body` 各物种 class），不是真实 3D 模型/生成结果
- **数据需求**：该功能需要一个能接收用户上传的宠物照片、返回可旋转查看的角色形象的服务；该功能需要一个能记录/持久化宠物档案（名字、物种、体型、已购装扮）的服务

### shard-04-module-community-preview
- **名称**：标品社区（白底商品市场）+ 3D 环境预览
- **覆盖范围**：`ModuleCard`（184-186）、`ModuleCommunitySection`（195-206）、`EnvironmentPreviewSection`（208-211），数据源 `modules` 数组（36-50 行，13 个打印模块，含 price/species/material/weight/image/shape/description）
- **关键交互**：3→全量模块展开/收起（带平滑滚动）、逐个模块"加入 3D 场景"/移出、已选模块价格实时求和（`useMemo`，209 行）、"适配评分"写死 92%（非真实计算）
- **已知缺口**：`preview-section` 文案原文自陈"当前是静态 demo，后续可接入 Three.js / GLB 模型和真实尺寸校验"（210 行）；"生成场景报价"按钮无 onClick 绑定
- **数据需求**：该功能需要一个能列出可打印模块商品（价格、材料、重量、适配物种、图片）并支持按物种筛选的服务；该功能需要一个能根据已选模块组合生成 3D 场景预览与报价的服务

### shard-05-content-marketing
- **名称**：内容/营销静态区块（档案示例、习性说明、上传氛围生成、AI 效果图、场景包、能力地图）
- **覆盖范围**：`IntroSection`（213-215）、`UploadVibeSection`（217-219）、`RenderSection`（221-223）、`ScenePackSection`（225-227，数据源 `scenePacks` 71-75 行）、`FlipCards`（241-243，数据源 `workflowCards` 59-68 行）
- **关键交互**：仅 `UploadVibeSection` 的"生成"按钮存在但无 onClick；其余均为纯静态展示（含真实场景图 3 张）
- **数据需求**：该功能需要一个能接收环境照片和文字描述、返回改造后效果图的服务（当前 UploadVibeSection/RenderSection 均为占位展示，无真实生成调用）

### shard-06-manufacturing-order
- **名称**：3D 打印报价 + 首单礼物 + 订单流程闭环
- **覆盖范围**：`ManufacturingSection`（229-231，数据源 `materialRows` 76 行）、`GiftSection`（233-235）、`OrderFlowSection`（237-239，数据源 `flowSteps` 70 行）
- **关键交互**：纯静态展示，无交互回调；报价区间写死 ¥399-¥899，材料单价表写死
- **已知差异**：GiftSection 素材在 src 中已换为真图 `gift-keychains.jpg`，dist 仍是占位符（见第 2 节）
- **数据需求**：该功能需要一个能根据模块组合、材料选择、重量计算出真实打印报价与生产周期的服务；该功能需要一个能驱动从效果图到下单、生产、发货的订单状态流转的服务

## 5. 遗留问题 / 后续分片提取时需注意

1. `EnvironmentPreviewSection`"生成场景报价"和 `UploadVibeSection`"生成"两个按钮无 onClick，提取功能点时应标注为"UI 已就绪、待接入处理逻辑"，不要误判为"已实现的生成功能"。
2. 穿戴装扮（wearableItems）缺真实商品图素材，仅数据结构+占位展示。
3. "适配评分 92%"（EnvironmentPreviewSection, main.jsx:210）是写死数值，不是真实计算结果。
4. 站内标题 `TinyHabitat AI`（index.html:5）与项目/资产命名 `PetScape`（logo 文件名、多处 CSS class 前缀）并存，是命名漂移而非两个不同项目，功能点提取时统一按此页面的实际产品名描述即可，不必纠结改名。
5. FlipCards 翻转效果依赖 CSS `:hover`（styles.css 内 `.flip-card`/`.flip-inner` 相关规则，未在本轮细读，行号待补），main.jsx 本身没有 JS 状态驱动翻转，如后续分片需要精确样式行号需另行在 styles.css 中定位 `.flip-` 前缀规则。
