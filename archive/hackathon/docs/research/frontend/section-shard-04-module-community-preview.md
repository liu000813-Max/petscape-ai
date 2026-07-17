# 分片 04：标品社区（白底商品市场）+ 3D 环境预览

> 隔离声明：本笔记仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现。功能点描述用"该功能需要一个能 X 的服务"的中立语言，不涉及、不引用、不猜测任何后端项目或技术选型。
>
> 依据：`src/main.jsx`（唯一权威源，src 比 dist 新，2026-07-04 17:41:14 > dist 构建产物 17:15:02）+ `src/styles.css`。dist 与 src 逐条比对 344 条中文字符串后仅 2 条不一致（"查看更多"展开态文案 dist="爱宠社区已展开"/src="收起"；GiftSection 素材 dist=占位/src=真图 `gift-keychains.jpg`），均不在本分片覆盖范围内，仅供旁证，不影响本分片提取。

## 覆盖组件

- `ModuleCard`（`src/main.jsx:184-186`）
- `ModuleCommunitySection`（`src/main.jsx:195-206`）
- `EnvironmentPreviewSection`（`src/main.jsx:208-211`）
- 数据源：`modules` 数组（`src/main.jsx:36-50`，13 个打印模块）

---

## 1. 数据源：`modules` 数组（`src/main.jsx:36-50`）

13 条打印模块记录，每条字段：`id, title, price, species, material, weight, image, shape, description`。逐条如下：

| id | title（原文） | price | species | material | weight | image | shape |
|---|---|---|---|---|---|---|---|
| cheese-lounge-bed | 奶酪软垫小床 | ¥89 | 花枝鼠 | PETG | 180g | /assets/pet-products/cheese-lounge-bed.png | cheese |
| banana-bed | 香蕉软垫小床 | ¥89 | 花枝鼠 | PETG / 软垫 | 170g | /assets/pet-products/banana-bed.png | hide |
| banana-layer-pad | 夹层香蕉垫 | ¥59 | 花枝鼠 | PETG / 软垫 | 150g | /assets/pet-products/banana-layer-pad.png | hide |
| hanging-climb-baskets | 悬挂藤篮阶梯 | ¥59 | 花枝鼠 / 鹦鹉 | PETG / 藤编纹理 | 130g | /assets/pet-products/hanging-climb-baskets.png | deck |
| cheese-play-mat | 奶酪洞洞层板 | ¥59 | 花枝鼠 / 蛇 | PETG | 140g | /assets/pet-products/cheese-play-mat.png | tunnel |
| vine-foraging-tray | 藤蔓觅食托盘 | ¥39 | 花枝鼠 / 鹦鹉 | PETG | 90g | /assets/pet-products/vine-foraging-tray.png | plate |
| cheese-storage-tower | 奶酪收纳高柜 | ¥89 | 花枝鼠 | PETG | 210g | /assets/pet-products/cheese-storage-tower.png | hide |
| sunny-climb-station | 多巴胺攀爬站 | ¥59 | 鹦鹉 / 守宫 | PETG | 160g | /assets/pet-products/sunny-climb-station.png | deck |
| hanging-z-ladder | Z 字吊桥梯 | ¥39 | 鹦鹉 / 小宠 | PETG / 木纹色 | 80g | /assets/pet-products/hanging-z-ladder.png | deck |
| starry-hideout | 星月魔法躲屋 | ¥89 | 守宫 / 蛇 / 蜘蛛 | PETG | 190g | /assets/pet-products/starry-hideout.png | hide |
| star-bridge-hide | 星桥拱门躲屋 | ¥59 | 守宫 / 蛇 / 蜘蛛 | PETG | 150g | /assets/pet-products/star-bridge-hide.png | hide |
| mushroom-climb-tree | 蘑菇攀爬树 | ¥59 | 守宫 / 蜘蛛 | PETG | 150g | /assets/pet-products/mushroom-climb-tree.png | rock |
| spiral-star-perch | 星旋攀爬立柱 | ¥39 | 鹦鹉 / 守宫 / 蜘蛛 | PETG | 110g | /assets/pet-products/spiral-star-perch.png | rock |

