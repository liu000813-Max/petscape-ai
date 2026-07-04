# 分片提取报告 — shard-05-content-marketing

> 隔离声明：本报告仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现。不涉及、不引用、不猜测任何后端项目或其它 PRD。所有"数据/服务需要什么"的表述均使用中立语言（"该功能需要一个能 X 的服务"），不提及任何具体后端技术或项目名称。

## 分片范围

| 组件 | 行号（src/main.jsx） | 数据源 |
|---|---|---|
| `IntroSection` | 213-215 | 无（全部写死在 JSX 内） |
| `UploadVibeSection` | 217-219 | 无（全部写死在 JSX 内） |
| `RenderSection` | 221-223 | 无（全部写死在 JSX 内） |
| `ScenePackSection` | 225-227 | `scenePacks` 数组，main.jsx:71-75 |
| `FlipCards` | 241-243 | `workflowCards` 数组，main.jsx:59-68 |

依据：`src/main.jsx`（266 行）+ `src/styles.css`（2471 行）。src 比对应 dist 构建产物新（src mtime 2026-07-04 17:41:14 晚于 dist 17:15:02），已按分片任务说明逐条核对 dist 提取的 344 条中文字符串，本分片范围内两版无差异（唯二差异——"查看更多/收起"按钮文案、GiftSection 礼物图——都不在本分片覆盖的组件里，此处不再重复列出）。

---

## 1. IntroSection（main.jsx:213-215）

一个双栏静态展示区块："完整落地链路"小节，左侧宠物档案示例卡，右侧习性适配规则说明。

### 1.1 区块标题与引导语

- **证据**：`<span>完整落地链路</span><h2>把爱宠档案、赛博云宠和真实打印小窝一次打通。</h2>`（main.jsx:214）
- **交互形式**：无，纯文本标题。
- **期望行为**：向用户说明本区块是在演示"档案 → 云宠形象 → 实物打印"这条链路已经打通的示例，为下面两张卡片定调。
- **数据/服务需要**：无（静态文案）。
- **当前实现状态**：纯展示。

### 1.2 宠物档案示例卡（profile-panel）

- **证据**：
  - 占位图：`<AssetPlaceholder title="上传宠物头像" ratio="1:1" icon={Camera} />`（main.jsx:214）
  - 档案文案：`<span className="eyebrow">宠物档案</span><h3>Nomi 的档案</h3><p>物种：花枝鼠 / 年龄：6 个月 / 性格：爱钻洞、爱攀爬、爱觅食。</p>`（main.jsx:214）
  - 习性标签：`<div className="profile-tags"><span>爱社交</span><span>爱啃咬</span><span>需要多层空间</span></div>`（main.jsx:214）
- **交互形式**：无点击/输入回调，纯展示卡片（`AssetPlaceholder` 组件本身不含 `<input>`，仅渲染图标+标题+比例文案，与 `PetCreatorSection` 里真实的 `<input type="file">` 上传位不同，此处只是"上传宠物头像"字样的占位示意，不能真的点击上传）。
- **期望行为**：向首次浏览的用户展示"一个已经建好的宠物档案长什么样"——名字 Nomi、物种、年龄、性格标签，作为下方真实创建流程（`PetCreatorSection`，另一分片覆盖）的成品示例/参考样例。
- **数据/服务需要**：该功能需要一个能保存并展示宠物档案信息（头像、物种、年龄、性格标签）的服务；当前该卡片内容是硬编码示例数据，不读取任何真实创建的档案。
- **当前实现状态**：纯展示（占位壳，"上传宠物头像"仅为视觉占位，无真实上传能力挂载在此处）。

### 1.3 习性适配规则说明（habit-panel）

- **证据**：
  - 标题：`<span className="eyebrow">习性适配规则</span><h3>懂习性，才敢把梦中小窝真的带回家。</h3>`（main.jsx:214）
  - 三条规则：
    - `<HeartHandshake size={18} /><span>喜好：隧道、窝、层板、觅食区</span>`
    - `<ShieldCheck size={18} /><span>风险：尖角、小零件、尾巴卡缝、难清洁沟槽</span>`
    - `<Tags size={18} /><span>材料：优先 PETG、圆角处理、可拆卸连接件</span>`
    （均在 main.jsx:214）
