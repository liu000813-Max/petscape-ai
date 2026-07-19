# B 线执行文档：B4 + B5 首版（3D 工作台与场景确认）

状态：v1（2026-07-19，用户拍板后编写）。上游：`PRODUCT-MODULES.md`（B4/B5 模块定义）、`ARCHITECTURE.md` §6 场景确认模块与 §7.4 不可变快照、`docs/plans/reference-competitor-3d-flow-2026-07-19.md`（竞品取舍，用户已逐项确认）、`docs/plans/p0-batch-1-execution-plan.md`（编排约定全部沿用）。

## 已拍板（2026-07-19，用户确认）

1. **笼舍 1:1 来源 = 手输尺寸参数化笼箱**：用户输入笼舍内部长/宽/高（mm），生成参数化笼箱（线框 + 地面）。1:1 的本质是真实尺寸参照，不是视觉复刻笼子外观。预设笼型库后置（PRD 待确认问题 2 以此口径首次落地）。
2. **3D 技术栈 = react-three-fiber v9 + drei（试用性质）**：理由——React 状态 ↔ 3D 场景的同步声明式化（工作台是重状态交互场景）；视角立方体（GizmoHelper）、尺寸标注（Html）、GLB 加载（useGLTF + Suspense）等已确认要的元素有现成件；React 应用做交互式 3D 的领域标准做法。**用户保留退路**：后续开发体验不佳可换回 three.js 直用；为此原型吸收的 AABB/叠放/尺寸换算逻辑一律写成与渲染层无关的纯函数，更换成本隔离在组件层。
3. **入口 = 默认项目直进**：App 壳导航加「3D 工作台」，进入时取最近项目（没有则静默新建）直达场景。项目管理 UI 留给 B1，本批不做列表页。
4. **数据模型 = Scene + SceneConfirmation 两表**，物品实例 JSONB 内嵌不单独建表（整场景读写、单人编辑，正规化无收益）。migration 排第二窗口——**时序更新：WP-A4-1 宠物表（PR #30）已合并且生产 migration 已 applied，本窗口已畅通**；动 `schema.prisma` 前知会编排方（migration 串行约定），合并后按纪律立即手动 migrate deploy（部署链缺 migration 步骤，P2021 教训）。
5. **范围切法 = 单页最小竖切**：不做独立单品预览页；竞品单品 Viewer 中用户确认纳入的元素（包围盒尺寸常显、视角立方体 + 回到原点、拖动提示、单个/全部重置）全部融进场景页，选中物品即预览。B4 的「生成」部分本批不碰。

## 范围：一条链

选物品（9 个归一化 GLB 临时物品库）→ 摆进 1:1 笼舍 → 确认 → 确认快照落库（C 线报价的输入）。

### 用户可见行为首版清单

- **笼舍**：手输内部长/宽/高（mm）→ 参数化笼箱；尺寸可改，改小后越界物品即时提醒。
- **物品库**：侧栏列表（9 个 `web/public/scene-assets/*.norm.glb`，缩略图 + 名称）；加入场景、选中、删除。`*.meshy.glb` 未核实烘焙状态，不用。物品库是临时形态，生成链（B2-B4 生成部分）接入后替换为用户自己的模型。
- **摆放**：地面拖动（「按住拖动」提示，竞品确认项）、绕竖轴旋转、叠放（自动找支撑物贴顶，吸收原型语义）、AABB 防碰撞与越界阻止。
- **尺寸**：选中物品的包围盒长/宽/高常显（竞品确认项）；目标尺寸输入，默认值取资产 meta.json 推荐尺寸，允许 50–300mm 内调整（权宜范围，可制造边界由 B6/B7 界定）；UI 明示「预览与摆放不代表可制造或适合宠物使用」（PRD 承诺边界）。
- **相机**：视角立方体 + 回到原点（drei GizmoHelper）；单个重置 / 全部重置。
- **比例参照**：一只按真实花枝鼠体尺寸归一的静态鼠模型，可显隐（资产来源与真实尺寸数值在 spec 内核定；候选：现有 avatar GLB 运行时归一）。
- **保存与恢复**：场景编辑自动保存（防抖写库）；刷新、重登、跨设备后恢复。
- **确认**：确认动作生成不可变快照（ARCHITECTURE §7.4）；确认后场景仍可编辑，再次确认产生新快照，不覆盖历史。