description 字段逐条附商品文案原文，例如 `cheese-lounge-bed`："低矮奶酪围栏搭配软垫窝位，适合睡觉、躲藏和拍照展示。"（`src/main.jsx:37`）；`starry-hideout`："黑色星月主题躲避屋，偏艺术摆件感，适合主题景观。"（`src/main.jsx:46`）。全部 13 条均带真实图片路径（`image` 字段非空），与 `ProductRender` 组件的"有图走真图渲染"分支对应（见下节）。

**数据需求**：该功能需要一个能列出可打印模块商品的服务，返回内容至少包含标题、价格、适配物种、材料、重量、白底商品图、外形分类；并支持后续按物种做筛选/推荐（`species` 字段已具备物种粒度，但当前 UI 未接入按物种过滤交互，只是纯罗列展示）。

**当前实现状态**：本地静态 JS 常量数组（纯前端硬编码，无网络请求，无分页/筛选逻辑）。

---

## 2. `ProductRender`（`src/main.jsx:86-105`，被 `ModuleCard` 内部调用）

虽然本组件未在分片任务名单里单独列出，但它是 `ModuleCard` 渲染商品图的直接实现，纳入说明以便完整还原 `ModuleCard` 的视觉证据。

### 交互形式
纯展示，无点击/输入交互。

### 期望行为
两态渲染器：
1. 有 `module.image` 时（本分片全部 13 条模块都有图）：渲染 `<img className="product-image" src={module.image} alt="{title} 白底商品图">`，外层 `<div className="product-render has-image" aria-label="{title} 白底商品图">`，角标文案 `<em>白底商品图 / 1:1</em>`（`src/main.jsx:89-92`）。
2. 无图时降级为纯 CSS 3D 几何图形占位（`print-object` + `shape` class，如 cheese/hide/tunnel/deck/plate/rock 等形状变体，`src/styles.css:1575-1637`），同样带 `白底商品图 / 1:1` 角标文案（`src/main.jsx:97-103`）。当前 13 条模块均已配真图，此降级分支在本分片数据下不会被触发，属于防御性兜底渲染。

### 需要什么数据/服务能力
该功能需要一个能为每个打印模块提供白底商品图（1:1 比例）的素材服务；当前分支逻辑已假设"有图优先展示真图，无图退化为几何示意图"，说明产品预期未来所有模块都应补齐真图。

### 当前实现状态
纯展示组件，本地条件渲染（`module.image ? 真图 : CSS图形`），无远程生成能力。

---

## 3. `ModuleCard`（`src/main.jsx:184-186`）

```jsx
function ModuleCard({ module, selected, onToggleModule }) {
  return <article className={`module-card ${selected ? 'selected' : ''}`}><ProductRender module={module} /><div className="module-body"><div><span>{module.species}</span><h3>{module.title}</h3><p>{module.description}</p></div><div className="module-meta"><span>{module.material}</span><span>{module.weight}</span><strong>{module.price}</strong></div><button type="button" onClick={() => onToggleModule(module.id)}>{selected ? '已加入预览' : '加入 3D 场景'}</button></div></article>;
}
```

### UI 元素与文案
- 卡片顶部：`ProductRender` 商品图（见上节）。
- 物种标签：`<span>{module.species}</span>`，如"花枝鼠"、"守宫 / 蛇 / 蜘蛛"。
- 标题：`<h3>{module.title}</h3>`，如"奶酪软垫小床"。
- 描述：`<p>{module.description}</p>`，如"低矮奶酪围栏搭配软垫窝位，适合睡觉、躲藏和拍照展示。"
- 元信息行：材料 `<span>{module.material}</span>`、重量 `<span>{module.weight}</span>`、价格 `<strong>{module.price}</strong>`。
- 操作按钮：未选中显示原文 **"加入 3D 场景"**；已选中显示原文 **"已加入预览"**（`src/main.jsx:185`）。

