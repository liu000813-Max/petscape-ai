# Gap-8：[G7] 报价/重量/生产周期写死不随用户选择计算，生成报价按钮未接线

> 隔离声明：本笔记仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现，不涉及、不引用、不猜测任何后端项目或其它 PRD。数据/持久化/计算能力需求一律用"该功能需要一个能 X 的服务"的中立表述描述。

**缺口来源**：PRD §6.9 提出的报价示例数值（¥0.42/g、¥0.28/g、¥49+、2-4 天）与实物写死值完全一致；缺口不在数值本身，而在于这些数值/按钮在实物中**不随用户前序选择变化**、且报价生成动作**未接线**。

**覆盖组件**：`ManufacturingSection`（`src/main.jsx:229-231`，数据源 `materialRows` 第 76 行）、`EnvironmentPreviewSection`（`src/main.jsx:208-211`）

**验证结论**：缺口成立。已直接读取 `<USER_HOME>/Desktop/设计师前端页面/src/main.jsx` 对应行号核实，逐字与下文引用一致。本 gap 文档提取的证据此前已分散记录于 `section-shard-04-module-community-preview.md` §5.3/§5.6 与 `section-shard-06-manufacturing-order.md` §1.4/§1.5，此处按 gap 粒度单独提取合并、并补充"与用户选择不绑定"的直接代码级证据（`ManufacturingSection` 是零 props 的纯静态函数，`EnvironmentPreviewSection` 虽接收 `selectedModules` 但相关三处显示值仍与其无关或部分写死）。

---

## 1. 材料价目表（三行）写死，不随用户选择变化

- 证据：`main.jsx:76`，`const materialRows = [['PETG', '防潮、耐用、易清洁', '¥0.42 / g'], ['PLA+', '适合干燥装饰件', '¥0.28 / g'], ['后处理', '圆角打磨、清洁涂层、低气味处理', '¥49+']];`
- 渲染证据：`main.jsx:230`，`<div className="material-table">{materialRows.map(([name, desc, price]) => <div className="material-row" key={name}><strong>{name}</strong><span>{desc}</span><em>{price}</em></div>)}</div>`
- 结构性证据（关键）：`ManufacturingSection` 定义为 `function ManufacturingSection() { ... }`（`main.jsx:229`）——**零 props**。组件树上没有任何从 `App`（顶层状态容器，持有 `selectedIds`/`selectedModules`/`petSize`/`selectedWearables` 等全部用户选择状态）向 `ManufacturingSection` 传参的路径，`materialRows` 是模块作用域常量，与任何用户交互无关联的技术可能性都不存在（不是"绑定了但没生效"，而是从未接线）。
- 交互形式：无，纯列表渲染，无点选/切换材料的能力。
- 期望行为（从文案+数值结构推断）：三行分别对应"PETG（结构件材料）/PLA+（装饰件材料）/后处理（固定服务费）"，暗示总价应按用户实际选用的模块材料构成（各模块 `material` 字段，见 `modules` 数组 `main.jsx:36-50`）分别套用对应单价再求和，而不是一张固定不变的说明性价目表。
- 需要什么数据/服务能力：该功能需要一个能维护材料种类、单价、说明文案，并能根据用户实际选择的模块材料类型套用对应单价计算总成本的服务；当前用户在模块社区（shard-04）选择的每个模块虽自带 `material` 字段（如 "PETG"、"PETG / 软垫"、"PETG / 藤编纹理"），但这些字段从未在 `ManufacturingSection` 的价目表渲染中被读取或引用。
- 当前实现状态：**纯展示**（写死数组渲染，非可交互选择器，也非真实计价引擎；组件本身零 props，物理上无法感知用户选择）。

## 2. 预计重量/生产周期/报价区间三个总计数值全部写死

