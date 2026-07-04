# 缺口补录 G2：选择物种后下方推荐对应标品模块——未接线

> 隔离声明：本笔记仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现。功能点描述用"该功能需要一个能 X 的服务"的中立语言，不涉及、不引用、不猜测任何后端项目或技术选型。
>
> 依据：`src/main.jsx`（唯一权威源）。本补录只新增/修正 shard-04 遗漏的一个交互缺口，不重复 shard-04 已完整覆盖的其余功能点（`ModuleCard`、"查看更多/收起"、模块网格分页、`EnvironmentPreviewSection` 各子块等，详见 `section-shard-04-module-community-preview.md`）。

## 缺口结论：成立

查证结果：`species` 数组每个物种确有 `modules` 字段（关联模块 id 列表），`ModuleCommunitySection` 组件也确实渲染标品模块列表，但**两者在实物代码中没有任何数据流连接**——组件既未接收当前选中物种，也未按物种过滤/推荐模块。属于"数据已备好、UI 已就绪，接线动作缺失"的缺口，不是"页面里根本不存在这个模块列表"的误报。

---

## 1. 数据侧证据：`species` 数组自带 `modules` 关联字段

`src/main.jsx:28-34`，5 个物种记录，每条都含 `modules: [...]` 字段（模块 id 数组）：

| 物种 id | 物种名 | `modules` 字段值 |
|---|---|---|
| rat | 花枝鼠 | `['cheese-lounge-bed', 'banana-bed', 'banana-layer-pad', 'hanging-climb-baskets', 'cheese-play-mat', 'vine-foraging-tray']` |
| gecko | 守宫 | `['starry-hideout', 'star-bridge-hide', 'mushroom-climb-tree', 'sunny-climb-station', 'spiral-star-perch']` |
| snake | 蛇 | `['star-bridge-hide', 'starry-hideout', 'spiral-star-perch', 'cheese-play-mat']` |
| parrot | 鹦鹉 | `['hanging-z-ladder', 'sunny-climb-station', 'hanging-climb-baskets', 'vine-foraging-tray']` |
| spider | 蜘蛛 | `['mushroom-climb-tree', 'starry-hideout', 'star-bridge-hide', 'spiral-star-perch']` |

每个物种的 `modules` 列表与 `modules` 商品数组（`src/main.jsx:36-50`）里各条目的 `species` 字段是可交叉验证一致的（例如"花枝鼠"关联的 6 个 id，在 `modules` 数组里对应条目的 `species` 字段也确实含"花枝鼠"）。**这组字段在数据结构层面已经为"按物种推荐模块"做好了准备，但截至目前从未被任何组件读取消费。**

用全文搜索确认：`grep -n "\.modules\b" src/main.jsx` 只在 `species` 数组定义本身命中，没有任何组件代码读取 `item.modules` 或 `selectedSpecies.modules`——字段被写入后即被闲置。

---

## 2. UI 侧证据：`ModuleCommunitySection` 未接收物种上下文

`src/main.jsx:195`：

```jsx
function ModuleCommunitySection({ selectedIds, onToggleModule, marketRef }) {
  const [showAllModules, setShowAllModules] = useState(false);
  const visibleModules = showAllModules ? modules : modules.slice(0, 3);
  ...
}
```

组件签名只接收 `selectedIds`（已加入 3D 场景的模块 id）、`onToggleModule`（加入/移出回调）、`marketRef`（滚动锚点），**没有 `selectedSpeciesId` 或等价的物种上下文参数**。`visibleModules` 的计算逻辑是 `showAllModules ? modules : modules.slice(0, 3)`——永远对全量 `modules` 数组做"取前 3 条"或"取全部"的静态切片，与物种完全无关。

App 顶层实际调用处（`src/main.jsx:263`）：

```jsx
<ModuleCommunitySection selectedIds={selectedIds} onToggleModule={toggleModule} marketRef={moduleMarketRef} />
```

对照同一行里 `<SpeciesShowcase selectedSpeciesId={selectedSpeciesId} onSelectSpecies={setSelectedSpeciesId} .../>` 和 `<PetCreatorSection selectedSpecies={selectedSpecies} .../>` 的传参方式——`App` 组件里 `selectedSpeciesId` 这个 state（`src/main.jsx:247`）确实存在且已传给另外两个组件，唯独没有传给 `ModuleCommunitySection`。这是一处明确的"漏传 prop"，而非"物种状态压根不存在"。