### 交互形式
点击按钮式切换（toggle）。

### 期望行为
点击"加入 3D 场景"后，该模块被加入当前 3D 场景预览的已选集合，按钮文案变为"已加入预览"（表明已完成、可再次点击移出）；卡片整体在选中态获得视觉强调（见样式证据）。选中态还会驱动整卡外观变化：`.module-card:hover, .module-card.selected { transform: translateY(-2px); border-color: rgba(0, 0, 0, 0.24); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.08); }`（`src/styles.css:1516-1521`），即选中卡片会有轻微上浮+描边加深+投影加深的反馈，与 hover 态共用同一视觉规则。

### 需要什么数据/服务能力
该功能需要一个能记录"用户当前选择了哪些打印模块加入 3D 场景"的状态服务（当前是纯前端内存态，刷新页面即丢失，无持久化）。

### 当前实现状态
本地 JS 状态（`selectedIds` 数组存于父级 `App` 组件 `useState`，`src/main.jsx:248`；`toggleModule` 函数用数组 includes/filter 做增删，`src/main.jsx:259`）。非占位壳——按钮点击有真实回调、有真实视觉反馈，只是状态未持久化到任何服务端。

---

## 4. `ModuleCommunitySection`（`src/main.jsx:195-206`）

```jsx
function ModuleCommunitySection({ selectedIds, onToggleModule, marketRef }) {
  const [showAllModules, setShowAllModules] = useState(false);
  const visibleModules = showAllModules ? modules : modules.slice(0, 3);
  const toggleFullMarket = () => {
    setShowAllModules(current => {
      const next = !current;
      if (next) requestAnimationFrame(() => marketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return next;
    });
  };
  return <section className={`module-section ${showAllModules ? 'market-open' : ''}`} ref={marketRef} id="module-market">...
}
```

### 4.1 区块标题
- `<h2>爱宠之家社区</h2>`（`src/main.jsx:205`）——纯展示文案，区块命名。

### 4.2 "查看更多 / 收起" 按钮

- **交互形式**：点击切换布尔状态 `showAllModules`。
- **文案原文**：折叠态显示 **"查看更多"**；展开态显示 **"收起"**（`src/main.jsx:205`：`{showAllModules ? '收起' : '查看更多'}`），旁边跟 `ArrowRight` 图标，展开时图标加 `rotated` class 做旋转动效（`className={showAllModules ? 'rotated' : ''}`）。
- **CSS 证据**：`.view-more-button svg.rotated`（`src/styles.css:897`，图标旋转样式，配合按钮状态翻转指示"展开/收起"方向感）。
- **期望行为**：点击后模块列表从"只显示 3 个"展开为"显示全部 13 个"（或反向收起回 3 个）；展开瞬间通过 `requestAnimationFrame` 触发 `marketRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })` 平滑滚动到本区块顶部，确保用户视线跟随内容展开（`src/main.jsx:201`）。
- **注**：dist 构建产物里此按钮展开态文案是"爱宠社区已展开"，当前 src 已改为"收起"——按用户指令以 src 当前态为准，二者不算功能差异，只是文案迭代先后关系的旁证。
- **当前实现状态**：本地 JS 状态（`useState(false)` + 布尔翻转），非占位壳，真实驱动列表内容与滚动行为。

### 4.3 状态摘要行（`market-status`）

```jsx
<div className="market-status"><span>{showAllModules ? `已加载 ${modules.length} 个梦想配件` : '当前展示 3 个入门配件'}</span><strong>{selectedIds.length} 个已加入当前 3D 场景</strong></div>
```

