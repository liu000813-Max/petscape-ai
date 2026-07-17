# 补充缺口报告 — gap-7（[G6] vibe 上传/生成/AI效果图链路全段占位）

> 隔离声明：本报告仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现。不涉及、不引用、不猜测任何后端项目或其它 PRD。所有"数据/服务需要"的表述均使用中立语言（"该功能需要一个能 X 的服务"），不提及任何具体后端技术或项目名称。

## 缺口结论

**缺口成立。** 已在 `<USER_HOME>/Desktop/设计师前端页面/src/main.jsx` 中逐字核对：`UploadVibeSection`（217-219 行）与 `RenderSection`（221-223 行）两个组件，从上传入口到 prompt 输入到生成动作到效果图输出，全链路每一环都是占位壳或未接线的静态元素，没有任何一处真实交互回调或 state。这与 `_map.md` 第 1B/1C 节、`section-shard-05-content-marketing.md` 第 2/3 节里已有的记录一致，本报告在此基础上补充逐点核实证据，并单独按"缺口"角度重新组织、强调与 `PetCreatorSection` 的对照。

补充核实点（原分片文档未明确写出，此处补齐）：`App` 组件渲染这两个 section 时是 `<UploadVibeSection /><RenderSection />`（main.jsx:263），**零 props 传入**——对比同一行内 `<PetCreatorSection selectedSpecies={...} onSelectSpecies={...} petName={...} ... />` 携带 12 个 props/回调，`UploadVibeSection` 和 `RenderSection` 在 App 顶层完全没有状态挂钩，连"结构已搭、数据未连"的半成品程度都不到——是彻底孤立的静态子树，不参与 App 的 7 个顶层 state（drawerOpen / selectedSpeciesId / selectedIds / petName / petSize / petImageUrl / avatarGenerated / avatarRotation / selectedWearables，main.jsx:245-263）中的任何一个。

---

## 1. UploadVibeSection 两个上传位（笼箱照片 + 宠物照片）均无真实上传能力

- **证据**：
  ```jsx
  function UploadVibeSection() {
    return <section className="builder-section">
      <div className="builder-left">
        <span className="eyebrow">上传与 Vibe 描述</span>
        <h2>上传真实环境，再描述你想要的宠物小家。</h2>
        <p>当前 demo 保留上传位、生成路径和订单交接逻辑，后续可连接生图模型、混元 3D 和生产报价。</p>
        <div className="prompt-box">
          <WandSparkles size={18} />
          <span>森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。</span>
          <button type="button">生成</button>
        </div>
      </div>
      <div className="upload-grid">
        <AssetPlaceholder title="当前笼箱照片" ratio="4:3" icon={Upload} />
        <AssetPlaceholder title="宠物照片" ratio="1:1" icon={Camera} />
      </div>
    </section>;
  }
  ```
  （main.jsx:217-219，函数本身无形参，无内部 `useState`）
- **交互形式**：视觉上两张卡片各带图标（Upload 图标、Camera 图标）+ 标题 + 比例标注，是 `AssetPlaceholder` 通用占位组件（82-84 行：`<div className={...}><Icon /><strong>{title}</strong><span>{ratio}</span></div>`），**不含 `<input type="file">` 或任何可点击/拖拽元素**，点击无任何反应（无 onClick，DOM 上也没有可交互的表单控件）。
- **与真实上传位的对照证据**：同一文件里 `PetCreatorSection`（188-192 行）内的宠物照片上传是这样实现的：
  ```jsx
  <label className="upload-pet-card">
    <input type="file" accept="image/*" onChange={onPetImageUpload} />
    {petImageUrl ? <img src={petImageUrl} alt={...} /> : <span className="upload-empty">...</span>}
  </label>
  ```
  （main.jsx:192），并且 `onPetImageUpload` 回调在 `App` 内实现为 `URL.createObjectURL` 生成本地预览（App 内 `handlePetImageUpload`，main.jsx:245-263 区间）。两相对照可确认：全项目只有 `PetCreatorSection` 这一处宠物照片上传是真实的 `<input type="file">` + 状态回填；`UploadVibeSection` 里视觉语言相同（同样是"图标+标题+比例"卡片样式）但底层是纯 `AssetPlaceholder`，没有 `<input>`，是任务描述里指出的"仅 PetCreatorSection 那处宠物照片上传为真"的直接证据。
