# B 线执行文档：B4 单品检视 + B5 场景确认首版

状态：v5（2026-07-19，批次 2 执行中；migration 槽位缩至生产 DB 临界区，WP-B45-2 作为 OPS-1 首次真实 migration 演练）。上游：`PetScape-PRD.md`、`PRODUCT-MODULES.md`（B4/B5）、`ARCHITECTURE.md` §6、§7.3、§7.4、`docs/plans/reference-competitor-3d-flow-2026-07-19.md`、`docs/plans/p0-batch-1-execution-plan.md`。

本版取代 PR #31 中“单页完成 B4+B5、选中场景物品即预览”的范围切法。首版采用两个明确阶段：用户先检视并确认单个目标模型版本，再把该模型放入完整场景确认尺寸、摆放和空间关系。提议、预览、模型确认、场景确认、制作/安全检查、报价和订单是不同承诺，不得混写。

## 已确认（2026-07-19）

1. **两阶段用户流程**：`单品检视与模型确认 → 完整场景确认`。B4 与 B5 可以共享 3D 基础组件，但必须有独立任务状态和显式阶段转换。
2. **临时模型来源**：第一批允许使用仓库现有、已归一化的 GLB 作为测试资产；页面明确标注“AI 生成链尚未接入”。本批验证 B4 输出进入 B5 的接口和用户行为，不能据此宣告 B4“模型生成”完成。
3. **笼舍 1:1 来源**：用户输入笼舍内部长、宽、高（mm），生成参数化笼箱（线框 + 地面）。1:1 指真实尺寸参照，不是视觉复刻笼舍外观；预设笼型库后置。
4. **尺寸调整 = 等比缩放**：不允许分别拉伸三个轴。用户调整一个统一比例或主尺寸，系统按资产原始包围盒计算并常显最终长、宽、高；三轴独立形变属于后续模型修改能力。
5. **首版摆放类型**：只支持落地或放在水平支撑面上的物品。吊挂、贴壁、顶部安装和安装点建模后置；临时物品库不得展示当前无法正确摆放的品类。
6. **场景角色**：每个场景恰有一个本次准备制造的 `target`；可以加入零到多个 `context` 参照物。笼舍、通用花枝鼠比例模型和 context 物品均不参与本次制造或报价，界面必须明确标识。
7. **入口与恢复**：正常主链携带明确的项目、目标物品和已确认模型版本进入场景。App 壳“3D 工作台”只负责继续最近一次 3D 工作；没有可继续项目时进入选择/创建引导，不静默创建项目。工作台常显当前项目和目标物品。
8. **花枝鼠比例参照**：使用标准成年花枝鼠的简化模型或轮廓，可显隐，并标注“通用比例参照，不代表你的宠物真实体型”。不把现有 Avatar 运行时归一后表述为真实尺寸。
9. **3D 技术栈试用**：候选为 `react-three-fiber` v9 + drei。正式工作包前先做短技术尖峰；若关键交互或资源生命周期不可靠，保留 three.js 直用方案。AABB、越界、叠放、尺寸换算和快照构造必须是与渲染层无关的纯函数。

## 首版完整竖切

```text
选择现有测试模型
  → 单品加载与检视
  → 明确确认模型版本
  → 输入真实笼舍内部尺寸
  → 把目标物品放入 1:1 场景
  → 可选加入参照物
  → 自动保存并恢复草稿
  → 明确确认场景版本
  → 产生可供 B6/B7 与未来 C 线引用的稳定确认标识
```

临时目录资产可以跑通上述行为，但 `temporary_catalog` 模型不具备正式报价资格。真正进入检查、报价和订单前，目标模型必须转为用户拥有的正式 `Asset` 版本，并携带不可变校验信息。

## 视觉定稿参考（2026-07-19）