- **文案原文**：折叠态显示 **"当前展示 3 个入门配件"**；展开态显示 **"已加载 13 个梦想配件"**（`modules.length` 插值，当前数据为 13）。右侧强调文案 **"{N} 个已加入当前 3D 场景"**，`N` 为 `selectedIds.length` 实时值。
- **期望行为**：让用户随时知道"当前看到多少商品"和"已经选了多少个进场景"，是纯派生展示，无独立交互。
- **需要什么数据/服务能力**：无新增服务需求，依赖 `modules` 数组长度和父级已选 id 数组长度实时计算，纯前端派生态。
- **当前实现状态**：本地 JS 派生值（模板字符串插值），非占位壳。

### 4.4 模块网格（`module-grid`）

- **交互形式**：渲染 `visibleModules`（折叠态取前 3 条 `modules.slice(0, 3)`，展开态取全部 13 条）为 `ModuleCard` 列表，每张卡自带独立的加入/移出交互（见第 3 节）。
- **期望行为**：默认只展示入门级 3 个模块降低决策负担，用户主动展开后才看到完整 13 个模块库。
- **需要什么数据/服务能力**：同"数据源"节——需要能返回模块列表（可分页/可全量）的服务。
- **当前实现状态**：本地数组切片（`Array.prototype.slice`），非分页 API，是前端本地"假分页"（一次性拿到全部 13 条数据后用 JS 切片模拟展开效果）。

### 4.5 "进入完整爱宠社区" 卡片（`module-more-card`）

```jsx
{!showAllModules && <button className="module-more-card" type="button" onClick={toggleFullMarket}><span>进入完整爱宠社区</span><strong>查看更多梦想配件</strong><p>打开完整的梦想配件库，并继续把配件加入宠物 3D 场景。</p></button>}
```

- **交互形式**：仅在折叠态渲染的第 4 张"卡片"，本质是个大按钮，点击行为与顶部"查看更多"按钮完全相同（复用同一个 `toggleFullMarket` 回调）。
- **文案原文**：小标签 **"进入完整爱宠社区"**；主标题 **"查看更多梦想配件"**；说明文案 **"打开完整的梦想配件库，并继续把配件加入宠物 3D 场景。"**
- **期望行为**：作为网格内的"第 4 格"视觉引导物，用卡片形式（而非纯文字按钮）吸引用户点击展开，展开后此卡片消失（因为 `!showAllModules` 条件渲染）。
- **样式证据**：`.module-more-card:hover`（`src/styles.css:1783`）有独立 hover 反馈，说明设计上把它当作与商品卡同级的可点击网格项处理。
- **当前实现状态**：本地 JS 状态复用，非独立功能，非占位壳（真实驱动同一个展开状态）。

---

## 5. `EnvironmentPreviewSection`（`src/main.jsx:208-211`）

```jsx
function EnvironmentPreviewSection({ selectedModules }) {
  const total = useMemo(() => selectedModules.reduce((sum, item) => sum + Number.parseInt(item.price.replace(/[^\d]/g, ''), 10), 0), [selectedModules]);
  return <section className="preview-section">...
}
```

### 5.1 区块引导文案
- Eyebrow：**"加入 3D 环境预览"**（`<span className="eyebrow">`）。
- 主标题：**"打印模块可以被放入你的宠物环境预览中。"**（`<h2>`）。
- 说明文案（关键自陈证据）：**"当前是静态 demo，后续可接入 Three.js / GLB 模型和真实尺寸校验。"**（`<p>`，`src/main.jsx:210`）——这是产品文案自己承认"预览画布当前是占位，非真实 3D 渲染"的直接证据。

### 5.2 预览画布（`preview-stage`）

```jsx
<div className="preview-stage"><AssetPlaceholder title="我的宠物 3D 环境预览" ratio="交互画布 / 16:10" icon={Box} tone="dark" /><div className="preview-chips">{selectedModules.length === 0 ? <span>还没有添加模块</span> : selectedModules.map(item => <span key={item.id}>{item.title}</span>)}</div></div>
```