- **交互形式**：无，纯图标+文字列表，无点击/展开。
- **期望行为**：向用户解释"为什么模块设计要考虑这些"——建立信任感，说明产品团队对目标物种的习性、安全风险、材料选择有专业把关，为后续购买模块/场景包做铺垫。
- **数据/服务需要**：该功能需要一个能提供物种习性适配规则（喜好行为、风险点、推荐材料）的信息内容来源；当前三条规则是写死文案，不与 `SpeciesShowcase`（另一分片）选中的具体物种联动——无论用户在上方轮播选中哪个物种，这里始终显示同一套通用规则文字，不因物种切换而改变。
- **当前实现状态**：纯展示，且未与页面其他部分的物种选择状态联动（静态通用文案）。

---

## 2. UploadVibeSection（main.jsx:217-219）

"上传与 Vibe 描述"区块：左侧文案+一个 prompt 输入展示框+"生成"按钮，右侧两个上传占位位。

### 2.1 区块引导文案

- **证据**：`<span className="eyebrow">上传与 Vibe 描述</span><h2>上传真实环境，再描述你想要的宠物小家。</h2><p>当前 demo 保留上传位、生成路径和订单交接逻辑，后续可连接生图模型、混元 3D 和生产报价。</p>`（main.jsx:218）
- **交互形式**：无，纯文本。
- **期望行为**：明确告知这是流程演示，暗示用户接下来看到的"生成"按钮和上传位目前只是路径占位。
- **数据/服务需要**：无（说明性文案）。
- **当前实现状态**：纯展示。此文案是产品方自己承认的"占位声明"，对判断下方交互元素的真实完成度是关键证据。

### 2.2 Prompt 展示框 + "生成"按钮

- **证据**：
  ```jsx
  <div className="prompt-box">
    <WandSparkles size={18} />
    <span>森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。</span>
    <button type="button">生成</button>
  </div>
  ```
  （main.jsx:218）
- **交互形式**：视觉上是一个类似输入框的容器（`.prompt-box`，styles.css:831-841，白底圆角、`grid-template-columns: auto minmax(0,1fr)` 布局，图标+文字+下方满宽按钮），配一个黑底白字按钮（styles.css:849-858：`border-radius: 999px; background:#000; color:#fff; min-height:44px; cursor:pointer`）。但 `<span>` 是纯文本展示元素，不是 `<input>` 或 `<textarea>`——**用户无法编辑这段 prompt 文案**，它是写死的示例文本"森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。"
- **期望行为**：从视觉呈现（图标+文字+黑色圆角按钮，`cursor: pointer`）看，用户会预期这是一个可以输入自己想要的"氛围描述"（vibe prompt），点击"生成"后触发某种 AI 生成动作，产出对应风格的效果图。这与上一小节文案"描述你想要的宠物小家"的期望一致。
- **数据/服务需要**：该功能需要一个能接收环境照片和文字描述、返回按描述生成的场景效果图的服务。
- **当前实现状态**：占位壳。`<button type="button">生成</button>` 没有绑定任何 `onClick` 处理器（main.jsx:218 逐字核对，button 标签内无事件属性）；展示文案是纯 `<span>` 静态文本，不可编辑，不是真实输入框。这是全项目里"看起来能点但未接处理逻辑"的两个按钮之一（另一个在 `EnvironmentPreviewSection` 的"生成场景报价"，属其它分片）。

### 2.3 上传占位位（upload-grid）

- **证据**：
  ```jsx
  <div className="upload-grid">
    <AssetPlaceholder title="当前笼箱照片" ratio="4:3" icon={Upload} />
    <AssetPlaceholder title="宠物照片" ratio="1:1" icon={Camera} />
  </div>
  ```
  （main.jsx:218）
- **交互形式**：两个 `AssetPlaceholder` 卡片（图标+标题+比例标注），无 `<input type="file">`，点击无反应。与 `PetCreatorSection`（另一分片）里真实存在的 `<label className="upload-pet-card"><input type="file" accept="image/*" onChange={onPetImageUpload} />` 形成对照——那里是可点击真实上传并生成本地预览图，这里只是同款视觉语言的静态占位。
- **期望行为**：图标（Upload 图标 + Camera 图标）和标题（"当前笼箱照片"“宠物照片”）暗示用户预期能分别上传"现在养宠环境的照片"和"宠物本身的照片"，作为后续 AI 效果图生成（配合 2.2 的 prompt）的输入素材。
- **数据/服务需要**：该功能需要一个能接收用户上传的环境照片和宠物照片、并将其作为生成效果图输入的服务。
- **当前实现状态**：占位壳，无真实文件上传能力挂载于此（与文案 2.1 自陈的"当前 demo 保留上传位…后续可连接生图模型"完全对应）。