- **期望行为**：PRD §6.5（本报告不引用其具体内容，仅按任务描述转述其要求存在性）要求用户能上传"笼箱照片"与"宠物照片"两张图作为 vibe 生成的输入素材；页面文案"上传真实环境，再描述你想要的宠物小家"和图标语义（Upload=环境/笼箱、Camera=宠物）与该要求方向一致，用户看到这两张卡片会预期点击后能选择本地图片上传。
- **数据/服务需要**：该功能需要一个能接收用户上传的笼箱环境照片和宠物照片、并将两者作为后续效果图生成输入的服务。
- **当前实现状态**：占位壳。两个上传位均为 `AssetPlaceholder`，无真实 `<input type="file">`，无法选择或预览任何本地图片，也没有任何 state 保存已"上传"的文件。

## 2. Prompt 描述框是写死文本，不可编辑

- **证据**：`<div className="prompt-box"><WandSparkles size={18} /><span>森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。</span><button type="button">生成</button></div>`（main.jsx:218）。样式上 `.prompt-box`（styles.css:831-841）做成白底圆角、图标+文字+下方满宽按钮的输入框视觉（`grid-template-columns: auto minmax(0,1fr)`），但承载文案的是 `<span>`，不是 `<input>`/`<textarea>`。
- **交互形式**：纯文本展示，无法点击进入编辑，无法修改或清空这段"森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬"示例文案。
- **期望行为**：从视觉呈现（输入框样式容器 + 图标 + 跟随的"生成"按钮）与区块引导语"再描述你想要的宠物小家"来看，用户预期能在此处输入/编辑自己的 vibe 描述文字，而非只能看到一段固定示例。
- **数据/服务需要**：该功能需要一个能接收用户自由输入的文字描述（vibe prompt）的输入能力，作为后续生成请求的参数之一。
- **当前实现状态**：占位壳（写死 `<span>` 静态文本，非可编辑输入控件）。

## 3. "生成"按钮无 onClick 绑定

- **证据**：`<button type="button">生成</button>`（main.jsx:218），逐字核对 button 标签内无任何事件属性（无 onClick/onSubmit）。样式上是黑底白字、`border-radius:999px`、`min-height:44px`、`cursor:pointer` 的实心圆角按钮（styles.css:849-858），视觉呈现与"开始定制""生成 3D 可旋转预览"等其它有真实 onClick 的按钮几乎一致，用户无法从外观分辨出这颗按钮是空绑定的。
- **交互形式**：可点击（cursor:pointer + 满宽黑色按钮），点击后无任何反应——不会触发状态变化、不会有 loading/反馈、不会跳转或改变页面任何部分。
- **期望行为**：结合按钮文案"生成"、区块标题"上传与 Vibe 描述"、引导语"再描述你想要的宠物小家"，以及紧邻的两个上传位和后面 `RenderSection` 的三张效果图占位，用户预期点击"生成"会触发一次 AI 生成流程，用上传的两张照片+描述文字产出效果图，并在下方 `RenderSection` 区域呈现结果。
- **数据/服务需要**：该功能需要一个能接收环境照片、宠物照片与文字描述、返回改造后效果图（及可分享成片）的生成服务，并需要触发该服务调用、展示生成进度与结果的前端处理逻辑。
- **当前实现状态**：占位壳。按钮结构完整（type="button"、可点击样式）但未绑定任何处理器，是全项目内（连同 `EnvironmentPreviewSection` 的"生成场景报价"）仅有的两个"看起来能点但没有真实动作"的按钮之一。

## 4. RenderSection 三张效果图全部为占位卡，无任何真实生成结果或交互

