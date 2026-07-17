# Shard 02 — 大众物种入口轮播（SpeciesShowcase）

来源文件：`<USER_HOME>/Desktop/设计师前端页面/src/main.jsx`（组件定义于 137-181 行，数据源 species 数组于 28-34 行）与 `<USER_HOME>/Desktop/设计师前端页面/src/styles.css`（474-747 行，2263-2467 行响应式规则）。

## 分片说明

本分片以 `src/main.jsx` + `src/styles.css` 为唯一依据。已逐条比对 dist 构建产物提取出的 344 条中文字符串，在本分片覆盖范围内两边完全一致，dist 无独有组件或文案。（dist 与 src 存在的 2 处全局差异——"爱宠社区已展开"改为"收起"、GiftSection 占位图换成真图——均不落在本分片范围内，仅供追溯记录。）

---

## 1. 数据源：species 数组（main.jsx:28-34）

```js
const species = [
  { id: 'rat', name: '花枝鼠', en: 'Fancy Rat', image: '/assets/species-rat.png', traits: ['爱社交', '爱啃咬', '热爱钻洞'], material: 'PETG / 圆角安全处理', habitat: '层板、隧道、觅食房间', modules: [...] },
  { id: 'gecko', name: '守宫', en: 'Gecko', ... },
  { id: 'snake', name: '蛇', en: 'Snake', ... },
  { id: 'parrot', name: '鹦鹉', en: 'Parrot', ... },
  { id: 'spider', name: '蜘蛛', en: 'Tarantula', ... }
];
```

5 个物种条目，每条包含：`id`、中文名 `name`、英文名 `en`、素材路径 `image`（对应 `public/assets/species-{rat,gecko,snake,parrot,spider}.png`，5 个文件均已确认存在于磁盘）、`traits`（3 条习性标签）、`material`（材质说明文案）、`habitat`（栖息环境文案）、`modules`（该物种关联的可打印模块 id 列表，供后续 ModuleCommunitySection/PetCreatorSection 复用，但轮播卡片本身未渲染 modules 字段）。

- **交互形式**：纯数据结构，无直接交互；驱动下方轮播卡片渲染。
- **期望行为**：作为 5 个物种的唯一真相源，被 SpeciesShowcase、PetCreatorSection 的物种选择行（`species-select-row`）共同复用。
- **数据/服务需求**：当前是硬编码的前端常量数组。若要支持运营方更新物种列表、习性文案或替换素材图，需要一个能维护"物种档案"内容的能力（名称、习性、材质说明、栖息环境描述、图片资源）。
- **当前实现状态**：本地 JS 常量，纯展示型数据，无接口获取。

---

## 2. 区块标题文案（main.jsx:181）

引用原文：

> `<span>大众物种入口</span><h2>先从熟悉的宠物进入，再浏览它专属的白底配件。</h2>`

- **交互形式**：纯展示文本，无交互。
- **期望行为**：向用户说明本区块定位——通过用户熟悉的宠物物种作为入口，引导浏览该物种对应的打印配件（白底商品图）。
- **数据/服务需求**：静态文案，无数据依赖。
- **当前实现状态**：纯展示。

---

## 3. 物种轮播卡片（`species-carousel` / `species-carousel-stage`，main.jsx:181）

### 3.1 卡片本体

```jsx
<motion.button className={`species-card species-button carousel-species-card ${isActive ? 'selected' : ''}`}
  type="button" onClick={() => chooseSpecies(index)}
  animate={{ x: pose.x, y: pose.y, scale: pose.scale, opacity: pose.opacity, rotateY: pose.rotateY }}
  transition={{ duration: 0.82, ease }}
  aria-pressed={isActive}>
  <div className="species-image-frame"><img src={item.image} alt={`${item.name} 档案卡照片`} /><span>{item.name} 档案图 / 4:5</span></div>
  <div className="species-copy"><span>{item.en}</span><h3>{item.name}</h3><p>{item.habitat}</p>
    <div className="profile-tags">{item.traits.map(trait => <span key={trait}>{trait}</span>)}</div>
    <strong>{item.material}</strong>
  </div>
</motion.button>
```