---

## 3. RenderSection（main.jsx:221-223）

"AI 效果图"区块：三张深色调占位卡，横向排列，代表生成结果的三种呈现形态。

- **证据**：
  ```jsx
  <section className="render-section">
    <div className="section-copy">
      <span>AI 效果图</span>
      <h2>一键生成社媒传播预览，查看小窝的出片效果。</h2>
    </div>
    <div className="render-grid">
      <AssetPlaceholder title="改造前环境" ratio="4:3" icon={Image} tone="dark" />
      <AssetPlaceholder title="AI 改造效果图" ratio="16:9" icon={Sparkles} tone="dark" />
      <AssetPlaceholder title="小红书分享图" ratio="3:4" icon={Image} tone="dark" />
    </div>
  </section>
  ```
  （main.jsx:222）
- **交互形式**：三张纯静态占位卡（`tone="dark"` 深色主题），无按钮、无点击、无输入，视觉上呈现"改造前 → AI 改造后 → 适合分享的成片"三段式对比。
- **期望行为**：标题"一键生成社媒传播预览，查看小窝的出片效果"明确设定用户预期——用户上传环境后应能一键得到（1）改造前的原始环境图、（2）AI 改造后的效果图、（3）裁成适合小红书等社媒分享比例（3:4）的成片。三张卡的不同宽高比（4:3 / 16:9 / 3:4）对应不同用途：原图记录、效果图展示、社交分享裁切。
- **数据/服务需要**：该功能需要一个能基于用户环境照片生成"改造前后对比"效果图、并自动产出适配社媒分享比例的成片的服务。
- **当前实现状态**：纯展示（占位壳）。三张都是 `AssetPlaceholder`，无真实图片、无生成结果、无交互，紧跟在 `UploadVibeSection`（未接处理逻辑的"生成"按钮）之后，二者共同构成"上传 → 生成 → 展示效果图"这条链路里目前全部悬空的中段和输出端。

---

## 4. ScenePackSection（main.jsx:225-227，数据源 `scenePacks` main.jsx:71-75）

"场景包"区块：把多个模块打包成主题化整套方案，用卡片形式展示 3 个场景包。

### 4.1 区块标题

- **证据**：`<span>场景包</span><h2>把喜欢的氛围一键打包成可以落地的爱宠小窝。</h2>`（main.jsx:226）
- **交互形式**：无，纯文本。
- **期望行为**：说明下方卡片代表的是"打包好的整套方案"，而不是单个模块，暗示存在"一键购买整套"的产品形态。
- **数据/服务需要**：无（说明性文案）。
- **当前实现状态**：纯展示。

### 4.2 三张场景包卡片

数据源（main.jsx:71-75）：

```js
const scenePacks = [
  { title: '森林奶酪屋', tag: '花枝鼠首发套装', copy: '洞穴窝、觅食通道、攀爬平台和食盆固定座组成完整环境。', price: '¥399+', image: '/assets/scene-cheese-house.jpg' },
  { title: '都市基地', tag: '适合分享传播', copy: '工业风模块和可清洗平台，把普通笼箱变成主题空间。', price: '¥459+', image: '/assets/scene-urban-base.jpg' },
  { title: '雨林树屋', tag: '扩展物种方案', copy: '为守宫、蜘蛛和树栖宠物准备的湿润垂直攀爬方案。', price: '¥369+', image: '/assets/scene-rainforest-treehouse.jpg' }
];
```

渲染逻辑（main.jsx:226）：

```jsx
<div className="scene-grid">
  {scenePacks.map(({ title, tag, copy, price, image }) => (
    <article className="scene-card" key={title}>
      <div className="scene-media">
        {image ? <img className="scene-image" src={image} alt={`${title} 效果图`} /> : <AssetPlaceholder title={`${title} 效果图`} ratio="16:9" icon={Image} />}
      </div>
      <div className="scene-body">
        <span>{tag}</span><h3>{title}</h3><p>{copy}</p><strong>{price}</strong>
      </div>
    </article>
  ))}
</div>
```