两阶段工作台的视觉与交互定调基准 = `docs/plans/assets/b45-prototype/`（designer 探索稿快照，用户 2026-07-19 认可；打开方式、定调要点、开放项与资产事实见其 README）。工作台实现沿用该稿的 psx token 复用、米白视口、胶囊工具栏与状态呈现方式；README 中两处开放项及 `starry-hideout.norm.glb` 的处置已由下方“本批默认实现”闭合。

### 本批默认实现（2026-07-19，用户确认）

- 阶段一右栏保留探索稿的 editorial 留白，本批不新增「检视要点」卡；花枝鼠比例参照继续用程序化简化模型，保留“通用比例参照”说明，不引入真实宠物模型制作。
- 首批 target 测试资产固定为 `cheese-lounge-bed`、`banana-bed`、`cheese-play-mat`；context 测试资产固定为 `cloud-moss-platform`、`star-spiral-ramp`。
- `cloud-hammock`、`hanging-climb-baskets`、梯子类资产因本批不支持吊挂/安装而剔除；`starry-hideout` 本批直接剔除，不投入材质修复工作。
- 上述临时资产全部是交互验证 fixture，必须以精确文件、checksum、meta 尺寸和 sandbox 状态登记，不能因此获得正式报价资格。

## 用户可见行为

### 阶段一：单品检视与模型确认（B4 预览部分）

- **测试资产清单固定**：首批只使用明确适合落地/水平支撑的 `.norm.glb`，spec 必须列出精确 `assetKey`、文件、checksum、尺寸来源、占位状态和体积。不得再使用“9 个 GLB”这类无法复核的集合描述。
- **加载状态**：包含加载进度或明确等待态、加载失败、重试和切换模型时取消旧请求；异常模型不能进入确认。
- **查看**：旋转、缩放相机、视角立方体、回到原点；不提供专业工程工具箱。
- **尺寸**：常显资产原始包围盒与等比缩放后的最终长/宽/高（mm）。meta 中的归一化尺寸是测试默认值，不表述为已验证的制造推荐尺寸。
- **模型确认**：按钮文案明确为“确认此模型，进入场景”。确认冻结模型资产引用、checksum、原始包围盒和确认时间；它只表示用户愿意继续摆放，不表示可制造、适合宠物使用或已经报价。
- **重新选择**：用户可以返回测试资产列表选择其他模型；新选择产生新的模型确认，不能原地覆盖历史确认。

### 阶段二：完整场景确认（B5）

- **笼舍**：输入内部长/宽/高（mm）生成参数化笼箱；修改尺寸后立即重新检查越界状态。
- **目标物品**：从阶段一携带唯一已确认模型进入场景，并始终标识“本次目标物品”。不能在场景内悄悄替换为另一个资产版本。
- **参照物**：允许加入零到多个临时 context 物品；列表和画布均标识“仅供空间参照，不参与本次制造/报价”。
- **摆放**：地面拖动、绕竖轴旋转、在水平支撑面叠放、单个重置、全部重置、删除 context。目标物品不能被删除，只能返回阶段一重新选择模型。
- **尺寸调整**：只允许等比缩放。最终三轴尺寸实时更新；可编辑范围只是交互保护，不得伪装为可制造范围。
- **边界与碰撞**：旋转后的 world-space AABB、笼舍越界和物品重叠即时提示并阻止确认。AABB 叠放只是首版近似，不得表述为安装、安全或真实接触面验证。
- **比例参照**：标准成年花枝鼠模型默认可见、可关闭，始终显示“通用比例参照”说明。
- **相机与视觉**：视角立方体、回到原点、米白背景、软阴影、胶囊工具栏、大留白、少工具；B11 的截图、360° 成片和高质量商品渲染不进入本批。
- **承诺边界**：常显“模型检视与场景确认不代表可制造或适合宠物使用”。

### 保存、恢复与确认

