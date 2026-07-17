# 分片 shard-01-hero-nav — 首屏 Hero + 导航 + 详情抽屉

> 隔离声明：本笔记仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现，不涉及、不引用、不猜测任何后端项目或其它 PRD。数据/持久化/生成能力一律用"该功能需要一个能 X 的服务"的中立表述。

**依据版本**：以 `src/main.jsx`（2026-07-04 17:41:14，晚于 dist 构建产物）为唯一提取依据。本分片覆盖范围内 src 与 dist 内容一致，无 dist 独有差异（差异集中在 GiftSection / ModuleCommunitySection，不在本分片）。

**覆盖范围**：`Navbar`（main.jsx:107-118）、`HeroFooter`（main.jsx:120-131）、`DetailDrawer`（main.jsx:133-135）、`App` 内 `hero-shell` 区块（main.jsx:263 单行内联 JSX）。素材：`hero-mouse.mp4` / `hero-mouse-poster.jpeg` / `petscape-logo.png`（均已确认存在于 `public/assets/`）。

---

## 1. Navbar（main.jsx:107-118）

品牌区 + 菜单入口 + 快捷跳转，固定在首屏顶部，随页面淡入（`initial={{ y: -16, opacity: 0 }}` → `animate={{ y: 0, opacity: 1 }}`，`duration: 0.8`）。

### 1.1 品牌按钮

- **证据**：`main.jsx:111` `<button className="brand-button" type="button" aria-label="PetScape"><img className="brand-logo" src="/assets/petscape-logo.png" alt="PetScape" /></button>`
- **交互形式**：按钮包裹 logo 图片，无 `onClick` 绑定。
- **期望行为**：从 `aria-label="PetScape"` 及品牌位置推断，用户预期点击后回到首页/顶部，但当前无任何处理器，点击无响应。
- **数据/服务需求**：无（纯静态品牌展示）。
- **当前实现状态**：纯展示（占位壳级别的"能点但无动作"按钮——注意这是本分片内唯一一个结构像可点但未绑定处理器的元素，需与 `_map.md` 中记录的另外两处"生成"类按钮区分：那两处是"功能未接入"，这里是"品牌按钮惯例性存在但产品未定义点击目标"）。

### 1.2 菜单按钮（"菜单"）

- **证据**：`main.jsx:112` `<button className="menu-pill" type="button" onClick={onOpen}><span className="dark-circle light-circle"><Plus size={12} strokeWidth={3} /></span><span>菜单</span></button>`；`onOpen` 由 App 传入 `() => setDrawerOpen(true)`（main.jsx:263）。
- **交互形式**：点击按钮，图标为 `Plus`（加号，非通常的汉堡菜单图标）。
- **期望行为**：点击后打开右侧 `DetailDrawer` 详情抽屉，展示"AI 交付链路"说明。文案是"菜单"但实际行为是打开一个只读的产品介绍抽屉，而非站内导航菜单——命名与实际功能有轻微错位，属于文案证据需忠实记录的情况。
- **数据/服务需求**：无（本地 UI 状态切换，纯前端交互）。
- **当前实现状态**：本地 JS 状态（`drawerOpen` boolean，App 级 state，main.jsx:246）。

### 1.3 标签展示（"宠物形象" / "标品社区"）

- **证据**：`main.jsx:113` `<div className="tags-pill nav-tags"><span>宠物形象</span><span>标品社区</span></div>`
- **交互形式**：纯展示，无按钮元素，无点击回调。
- **期望行为**：从视觉上作为导航区的品类标签胶囊，暗示站内有"宠物形象"和"标品社区"两大板块，但两个 `<span>` 都不是可点击元素，不能跳转。
- **数据/服务需求**：无。
- **当前实现状态**：纯展示。

### 1.4 "白底标品"按钮（右侧系统按钮）

- **证据**：`main.jsx:115` `<div className="nav-right"><button className="system-pill" type="button" onClick={onBrowseModules}><span className="dark-circle"><GridIcon /></span><span>白底标品</span></button></div>`；`onBrowseModules` 由 App 传入 `scrollToModules`，实现为 `moduleMarketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })`（main.jsx:258）。
- **交互形式**：点击按钮，图标为自定义 `GridIcon`（网格图标）。
- **期望行为**：点击后页面平滑滚动锚定到"爱宠之家社区"（模块市场）区块，用户预期能快速跳转浏览可打印标品，行为与文案一致，是一次真实的锚点导航。
- **数据/服务需求**：无（纯前端 DOM 滚动定位，不涉及数据获取）。
- **当前实现状态**：本地 JS 状态/DOM 操作（`ref` + `scrollIntoView`，真实生效的锚点跳转，非占位）。

---

## 2. HeroFooter（main.jsx:120-131）

首屏底部文案区 + 主 CTA，逐段延迟淡入动效（`delay: 0.5` footer 整体 → `delay: 0.6` 副标题 → `delay: 0.8` 主标题 → `delay: 1` CTA 行）。

### 2.1 副标题