- **交互形式**：三张纯展示卡片，各含真实场景效果图（非占位——`image` 字段均已填充实际路径，styles.css:1941-1975 定义卡片样式：图片 `.scene-image`、标签 `.scene-body span`、标题 `.scene-body h3`、正文 `.scene-body p`、价格 `.scene-body strong`）。卡片本身无按钮、无点击回调、无"加入购物车"或"立即购买"动作。
- **期望行为**：每张卡片展示一个主题场景包的效果图（16:9）、适用标签（如"花枝鼠首发套装"“适合分享传播”“扩展物种方案”）、简介（列出该套装包含的功能性部件组合，如"洞穴窝、觅食通道、攀爬平台和食盆固定座"）和起售价（均为"¥399+"这类"+"结尾的起价格式，暗示价格随选配变化）。用户浏览后应能理解"买这一整套等于买了哪些功能组合"，但当前卡片本身不可点击进入详情或加入订单——视觉上是纯浏览型的营销展示，不是可交互的购买入口。
- **数据/服务需要**：该功能需要一个能提供场景包（主题名称、标签、包含部件说明、起售价格、效果图）目录信息、并支持将场景包对应的具体可打印模块列表关联起来以便履约的服务。
- **当前实现状态**：纯展示。三个场景包均为写死数组数据，真实图片资产已就位（`scene-cheese-house.jpg`、`scene-urban-base.jpg`、`scene-rainforest-treehouse.jpg`，`image` 字段非空故走 `<img>` 分支而非 `AssetPlaceholder` 分支），但卡片无任何点击/购买交互回调，不能选择或加入场景包到预览/订单中（与另一分片 `ModuleCommunitySection` 里单个模块可"加入 3D 场景"的交互形成对比——场景包停留在"整套展示"层面，未提供"加入"或"选购"这一步的挂载点）。

---

## 5. FlipCards（main.jsx:241-243，数据源 `workflowCards` main.jsx:59-68）

"能力地图"区块：8 张可翻转卡片，正面是简述，背面（鼠标悬停触发）展示更深入的产品原则说明。

### 5.1 区块标题

- **证据**：`<span>能力地图</span><h2>把视觉钩子连接到真实产品系统。</h2>`（main.jsx:242）
- **交互形式**：无，纯文本。
- **期望行为**：说明这个区块的作用是把前面展示的各种"视觉钩子"（轮播、创建器、效果图等营销/演示元素）串成一张能力地图，向用户/合作方解释每个环节背后对应的产品系统逻辑。
- **数据/服务需要**：无（说明性文案）。
- **当前实现状态**：纯展示。

### 5.2 八张翻转卡片

数据源（main.jsx:59-68，`workflowCards`，四元组：`[标题, 标签, 正面文案, 背面文案]`）：

| 标题 | 标签 | 正面文案 | 背面文案 |
|---|---|---|---|
| 物种入口 | 浏览 | 大众宠物档案卡进入后，展示对应物种的专属白底配件。 | 用户先从熟悉的物种进入，再看到真正适合该动物的模块。 |
| 宠物档案 | 创建 | 为爱宠命名，选择物种，并调节体型。 | 档案会成为生成、预览、计价和复购的核心锚点。 |
| 3D 形象 | 预览 | 上传宠物图片，生成可旋转的角色式 3D 预览。 | 体验应像游戏角色查看器，而不是静态表单。 |
| 爱宠装扮 | 穿戴 | 添加小帽子、围巾、吊牌等付费装饰。 | 每个穿戴物都有价格、适配规则和预览中的位置反馈。 |
| 标品社区 | 商店 | 纯白底打印模块作为标准 SKU 展示和售卖。 | 每个模块都有价格、材料、重量、适配物种和加入场景动作。 |
| 场景包 | 整装 | 多个模块组合成完整主题宠物空间。 | 前端卖整体效果，后端用标准化可打印部件履约。 |
| 3D 打印 | 生产 | 材料、重量、打印时间和后处理共同驱动报价。 | 同一套选择可以进入生产订单和发货流程。 |
| 实物交付 | 落地 | 从免费效果图到定金、模型确认、打印和发货。 | 这是 AI Agent 把数字想象交付到现实的关键链路。 |

渲染逻辑（main.jsx:242）：

```jsx
<div className="flip-grid">
  {workflowCards.map(([title, label, front, back]) => (
    <div className="flip-card" key={title}>
      <div className="flip-inner">
        <div className="flip-face flip-front"><span>{label}</span><h3>{title}</h3><p>{front}</p></div>
        <div className="flip-face flip-back"><span>{label}</span><h3>{title}</h3><p>{back}</p><ArrowRight size={18} /></div>
      </div>
    </div>
  ))}
</div>
```