- 证据：`main.jsx:230`，`<div className="quote-total"><span>预计 1.8kg / 生产 2-4 天</span><strong>¥399 - ¥899</strong></div>`
- 交互形式：无。
- 期望行为：给出一个总览式结论——"预计 1.8kg / 生产 2-4 天"、报价区间"¥399 - ¥899"，让用户对最终成本和等待时间有心理预期；从产品叙事（"让用户清楚看到：效果图可以变成真实订单"，`main.jsx:230` 标题）推断，这三个数字理应是对用户在 shard-03（宠物体型 `petSize`）、shard-04（已选模块 `selectedIds`/`selectedModules`，含各模块 `weight` 字段）两处实际选择的汇总结果。
- 反证据（数据本已具备但未被使用）：`modules` 数组（`main.jsx:36-50`）13 条记录每条都带 `weight` 字段（如 `cheese-lounge-bed` 180g、`hanging-z-ladder` 80g），`EnvironmentPreviewSection` 已证明"对已选模块字段做 reduce 求和"在技术上完全可行——它对 `price` 字段做了实时求和（见下节 §4），却没有对等地对 `weight` 字段做同样的求和来驱动这里的"预计 1.8kg"。说明不是能力缺失，是这条数据链路从模块选择状态到 `ManufacturingSection` 之间根本没有被连接。
- 需要什么数据/服务能力：该功能需要一个能根据用户实际选择的模块组合（含各模块重量）、材料选择、后处理选项，实时计算出准确重量、生产周期和精确报价（而非区间）的服务；当前数值是固定写死的示例值，不随前面任何用户选择（物种、模块、体型、装扮）变化。
- 当前实现状态：**纯展示**（写死数值）。与 `EnvironmentPreviewSection` 中用户实际选择的模块小计价格（`main.jsx:209` 的 `total`，真实 `useMemo` 求和）完全无数据关联——即便用户在模块社区选择了完全不同的模块组合（不同数量、不同重量、不同价格），`ManufacturingSection` 显示的报价区间和重量始终是"¥399 - ¥899"、"1.8kg / 2-4 天"，一字不变。

## 3. 报价标题"森林奶酪屋套装"同样写死、与实际所选场景/模块无关

- 证据：`main.jsx:230`，`<div className="quote-head"><Factory size={20} /><div><span>报价示例</span><strong>森林奶酪屋套装</strong></div></div>`
- 交互形式：无。
- 期望行为：暗示这份报价对应用户当前配置的具体套装名称；但"森林奶酪屋套装"与 shard-05 `scenePacks` 数组中的"森林奶酪屋"场景包同名仅是文案巧合式复用，代码层面两者无任何数据绑定（`ScenePackSection` 与 `ManufacturingSection` 之间没有共享 state 或 props 传递）。
- 需要什么数据/服务能力：该功能需要一个能针对用户实际选择的场景/模块组合生成对应报价标题（或至少反映"当前配置"而非固定套装名）的服务。
- 当前实现状态：**纯展示**（写死字符串）。

## 4. `EnvironmentPreviewSection`「生成场景报价」按钮无 onClick，点击无任何反应

- 证据：`main.jsx:210` 末尾（组件返回 JSX 的最后一个元素），`<button type="button">生成场景报价</button>`
- 交互形式：视觉上是可点击按钮（有 `type="button"`、有边框/背景样式），但未绑定任何事件处理器。全文件搜索确认 `EnvironmentPreviewSection`（`main.jsx:208-211`）内没有第二个 `onClick` 定义可覆盖到此按钮。
- 期望行为（从文案+同区块其它真实数据推断）：点击后应基于当前 `selectedModules`（已加入 3D 场景的模块集合，已经在同一组件里驱动着"模块小计" `¥{total}` 的实时求和，见 `main.jsx:209`）生成一份正式报价，很可能是把 `ManufacturingSection` 里那套"材料+重量+周期+总价"结构套用到用户实际选择上、产出真实结果（而非本 gap §1-§3 描述的写死值）。
- 需要什么数据/服务能力：该功能需要一个能根据用户已选模块组合（`selectedModules`）、材料构成、总重量，计算并返回正式报价单（含精确总价、材料成本明细、预计生产周期）的服务；当前按钮点击不会触发任何请求或状态变化。
- 当前实现状态：**占位壳**——按钮无 `onClick` 绑定。这是全项目 20 个组件中仅有的两处"结构完整但未接入处理逻辑"的按钮之一（另一处是 `UploadVibeSection` 的"生成"按钮，见 `_map.md` §1C，不属本 gap 范围）。