- **交互形式**：纯展示（无点击、无拖拽、无真实 3D 渲染引擎）。
- **视觉呈现**：`AssetPlaceholder` 组件渲染一个深色调（`tone="dark"`）占位卡，标题 **"我的宠物 3D 环境预览"**，比例标注 **"交互画布 / 16:10"**，配 `Box` 图标（lucide-react，暗示"3D 空间/盒子"语义）。
- **已选模块 chips**：若 `selectedModules` 为空，显示 **"还没有添加模块"**；否则逐个渲染已选模块标题的小标签（如"奶酪软垫小床"、"悬挂藤篮阶梯"）。
- **期望行为（从文案+图标+比例标注推断）**：设计意图是一个可交互的 3D 场景画布（16:10 比例暗示视频/3D viewport 规格），用户加入的模块应该实时出现在这个画布里、可旋转查看、可核对尺寸适配；但当前只用一个静态占位卡+文字 chips 列表模拟"已加入模块"的存在感，没有任何真实 3D 渲染。
- **需要什么数据/服务能力**：该功能需要一个能把已选打印模块组合渲染成可交互 3D 场景（可旋转、可缩放、体现真实尺寸比例）的服务，用于替换当前的静态占位画布。
- **当前实现状态**：占位壳（`AssetPlaceholder` 复用组件）+ 本地 JS 派生列表（chips 由 `selectedModules.map` 生成，是真实数据驱动的文字列表，但画布本身无渲染能力）。

### 5.3 适配评分（`fit-score`）

```jsx
<div className="fit-score"><span>适配评分</span><strong>{selectedModules.length ? '92%' : '--'}</strong></div>
```

- **交互形式**：纯展示。
- **文案**：标签 **"适配评分"**；数值：有已选模块时固定显示 **"92%"**，无已选模块时显示 **"--"**。
- **期望行为（从文案推断）**：暗示系统应该根据已选模块与宠物物种/体型/场景的匹配程度计算出一个真实适配百分比，帮用户判断"这套组合好不好"。
- **需要什么数据/服务能力**：该功能需要一个能根据已选模块组合与宠物档案（物种、体型等）计算真实适配度评分的服务。
- **当前实现状态**：写死常量。只要 `selectedModules.length` 非零，无论选的是哪几个模块、选了几个，永远显示"92%"——不是任何形式的计算结果，是硬编码占位数值。**这是本分片内最明确的"看起来是智能计算结果、实际是假数据"的证据点。**

### 5.4 已选模块明细列表（`preview-list`）

```jsx
<div className="preview-list">{selectedModules.length === 0 ? <p>点击模块卡片中的"加入 3D 场景"，即可构建预览组合。</p> : selectedModules.map(item => <div className="preview-line" key={item.id}><span>{item.title}</span><strong>{item.price}</strong></div>)}</div>
```

- **交互形式**：纯展示。
- **空态引导文案**：**"点击模块卡片中的"加入 3D 场景"，即可构建预览组合。"**——直接引用了 `ModuleCard` 按钮的原文案"加入 3D 场景"，形成跨组件的文案联动。
- **有数据时**：逐行显示已选模块的标题+价格（`preview-line`），如"奶酪软垫小床　¥89"。
- **需要什么数据/服务能力**：无新增需求，纯前端派生渲染（父级传入的 `selectedModules` 数组）。
- **当前实现状态**：本地 JS 派生列表，非占位壳，真实反映当前选择。

### 5.5 模块小计（`preview-total`）

```jsx
<div className="preview-total"><span>模块小计</span><strong>{selectedModules.length ? `¥${total}` : '¥0'}</strong></div>
```

