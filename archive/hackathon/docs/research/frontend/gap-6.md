# Gap-6 — [G5] 「开始定制」/「创建专属宠物档案」CTA 未导向真实创建流程

> 隔离声明：本笔记仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现（组件、交互、素材、文案），不涉及、不引用、不猜测任何后端项目或其它 PRD。凡涉及数据/持久化/生成能力之处，一律用"该功能需要一个能 X 的服务"的中立表述。

**缺口来源**：`verify-prd.md` G5（PRD §5.1 主流程第 1→3 步"进入首页 → 选择品种 → 创建档案"、§6.1 主 CTA"开始定制"）。本文档是该缺口对应的前端实物证据补充提取，格式对齐 `section-shard-*.md` 系列。

**依据版本**：以 `src/main.jsx`（2026-07-04 17:41:14，晚于 dist 构建产物）为唯一提取依据，本文档覆盖的 3 处 CTA 与 `App` 顶层接线代码在 src 与 dist 间无差异（dist 唯二已知差异是"查看更多"文案与礼物图素材，均不在本缺口范围内）。

**结论先行**：**缺口成立**。已在 `src/main.jsx` 中直接核验：全站恰好存在 3 处文案指向"进入定制/创建宠物档案"的 CTA（Navbar"菜单"、HeroFooter"开始定制"、SpeciesShowcase"创建专属宠物档案"卡片），三者的 `onClick`/`onOpen`/`onAddPet` 全部指向同一个回调 `() => setDrawerOpen(true)`（main.jsx:263），只打开一个只读的 `DetailDrawer` 介绍抽屉（main.jsx:133，静态文案"AI 交付链路"+ 四条能力摘要），不会滚动或跳转到页面下方真正可交互的宠物档案创建表单 `PetCreatorSection`（main.jsx:188-192，`className="pet-creator-section"`）。

---

## 1. 直接源码证据

### 1.1 三处 CTA 与其绑定的回调（均指向同一处理器）

| CTA 位置 | 证据（main.jsx） | 绑定的 prop | 实际回调（main.jsx:263, App 组件） |
|---|---|---|---|
| Navbar"菜单"按钮 | `main.jsx:112` `<button className="menu-pill" type="button" onClick={onOpen}>...<span>菜单</span></button>` | `onOpen` | `<Navbar onOpen={() => setDrawerOpen(true)} .../>` |
| HeroFooter"开始定制"主 CTA | `main.jsx:126` `<button className="cta-button primary" type="button" onClick={onOpen}>开始定制</button>` | `onOpen` | `<HeroFooter onOpen={() => setDrawerOpen(true)} .../>` |
| SpeciesShowcase"创建专属宠物档案"卡片 | `main.jsx:181` `<button className="add-species-card compact-add-species" type="button" onClick={onAddPet}>...<h3>创建专属宠物档案</h3>...</button>` | `onAddPet` | `<SpeciesShowcase ... onAddPet={() => setDrawerOpen(true)} />` |

三处 prop 名称不同（`onOpen` / `onOpen` / `onAddPet`），但在 `App` 组件里传入的实参**逐字相同**：`() => setDrawerOpen(true)`。即无论用户点击哪一个、文案如何暗示，触发的都是同一个 boolean state 翻转。

### 1.2 `setDrawerOpen(true)` 实际打开的内容——只读介绍抽屉

- **证据**：`main.jsx:133` `function DetailDrawer({ open, onClose }) { return <AnimatePresence>{open && <motion.aside className="detail-drawer" ...><button className="drawer-close" .../><div className="drawer-kicker">AI 交付链路</div><h2>从可分享视觉，到可玩的宠物角色预览。</h2><p>产品从大众物种入口开始，让用户创建宠物档案、生成 3D 形象、添加付费装扮，再把可打印模块放进真实 3D 场景。</p><div className="drawer-grid">...四条图标+文案摘要...</div></motion.aside>}</AnimatePresence>; }`
- 抽屉内容是**纯静态文案**（产品链路说明 + 四条能力摘要：上传宠物/3D 预览/付费装扮/打印模块），不包含任何表单元素（无 input、无 file upload、无 range slider），也不含指向 `PetCreatorSection` 的按钮或链接。
- 唯一的交互是关闭按钮（`onClose` → `setDrawerOpen(false)`），点击后抽屉消失，页面停留在原滚动位置，**不会**发生任何滚动或跳转。

