# 缺口补提 — [G1] 宠物档案缺「性格标签」与「居住环境类型」输入字段

> 隔离声明：本笔记仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现，不涉及、不引用、不猜测任何后端项目。凡涉及数据/持久化/生成能力之处，一律用"该功能需要一个能 X 的服务"的中立表述。

## 0. 缺口描述（来自任务输入，未改写）

PRD §6.3 档案字段列 6 项含性格标签+居住环境类型、§9.1 PetProfile 含 traits+habitatType；前端 `PetCreatorSection`（src/main.jsx:192，shard-03）只有名字/物种/体型/照片 4 项输入，性格标签仅在 `IntroSection` 写死示例卡出现，非可填字段。

## 1. 查证结论：缺口成立

逐层核查 `src/main.jsx`，确认 `PetCreatorSection` 的用户可填字段与全局 state 均不含性格标签或居住环境类型。

### 1.1 `PetCreatorSection` 实际输入字段清单（main.jsx:192，`creator-controls` 内 `field-card` + 上传卡）

| 字段 | 控件 | 证据 |
|---|---|---|
| 宠物名字 | `<input id="pet-name">` 文本输入 | main.jsx:192，`<label htmlFor="pet-name">宠物名字</label><input id="pet-name" value={petName} onChange={...} />` |
| 物种 | 5 个物种切换按钮 | main.jsx:192，`<label>物种</label><div className="species-select-row">{species.map(...)}</div>` |
| 体型大小 | `<input type="range" min="1" max="5">` | main.jsx:192，`<label htmlFor="pet-size">体型大小</label><input id="pet-size" type="range" .../>` |
| 宠物照片 | `<input type="file" accept="image/*">` | main.jsx:192，`<label className="upload-pet-card"><input type="file" accept="image/*" onChange={onPetImageUpload} />` |

**只有以上 4 项，逐字符核对整个 `PetCreatorSection` 返回的 JSX，不存在第 5、第 6 个输入控件**，与缺口描述吻合。

### 1.2 全局 state 佐证（`App` 组件，main.jsx:245-253）

```
const [petName, setPetName] = useState('Nomi');
const [petSize, setPetSize] = useState(3);
const [petImageUrl, setPetImageUrl] = useState('');
const [avatarGenerated, setAvatarGenerated] = useState(false);
const [avatarRotation, setAvatarRotation] = useState(32);
const [selectedWearables, setSelectedWearables] = useState(['knit-hat']);
```

App 级共 6 个宠物相关 state（另有 drawerOpen/selectedIds 为其它模块用），**没有 `petTraits`/`petPersonality` 或 `petHabitat`/`habitatType` 之类的 state**，说明缺口不只是"表单没渲染"，而是整条数据流（state → props → 渲染）从根上就没有这两个概念，非局部遗漏。

### 1.3 「性格标签」在别处的写死出现（用于确认"存在同名概念但非可填字段"）

- `species` 静态数组（main.jsx:29-33）：每个物种预置 `traits` 字段（如花枝鼠 `['爱社交', '爱啃咬', '热爱钻洞']`），但这是**物种级别的只读描述文案**，渲染在 `SpeciesShowcase` 轮播卡的 `profile-tags`（main.jsx:181）里，用户不能编辑、不属于用户创建的宠物档案。
- `IntroSection`（main.jsx:213-215）：写死的"Nomi 的档案"示例卡，文案硬编码 `<p>物种：花枝鼠 / 年龄：6 个月 / 性格：爱钻洞、爱攀爬、爱觅食。</p>` 及 `<div className="profile-tags"><span>爱社交</span><span>爱啃咬</span><span>需要多层空间</span></div>`，纯静态展示，与 `PetCreatorSection` 的 `petName` 等 state 无任何绑定关系（改名字/物种不会联动这张示例卡）。

### 1.4 「居住环境类型」核查

- 全文搜索 `habitat`：仅出现在 `species` 数组的只读字段 `habitat`（如花枝鼠 `'层板、隧道、觅食房间'`），同样是物种级只读描述，渲染于轮播卡 `<p>{item.habitat}</p>`（main.jsx:181），不是任何表单输入。
- `PetCreatorSection`、`App` 的 state、`styles.css` 均无与"居住环境类型"对应的输入控件或选项数据（如笼箱/缸/自由散养等类型枚举）。