- 场景自动保存采用防抖写入，并展示“保存中 / 已保存 / 保存失败，重试”状态。
- `Scene.revision` 单调递增；客户端保存必须携带读取到的 revision。服务端对陈旧 revision 返回结构化冲突，禁止跨标签页或跨设备无提示覆盖。
- 刷新、重登、跨设备后恢复服务器草稿；恢复行为用真实数据库和服务器重启验证，不以浏览器内存或 mock 代替。
- 场景确认前必须满足：目标模型确认存在、目标资产可读取、当前 revision 已保存、笼舍尺寸有效、目标物品未越界且不存在阻断碰撞。
- 确认绑定精确 `sceneRevision`；同一 Scene + revision 重复提交只返回同一确认结果，不重复制造等价快照。
- 确认后场景仍可编辑。任何编辑都会显示“当前草稿已不同于最近确认版本”；再次确认创建新快照，不覆盖历史。

## 数据与 Contract spec（2026-07-19 闭合）

字段正本在实施 spec 中由 zod schema 承载，DTO 从 schema 推导。下列对象表达业务边界，不授权 B 线提前定义报价、检查或订单 Contract。

本批采用以下持久化边界：每个 Project 首版只有一个活动 `Scene`；`Scene.items` 使用版本化 JSONB，不建立 `SceneItem` 数据表；`Scene` 是带 `revision` 乐观锁的可编辑草稿，`ModelConfirmation` 与 `SceneConfirmation` 是 append-only 不可变历史。

### `DesignItem`

- `id`、`projectId`、名称、当前工作引用、`createdAt/updatedAt`。
- 表示项目中希望制造的目标物品，不承载 Job、检查、报价或订单状态。

### `ModelConfirmation`

- `id`、`designItemId`、`modelRef snapshot`、`sourceBoundsMm`、`confirmedByUserId`、`confirmedAt`。
- `modelRef` 使用带类型的联合结构：
  - `temporary_catalog`：`assetKey + checksum`，仅用于本批交互验证，`quoteEligible=false`；
  - `owned_asset`：`assetId + sha256 checksum`，正式链使用，并在写入时验证 checksum 非空、资产归属和 Project 关系；资产内容变化创建新 `Asset`，不覆盖旧二进制，本批不新增 `AssetVersion` 表。
- 不提供 update 用例；重新选择模型创建新确认。

### `Scene`

- `id`、`projectId`（首版一项目一活动场景，数据库唯一约束）、`targetDesignItemId`、`targetModelConfirmationId`、`targetInstanceId`、笼舍尺寸、`items JSONB`、`revision`、`createdAt/updatedAt`。
- `SceneItemSchema` 至少包含：`instanceId`、`role(target|context|pet_reference)`、版本化 `modelRef`、位置（mm）、`rotationYRad`、`uniformScale`、源包围盒和最终包围盒。
- Schema 约束：恰有一个 target；target 必须对应 `targetModelConfirmationId`；context 与 pet_reference 永不成为报价目标。

### `SceneConfirmation`

- `id`、`sceneId`、`sceneRevision`、`targetDesignItemId`、`targetModelConfirmationId`、`targetInstanceId`、`snapshotSchemaVersion`、`snapshot JSONB`、`confirmedByUserId`、`confirmedAt`。
- snapshot 冻结：笼舍尺寸、全部场景实例及角色、最终 mm 尺寸、版本化资产引用、确认时 revision。
- `@@unique([sceneId, sceneRevision])` 支撑确认幂等；无 update 用例。

### 权限与一致性

- Scene、DesignItem、ModelConfirmation 与所有 `owned_asset` 必须属于当前用户和同一 Project；不能只验证 sceneId 的所有权。
- 访问他人对象统一按现有模式返回 404；未登录返回 401。
- 自动保存、确认和资产校验在应用层用例完成，Route Handler 只解析 Contract 和映射响应。
- JSONB 快照携带 `snapshotSchemaVersion`；读取历史快照不能依赖当前可编辑 schema 恰好未变化。