- **交互形式**：纯展示。
- **文案**：标签 **"模块小计"**；金额为 `total`（`useMemo` 实时计算，`src/main.jsx:209`：对 `selectedModules` 逐条 `Number.parseInt(item.price.replace(/[^\d]/g, ''), 10)` 求和），无已选模块时显示 **"¥0"**。
- **期望行为**：用户每次加入/移出模块，小计应实时更新为准确的价格总和。
- **需要什么数据/服务能力**：无新增需求——求和逻辑基于模块自带的 `price` 字段在前端本地完成，若未来涉及税费/运费/优惠等真实计价规则，需要一个能计算真实订单金额的服务。
- **当前实现状态**：本地 JS 计算（`useMemo` + `reduce`），真实计算、非占位，但只是简单价格字符串求和，不含任何税费/折扣/运费等真实计价规则。

### 5.6 "生成场景报价" 按钮

```jsx
<button type="button">生成场景报价</button>
```

- **交互形式**：按钮，视觉上可点击。
- **文案原文**：**"生成场景报价"**（`src/main.jsx:210` 末尾）。
- **期望行为（从文案推断）**：点击后应该基于当前已选模块组合，生成一份正式的场景报价（可能包含材料、重量、打印时间、总价等，参照同项目 `ManufacturingSection` 里的报价面板形式）。
- **需要什么数据/服务能力**：该功能需要一个能根据已选模块组合、材料与重量信息生成正式报价单（含总价、预计生产周期等）的服务。
- **当前实现状态**：**占位壳**——按钮无 `onClick` 绑定，是全项目里"结构完整但未接入处理逻辑"的两个按钮之一（另一个是 `UploadVibeSection` 的"生成"按钮，不在本分片范围）。点击此按钮当前无任何反应。

---

## 6. 样式证据补充

- 商品卡容器：`.module-card { border-radius: 28px; background: #fff; }`（`src/styles.css:1508-1514`），选中/hover 态统一上浮+加深描边+加深投影（`src/styles.css:1516-1521`）。
- 商品图渲染区：`.product-render` 白底渐变背景 + 阴影圆（`src/styles.css:1532-1542`），有图态 `.product-render.has-image`（`src/styles.css:1544-1547`）。
- "查看更多"按钮与展开箭头旋转：`.view-more-button svg.rotated`（`src/styles.css:897`）。
- 展开态整块区域样式切换：`.module-section.market-open .market-status` / `.module-section.market-open .market-status strong`（`src/styles.css:920-929`），说明展开前后状态摘要行也有独立视觉规则（非仅文案变化）。
- 预览区整体布局：`.preview-section`（`src/styles.css:1810`）、`.preview-board`（1828）、`.preview-stage`（1837）、`.preview-side`（1864）、`.fit-score`（1873）、`.preview-list`（1893）、`.preview-line`（1898）、`.preview-total`（1914），均有独立样式定义，证明这是完整设计过的信息面板，不是临时草稿。

---

## 7. 本分片"已知缺口"清单（供后续汇总用）

1. `EnvironmentPreviewSection` 内"生成场景报价"按钮（`src/main.jsx:210`）——UI 已就绪，无 `onClick`，动作待接入。
2. "适配评分 92%"（`src/main.jsx:210`）——写死常量，非真实计算结果，只要有任意已选模块就恒为 92%。
3. 3D 环境预览画布本身是 `AssetPlaceholder` 静态占位卡（深色调、Box 图标、16:10 比例标注），文案自陈"当前是静态 demo，后续可接入 Three.js / GLB 模型和真实尺寸校验"（`src/main.jsx:210`）——没有任何真实 3D 渲染引擎接入。
4. 模块列表的"展开/收起"是前端本地数组切片模拟的假分页（一次性加载全部 13 条数据，非真实分页请求）。
5. `modules` 数组虽含 `species` 字段（可用于按物种筛选），但当前 UI 未提供任何筛选/排序交互，只是纯罗列 + 展开/收起两态。