### 1.5 CSS 佐证

`styles.css` 中 `.field-card` 相关规则共 4 处（984/992/999/1011 行），分别对应 label 样式、文本输入样式、range 输入样式——**数量与可见的 3 个 field-card（名字/物种/体型）+ 1 个独立上传卡吻合，没有多余的、未被渲染但已定义样式的"隐藏字段"**，说明这不是"CSS 已就绪、JSX 未接线"的半成品，而是从设计到实现都未覆盖这两个字段。

## 2. 结论

缺口 **[G1] 成立**：`PetCreatorSection`（src/main.jsx:192，shard-03-pet-creator）确实只支持 名字/物种/体型/照片 4 项用户可填字段，不含性格标签（traits/personality）与居住环境类型（habitatType）两个字段的输入入口。"性格标签"这一概念仅以物种级只读文案形式出现在 `SpeciesShowcase` 轮播卡与 `IntroSection` 写死示例卡中，均非用户可编辑的宠物档案字段。

## 3. 功能点提取

按 `_map.md` 相同格式，作为 shard-03-pet-creator 的补充功能点登记。

### 功能点：宠物档案「性格标签」输入
- **名称**：性格标签选择/填写
- **交互形式**：当前无任何交互形式（字段不存在）。参照同页 `species` 数据中 `traits` 的既有形态（每物种 3 个短标签，如"爱社交""爱啃咬""热爱钻洞"）及 `IntroSection` 示例卡的 `profile-tags` 胶囊样式，若补齐大概率会是"多选标签/胶囊选择器"或"自由文本+推荐标签"形式。
- **期望行为**：用户在创建宠物档案时可以为自己的宠物打上若干性格标签（而非只能看到系统预置的物种通用标签），标签应能保存并在档案相关展示位（如未来的角色预览、档案卡）体现。
- **数据需求**：该功能需要一个能存储和读取每个宠物档案自定义性格标签（一组文本/枚举值）的服务；若采用推荐标签模式，还需要一个能提供可选标签候选列表（可能按物种区分）的服务。
- **当前实现状态**：占位壳（准确说是完全缺失——不存在对应的 state、props、JSX 输入控件，也不存在同名但未接线的 CSS 规则；"占位壳"取其最接近的档位，实际比一般占位壳更彻底，无任何前端痕迹）。

### 功能点：宠物档案「居住环境类型」输入
- **名称**：居住环境类型选择
- **交互形式**：当前无任何交互形式（字段不存在）。参照同页 `species` 数据中 `habitat` 的既有形态（每物种一句环境描述，如花枝鼠"层板、隧道、觅食房间"），若补齐大概率是"下拉选择/单选按钮组"（如：笼养/缸养/散养等环境类型），可能与物种形成级联关系。
- **期望行为**：用户在创建宠物档案时可以指定自己养宠所用的居住环境类型，用于后续模块推荐、场景适配等场景的输入依据。
- **数据需求**：该功能需要一个能存储和读取每个宠物档案居住环境类型（枚举值）的服务；若与模块推荐联动，还需要一个能根据居住环境类型和物种筛选/排序可打印模块的服务。
- **当前实现状态**：占位壳（同上，实际为完全缺失，无 state/props/JSX/CSS 任何痕迹）。

## 4. 对 `_map.md` / shard-03 的订正提示

`_map.md` 第 96-100 行（shard-03-pet-creator）原文列出的可填字段为"命名 input、物种切换、体型 range(1-5)、真实文件上传"，与本次逐字核查结果一致，**原文档未遗漏任何已实现字段，缺口纯粹是 PRD 要求但前端未实现的两项**，不属于此前分片提取时的遗漏或误判。建议后续综合报告在 shard-03 功能点列表中追加本文件的两个功能点，并标注状态为"PRD 要求、前端未见任何实现痕迹"，以便与"UI 已就绪、待接处理器"（如"生成场景报价"按钮）类型的缺口区分开——后者是有壳无芯，本缺口是连壳都没有。
