# 分片 03：宠物档案创建器 + 3D 角色预览 + 装扮商店

- 覆盖组件：`PetCreatorSection`（`src/main.jsx:188-192`）
- 数据源：`wearableItems` 数组（`src/main.jsx:52-57`，4 件装扮）
- 关联逻辑：`App.handlePetImageUpload`（`src/main.jsx:261`）、`App.handleGenerateAvatar`（`src/main.jsx:262`）、`App` 中的相关 state（`src/main.jsx:249-254`）
- 唯一依据：`src/main.jsx` + `src/styles.css`（src 比 dist 新，两者内容除文首说明的 2 处已知差异外一致，此分片范围内两者无差异）

> 说明：本分片所有文案均逐字引用自 `src/main.jsx`。中立语言原则：功能点描述仅涉及前端呈现的交互与数据需求，不对后端形态做任何假设。

---

## 1. 分片总览与整体期望行为

`PetCreatorSection` 是一个把"档案信息输入 → 图片上传 → 3D 角色生成/旋转 → 付费装扮"串成一条竖切体验的区块。

证据（`src/main.jsx:192`）：
> "创建专属宠物档案" / "上传你的爱宠照片和信息，同步赛博云宠，快来装扮你的爱宠吧。" / "体验要像游戏角色预览：上传宠物照片，生成角色，旋转查看，再为它添加带价格的付费装扮。"

对应的能力地图卡片文案进一步印证了期望行为（`src/main.jsx:61-63`）：
> `['宠物档案', '创建', '为爱宠命名，选择物种，并调节体型。', '档案会成为生成、预览、计价和复购的核心锚点。']`
> `['3D 形象', '预览', '上传宠物图片，生成可旋转的角色式 3D 预览。', '体验应像游戏角色查看器，而不是静态表单。']`
> `['爱宠装扮', '穿戴', '添加小帽子、围巾、吊牌等付费装饰。', '每个穿戴物都有价格、适配规则和预览中的位置反馈。']`

以及订单闭环步骤中的措辞（`src/main.jsx:70`）：
> `flowSteps = ['免费生成图', '选择宠物', '创建形象', '添加装扮', '添加模块', '确认模型', '3D 打印', '发货']`

---

## 2. 宠物名字输入框

- 文件位置：`src/main.jsx:192`
- 引用代码：`<label htmlFor="pet-name">宠物名字</label><input id="pet-name" value={petName} onChange={event => onPetNameChange(event.target.value)} />`
- 交互形式：单行文本输入框，受控组件。
- 期望行为：用户输入宠物名字，实时同步显示到右侧 3D 预览的 HUD（`avatar-hud` 中 `<strong>{petName || '你的宠物'}</strong>`）以及上传预览图的 alt 文案（`` `${petName || '宠物'} 上传预览` ``）。默认值为初始 state `'Nomi'`（`src/main.jsx:249`）。
- 需要什么数据/服务能力：需要一个能持久化保存"宠物名字"这一档案字段、并让该名字在后续生成、预览、下单流程中被复用的能力（工作流卡片明确写道"档案会成为生成、预览、计价和复购的核心锚点"）。
- 当前实现状态：本地 JS 状态（`useState('Nomi')`，`src/main.jsx:249`），未见任何持久化或跨会话保存逻辑。

---

## 3. 物种选择行（Species select row）

- 文件位置：`src/main.jsx:192`
- 引用代码：`<label>物种</label><div className="species-select-row">{species.map(item => <button className={selectedSpecies.id === item.id ? 'active' : ''} key={item.id} type="button" onClick={() => onSelectSpecies(item.id)}>{item.name}</button>)}</div>`
- 交互形式：一组按钮（花枝鼠 / 守宫 / 蛇 / 鹦鹉 / 蜘蛛，来自 `species` 数组 `src/main.jsx:28-34`），点击切换选中态（`active` 类）。
- 期望行为：切换物种后，3D 预览区域的角色形态（`avatar-body` 的 class 会变为 `avatar-body ${selectedSpecies.id}`，对应 CSS 中 `.avatar-body.hamster` / `.gecko` / `.crestie` / `.beardie` 等不同造型，`src/styles.css:1248-1268`）与 HUD 中的物种名同步变化；同时该选择与页面顶部 `SpeciesShowcase` 轮播共享同一个 `selectedSpeciesId` state（`src/main.jsx:256`，双向绑定同一份 state）。
- 需要什么数据/服务能力：需要一个能根据所选物种提供对应 3D 角色基础形态/骨骼或体型模板的能力。
- 当前实现状态：本地 JS 状态驱动的纯 CSS 图形（渐变色块 + border-radius 拼出的卡通形状），并非真实 3D 模型；`avatar-body` 的物种差异化目前止步于 CSS class 名对应的静态图形（`hamster`/`gecko`/`crestie`/`beardie` 四种曲线形状，与 `species` 数组中的 5 个物种 id 如 `rat`/`gecko`/`snake`/`parrot`/`spider` 并不完全一一对应，例如未见 `rat`、`snake`、`parrot`、`spider` 对应的 CSS class，实际渲染会退回默认 `.avatar-body` 样式）。