- **交互形式**：鼠标悬停触发 3D 翻转动画。样式证据（styles.css:2139-2156）：
  - `.flip-card { min-height: 280px; perspective: 1200px; }`
  - `.flip-inner { transform-style: preserve-3d; transition: transform 700ms cubic-bezier(0.16,1,0.3,1); }`
  - `.flip-card:hover .flip-inner, .flip-card:focus-within .flip-inner { transform: rotateY(180deg); }`
  
  即卡片默认显示正面（白底 `.flip-front`，styles.css:2181-2183 `background:#fff`），鼠标悬停（或键盘聚焦，`:focus-within` 兼顾可访问性）时以 700ms 缓动整体绕 Y 轴翻转 180 度，露出黑底背面（`.flip-back`，styles.css:2185-2189 `background:#000; color:#fff`）。这是纯 CSS `:hover`/`:focus-within` 驱动的效果，main.jsx 内没有任何 JS state 或事件处理器参与翻转逻辑（逐字核对 241-243 行，`<div className="flip-card">` 无 onMouseEnter/onClick 等回调）。
- **期望行为**：用户鼠标划过每张卡片时，卡片翻转露出背面更深一层的产品逻辑说明（例如正面"物种入口/浏览：大众宠物档案卡进入后，展示对应物种的专属白底配件"，背面"用户先从熟悉的物种进入，再看到真正适合该动物的模块"），起到"一句话钩子 + 一句话原理"的渐进展开效果，帮助浏览者（很可能是产品/投资方/合作方，而非普通消费者，从文案"前端卖整体效果，后端用标准化可打印部件履约"“这是 AI Agent 把数字想象交付到现实的关键链路”等措辞可判断）快速理解整个产品从"物种入口"到"实物交付"的 8 段能力地图。
- **数据/服务需要**：无功能性数据/服务需要——这是纯说明性内容展示，8 组标题/标签/正背面文案均为写死数组，不依赖任何用户输入或外部数据源。
- **当前实现状态**：纯展示，交互仅为 CSS hover/focus 驱动的视觉动效（无 JS 状态），内容固定不变。

---

## 本分片小结

本分片 5 个组件全部为**内容/营销类静态展示区块**，特点：

1. **无一个组件持有独立 state**——`IntroSection`、`RenderSection`、`ScenePackSection`、`FlipCards` 完全无状态；`UploadVibeSection` 虽有一个视觉上像交互点的"生成"按钮，但未绑定任何处理器，等同静态。
2. **两处按钮/占位在此分片首次现身，且均为"结构就绪、逻辑未接"**：
   - `UploadVibeSection` 的"生成"按钮（main.jsx:218）——无 `onClick`。
   - `UploadVibeSection` 的两个上传占位位——无真实 `<input type="file">`（与另一分片 `PetCreatorSection` 里真实可用的文件上传形成对比）。
3. **真实图片资产已就位的部分**：`ScenePackSection` 三张场景包卡片使用真实效果图（`scene-cheese-house.jpg`、`scene-urban-base.jpg`、`scene-rainforest-treehouse.jpg`），不是占位符；但卡片本身仍不可点击/不可加入订单。
4. **唯一有真实前端交互动效的组件**是 `FlipCards`，但其交互层级仅限于 CSS hover 3D 翻转特效，不涉及任何数据读写。
5. **本分片内所有"数据/服务需要"归纳**：
   - 一个能接收环境照片和文字描述、返回按描述生成的场景效果图的服务（对应 UploadVibeSection prompt-box + RenderSection 三态效果图输出）。
   - 一个能接收用户上传的环境照片和宠物照片、并将其作为生成效果图输入的服务（对应 UploadVibeSection 上传位）。
   - 一个能提供场景包目录信息（名称、标签、部件组合说明、起售价、效果图）、并支持将场景包关联到具体可打印模块列表以便履约的服务（对应 ScenePackSection）。
   - 一个能保存并展示宠物档案信息（头像、物种、年龄、性格标签）的服务（对应 IntroSection 示例卡，当前为硬编码展示，不读取真实创建的档案）。
   - 一个能提供物种习性适配规则（喜好、风险、材料建议）内容来源的服务（对应 IntroSection 习性面板，当前未与用户实际选择的物种联动）。
   - `FlipCards`（能力地图）本身不产生任何数据/服务需要，纯说明性内容。