- **证据**：`main.jsx:124` `<span>每一个洞口都是房间，每一层都是故事。</span>`
- **交互形式**：纯展示文案，无交互。
- **期望行为**：氛围文案，无功能预期。
- **数据/服务需求**：无。
- **当前实现状态**：纯展示。

### 2.2 主标题

- **证据**：`main.jsx:125` `<motion.h1 ...>为爱宠定制，<br />把想象打印成家。</motion.h1>`
- **交互形式**：纯展示文案。
- **期望行为**：产品主张陈述，无交互预期。
- **数据/服务需求**：无。
- **当前实现状态**：纯展示。

### 2.3 CTA "开始定制"

- **证据**：`main.jsx:126` `<button className="cta-button primary" type="button" onClick={onOpen}>开始定制</button>`；`onOpen` 同样绑定 `() => setDrawerOpen(true)`（main.jsx:263）。
- **交互形式**：点击按钮（主 CTA，视觉上强调样式 `primary`）。
- **期望行为**：文案"开始定制"暗示用户预期点击后直接进入宠物定制/创建流程（例如跳转到 `PetCreatorSection` 或打开创建表单），但实际行为与 Navbar 的"菜单"按钮完全相同——打开的是同一个只读介绍性 `DetailDrawer`（展示"AI 交付链路"文字说明和 4 条能力摘要），并不会滚动到或聚焦真正的宠物创建器表单。这是文案期望（"开始定制"=进入定制流程）与实际实现（=打开说明抽屉）之间的一处落差，提取时需明确指出。
- **数据/服务需求**：若未来要让"开始定制"真正引导至创建流程，需要一个能承载宠物档案创建（见 shard-03）的入口跳转能力；当前该按钮本身不产生任何数据请求。
- **当前实现状态**：本地 JS 状态（与菜单按钮共享同一个 `drawerOpen` state，非独立的"定制流程启动"逻辑）。

### 2.4 CTA "浏览标品"

- **证据**：`main.jsx:126` `<button className="cta-button secondary" type="button" onClick={onBrowseModules}>浏览标品</button>`；同 Navbar 的 `scrollToModules`。
- **交互形式**：点击按钮（次 CTA，样式 `secondary`）。
- **期望行为**：点击后平滑滚动到模块市场区块，与文案一致，是真实生效的锚点跳转。
- **数据/服务需求**：无。
- **当前实现状态**：本地 JS 状态/DOM 操作（真实生效，非占位）。

### 2.5 底部标签列表（"宠物档案" / "爱宠装扮" / "3D 预览"）

- **证据**：`main.jsx:128` `<div className="footer-right"><span>宠物档案</span><span>爱宠装扮</span><span>3D 预览</span></div>`
- **交互形式**：纯展示，无按钮元素，无点击回调。
- **期望行为**：作为首屏的功能预告标签，暗示下方页面包含这三大能力区块（分别对应 shard-03 的宠物档案创建、装扮商店、3D 旋转预览），但本身不可点击、不跳转。
- **数据/服务需求**：无（纯导览提示）。
- **当前实现状态**：纯展示。

---

## 3. DetailDrawer（main.jsx:133-135）

受控的侧边详情抽屉，由 `drawerOpen` boolean 驱动显隐，用 `AnimatePresence` 包裹实现进出场动效（`initial/animate/exit` 都是 `x: 24` ↔ `x: 0` 位移 + 透明度渐变，`duration: 0.45`）。

### 3.1 关闭按钮

- **证据**：`main.jsx:134` `<button className="drawer-close" type="button" onClick={onClose} aria-label="关闭详情"><Plus size={15} strokeWidth={2.5} /></button>`；`onClose` 由 App 传入 `() => setDrawerOpen(false)`。
- **交互形式**：点击按钮，图标为旋转视觉暗示（`Plus` 图标搭配 `drawer-close` class，视觉上通常渲染成 "×"，但源码引用的确实是 `Plus` 图标本体，具体旋转靠 CSS 完成，需查 styles.css 确认，未在本分片深究）。
- **期望行为**：点击后抽屉滑出关闭，`aria-label="关闭详情"` 明确其语义。
- **数据/服务需求**：无。
- **当前实现状态**：本地 JS 状态（真实生效）。

### 3.2 抽屉标题区

- **证据**：`main.jsx:134` `<div className="drawer-kicker">AI 交付链路</div><h2>从可分享视觉，到可玩的宠物角色预览。</h2><p>产品从大众物种入口开始，让用户创建宠物档案、生成 3D 形象、添加付费装扮，再把可打印模块放进真实 3D 场景。</p>`
- **交互形式**：纯展示文案，无交互。
- **期望行为**：向用户说明整体产品链路，是一段导览/说明文字，不产生具体功能预期。
- **数据/服务需求**：无。
- **当前实现状态**：纯展示。

### 3.3 四条能力摘要（drawer-grid）

- **证据**：`main.jsx:134` 完整摘要块：
  - `<Camera size={18} /><strong>上传宠物</strong><span>照片、物种、体型、档案名</span>`
  - `<Rotate3D size={18} /><strong>3D 预览</strong><span>游戏角色式旋转查看器</span>`
  - `<ShoppingBag size={18} /><strong>付费装扮</strong><span>每个穿戴物都有明确价格</span>`
  - `<BadgeCheck size={18} /><strong>打印模块</strong><span>纯白底标准 SKU 社区</span>`