---

## 4. 体型大小滑块（Size range）

- 文件位置：`src/main.jsx:192`
- 引用代码：`<label htmlFor="pet-size">体型大小</label><input id="pet-size" type="range" min="1" max="5" step="1" value={petSize} onChange={event => onPetSizeChange(Number(event.target.value))} /><div className="size-scale"><span>迷你</span><strong>{petSize}</strong><span>大型</span></div>`
- 交互形式：range 滑块，取值 1-5 整数，两端文案"迷你"/"大型"，中间实时显示当前数值。
- 期望行为：调整体型会实时缩放 3D 预览模型（`avatarScale = 0.82 + petSize * 0.07`，`src/main.jsx:191`，作用于 `avatar-model-shell` 的 CSS 变量 `--avatar-size`），并同步展示到左上角徽标"Lv. {petSize} 档案"（`avatar-species-tag` 中 `<strong>Lv. {petSize} 档案</strong>`）与 HUD 底部文案（`{selectedSpecies.name} / 体型 {petSize} / ...`）。
- 需要什么数据/服务能力：需要一个能把"体型档位"映射为 3D 模型实际尺寸/比例的能力（例如影响后续打印模块的适配尺寸校验）。
- 当前实现状态：本地 JS 状态，纯 CSS `transform: scale()` 缩放，无真实模型或物理尺寸换算。默认值 `3`（`src/main.jsx:250`）。

---

## 5. 宠物照片上传卡片

- 文件位置：`src/main.jsx:192`；上传逻辑 `src/main.jsx:261`
- 引用代码：`<label className="upload-pet-card"><input type="file" accept="image/*" onChange={onPetImageUpload} />{petImageUrl ? <img src={petImageUrl} alt={...} /> : <span className="upload-empty"><Upload size={22} strokeWidth={1.6} /><strong>上传宠物照片</strong><em>正面 / 侧面照片</em></span>}</label>`
- 上传处理函数（`src/main.jsx:261`）：
  ```js
  const handlePetImageUpload = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (petImageUrl) URL.revokeObjectURL(petImageUrl);
    setPetImageUrl(URL.createObjectURL(file));
    setAvatarGenerated(false);
  };
  ```
- 交互形式：点击整张卡片触发系统文件选择器（`<input type="file" accept="image/*">` 被 `<label>` 包裹）；未上传时展示空态图标 + 文案"上传宠物照片" / "正面 / 侧面照片"；上传后卡片内直接显示图片预览。
- 期望行为：用户选择一张图片后，卡片内立即替换为该图片的本地预览；同时会把"已生成"状态重置为 false（`setAvatarGenerated(false)`），意味着换图后需要用户重新点击生成按钮才能刷新 3D 预览——即上传新照片并不会自动触发 3D 生成。上传后的照片还会同步出现在右侧 3D 预览舞台左上角的"参考照片"浮层中（`avatar-source-photo`，`src/main.jsx:192`：`<img src={petImageUrl} ... /><span>参考照片</span>`）。
- 需要什么数据/服务能力：需要一个能接收宠物照片、并将其转换/映射为可旋转 3D 角色模型的能力（这是本分片的核心待补能力——workflow 卡片原文"上传宠物图片，生成可旋转的角色式 3D 预览"）。
- 当前实现状态：真实文件上传 + 本地临时预览（`URL.createObjectURL(file)`），是浏览器端真实可用的图片选择与本地渲染逻辑；但没有任何服务端处理或 3D 建模能力——"生成"按钮点击后只是切换一个布尔状态，并未消费该图片做任何转换（见下一条）。属于"真实文件上传逻辑 + 占位壳的下游生成"。

