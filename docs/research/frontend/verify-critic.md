# 完整性 Critic — 设计师前端页面（提取缺口审查）

> 隔离声明：仅审查 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现。凡涉及数据/生成能力处，用"该功能需要一个能 X 的服务"的中立表述。

## 审查方法

独立重读 `src/main.jsx`（266 行，全部 20 个组件内联）+ `src/styles.css`（2471 行，重点 grep hover / @keyframes / @media / animation）+ `public/assets/`，逐条对照 6 个分片已提取的功能点索引，找 (1) 未覆盖区域 (2) 覆盖但交互不完整 (3) assets 暗示但未体现。

结论先行：**6 个分片对「组件级」与「按钮级」覆盖是完整的，没有整块页面区域被漏掉。** 缺口集中在**同一批组件的「态」与「视觉行为」维度**——尤其是 `PetCreatorSection` 的 3D 角色舞台，它承载了远比索引"3D角色预览舞台/旋转预览滑块"两条更丰富的状态机与动画逻辑，被压缩提取了。另有**全站响应式布局**完全未提取。

---

## 缺口清单

### G1 [high] avatar 舞台的生成前/后双态呈现（未提取）
`.avatar-turntable`（styles.css:1209-1226）：**生成前**转盘持续自转 `turntable 12s linear infinite`（竖直正视）；**生成后**（`.avatar-stage.generated`）动画停止并翻转成俯视桌面姿态 `transform: rotateX(62deg) rotateZ(var(--avatar-rotate))`，此时才由旋转滑块驱动 `--avatar-rotate`。索引里"生成/重新生成3D可旋转预览按钮"+"旋转预览滑块"两条**没有体现这是一个"平台自转→点生成→落台可手动旋转"的两阶段视觉状态机**，而这正是页面自陈"要像游戏角色查看器"的核心体验载体。定位：main.jsx:192（`avatar-stage ${avatarGenerated ? 'generated' : ''}`）+ styles.css:1220/1223-1226。

### G2 [high] avatar 舞台的多个动态状态元素（HUD / 物种标签 / 参考照片，未提取）
`PetCreatorSection`（main.jsx:192）内 avatar 舞台包含索引完全未列的三块动态 UI：
- `.avatar-source-photo`：上传照片后在舞台内显示"参考照片"缩略图内嵌（`petImageUrl &&` 条件渲染）。
- `.avatar-species-tag`：显示 `{物种名}` + `Lv. {petSize} 档案`——体型滑块值实时映射成"等级"。
- `.avatar-hud`：三行动态文案，随状态切换——`等待生成 / 已生成角色预览`、`{petName || '你的宠物'}`、`{物种} / 体型 N / 可旋转查看 | 请先上传照片`。
这些是"体型/物种/上传/生成"四个输入的实时反馈出口。索引把整个舞台压成一条"3D角色预览舞台"，丢了全部派生态。定位：main.jsx:192。

### G3 [medium] avatar 角色形象随物种改变形态（未提取）
`.avatar-body.{hamster|gecko|crestie|beardie}`（styles.css:1248-1268）：CSS 用不同 width/height/border-radius/渐变为花枝鼠/守宫/蜥蜴/鬃狮蜥拼出**不同体型轮廓**，随 `selectedSpecies.id` 切换（main.jsx:192 `avatar-body ${selectedSpecies.id}`）。索引"3D角色预览舞台"未体现"切物种→角色形态实时变形"这一联动。注：class 名（hamster/beardie/crestie）与数据层物种 id（rat/gecko/snake/parrot/spider）不完全对应，是**样式覆盖不全的既存缺陷**——蛇/鹦鹉/蜘蛛无专属 avatar-body 样式，落到默认灰色体。此项本身也是一个应记录的功能点。

