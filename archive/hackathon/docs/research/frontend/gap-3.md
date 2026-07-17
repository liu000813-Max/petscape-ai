# 缺口补提报告 — gap-3（场景包无「进入定金支付/选购加入」入口）

> 隔离声明：本报告仅覆盖 `<USER_HOME>/Desktop/设计师前端页面` 一个前端项目的实物呈现。不涉及、不引用、不猜测任何后端项目或其它 PRD。所有"数据/服务需要"表述均使用中立语言（"该功能需要一个能 X 的服务"），不提及任何具体后端技术或项目名称。

## 缺口描述（来自任务输入）

[G3] 场景包无「进入定金支付/选购加入」入口。PRD §6.7 要求「允许用户从场景包进入定金支付」、§5.1 主流程第9-11步。前端 `ScenePackSection`（shard-05 §4.2）三张卡纯展示，无 `onClick`、无加入/选购/支付按钮，停留营销层，与 `ModuleCard` 可「加入3D场景」形成对比。

## 查证结论：缺口成立

已直接对源码逐字核对，缺口描述与实物完全一致，且已有 `section-shard-05-content-marketing.md` §4.2 与 `_map.md` 对同一处有过完整记录（本报告在其基础上按缺口视角重新聚焦提取，不重复造轮子，指向同一份证据）。

## 证据

### 1. ScenePackSection 组件本体（main.jsx:225-226）

```jsx
function ScenePackSection() {
  return (
    <section className="scene-section">
      <div className="section-copy narrow">
        <span>场景包</span>
        <h2>把喜欢的氛围一键打包成可以落地的爱宠小窝。</h2>
      </div>
      <div className="scene-grid">
        {scenePacks.map(({ title, tag, copy, price, image }) => (
          <article className="scene-card" key={title}>
            <div className="scene-media">
              {image
                ? <img className="scene-image" src={image} alt={`${title} 效果图`} />
                : <AssetPlaceholder title={`${title} 效果图`} ratio="16:9" icon={Image} />}
            </div>
            <div className="scene-body">
              <span>{tag}</span><h3>{title}</h3><p>{copy}</p><strong>{price}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
```

逐字核对：`<article className="scene-card">` 及其子元素 `scene-media` / `scene-body` 内，不存在任何 `<button>`、`onClick`、`onSelect`、`<a href>` 或其它事件绑定属性。三张卡片（森林奶酪屋 ¥399+ / 都市基地 ¥459+ / 雨林树屋 ¥369+，数据源 main.jsx:71-75）渲染出的 DOM 仅含一张图片、一个标签、一个标题、一段简介、一个价格文本，全部是纯文本/图片节点。

### 2. 样式层核对（src/styles.css:1941-1978）——排除"有点击态但未在 JSX 体现"的可能

```css
.scene-card {
  border: 1px solid var(--line);
  border-radius: 28px;
  background: #fff;
  overflow: hidden;
}
.scene-media { padding: 14px 14px 0; }
.scene-image { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 18px; }
.scene-body { padding: 18px; }
.scene-body span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: rgba(0,0,0,0.48); }
.scene-body h3 { font-size: 34px; }
.scene-body strong { display: inline-flex; margin-top: 18px; font-size: 18px; font-weight: 500; }
```

`.scene-card` 及其子选择器均无 `cursor: pointer`、无 `:hover`/`:active` 视觉反馈规则、无按钮相关类名（对比全局搜索 `.scene-` 前缀共 10 处命中，styles.css:720、733、862、1941、1948、1952、1960、1964、1971、1975、2356，逐条为标题字号、正文颜色、栅格断点等纯排版规则，无一处涉及交互态）。这排除了"卡片整体可点击但样式里有隐藏交互态、只是 JSX 里事件绑定写漏"的可能——视觉与结构两层都指向纯展示。

### 3. 对照组：ModuleCard 的真实"加入"交互（main.jsx:184-186）

```jsx
function ModuleCard({ module, selected, onToggleModule }) {
  return (
    <article className={`module-card ${selected ? 'selected' : ''}`}>
      <ProductRender module={module} />
      <div className="module-body">
        <div><span>{module.species}</span><h3>{module.title}</h3><p>{module.description}</p></div>
        <div className="module-meta">
          <span>{module.material}</span><span>{module.weight}</span><strong>{module.price}</strong>
        </div>
        <button type="button" onClick={() => onToggleModule(module.id)}>
          {selected ? '已加入预览' : '加入 3D 场景'}
        </button>
      </div>
    </article>
  );
}
```

