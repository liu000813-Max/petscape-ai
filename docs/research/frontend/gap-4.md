# 缺口补提报告 — gap-4（习性与材料建议不随物种联动 + 缺风险/不建议材料）

> 隔离声明：本报告仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现。不涉及、不引用、不猜测任何后端项目或其它 PRD。所有"数据/服务需要什么"的表述均使用中立语言（"该功能需要一个能 X 的服务"），不提及任何具体后端技术或项目名称。

## 缺口描述（复述）

[G4] 习性与材料建议不随所选物种联动，且缺"风险点/不建议材料"。PRD §6.4 要求按物种给喜好+风险+推荐材料+不建议材料，§12.2 验收"不同物种不同建议"。前端 `IntroSection` 习性面板（shard-05 §1.3）写死花枝鼠通用规则不随物种变；`species` 数组只带喜好/材质/栖息地三类，无风险与不建议材料两类安全信息。

## 查证结论：缺口成立

本轮直接复核 `src/main.jsx` 源码，逐点坐实如下证据。

---

## 1. `IntroSection` 与全局物种选择状态无任何连接（main.jsx:213-215, 263）

- **证据（组件定义）**：
  ```jsx
  function IntroSection() {
    return <section className="intro-section">...</section>;
  }
  ```
  （main.jsx:213，函数签名 `IntroSection()` 不接收任何 props）
- **证据（调用点）**：`App` 组件顶层渲染列表中：
  ```jsx
  <SpeciesShowcase selectedSpeciesId={selectedSpeciesId} onSelectSpecies={setSelectedSpeciesId} onAddPet={...} />
  <PetCreatorSection selectedSpecies={selectedSpecies} onSelectSpecies={setSelectedSpeciesId} ... />
  <IntroSection />
  <ModuleCommunitySection selectedIds={selectedIds} onToggleModule={toggleModule} marketRef={moduleMarketRef} />
  ...
  ```
  （main.jsx:263，一整行内联渲染）
- **交互形式**：无。`IntroSection` 调用处 `<IntroSection />` 不传入任何 prop——对照同一行内 `SpeciesShowcase` 传入 `selectedSpeciesId`、`PetCreatorSection` 传入 `selectedSpecies`，两者都从 `App` 的 `selectedSpeciesId` state（main.jsx:247 `useState('rat')`）派生并显式传递，唯独 `IntroSection` 与该 state 之间没有任何 props 通路。
- **期望行为**：PRD §6.4 要求"按物种给喜好+风险+推荐材料+不建议材料"，§12.2 验收标准为"不同物种不同建议"——即用户在轮播（`SpeciesShowcase`）或创建器（`PetCreatorSection`）里切换物种后，`IntroSection` 的习性适配规则面板应同步刷新为对应物种的喜好/风险/材料信息。
- **数据/服务需要**：该功能需要一个能提供物种习性适配规则（喜好行为、风险点、推荐材料、不建议材料）的信息内容来源，并需要该组件读取当前选中的物种状态以联动刷新展示内容。
- **当前实现状态**：本地 JS 状态存在（`App` 已持有 `selectedSpeciesId`），但未接线——组件本身不接收该 state，属于"上游状态已就绪、消费端未挂载"的联动缺口，不是数据源完全空缺。

---

## 2. 习性面板三条规则写死为花枝鼠专属文案，逐字不含变量（main.jsx:214）

- **证据**：
  ```jsx
  <div className="habit-panel">
    <span className="eyebrow">习性适配规则</span>
    <h3>懂习性，才敢把梦中小窝真的带回家。</h3>
    <div className="habit-list">
      <div><HeartHandshake size={18} /><span>喜好：隧道、窝、层板、觅食区</span></div>
      <div><ShieldCheck size={18} /><span>风险：尖角、小零件、尾巴卡缝、难清洁沟槽</span></div>
      <div><Tags size={18} /><span>材料：优先 PETG、圆角处理、可拆卸连接件</span></div>
    </div>
  </div>
  ```
  （main.jsx:214，逐字量抄自源码，非改写）
- **交互形式**：无，纯图标+静态文字列表，无展开/点击。
- **期望行为**：文案本身内容（"喜好：隧道、窝、层板、觅食区"“尾巴卡缝"）明显专指花枝鼠这类啮齿类物种的习性与解剖特征（"尾巴卡缝"对蛇/守宫/鹦鹉/蜘蛛均不适用），但页面上无论用户选中 5 个物种中的哪一个（花枝鼠/守宫/蛇/鹦鹉/蜘蛛，`species` 数组 main.jsx:28-34），此三行文字固定不变、逐字相同。这与结合第 1 节的"无 props 通路"共同构成完整证据链：不仅数据模型不支持按物种变化，组件本身的静态字符串写法也直接排除了变化的可能——即便未来补上 props 通路，当前 JSX 仍需重写才能消费传入数据。
- **数据/服务需要**：同上——需要按物种区分的习性规则内容来源，且当前呈现方式（写死 `<span>` 文本）与该需要不兼容，需改为从物种数据动态渲染。
- **当前实现状态**：纯展示，写死文案，不随物种切换而改变，同 `_map.md` 第 1.3 节已记录的判定一致，本轮源码复核确认无误。

---

## 3. `species` 数据模型仅含三类字段，无风险与不建议材料两类（main.jsx:28-34）

