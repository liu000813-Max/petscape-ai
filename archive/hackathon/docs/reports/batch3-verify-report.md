# 批次3 独立验收报告（5B Story 1–5）

- Verifier：独立 agent（不了解实现过程），2026-07-04
- 环境：worktree `.claude/worktrees/agent-a57af23c3c445901b`，`PORT=3013 pnpm dev`（Next 16 dev），Playwright headless Chromium 1187（playwright-core 1.55）
- 断言方法：DOM/金额走 Playwright 定位器精确读数；three.js 场景内部（GLB/billboard 对象数、位置、四元数、宠物位）走 `__THREE_DEVTOOLS__` hook 包裹 `renderer.render` 捕获 scene/camera，逐帧读 scene graph——不改任何 app 代码
- 截图：`tools/verify-batch3/shots/`（20 张，文件名前缀 = Story 号）
- 原始判定数据：verifier scratchpad `pw/results.json`（本报告数字均取自页面实测值）

## 结论：PASS 4/5

| Story | 结果 | 一句话 |
|---|---|---|
| 1 画布混合渲染 | PASS | 2 GLB + 1 billboard 同场；拖拽旋转后 billboard 四元数与相机 \|dot\|=1.000000（始终面向相机），GLB 不动；移出后对象消失、chips 3→2、小计 ¥207→¥148 |
| 2 场景包假闭环 | PASS | N₀=¥0 → 森林奶酪屋 ¥296（=N₀+子集单价和，精确）→ 雨林树屋叠加 ¥542，前者不清空，两卡均变"已加入"（disabled），画布 4→8 对象 |
| 3 订单条推导 | PASS | 6 帧截图序列，每步单独点亮且顺序正确；3D打印/发货全程未达态 |
| 4 F46 报价明细 | PASS | 2 模块：逐行 89+59、材料单价行 `PETG ¥0.42 / g`、合计 ¥148=小计；+1 模块重点击 → 3 行、合计 ¥187 |
| 5 宠物位 | **FAIL** | 模型确实加载并置于场景中心 (0,0,0)、无未捕获异常——但**米制模型进毫米制场景，实际约 2mm 高，画布上肉眼不可见**，"画布中央出现宠物模型"这条用户可见断言不成立 |

## 各 Story 证据

### Story 1 — 画布混合渲染（PASS）

默认已选 2 个 GLB 模块（奶酪软垫小床/悬挂藤篮阶梯），加入 billboard 模块星桥拱门躲屋（¥59）：

- 场景实测：2 个 GLB Group（`userData.isBillboard=false`）+ 1 个 billboard Mesh（`=true`）— `s1-1-mixed-before-drag.png`（画布同时可见奶酪 3D 网格与星桥白底图立牌）
- 拖拽旋转（鼠标 240px 拖移）：相机位置改变；billboard 四元数与相机四元数 |dot|=1.000000（面向相机）、billboard 随视角转动、GLB 四元数不变（|dot|>0.9999）— `s1-2-mixed-after-drag.png`（视角已转，立牌仍正对屏幕）
- 移出星桥拱门躲屋：billboard 对象从 scene 消失（0 个），chips 3→2（不含"星桥拱门躲屋"），小计 ¥207→¥148（精确 -¥59）— `s1-3-after-remove.png`

### Story 2 — 场景包假闭环（PASS，精确金额）

为让"N₀+子集单价之和"可精确断言，先移出 2 个默认模块（N₀=¥0，无重叠；注：`addModules` 为 Set 去重合并，若 N₀ 与包有重叠则按并集计价，属 spec 设计内行为）：

- 点"森林奶酪屋·加入预览"：chips 新增其全部 4 模块（奶酪软垫小床/香蕉软垫小床/悬挂藤篮阶梯/奶酪洞洞层板），小计 ¥0+89+89+59+59=**¥296**（页面实测=¥296 ✓），按钮变"已加入"且 disabled，画布模块对象 4 个 — `s2-3-forest-added.png`
- 再点"雨林树屋"：chips 累计 8 个（前者全保留），小计 296+59+59+89+39=**¥542**（实测=¥542 ✓），两卡均"已加入"，画布 8 个对象（5 GLB + 3 billboard）— `s2-4-both-added-buttons.png`、`s2-5-both-added-canvas.png`

### Story 3 — 订单条推导（PASS，6 帧 ≥4）