- **证据**：
  ```jsx
  function RenderSection() {
    return <section className="render-section">
      <div className="section-copy">
        <span>AI 效果图</span>
        <h2>一键生成社媒传播预览，查看小窝的出片效果。</h2>
      </div>
      <div className="render-grid">
        <AssetPlaceholder title="改造前环境" ratio="4:3" icon={Image} tone="dark" />
        <AssetPlaceholder title="AI 改造效果图" ratio="16:9" icon={Sparkles} tone="dark" />
        <AssetPlaceholder title="小红书分享图" ratio="3:4" icon={Image} tone="dark" />
      </div>
    </section>;
  }
  ```
  （main.jsx:221-223，函数无形参，无内部 state，不接收 `UploadVibeSection` 产出的任何数据——事实上 `UploadVibeSection` 本身也不产出任何数据，二者在 App 层完全独立、互不传值）
- **交互形式**：三张深色调（`tone="dark"`）纯展示占位卡，横向排列，无按钮、无点击、无 hover 交互、无图片资源引用。三张比例不同（4:3 / 16:9 / 3:4）对应"改造前原图 / 改造后效果图 / 社媒分享裁切图"三种用途语义，但均只渲染图标+标题+比例文案，不含任何 `<img>` 标签或真实图片路径。
- **期望行为**：标题"一键生成社媒传播预览，查看小窝的出片效果"明确设定预期——用户完成第 1-3 点的上传+描述+点击生成后，应在此处看到（1）改造前的原始环境照片回显、（2）AI 生成的改造效果图、（3）裁好比例、适合直接分享到小红书等社媒的成片。
- **数据/服务需要**：该功能需要一个能基于用户上传的环境照片和宠物照片、结合文字描述，生成"改造前后对比"效果图、并自动产出适配社媒分享比例成片的服务；同时需要前端将生成结果（三种形态的图片）渲染到对应占位位置的展示逻辑。
- **当前实现状态**：纯展示（占位壳）。三张卡片均为 `AssetPlaceholder`，无真实图片、无生成结果、无交互，是整条"上传 → 描述 → 生成 → 展示效果图"链路里悬空的输出端。

---

## 链路总览（PRD §6.5 对照）

| 链路环节 | 组件/位置 | 实物状态 |
|---|---|---|
| 上传笼箱照片 | `UploadVibeSection` 上传位 1（main.jsx:218） | 占位壳，无 `<input type="file">` |
| 上传宠物照片（vibe 场景） | `UploadVibeSection` 上传位 2（main.jsx:218） | 占位壳，无 `<input type="file">` |
| 描述 vibe 文字 | `UploadVibeSection` prompt-box（main.jsx:218） | 写死 `<span>`，不可编辑 |
| 触发生成 | `UploadVibeSection` "生成"按钮（main.jsx:218） | 无 onClick，点击无反应 |
| 改造前环境图 | `RenderSection` 第 1 张卡（main.jsx:222） | AssetPlaceholder，无真实图 |
| AI 改造效果图 | `RenderSection` 第 2 张卡（main.jsx:222） | AssetPlaceholder，无真实图 |
| 小红书分享图 | `RenderSection` 第 3 张卡（main.jsx:222） | AssetPlaceholder，无真实图 |

对照项：全项目唯一真实的图片上传能力位于 `PetCreatorSection`（main.jsx:192，`<input type="file" accept="image/*" onChange={onPetImageUpload} />` + `URL.createObjectURL` 本地预览），用于"生成 3D 可旋转宠物角色预览"这条链路，与 vibe 效果图链路（本报告覆盖的 `UploadVibeSection`/`RenderSection`）是页面上两条不同的功能线；后者从上传到展示全段没有一处挂接真实交互或数据，前者的真实上传能力也不能跨组件复用到本报告覆盖的两个占位区块（二者在 App 层是完全独立的组件树分支，互不传参）。

---

## 功能点提取

见下方 `features` 结构化字段。共 4 个功能点：笼箱/宠物照片上传位（占位）、vibe 描述输入（写死不可编辑）、生成按钮（无处理逻辑）、AI 效果图三态输出（全占位）。