### 交互形式（实物现状）
用户在 `SpeciesShowcase` 轮播区点击切换物种（或自动轮播 4.2 秒切换一次）后，`selectedSpeciesId` 状态确实会更新（`onSelectSpecies` 回调驱动），但页面下方的标品模块区（`ModuleCommunitySection`）**视觉与数据均无任何响应**——列表内容、顺序、数量在切换物种前后完全一致，永远是"折叠态显示 `modules` 数组前 3 条（奶酪软垫小床/香蕉软垫小床/夹层香蕉垫，均为花枝鼠向商品），展开态显示全部 13 条"，与用户刚选择的物种（例如切到"蜘蛛"）无任何关联。

### 期望行为（从 PRD 引用 + 数据结构推断）
按 `species.modules` 字段已具备的关联关系，切换物种后模块区应当：优先展示/置顶该物种关联的模块子集（如切到"蜘蛛"应优先展示 `mushroom-climb-tree`、`starry-hideout`、`star-bridge-hide`、`spiral-star-perch` 这 4 条，而不是恒定展示花枝鼠向的前 3 条），或至少提供按物种筛选的交互（筛选器/标签），让用户能看到"专属于当前物种"的推荐商品集合。当前实物只做到"全量罗列 + 展开收起"，物种维度的筛选/推荐能力完全未接入。

### 需要什么数据/服务能力
不需要新增数据能力——`species` 数组的 `modules` 字段已经是现成的关联数据，无需额外服务支撑。缺口纯粹在前端接线层面：`ModuleCommunitySection` 需要接收当前选中物种（或其 `modules` id 列表）作为 prop，并在计算 `visibleModules` 时按该物种的 `modules` 列表做筛选/排序/置顶，而不是对全量 `modules` 数组做与物种无关的静态切片。

### 当前实现状态
本地 JS 状态（纯前端），非占位壳，但**未接线**——`showAllModules` 状态和展开/收起交互本身是真实可用的（详见 `section-shard-04-module-community-preview.md` 第 4 节），只是这套交互完全忽视了物种上下文；数据源（`species[].modules`）与消费端（`ModuleCommunitySection`）之间没有任何代码路径连接，是纯粹的"prop 未传递、字段未读取"缺口，不涉及任何缺失的后端能力。

---

## 3. 与已有分片文档的关系

`section-shard-04-module-community-preview.md` 第 7 节"已知缺口清单"第 5 条已提及：

> 5. `modules` 数组虽含 `species` 字段（可用于按物种筛选），但当前 UI 未提供任何筛选/排序交互，只是纯罗列 + 展开/收起两态。

该条注意到了"`modules` 数组自带 `species` 字段、UI 未筛选"，但**未指出 `species` 数组一侧同样存在对称的 `modules` 关联字段、且 `SpeciesShowcase` 的选中状态与 `ModuleCommunitySection` 之间完全没有数据流连接**——即 G2 描述的"选择物种后下方推荐对应标品模块"这一具体交互路径未被识别为独立缺口。本补录在原有认知基础上补充了：(1) `species[].modules` 字段的存在与内容；(2) `App` 组件 `selectedSpeciesId` state 漏传给 `ModuleCommunitySection` 的具体代码证据（第 263 行 prop 列表对照）；(3) 该缺口应表述为"物种选择与模块推荐之间的接线缺失"，而非笼统的"无筛选交互"。

---

## 4. 本补录功能点小结（供汇总用）

| 功能点 | 交互形式 | 期望行为 | 数据需求 | 当前实现状态 |
|---|---|---|---|---|
| 选择物种后模块区按物种推荐/筛选 | 期望为：切换物种联动下方列表；实际：物种切换与模块列表无任何交互response | 切换物种后模块列表应优先展示/筛选该物种 `modules` 字段关联的商品子集 | 无新增数据需求，`species[].modules` 关联数据已就绪，只缺前端接线（prop 传递 + 筛选逻辑） | 未接线——`species` 数组的 `modules` 字段从未被任何组件读取；`ModuleCommunitySection` 未接收物种上下文 prop；`App` 顶层调用处（`src/main.jsx:263`）明确漏传 `selectedSpeciesId` |