### 1.3 真正的创建表单存在，但未被这三处 CTA 引用

- **证据**：`main.jsx:188` `function PetCreatorSection({ selectedSpecies, onSelectSpecies, petName, onPetNameChange, petSize, onPetSizeChange, petImageUrl, onPetImageUpload, avatarGenerated, onGenerateAvatar, avatarRotation, onAvatarRotationChange, selectedWearables, onToggleWearable }) { return <section className="pet-creator-section">...<h2>上传你的爱宠照片和信息，同步赛博云宠，快来装扮你的爱宠吧。</h2>...`，内含真实姓名 input、物种切换、体型 range、`<input type="file" accept="image/*" onChange={onPetImageUpload} />` 照片上传等完整表单控件（详见 `section-shard-03-pet-creator.md`）。
- 该组件在 `App` 内被渲染在 `SpeciesShowcase` 之后（`main.jsx:263`：`<SpeciesShowcase .../><PetCreatorSection .../>`），是页面 DOM 顺序中紧随其后的下一个 section，物理上并不远，但**代码里没有任何 ref/scrollIntoView/锚点跳转把三处 CTA 与这个 section 连接起来**。
- **对比证据（同一文件内已有可行方案，说明"缺口"不是技术受限，而是未接线）**：`App` 组件对 `ModuleCommunitySection`/`EnvironmentPreviewSection` 一侧使用了完全相同的模式并接好了线——`const moduleMarketRef = useRef(null);` + `const scrollToModules = () => moduleMarketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });`（main.jsx:257-258），"白底标品"/"浏览标品"两个 CTA 都绑定 `onBrowseModules={scrollToModules}`，点击后真实平滑滚动到模块市场区块。`PetCreatorSection` 在 `App` 里的渲染语句 `<PetCreatorSection selectedSpecies={...} ... />`（main.jsx:263）**没有被赋予任何 `ref` prop**，也没有类似 `creatorRef`/`scrollToCreator` 的变量或函数存在于全文件——即该组件本身没有暴露可供滚动定位的锚点。

---

## 2. 功能点提取（对齐 section-shard 格式）

### 2.1 首屏主 CTA "开始定制"

- **证据**：`main.jsx:126`
- **交互形式**：点击按钮（`cta-button primary`，视觉强调样式）。
- **期望行为**：文案"开始定制"暗示点击后进入宠物定制/创建流程（对应 PRD §5.1 第 3 步"创建档案"、§6.1 主 CTA 定义）。
- **实际行为**：打开只读 `DetailDrawer` 介绍抽屉（静态文案，无表单），不滚动/不跳转到 `PetCreatorSection`。
- **数据/服务需求**：CTA 本身不产生数据请求；若要让其兑现文案期望，需要把点击行为改为跳转/滚动到已存在的创建表单区域（该表单自身的数据需求见 `section-shard-03-pet-creator.md`：一个能接收宠物照片上传、记录名字/物种/体型等档案信息的服务）。
- **当前实现状态**：本地 JS 状态（与另外两处 CTA 共享同一个 `drawerOpen` boolean，非独立的"进入创建流程"逻辑）。

### 2.2 轮播下方 "创建专属宠物档案" 卡片

- **证据**：`main.jsx:181`
- **交互形式**：虚线边框卡片式按钮，紧邻物种轮播下方，带加号图标。
- **期望行为**：标题"创建专属宠物档案"+ 说明文案"上传照片、记录名字与习性，让每一次装扮和打印都围绕你的爱宠展开"，明确指向"上传宠物照片 + 填写名字/习性"的档案创建动作。
- **实际行为**：与"开始定制"按钮完全相同——打开同一个只读 `DetailDrawer`，不进入任何可填写表单。
- **数据/服务需求**：同 2.1。
- **当前实现状态**：本地 JS 状态（占位壳级别的"文案与绑定行为不一致"按钮）。