### G4 [medium] avatar 待机呼吸动画（未提取）
`.avatar-body` 持续 `avatar-idle 3s ease-in-out infinite`（styles.css:1245，keyframes 1503），角色始终有轻微上下浮动的"活着"感。属于"要像游戏角色查看器"体验的一部分，索引未列。

### G5 [medium] FlipCards 触发方式 = hover + focus-within（提取不完整）
索引 shard-05 列了"能力地图翻转卡片（8张）"，但未提取触发条件：`.flip-card:hover .flip-inner, .flip-card:focus-within .flip-inner { transform: rotateY(180deg) }`（styles.css:2153-2155）。**`:focus-within` 意味着键盘 Tab 聚焦也能翻转**（无障碍路径），且翻转是 700ms 3D 绕 Y 轴。_map.md 第 128/5 条已自认"hover 行号待补"，此处补齐并升级为独立功能点（含 focus-within 分支）。

### G6 [medium] 全站响应式布局（完全未提取）
`src/styles.css` 有两段 `@media`：`min-width:768px`（2226 起，桌面双列/网格增强）与 `max-width:767px`（2385-2471，移动端重排：导航缩小、drawer 顶部偏移+单列、市场状态改 grid、物种轮播卡改 `min(318px, calc(100vw-52px))` 全宽、add-species 单列等）。**6 个分片没有任何一条涉及移动端/断点行为**。响应式是页面实物呈现的一部分（同一组件在窄屏是不同布局与触达尺寸），属于系统性遗漏，建议在各分片补"移动端表现"或单列一条跨分片功能点。

### G7 [low] "生成"前需先上传照片的软前置提示（未提取为约束）
`.avatar-hud` 文案在未上传时显示"请先上传照片"（main.jsx:192），语义上暗示"上传→生成"的顺序前置；但 `handleGenerateAvatar`（main.jsx:262）**不校验** `petImageUrl`，无照片也能点生成。这是一个"UI 文案声明了前置条件、逻辑未强制"的交互分支，索引的"生成3D预览按钮"未标注此 gap。该行为需要一个能校验/编排"先有宠物照片再生成角色"的服务来真正闭合。

### G8 [low] 物种数据的 modules 关联字段未被任何 UI 消费（数据暗示 vs 页面未体现）
`species` 数组每个物种带 `modules: [...]`（main.jsx:29-33，关联适配模块 id 列表），但通读 render 树，**没有任何组件读取 `species[].modules`**——`ModuleCommunitySection` 展示全量 13 模块、不按选中物种过滤。索引 shard-02 数据需求提到"关联模块 id 列表"，但未点明**该关联在当前页面是死数据/未接线**：数据结构已就绪的"按物种筛选专属配件"能力，UI 尚未实现。该功能需要一个能按物种返回其适配模块子集的服务，且前端消费点缺失。

### G9 [low] DOM 渲染顺序与分片编号不一致（结构备注，非缺失）
`App`（main.jsx:263）实际渲染序为：Hero → SpeciesShowcase → **PetCreatorSection → IntroSection** → ModuleCommunitySection → EnvironmentPreviewSection → UploadVibeSection …。即 `IntroSection`（被归入 shard-05）物理上夹在 pet-creator 与 module-market 之间，**不在页面尾部的营销区**。分片按"主题"而非"DOM 顺序"归组无问题，但如果下游按分片顺序重建页面会错位。此为定位提示，非功能缺口。

---

## 已被 _map.md 妥善标注、无需重复记的点（供对照，非缺口）
- 两个无 onClick 按钮（EnvironmentPreviewSection"生成场景报价" main.jsx:210 / UploadVibeSection"生成" main.jsx:218）——索引已收。
- 适配评分 92% 写死（main.jsx:210）——索引已收（fit-score）。
- 穿戴品无真实商品图（仅 AssetPlaceholder icon=Gift）——索引 shard-03 已收。
- src/dist 文案差异（爱宠社区已展开 / 首单挂件图）——_map.md 第 2 节已详载，且以 src 为准。