- **证据**：
  ```js
  const species = [
    { id: 'rat', name: '花枝鼠', en: 'Fancy Rat', image: '/assets/species-rat.png', traits: ['爱社交', '爱啃咬', '热爱钻洞'], material: 'PETG / 圆角安全处理', habitat: '层板、隧道、觅食房间', modules: [...] },
    { id: 'gecko', name: '守宫', en: 'Gecko', image: '/assets/species-gecko.png', traits: ['夜行', '需要躲避', '喜稳定温湿度'], material: '耐热 PETG / 防潮结构', habitat: '湿躲、岩洞、喂食台、低晒台', modules: [...] },
    { id: 'snake', name: '蛇', en: 'Snake', image: '/assets/species-snake.png', traits: ['爱隐蔽', '贴地移动', '需要安全边界'], material: '耐热 PETG / 无尖角缝隙', habitat: '洞穴、贴地通道、稳定水盆、攀爬枝架', modules: [...] },
    { id: 'parrot', name: '鹦鹉', en: 'Parrot', image: '/assets/species-parrot.png', traits: ['爱攀爬', '爱啃咬', '需要互动'], material: 'PETG / 加厚防啃结构', habitat: '站杆、觅食盒、攀爬平台、玩具挂点', modules: [...] },
    { id: 'spider', name: '蜘蛛', en: 'Tarantula', image: '/assets/species-spider.png', traits: ['喜躲避', '怕震动', '需要低干扰'], material: '防潮 PETG / 低反光表面', habitat: '洞穴躲避、地形坡度、水盆固定、观察窗口', modules: [...] }
  ];
  ```
  （main.jsx:28-34，5 个物种对象逐条核对字段名一致：`id`/`name`/`en`/`image`/`traits`/`material`/`habitat`/`modules`，共 8 个 key，无例外）
- **交互形式**：数据层面，非 UI 交互。该数组被 `SpeciesShowcase`（main.jsx:137-182，轮播卡片正文渲染 `traits`/`habitat`/`material`）和 `PetCreatorSection`（消费 `selectedSpecies`）读取，但均只读取 `traits`（喜好）、`material`（材料，注意此处 `material` 字段本身已是"推荐材料"语义，非"不建议材料"）、`habitat`（栖息地）三类，无一处出现 `risk`/`risks`/`avoidMaterial`/`unsuitable` 等风险或禁用材料字段名。
- **期望行为**：PRD §6.4 要求每个物种同时提供喜好、风险、推荐材料、不建议材料四类信息。当前数据模型只覆盖喜好（`traits`）、推荐材料（`material`）、栖息地（`habitat`）三类，风险点与不建议材料两类字段在数据源头就不存在，不是"有数据未展示"，而是"数据结构本身缺项"。
- **数据/服务需要**：该功能需要一个能为每个物种提供风险点（如尖角、小零件误食、缝隙夹伤等安全隐患）与不建议材料（如该物种应避免接触的材质/结构）两类安全信息、并支持按物种差异化提供该内容的服务；当前数据结构需要扩展这两个维度才能承载。
- **当前实现状态**：数据层面为"结构缺项"，非"占位/写死"——`IntroSection` 里出现的"风险"“材料"字样（第 2 节）是独立于 `species` 数组之外的另一套写死通用文案，两者并未打通，也证明就算把 `IntroSection` 与 `species` 数组连上线，现有 `species` 字段也不足以覆盖"风险+不建议材料"两项要求，需同时补数据结构和补联动两处改动。

---

## 4. 样式证据（辅助确认该面板为已定型的静态展示单元）

- **证据**：`.habit-panel`（styles.css:704，与 `.profile-panel`/`.quote-panel`/`.gift-card` 共用卡片外观：白底、圆角 28px、1px 描边）；`.habit-list div`（styles.css:763-773，每条规则渲染为一个 58px 高、18px 圆角的独立行，图标+文字水平排列）。样式本身对"内容随物种变化"无技术阻碍——纯粹是布局容器，问题完全在 JSX 逻辑层（第 1、2 节）与数据层（第 3 节），不在 CSS。

---

## 本报告小结

| 证据点 | 位置 | 结论 |
|---|---|---|
| `IntroSection()` 组件签名与调用点均无 props 传递 | main.jsx:213, 263 | 与全局 `selectedSpeciesId` 状态无连接通路，非"有联动但显示不对"，而是"从未接线" |
| 习性面板三条规则为写死字符串，专属花枝鼠语境（如"尾巴卡缝"） | main.jsx:214 | 与第 1 点共同证明：即便补上联动通路，现有 JSX 写法仍需重写才能消费按物种变化的数据 |
| `species` 数组仅含 `traits`/`material`/`habitat` 三类字段，无风险/不建议材料字段 | main.jsx:28-34 | 数据模型结构性缺项，不是"有数据未展示"，需求需先补数据结构再谈联动展示 |

三点证据互相独立又彼此印证，完整对应缺口描述的两句判断——"习性与材料建议不随所选物种联动"（第 1、2 点）与"缺风险点/不建议材料"（第 3 点）。缺口成立，PRD §6.4 与 §12.2 的要求在当前前端实物中均未满足。

**本缺口的功能点数据/服务需要归纳**：
- 一个能为每个物种提供喜好、风险、推荐材料、不建议材料四类习性适配信息、并支持扩展新物种的服务（对应 `species` 数据结构需补齐字段）。
- `IntroSection` 组件需要接收当前选中物种的标识以联动读取该服务返回的对应内容（对应组件 props 通路需补齐）。