### 2.3 Navbar "菜单" 按钮（同一问题的第三处触发点，非缺口描述原文点名但共享同一根因，一并记录供综合审查参考）

- **证据**：`main.jsx:112`
- **交互形式**：点击按钮，图标为 `Plus` 加号（非常规汉堡菜单图标）。
- **期望行为**：文案"菜单"通常暗示打开站内导航；从图标和位置看用户也可能预期这是通用入口。
- **实际行为**：与前两处相同，打开同一个只读介绍抽屉。
- **数据/服务需求**：无。
- **当前实现状态**：本地 JS 状态。
- **备注**：此项不在缺口描述原文列出的两处 CTA 之列，但因其共享完全相同的回调与根因（三处按钮 → 同一个 `drawerOpen` state → 同一个只读抽屉），为避免遗漏同类问题在此一并记录，不影响缺口 G5 的判定范围（缺口判定仍以原描述点名的"开始定制"与"创建专属宠物档案"两处为准）。

---

## 3. 缺口成立性判定

**判定：缺口成立，证据充分，无需修正 `verify-prd.md` G5 的既有表述。**

- 三处 CTA 的 `onClick`/`onOpen`/`onAddPet` 均可在 `main.jsx:263` 一行内联渲染代码中直接读到指向同一个 `() => setDrawerOpen(true)`，非推测。
- `DetailDrawer`（main.jsx:133）内容逐字核对，确认无表单元素、无到 `PetCreatorSection` 的跳转逻辑。
- `PetCreatorSection`（main.jsx:188-192, 渲染于 263 行）确认是独立存在、功能完整的真实创建表单，但在 `App` 顶层没有被赋予 `ref`，全文件搜索确认不存在任何指向它的 `scrollIntoView`/锚点变量——即"真实创建流程"客观存在，只是未被这三处 CTA 引用。
- 对照组证据：`moduleMarketRef` + `scrollToModules`（main.jsx:257-258）证明"ref + 平滑滚动"这一模式在同一文件内已被验证可行并用于另一组 CTA（"白底标品"/"浏览标品"），说明这不是技术限制，而是 `PetCreatorSection` 一侧未做同等接线。

---

## 4. 功能点小结（用于结构化提取）

| 元素 | 交互 | 期望行为 vs 实际行为 | 实现状态 |
|---|---|---|---|
| "开始定制"主 CTA（HeroFooter） | onClick 打开抽屉 | 期望：进入定制/创建流程；实际：打开只读介绍抽屉 | 本地 JS 状态（占位壳级——绑定了处理器但处理器行为浅于文案期望） |
| "创建专属宠物档案"卡片（SpeciesShowcase 下方） | onClick 打开抽屉 | 期望：进入档案创建表单；实际：打开只读介绍抽屉 | 本地 JS 状态（同上） |
| Navbar"菜单"按钮（同根因，非原缺口点名对象） | onClick 打开抽屉 | 期望：站内导航；实际：打开只读介绍抽屉 | 本地 JS 状态（同上） |
| `PetCreatorSection` 真实创建表单 | 姓名 input / 物种切换 / 体型 range / 真实文件上传 | 表单本身功能完整、真实可用（见 shard-03） | 本地 JS 状态（真实生效，但未被上述三处 CTA 引用） |

**数据/服务需求汇总**：修复本缺口（把 CTA 接到真实创建流程）本身不引入新的数据/服务需求——纯前端跳转/滚动逻辑即可解决；`PetCreatorSection` 表单自身已有的数据需求（接收宠物照片上传、记录/持久化宠物档案）已在 `section-shard-03-pet-creator.md` 中记录，此处不重复展开。