---

## 6. 3D 角色预览舞台（Avatar turntable）

- 文件位置：`src/main.jsx:192`；相关 CSS `src/styles.css:1115-1354`
- 引用代码要点：
  - 舞台容器：`<div className={`avatar-stage ${avatarGenerated ? 'generated' : ''}`}>`
  - 参考照片浮层（仅在已上传图片时出现）：`<div className="avatar-source-photo"><img .../><span>参考照片</span></div>`
  - 物种/档位徽标：`<div className="avatar-species-tag"><span>{selectedSpecies.name}</span><strong>Lv. {petSize} 档案</strong></div>`
  - 转盘：`<div className="avatar-turntable" style={{ '--avatar-rotate': `${avatarRotation}deg` }}>`
  - HUD 状态条：`<div className="avatar-hud"><span>{avatarGenerated ? '已生成角色预览' : '等待生成'}</span><strong>{petName || '你的宠物'}</strong><em>{selectedSpecies.name} / 体型 {petSize} / {avatarGenerated ? '可旋转查看' : '请先上传照片'}</em></div>`
- 交互形式：纯展示区域（无独立点击交互），状态由上传/生成/物种/体型/装扮等其它控件驱动。
- 期望行为：
  - 未生成时（`avatarGenerated === false`）：转盘持续自动旋转（CSS `animation: turntable 12s linear infinite`，`src/styles.css:1220`），HUD 显示"等待生成"，副文案显示"请先上传照片"。
  - 已生成后：转盘动画停止，改为根据"旋转预览"滑块的角度静态定格（`transform: rotateX(62deg) rotateZ(var(--avatar-rotate))`，`src/styles.css:1223-1226`），舞台背景切换为更亮的渐变（`.avatar-stage.generated`，`src/styles.css:1187-1192`），HUD 显示"已生成角色预览"，副文案变为"可旋转查看"。
  - 角色本体（`avatar-body`）用 CSS 渐变 + 圆角拼出卡通形状，附带轻微呼吸动效（`animation: avatar-idle 3s ease-in-out infinite`，`src/styles.css:1245`），并根据已选装扮叠加对应的 CSS 装饰层（针织帽/围巾/吊牌/斗篷，见第 8 节）。
- 需要什么数据/服务能力：需要一个能把用户上传的宠物照片实际转换成可 360 度旋转查看的 3D 角色模型的能力（当前这一环完全未实现，见下方"当前实现状态"）。
- 当前实现状态：纯本地 JS 状态 + CSS 动画的占位壳。角色形态与上传的照片内容无关（无论上传什么照片，角色本体始终是同一批预设的 CSS 渐变色块），"3D"效果仅通过 `rotateX` + `rotateZ` 的 2.5D CSS 变换模拟，并非真实三维模型或点云/网格渲染。

---

## 7. 旋转预览滑块（Rotate control）

- 文件位置：`src/main.jsx:192`；CSS `src/styles.css:1391-1409`
- 引用代码：`<div className="rotate-control"><Rotate3D size={18} strokeWidth={1.8} /><label htmlFor="avatar-rotation">旋转预览</label><input id="avatar-rotation" type="range" min="0" max="360" value={avatarRotation} onChange={event => onAvatarRotationChange(Number(event.target.value))} /><strong>{avatarRotation}deg</strong></div>`
- 交互形式：range 滑块，0-360 度，实时显示当前角度数值（如"32deg"，默认值 `avatarRotation = 32`，`src/main.jsx:253`）。
- 期望行为：拖动滑块实时旋转已生成的 3D 角色预览（通过 CSS 变量 `--avatar-rotate` 驱动 `rotateZ`）。仅在 `avatarGenerated === true` 时旋转生效（未生成状态下转盘由自动动画接管，手动角度不生效，见第 6 节）。
- 需要什么数据/服务能力：需要一个能围绕角色模型做真实多角度渲染或视角切换的能力（若模型是真三维网格/点云，则是相机轨道控制；当前是纯 2D 图层变换的近似）。
- 当前实现状态：本地 JS 状态 + CSS transform，非真实 3D 相机控制。