## 5. 已验证为"真实计算"的对照组（用于界定缺口边界，避免误判）

为避免把整个报价区块笼统判为"全部写死"，需明确同一组件内 **确实存在** 真实动态计算的部分，缺口仅限于上述 §1-§4：

- 「模块小计」`<strong>{selectedModules.length ? `¥${total}` : '¥0'}</strong>`（`main.jsx:209-210`）：`total` 由 `useMemo(() => selectedModules.reduce((sum, item) => sum + Number.parseInt(item.price.replace(/[^\d]/g, ''), 10), 0), [selectedModules])` 实时计算，随用户加入/移出模块真实变化。这是"报价"链路里唯一已联通用户选择的数值。
- 已选模块 chips 与明细列表（`main.jsx:210` 的 `preview-chips`/`preview-list`）：随 `selectedModules` 真实增删，非写死。

**缺口的精确边界**：用户在模块社区选好模块后，能看到的"实时反映选择"的数字只有一个（模块小计 ¥{total}）；一旦叙事推进到 `ManufacturingSection`（"效果图变成真实订单"环节）或点击「生成场景报价」，所有更进一步、更接近"最终下单依据"的数字（材料单价表、总重量、生产周期、报价区间、报价标题）全部与前面的真实小计脱钩，退回写死值；报价生成动作本身也未接线。

---

## 6. 数据/服务需求归纳（中立表述）

1. 该功能需要一个能根据用户已选模块组合（含材料构成、各模块重量）、后处理选项，实时计算出准确材料成本、总重量、生产周期和精确报价（而非固定区间）的服务，替代当前 `ManufacturingSection` 内写死的材料表、"1.8kg / 2-4 天"、"¥399-¥899"三处数值。
2. 该功能需要将"报价示例"标题替换为反映用户实际配置（而非固定"森林奶酪屋套装"字符串）的展示逻辑，或明确将其保留为独立于用户选择的示例区块（需产品侧决策消除歧义）。
3. 该功能需要为 `EnvironmentPreviewSection`「生成场景报价」按钮接入一个真实的处理逻辑：点击后调用上述报价计算服务，基于当前 `selectedModules` 生成正式报价单并展示结果。

## 7. 结构性证据小结（区别于"数值恰好一致"的表面证据）

| 组件 | props | 是否接收用户选择状态 | 缺口性质 |
|---|---|---|---|
| `ManufacturingSection` | 无（零 props） | 否——物理上无接线路径 | 材料表/总重/周期/报价区间/标题共 5 处写死值，均与 `App` 顶层状态（`selectedIds`/`selectedModules`/`petSize` 等）无任何 props 传递关系 |
| `EnvironmentPreviewSection` | `selectedModules` | 是——但仅"模块小计"一处消费该 prop 做真实计算 | 「适配评分」写死 92%（已见 shard-04 §5.3，与本 gap 报价按钮同处一个组件，一并列为佐证）；「生成场景报价」按钮无 onClick |

**结论**：PRD §6.9 描述的报价能力（按材料单价、重量动态计算真实报价与周期）在本前端实物中**尚未实现**——现有 UI 是"报价面板的完整视觉设计 + 报价生成按钮的完整视觉设计"，但两者都停留在写死示例数据/未接线状态，中间缺一层"消费用户选择、驱动这些显示值"的计算与请求逻辑。缺口成立，非误判。