- **交互形式**：纯展示网格，四个图标+标题+说明文字组合，均无点击回调。
- **期望行为**：作为产品能力的四点摘要导览，分别预告：(1) 宠物照片/信息上传能力、(2) 3D 旋转查看器、(3) 带价格的付费装扮体系、(4) 白底标准化打印模块商品库。这四点分别对应 shard-03（宠物创建器+装扮商店）和 shard-04（模块社区+3D 环境预览）的实际功能区块，此处仅为文字导览，不是可交互入口。
- **数据/服务需求**：
  - "上传宠物"一条对应"该功能需要一个能接收用户上传的宠物照片、物种、体型、档案名并保存为宠物档案的服务"（实际实现见 shard-03）；
  - "3D 预览"一条对应"该功能需要一个能围绕宠物形象生成可旋转查看的 3D/角色预览的服务"；
  - "付费装扮"一条对应"该功能需要一个能管理穿戴商品价格、并支持组合结算的服务"；
  - "打印模块"一条对应"该功能需要一个能列出标准化打印模块 SKU 及其分类/物种适配信息的服务"。
  - 本分片内这四点仅为静态摘要文案，不产生实际数据请求。
- **当前实现状态**：纯展示（抽屉本身的开关是本地 JS 状态，但抽屉内容是写死的静态文案，不随任何 App state 变化）。

---

## 4. hero-shell 区块（App 内联，main.jsx:263）

首屏最外层容器，从代码结构看包含 `Navbar` + 视频包裹层 + `HeroFooter` + `DetailDrawer` 四个子元素。

### 4.1 首屏背景视频

- **证据**：`main.jsx:263` `<motion.div className="video-wrap" initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.8, ease }}><video className="hero-video" src="/assets/hero-mouse.mp4" poster="/assets/hero-mouse-poster.jpeg" autoPlay muted playsInline loop /></motion.div>`
- **交互形式**：无交互控件（无播放/暂停按钮、无进度条），`autoPlay muted playsInline loop` 四属性齐全，即自动静音循环播放，用户唯一能做的是被动观看，不能操作视频本身。
- **期望行为**：营造首屏氛围（花枝鼠场景视频），配合 1.8 秒的缩放+淡入动效强化开场质感。素材文件 `hero-mouse.mp4`（约 8.5MB）与海报图 `hero-mouse-poster.jpeg`（约 2MB）均已在 `public/assets/` 目录下确认存在，非占位素材。
- **数据/服务需求**：无（静态视频文件，非动态生成/拉流内容）。
- **当前实现状态**：纯展示（真实视频素材已就位，非 `AssetPlaceholder` 占位卡）。

---

## 5. 本分片小结

| 元素 | 交互 | 期望行为对齐度 | 实现状态 |
|---|---|---|---|
| 品牌按钮 | 无 onClick | 隐含"点击回顶部/首页"但无处理器 | 纯展示（无动作绑定） |
| 菜单按钮 | onClick 打开抽屉 | 文案"菜单"，实际打开的是只读介绍抽屉而非导航菜单 | 本地 JS 状态 |
| 导航标签胶囊 | 无 | 纯展示 | 纯展示 |
| "白底标品"按钮 | onClick 滚动锚定 | 与文案一致，真实生效 | 本地 JS 状态/DOM |
| 首屏副标题/主标题 | 无 | 纯文案 | 纯展示 |
| "开始定制" CTA | onClick 打开抽屉 | 文案暗示进入定制流程，实际只打开介绍抽屉，与"浏览标品"锚点跳转的真实生效程度不同 | 本地 JS 状态 |
| "浏览标品" CTA | onClick 滚动锚定 | 与文案一致，真实生效 | 本地 JS 状态/DOM |
| 底部功能标签 | 无 | 纯导览提示 | 纯展示 |
| 抽屉关闭按钮 | onClick 关闭 | 与 aria-label 一致 | 本地 JS 状态 |
| 抽屉标题/摘要文案 | 无 | 静态导览说明，预告后续功能区块 | 纯展示 |
| 首屏背景视频 | 无控件，自动播放 | 氛围展示，素材已就位 | 纯展示（真实素材） |

**关键发现（需在综合审查时特别注意）**：Navbar 的"菜单"按钮与 HeroFooter 的"开始定制"按钮共享同一个 `onOpen` 回调、指向同一个 `drawerOpen` state，两个文案不同的按钮触发完全相同的行为（打开同一个只读产品介绍抽屉）。"开始定制"字面期望是启动一个定制流程/表单，但实际未跳转到 `PetCreatorSection` 或做任何"定制"相关的初始化，只是展示静态说明文字。这不是"占位壳"（抽屉本身真实渲染、可关闭），而是"文案命名的功能意图 > 已绑定的实际行为"的落差，与 `_map.md` 中记录的"生成场景报价"/"生成"两处无 onClick 按钮性质不同（那两处是完全无绑定，这里是绑定了但绑定到了一个更浅的行为）。