---

## 8. "生成 3D 可旋转预览"按钮

- 文件位置：`src/main.jsx:192`；处理函数 `src/main.jsx:262`
- 引用代码：`<button className="generate-avatar-button" type="button" onClick={onGenerateAvatar}>{avatarGenerated ? '重新生成 3D 可旋转预览' : '生成 3D 可旋转预览'}</button>`
- 处理函数：
  ```js
  const handleGenerateAvatar = () => { setAvatarGenerated(true); setAvatarRotation(32); };
  ```
- 交互形式：主操作按钮，文案随状态切换："生成 3D 可旋转预览"（首次） → "重新生成 3D 可旋转预览"（已生成后再点）。
- 期望行为：点击后应该基于用户上传的照片、所选物种、体型、已选装扮，生成一个可旋转查看的 3D 角色模型；从文案与工作流描述看，用户预期这是一次"真正的生成"动作（对照工作流卡片"上传宠物图片，生成可旋转的角色式 3D 预览"、"体验应像游戏角色查看器，而不是静态表单"）。
- 需要什么数据/服务能力：需要一个接收（宠物照片 + 物种 + 体型 + 装扮选择）、输出可交互 3D 角色资产的生成能力。
- 当前实现状态：占位壳。点击后仅把 `avatarGenerated` 置为 `true` 并把旋转角度重置为 `32`，不读取、不处理、不上传任何用户照片或参数；没有加载态、进度提示或失败态；是一个瞬时的本地布尔翻转。

---

## 9. 装扮槽位状态条（Loadout row）

- 文件位置：`src/main.jsx:192`；CSS `src/styles.css:1410-1429`
- 引用代码：`<div className="loadout-row">{wearableItems.map(item => <span className={selectedWearables.includes(item.id) ? 'equipped' : ''} key={item.id}>{selectedWearables.includes(item.id) ? item.title : '空槽位'}</span>)}</div>`
- 交互形式：纯展示的状态条，为 `wearableItems` 数组的每一项固定渲染一个槽位标签（无论是否已装备）。
- 期望行为：4 个固定槽位，已装备的显示对应装扮名（如"迷你针织帽"），未装备的显示"空槽位"占位文案，让用户对"还能装扮什么/已经装扮了什么"一目了然。
- 需要什么数据/服务能力：不需要额外服务能力，纯前端根据已有装扮选择状态渲染。
- 当前实现状态：本地 JS 状态派生的纯展示。

---

## 10. 爱宠装扮商店（Wearable shop）

- 文件位置：`src/main.jsx:192`；数据源 `src/main.jsx:52-57`；CSS `src/styles.css:1454-1493`
- 数据源引用（`wearableItems`，共 4 件）：
  ```js
  const wearableItems = [
    { id: 'knit-hat', title: '迷你针织帽', price: '¥39', fit: '花枝鼠 / 鹦鹉' },
    { id: 'chef-scarf', title: '小厨师围巾', price: '¥29', fit: '花枝鼠' },
    { id: 'name-charm', title: '名字小吊牌', price: '¥19', fit: '全物种' },
    { id: 'mini-cape', title: '迷你斗篷', price: '¥49', fit: '花枝鼠 / 毛绒预览' }
  ];
  ```
- 头部引用：`<div className="shop-head"><span>爱宠装扮商店</span><strong>装扮合计：¥{wearableTotal}</strong></div>`
- 单卡引用：`<button className={`wearable-card ${selectedWearables.includes(item.id) ? 'selected' : ''}`} type="button" onClick={() => onToggleWearable(item.id)}><AssetPlaceholder title={item.title} ratio="穿戴商品图 / 1:1" icon={Gift} /><span>{item.fit}</span><strong>{item.title}</strong><em>{item.price}</em></button>`
- 合计计算逻辑（`src/main.jsx:189-190`）：
  ```js
  const selectedWearableItems = wearableItems.filter(item => selectedWearables.includes(item.id));
  const wearableTotal = selectedWearableItems.reduce((sum, item) => sum + Number.parseInt(item.price.replace(/[^\d]/g, ''), 10), 0);
  ```