`?mock=1`。先清空默认装扮/模块使初始无点亮。为消除"mock 切片自动完成抢跑中间帧"的竞态，用 Playwright route hold 住 POST `/avatar` 请求，逐帧截图后放行：

| 帧 | 操作 | 点亮（页面实测，黑底 active 样式） |
|---|---|---|
| f1 | 初始（清空后） | 无 |
| f2 | 上传宠物照 | 选择宠物 |
| f3 | 点生成 3D（mock） | 创建形象 |
| f4 | 勾 1 件装扮 | 添加装扮 |
| f5 | 加 1 个模块 | 添加模块 |
| f6 | mock 切片完成 | 确认模型 |

每帧有且仅有 1 步点亮；"3D 打印/发货"6 帧全部未达态。截图 `s3-f1` ~ `s3-f6`。

### Story 4 — F46 报价明细（PASS）

- 已选 2 模块点"生成场景报价"：明细卡逐模块（奶酪软垫小床 ¥89 / 悬挂藤篮阶梯 ¥59）+ 材料单价行 `PETG ¥0.42 / g` + 合计 ¥148 = 小计 ✓，逐行和=合计 ✓ — `s4-1-quote-2-modules.png`
- 加藤蔓觅食托盘（¥39）后：明细卡保持 ¥148（点击才刷新语义），重点击 → 3 行、合计 ¥187 = 新小计 ✓ — `s4-2-quote-3-modules.png`

### Story 5 — 宠物位（FAIL）

`?mock=1`：

- 无 avatar 时：场景中心 0 个宠物对象（留空 ✓），未捕获异常 0（`pageerror` 事件全程监听）✓ — `s5-1-no-avatar-center-empty.png`
- mock 生成 avatar 后：scene graph 出现 1 个 Group @ (0,0,0)（模型确实加载、位置正确），未捕获异常仍 0
- **但**：宠物模型 world bbox 实测 **1.91 × 0.86 × 1.90（glTF 米制单位）**，而场景是毫米制（模块 ~200mm、地台 1600mm）→ 宠物在画布上约 2mm 高、亚像素级，**肉眼不可见** — `s5-2-avatar-in-center.png`（中央目视为空）
- 诊断证明：页内临时将该对象 `scale×100` 后模型清晰出现在中央 — `s5-3b-pet-scaled-100x-diagnostic.png`（对照 `s5-3a-pet-actual-scale.png`）。即加载/接线正确，缺的是单位归一/缩放

**根因**：`app/components/SceneViewer.tsx` 宠物位分支（~L241-256）对 `petAvatarUrl` 直接 `loader.load` 后原样 `scene.add`，不做任何尺寸归一；模块 GLB 走的是预归一化的 `.norm.glb` 所以没这问题。mock 模型（`public/mockup-assets/mock-model.glb`）是米制；批次1 真实 Meshy 产物同样是米制量级（PetViewer 单独取景所以显示正常），**换真资产后该缺陷依旧**。建议修复：加载后按 bbox 归一到目标高度（如按 petSize 档位的 mm 高度），再由主控重派。

## 环境发现（非本批次代码缺陷，但影响验收可复现性）

`web/.gitignore` 忽略了 `public/mockup-assets/mock-model.{glb,stl,gcode}`，fresh worktree/checkout 缺这 3 个文件 → `?mock=1` 的 avatar 管线在服务端 `copyfile` ENOENT 直接 FAILED（Story 3/5 首轮因此挂掉）。本次验收从主 repo 手动补齐后复跑通过。建议：mock 资产入库或加启动自检，否则 CI/新环境的 mock 链路必挂。

另：console 有 1 条 React 警告（`Cannot update a component (App) while rendering (SpeciesShowcase)`，setState-in-render），属批次3 所有权之外的既有问题，非未捕获异常，不计入 Story 5 判定，记录备查。

## Receipts

独立 verifier 单 agent 执行：读 spec §3/§4/5B → pnpm install + dev:3013 → Playwright（chromium-1187）跑 5 Story 脚本（首轮 3/5，定位 mock 资产缺失为环境缺口，补资产后 Story 3/5 复跑）→ Story 5 场景级探针 + 100x 缩放诊断定位米/毫米单位缺陷 → 本报告。截图 20 张见 `tools/verify-batch3/shots/`。