- **交互形式**：可点击的按钮式卡片（`type="button"`、`aria-pressed`），5 张卡片以 3D 环形轮播布局堆叠展示（每张卡片按与当前激活项的相对位置计算 `x`/`y`/`scale`/`opacity`/`rotateY`，见 `getCardPose` 函数，main.jsx:164-179）；点击任意一张卡片会将其设为激活项。
- **期望行为**：
  - 点击卡片 → 调用 `chooseSpecies(index)`（main.jsx:158-162）→ 更新 `activeIndex`、通知父组件 `onSelectSpecies(species[index].id)`（联动 `PetCreatorSection` 的当前选中物种）、并重置自动轮播计时器（`setRotationSeed`）。
  - 视觉预期：当前激活卡片居中放大（`scale: 1`, `opacity: 1`），相邻卡片依距离缩小/半透明（距离 1 时 `scale: 0.84, opacity: 0.68`；距离 2+ 时 `scale: 0.68, opacity: 0.36`），并沿 Y 轴旋转（`rotateY: offset * -13`）制造 3D 环绕效果，形成"游戏角色选择转盘"式体验。
  - 卡片内展示：物种照片（4:5 比例，图片下方浮贴文字标签"`{物种名} 档案图 / 4:5`"，如"花枝鼠 档案图 / 4:5"，作为设计稿阶段的素材尺寸标注）、英文名（大写小字）、中文名（大字号标题）、栖息环境描述（`habitat`）、习性标签胶囊组（`traits`，如"爱社交""爱啃咬""热爱钻洞"）、材质说明（`material`，如"PETG / 圆角安全处理"）。
- **需要的数据/服务能力**：无额外服务能力需求——纯前端状态切换 + 已有的本地物种数据渲染。若素材图需要按物种批量替换/上新，则需要一个能托管并按 `id` 关联物种图片的资源管理能力。
- **当前实现状态**：本地 JS 状态（`useState` 管理 `activeIndex`），配合 Framer Motion（`motion/react`）做动画插值，属于纯前端交互 + 视觉展示，不涉及任何网络请求。

### 3.2 自动轮播（main.jsx:147-156）

```js
useEffect(() => {
  const timer = window.setInterval(() => {
    setActiveIndex(current => {
      const next = (current + 1) % species.length;
      onSelectSpecies(species[next].id);
      return next;
    });
  }, 4200);
  return () => window.clearInterval(timer);
}, [onSelectSpecies, rotationSeed]);
```

- **交互形式**：无用户操作，页面加载后自动运行的定时器。
- **期望行为**：每 4.2 秒自动切换到下一个物种（循环），并同步通知父组件更新当前选中物种；用户手动点击卡片或圆点后，计时器通过 `rotationSeed` 依赖重置（即手动切换会重新计时 4.2 秒，避免手动选择后立刻被自动轮播打断）。
- **数据/服务需求**：无，纯前端定时器逻辑。
- **当前实现状态**：本地 JS 状态/副作用（`useEffect` + `setInterval`），纯前端行为。

### 3.3 外部受控同步（main.jsx:138, 142-145）

```js
const selectedIndex = Math.max(0, species.findIndex(item => item.id === selectedSpeciesId));
const [activeIndex, setActiveIndex] = useState(selectedIndex);
useEffect(() => {
  const nextIndex = Math.max(0, species.findIndex(item => item.id === selectedSpeciesId));
  setActiveIndex(nextIndex);
}, [selectedSpeciesId]);
```

- **交互形式**：非直接交互，响应父组件传入的 `selectedSpeciesId` prop 变化（例如用户在下方 `PetCreatorSection` 的物种选择行点击了另一个物种）。
- **期望行为**：保持轮播卡片的激活状态与全局"当前选中物种"状态双向同步——无论用户在轮播里点还是在下方创建档案区选择，两处状态始终一致。
- **数据/服务需求**：无，前端组件间状态提升（lifted state），由 `App` 顶层组件的 `selectedSpeciesId`/`setSelectedSpeciesId`（main.jsx:247）统一持有。
- **当前实现状态**：本地 JS 状态（受控组件模式）。

---

## 4. 轮播圆点导航（`species-dots`，main.jsx:181）

```jsx
<div className="species-dots">
  {species.map((item, index) => <button className={index === activeIndex ? 'active' : ''} key={item.id}
    type="button" onClick={() => chooseSpecies(index)} aria-label={`切换到${item.name}`} />)}
</div>
```