- 交互形式：4 张可点击切换选中态的卡片（点击整卡即勾选/取消），每张卡片展示：占位图（`AssetPlaceholder`，文案"穿戴商品图 / 1:1"）、适配范围（`fit`）、标题、价格。默认选中 `'knit-hat'`（`src/main.jsx:254`）。
- 期望行为：
  - 点击装扮卡片后，该装扮会实时叠加到 3D 预览角色本体上（对应 CSS：`selectedWearables.includes('knit-hat') && <span className="wearable-hat" />` 等四个条件渲染，`src/main.jsx:192`；样式定义于 `src/styles.css:1302-1346`，分别是帽子/围巾/吊牌/斗篷四种 CSS 图层）。
  - 商店头部实时显示"装扮合计：¥{wearableTotal}"，随选中项增减动态求和。
  - 每件装扮标注"适配"范围（`fit` 字段，如"花枝鼠 / 鹦鹉"），暗示装扮与物种/预览形态有适配关系，但当前代码未见任何基于 `fit` 字段的实际限制逻辑（即选了不适配的物种仍可勾选任意装扮，未见校验或禁用态）。
- 需要什么数据/服务能力：需要一个能维护"可购买装扮商品目录"（含价格、适配规则、库存等）并支持结算/下单的能力；同时需要装扮效果能真实附着在 3D 模型的对应部位上（当前是固定位置的 2D CSS 图层叠加，不是模型级挂点绑定）。
- 当前实现状态：本地 JS 状态（`selectedWearables` 数组，`useState(['knit-hat'])`），装扮数据是硬编码的静态数组，价格合计是本地字符串正则解析后的求和，无真实购物车/支付/库存服务；装扮图标目前是 `AssetPlaceholder` 占位组件（灰底 + `Gift` 图标 + 文案"穿戴商品图 / 1:1"），不是真实商品图片。

---

## 11. AssetPlaceholder（穿戴商品图占位）

- 文件位置：组件定义 `src/main.jsx:82-84`；使用处 `src/main.jsx:192`
- 引用代码：`function AssetPlaceholder({ title, ratio, icon: Icon = Image, tone = 'light' }) { return <div className={`asset-placeholder ${tone}`}><Icon size={22} strokeWidth={1.6} /><strong>{title}</strong><span>{ratio}</span></div>; }`
- 在本分片中的调用：`<AssetPlaceholder title={item.title} ratio="穿戴商品图 / 1:1" icon={Gift} />`（每张装扮卡片内）
- 交互形式：纯展示，无点击行为。
- 期望行为：作为真实商品图片上线前的视觉占位，标注了期望的图片用途（"穿戴商品图"）与画幅比例（"1:1"）。
- 需要什么数据/服务能力：需要为 4 件装扮商品提供真实商品图片素材的能力（图片托管/展示）。
- 当前实现状态：占位壳（灰底图标 + 文字说明），非真实图片。对照分片说明中提到的 dist 独有差异——`GiftSection` 的"首单挂件图"在 dist 中也曾是 `AssetPlaceholder` 占位、现已在 src 换成真实图 `gift-keychains.jpg`（`src/main.jsx:234`），可推断本分片的装扮商店占位图片存在被替换为真实素材的先例和路径，但截至当前 src 版本尚未发生在 `wearable-grid` 上。

---

## 附：与本分片强相关但定义在别处的 state（均在 `App` 组件内，`src/main.jsx:245-264`）

| state 变量 | 初始值 | 定义位置 | 作用 |
|---|---|---|---|
| `selectedSpeciesId` | `'rat'` | `src/main.jsx:247` | 驱动物种选择行 + 顶部物种轮播共享同一状态 |
| `petName` | `'Nomi'` | `src/main.jsx:249` | 宠物名字输入框 |
| `petSize` | `3` | `src/main.jsx:250` | 体型滑块 |
| `petImageUrl` | `''` | `src/main.jsx:251` | 上传照片的本地 objectURL |
| `avatarGenerated` | `false` | `src/main.jsx:252` | 是否已"生成"3D 预览 |
| `avatarRotation` | `32` | `src/main.jsx:253` | 旋转角度滑块 |
| `selectedWearables` | `['knit-hat']` | `src/main.jsx:254` | 已选装扮 id 列表 |

无一处涉及网络请求、异步调用或外部服务交互；本分片范围内全部状态管理均为纯客户端 React `useState`。