## 与 B6/B7、电商线的接缝（2026-07-19 批次 2 收敛，用户拍板）

- 场景确认模块拥有 `SceneConfirmation`，对外提供稳定 `sceneConfirmationId`、目标物品身份和版本化模型引用。
- **跨线输入 contract 以 C 线执行文档的 `WP-SEAM-0` 为正本**：版本化 zod contract 落共享 `packages/server/src/contracts/`，由 C 线 session 起草、B 线 session 会签；不再由各线自行定义输入 Contract 或由编排方逐字段对齐。contract 只约束跨线输出，不规定本线数据库表或内部状态机。
- **下游报价输入绑定 `SceneConfirmation`**（不是 `ModelConfirmation`）：contract 携带 `targetInstanceId` 的最终 mm 尺寸；`ModelConfirmation` 只作为快照内的间接引用。任何下游都不能直接把 Scene 当前草稿当成价格、安全或订单真相。
- **B 线拥有 producer adapter 与 provider conformance test**（见 WP-B45-3）：把 `SceneConfirmation` 映射为 WP-SEAM-0 contract 并通过双方共同的兼容性测试。
- 首版报价与订单只针对 `targetInstanceId`，context、笼舍和宠物参照不进入订单项。
- `temporary_catalog` 模型的场景确认经 producer 只能生成 sandbox 来源的下游请求；正式报价必须拒绝，只有用户拥有且版本明确的 Asset 可以继续。
- 笼舍尺寸首版保存在 Scene，不写入 `Pet.environmentNotes`；结构化宠物环境或多笼舍档案另行讨论。

## 明确后置

- AI 生成链和通用模型上传/解析的正式接入；
- 多候选并排比较、评论、分享与版本协作（B8）；
- 三轴独立形变、三轴旋转、镜像和局部模型修改；
- 吊挂、贴壁、顶部安装、安装点和连接件建模；
- 测量工具、材料/颜色、贴图编辑、截图分享、剖切；
- 个性化宠物真实体型与 Pet 档案接通；
- 预设笼型库、多场景和整套场景购买；
- GLB 压缩生产管线。首版仍必须定义单资产大小上限、加载失败和性能验收，不能以“后续压缩”为由跳过错误路径。

## 工作包与顺序

### WP-B45-0：Contract 闭合 + R3F 技术尖峰

- 冻结两阶段状态、SceneItem/ModelRef/快照 schema、目标与 context 角色、revision 冲突和确认幂等语义。
- 用代表性 GLB 验证：加载/卸载、错误重试、OrbitControls 与 TransformControls 冲突、地面拖动、GizmoHelper、Html 尺寸标注、Strict Mode 资源释放、移动端指针和同场多模型性能。
- 记录 R3F 继续/退回 three.js 直用的结论与证据。尖峰通过前不开始完整工作台组件建设。

### WP-B4-1：单品检视与模型确认

- 固定临时资产清单和 provenance；完成单品 Viewer、加载错误、视角、尺寸常显、等比缩放和显式确认。
- 先以内存和纯 Contract 完成用户行为；持久化接入后验证不可变 ModelConfirmation。
- 验收不包含 AI 生成成功，不把临时目录资产描述为用户正式资产。

### WP-B5-1：场景交互与纯逻辑

- 参数化笼箱、唯一 target、context 列表、地面拖动、绕 Y 轴旋转、等比缩放、水平叠放、旋转后 AABB、越界、单个/全部重置、标准花枝鼠比例参照。
- 几何与状态规则先写纯函数红灯测试，再完成渲染层；首轮以内存 state 跑通阶段转换。

### WP-B45-2：持久化与两类确认 API