- **交互形式**：5 个圆点按钮，点击任意一个直接跳转到对应物种。`aria-label` 为"切换到花枝鼠""切换到守宫"等（逐字引用 `切换到${item.name}`）。
- **期望行为**：作为轮播卡片的辅助导航/进度指示器——当前激活项对应的圆点会横向拉长并变为纯黑色（CSS：`.species-dots button.active { width: 28px; background: #000; }`，styles.css:632-635），未激活圆点为浅灰色小圆点（`width: 8px; background: rgba(0,0,0,0.18)`，styles.css:622-629），提供"共 5 项，当前第几项"的视觉反馈。
- **数据/服务需求**：无。
- **当前实现状态**：纯前端交互 + CSS 过渡动画（`transition: width 180ms ease, background 180ms ease`）。

---

## 5. "创建专属宠物档案"卡片（`add-species-card compact-add-species`，main.jsx:181）

```jsx
<button className="add-species-card compact-add-species" type="button" onClick={onAddPet}>
  <span className="add-species-icon"><Plus size={20} strokeWidth={2.4} /></span>
  <div><span>宠物档案</span><h3>创建专属宠物档案</h3>
    <p>上传照片、记录名字与习性，让每一次装扮和打印都围绕你的爱宠展开。</p>
  </div>
</button>
```

- **交互形式**：虚线边框卡片式按钮（styles.css:637-651，`border: 1px dashed rgba(0,0,0,0.28)`），带加号图标（Plus icon），紧邻轮播下方。
- **期望行为**：文案逐字引用——
  - 小标签："宠物档案"
  - 标题："创建专属宠物档案"
  - 说明文字："上传照片、记录名字与习性，让每一次装扮和打印都围绕你的爱宠展开。"
  - 从文案看，用户预期点击后应进入"上传宠物照片 + 填写名字/习性"的档案创建流程。
- **实际接线行为（main.jsx:263，App 顶层组件）**：`onAddPet` 被传入为 `() => setDrawerOpen(true)`，即点击此卡片实际打开的是页面顶部的 `DetailDrawer`（"AI 交付链路"说明抽屉，展示"上传宠物→3D 预览→付费装扮→打印模块"四步流程介绍卡片，main.jsx:134），**并不会**直接跳转或滚动到下方真正可填写的宠物档案创建区块（`PetCreatorSection`，页面下方独立区块，标题"上传你的爱宠照片和信息，同步赛博云宠，快来装扮你的爱宠吧。"）。这是文案期望行为与当前接线行为之间的一处落差，值得在功能盘点中标注。
- **需要的数据/服务能力**：若要实现文案所描述的档案创建流程，需要一个能接收宠物照片上传、保存宠物名字/物种/习性等档案信息的能力（该流程的实际表单已存在于同页面的 PetCreatorSection，但不属于本分片覆盖范围）。
- **当前实现状态**：占位壳/纯展示按钮——点击只触发一个与自身文案不直接对应的抽屉展示，未连接到任何数据提交或表单跳转逻辑。

---

## 6. 视觉/动效补充证据（styles.css）

- `.species-carousel-stage`（474-491 行）：`min-height: 620px`、`perspective: 1300px`、`transform-style: preserve-3d`，确认整个轮播是基于 CSS 3D 透视 + Framer Motion transform 实现的环形卡片堆叠效果，而非真正的 3D 渲染引擎。
- `.species-image-frame img`（550-558 行）：`object-fit: contain`、`filter: drop-shadow(...)`，物种图为抠图式产品/宠物照片，非全屏背景图。
- `.carousel-species-card`（516-528 行）：单卡宽度 `min(390px, calc(100vw - 34px))`，`min-height: 550px`，暗示这是设计稿定义的固定尺寸卡片，非流式自适应内容。
- 响应式断点（2263-2467 行）在小屏下调整卡片尺寸和 stage 高度，但未改变交互逻辑，本分片功能点在各断点下一致。

---

## 功能点小结（用于结构化提取）

1. **物种轮播卡片（点击/自动切换/3D 堆叠展示）** — 本地 JS 状态 + 动效库驱动，纯前端展示与状态切换，无服务依赖。
2. **物种数据（5 物种的名称/习性/材质/栖息地/素材图）** — 本地常量，若需运营可更新则需要一个内容维护能力。
3. **自动轮播定时器（4.2 秒自动切换 + 手动交互重置计时）** — 纯前端定时器逻辑。
4. **圆点导航（点击跳转 + 激活态高亮）** — 纯前端交互。
5. **"创建专属宠物档案"卡片** — 文案预期"进入档案创建流程"，实际接线为"打开 AI 交付链路说明抽屉"，两者不一致；若要满足文案期望，需要一个能接收宠物照片上传并保存宠物档案信息（名字、物种、习性）的能力。