同为"卡片形式展示可购买单元"，`ModuleCard`（标品社区，单个可打印模块）有真实 `<button type="button" onClick={...}>`，点击后驱动父级 `selectedIds` state（联动 `EnvironmentPreviewSection` 的已选列表和价格实时求和）；`ScenePackSection`（场景包，多模块打包方案）没有对应机制——两者渲染模式几乎同构（图 + 标签/标题/简介 + 价格），唯一实质差异就是有没有一个"加入/选购"按钮和背后的 state 挂载点。这构成了缺口描述里"与 ModuleCard 可'加入3D场景'形成对比"的直接实物证据。

### 4. 页面渲染顺序确认 ScenePackSection 独立于其它交互链路（main.jsx:263）

`ScenePackSection` 在主 `<main>` 渲染树中位于 `RenderSection` 之后、`ManufacturingSection` 之前，前后相邻组件均为纯展示或已知占位壳（`RenderSection` 三张 AssetPlaceholder 无交互；`ManufacturingSection` 报价面板无交互），场景包区块前后没有任何隐藏的" props 透传"或跨组件 state 联动能覆盖到它——`ScenePackSection` 调用时不传入任何 props（`<ScenePackSection />`，main.jsx:263），确认它是完全独立、无状态、无外部交互挂载点的组件。

## 功能点提取

### 4.1 场景包卡片缺失「选购/加入」交互入口

- **证据**：`main.jsx:225-226`（组件定义）+ `main.jsx:71-75`（`scenePacks` 数据源）+ `styles.css:1941-1978`（样式层确认无隐藏交互态）。三张场景包卡片（森林奶酪屋/都市基地/雨林树屋）仅渲染图片、标签、标题、简介、起售价，`<article className="scene-card">` 内无 `<button>`、无 `onClick`、无 `<a>`，不可点击进入下一步。
- **交互形式**：无。纯视觉浏览型卡片，鼠标悬停无反馈（CSS 无 hover 态），点击无任何响应。
- **期望行为**：依据缺口描述引用的产品需求（"允许用户从场景包进入定金支付"、主流程第 9-11 步）与本区块自身文案"把喜欢的氛围一键打包成可以落地的爱宠小窝"（main.jsx:226）、以及每张卡片明确标注的起售价格（"¥399+"类"+"结尾格式，暗示价格随选配变化，需要用户进一步操作才能得到最终报价），用户点击场景包卡片（或卡片内某个"选购整套"/"加入预览"按钮）后，应能进入下一步——无论是加入到类似 `EnvironmentPreviewSection` 那样的预览/已选列表，还是直接进入定金支付流程，形成"浏览场景包 → 选定一套 → 支付/确认"的闭环。与 `ModuleCard`「加入 3D 场景」→ 反映在 `EnvironmentPreviewSection` 已选列表并参与总价计算的现有模式相比，场景包停留在纯营销展示层，用户看完三张卡片后没有任何前端提供的下一步动作。
- **数据/服务需要**：该功能需要一个能接收"用户选定某个场景包"这一操作、并将该场景包对应的模块组合体现到已选预览/订单状态中的服务；若进一步对应"进入定金支付"，还需要一个能发起定金支付流程（关联具体场景包、生成待支付订单）的服务。
- **当前实现状态**：纯展示（占位壳的更彻底形式——本组件甚至不像 `UploadVibeSection`"生成"按钮或 `EnvironmentPreviewSection`"生成场景报价"按钮那样有一个"结构就绪但无 onClick"的按钮元素存在；`ScenePackSection` 的三张卡片连按钮 DOM 节点都不存在，是全项目里交互缺失程度最彻底的可购买类展示单元）。

## 小结

缺口 [G3] 成立。证据链：组件 JSX（无按钮/事件绑定）+ 样式表（无交互态视觉线索）+ 对照组 `ModuleCard`（同类卡片有真实"加入"按钮与 state 联动）+ 页面渲染树（`ScenePackSection` 无 props 传入，无外部联动可能）四重交叉确认，排除了"交互逻辑挂在别处/样式暗示可点击"等替代解释。本缺口在既有 `section-shard-05-content-marketing.md` §4.2 中已有详细记录（"卡片本身不可点击进入详情或加入订单……与另一分片 ModuleCommunitySection 里单个模块可'加入 3D 场景'的交互形成对比"），本报告在缺口视角下重新核实并补齐"选购/加入/支付入口缺失"这一具体功能点表述，供 PRD 对照使用。