### 明确后置（本批不做）

测量工具（用户确认作进阶）、三轴旋转与镜像（首版只保留绕竖轴）、材料颜色（B7/B10）、截图分享（B11）、剖切（B6 后台）、GLB 压缩管线（`pink-teapot.norm.glb` 33.6MB，首版按需加载 + loading 态，压缩记为后续项）、预设笼型库、生成链接入、多场景/版本协作（B8）。

## 数据模型草案（spec 内以 zod schema 为字段正本）

- `Scene`：`id`、`projectId`（首版一项目一场景，unique；B8 版本协作再扩）、`cageWidthMm/cageDepthMm/cageHeightMm`、`items JSONB`、`createdAt/updatedAt`。
  - items 元素（`SceneItemSchema`）：`instanceId`、`assetKey`（首版指向 scene-assets 键，预留正式 `assetId` 引用位）、位置、`rotationY`、目标尺寸（mm）。
- `SceneConfirmation`：`id`、`sceneId`、`snapshot JSONB`（冻结整场景：笼舍尺寸 + 全部物品实例及各自最终 mm 尺寸与资产引用）、`confirmedAt`。不可变：无 update 用例。
- contract：`packages/server/src/contracts/scenes.ts`，照 `contracts/pets.ts` 已确立的模式（zod 运行时正本，DTO 从 schema 推导）。

## 接缝与依赖

- **确认 → 报价输入**：报价输入 contract 由电商 session 定义（尚不存在）。本线不等它：确认快照归场景确认模块拥有（ARCHITECTURE §6），快照内包含报价最少需要的字段（物品资产引用 + 最终尺寸 mm）。**落库 spec 闭合前与电商 session 对齐一轮快照字段形状**（待办，编排方执行）。
- **Pet 档案**：笼舍尺寸首版不与 `Pet.environmentNotes` 打通（该字段是自由文本，无结构化尺寸），后续再议。
- **原型退役**：`SceneViewer.tsx` / `PetViewer.tsx` 语义吸收后进 `docs/governance/prototype-retirement-ledger.md` 记账（吸收语义不搬代码，A4 先例）。

## WP 拆分

- **WP-B45-1 3D 工作台前端 + 场景纯逻辑**：R3F 场景、全部交互、笼箱参数化；AABB/叠放/越界/尺寸换算写成渲染层无关纯函数并 TDD 红绿；视觉沿 WP-A1 基准 + 竞品视觉要点（米白底、软阴影、胶囊工具栏、大留白少工具）。先以内存 state 跑通。
- **WP-B45-2 场景持久化 + 确认 API**：两表 migration、`contracts/scenes.ts`、`application/scenes.ts`（所有权断言复用现有模式）、`/api/v1/…` 薄 route、前端接线（自动保存 + 恢复 + 确认）。权限类测试先行（A 用户持 B 的 sceneId 读/写/确认 404；未登录 401；确认快照不可变）。
- 顺序：两包可并行开发，B45-1 落地后接 B45-2 的 API。
- 编排约定全部沿用 batch-1：TDD 红→绿证据、非实现者 QA 真实浏览器录屏、`gh pr checks --json` 显式判定、执行者独立 worktree、landing 零回归截图、样式作用域自包含（Tailwind preflight 教训）。

## 开放项

- 尺寸输入范围 50–300mm 是权宜值；正式可制造范围随 B6/B7 收敛。
- 比例参照鼠模型的资产选择与真实尺寸数值，spec 时核定。
- R3F 试用评估点：WP-B45-1 收尾时记录开发体验结论；若判定换回 three.js 直用，纯函数层不动，重写仅限组件层。