- 一个职责闭合的 migration 落 `DesignItem`、`ModelConfirmation`、`Scene`、`SceneConfirmation` 及必要关系/索引。
- 新增 `contracts/scenes.ts`、应用层用例和 `/api/v1/...` 薄 Route Handler；接入自动保存、revision 冲突、恢复、模型确认和场景确认。
- 前端包可以在 WP-B45-0 Contract 冻结后并行实现，但持久化接线依赖前端行为和 API 都完成；不得边做边分叉字段正本。
- WP-B45-2 可在独立 worktree 并行完成 schema、Draft migration、实现/测试与隔离临时数据库 CI；生产合并槽位由批次 2 跨线单队列按就绪顺序放行。进入槽位后必须 rebase 最新 `main` 并重跑完整 migration CI，不得复用旧 base 结论；槽位只持续到生产 `migrate deploy`、目标 schema 验证与 `/api/healthz db:true`，完整功能/浏览器 QA 在槽外并行（详见 `p0-batch-2-execution-plan.md`）。WP-OPS-1 先独立落地部署链改造，WP-B45-2 随后作为该链路第一次真实 migration 演练，不把运维改造混进本 WP。

### WP-B45-3：WP-SEAM-0 producer adapter（挂 WP-B45-2 之后）

- 实现 `SceneConfirmation` → WP-SEAM-0 contract 的 producer adapter：输出 `schemaVersion`、服务端可验证的确认引用与 `projectId`、单物品资产标识与不可变版本/校验、`targetInstanceId` 最终 mm 尺寸与单位、方向/姿态（首版为 `rotationYRad` + 等比缩放语义）、服务端确认时间与来源。
- 通过 C 线定义的 provider conformance test；`temporary_catalog` 来源必须显式标记 sandbox。
- 依赖 WP-B45-2 落库完成；在此之前 C 线只使用 sandbox fixture，不阻塞两线并行。

## 验收与证据

### 纯逻辑与 Contract

- 等比缩放及最终尺寸换算；旋转后 AABB；笼舍越界；context 碰撞；水平叠放；恰有一个 target；context 永不成为报价目标。
- ModelRef 联合结构、snapshot schema version、Scene revision 冲突和相同 revision 的确认幂等。

### 真实数据库集成

- 自动保存后服务器重启仍能恢复；陈旧 revision 写入被拒绝；确认快照不可更新。
- A 用户持 B 的 scene/designItem/modelConfirmation/asset ID 读取、写入或确认均为 404；未登录为 401；跨 Project 资产注入被拒绝。
- migration 在目标 RDS 实际 applied，并验证 `_prisma_migrations`、相关表、唯一约束、关系和 `/api/healthz db:true`；完整业务冒烟不占 migration 槽位。

### 真实浏览器用户竖切

- 登录 → 进入明确项目 → 选择测试模型 → 单品检视 → 确认模型 → 输入笼舍尺寸 → 放置唯一 target → 加入 context → 自动保存 → 刷新恢复 → 确认场景。
- 修改已确认场景后出现“草稿已变化”提示；重新确认得到新版本，旧确认仍可读取。
- 模型加载失败可重试；保存失败可见；另一标签页制造 revision 冲突时不会静默覆盖。
- 用户全程可以区分 target、context、通用宠物参照，以及“预览/确认”和“可制造/可报价”的承诺边界。

编排约定沿用 batch-1：实现者 TDD 红→绿证据、非实现者真实浏览器录屏与关键截图、production build、三包类型检查、lint baseline、landing 零回归截图、`gh pr checks --json` 显式判定。Draft schema 的 QA 使用一次性 PostgreSQL 16，不提前修改生产 RDS；B 线收口时再做一次生产浏览器 E2E。每个阶段证据随阶段产出，不集中到最后补写；用户可见 WP 合并后关键截图直接发给用户，不等待回复、不阻塞下一包。

## 原型退役

现有 `SceneViewer.tsx` / `PetViewer.tsx` 只作为语义和行为参考。正式两阶段流程验收后，按实际吸收范围更新 `docs/governance/prototype-retirement-ledger.md`；没有行为证据前不得提前宣告原型已退役。
