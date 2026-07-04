# 批次0 Spec：交付项目基座（骨架复制 + 裁剪 + V3 移植 + 纯前端接线）

> 上游依据：`../integration-mapping.md`（判定与拍板）、`../research/frontend/AGGREGATE.md`（F 编号）、`../research/backend/AGGREGATE.md`（能力编号）。
> 执行原则：本批次是**机械移植**，不是重构。视觉与行为以原版 V3 为唯一基准，禁止任何"顺手优化"。

## 1. 任务

在 `<USER_HOME>/Desktop/PetScape-final/web` 建立交付项目：复制老后端为骨架 → 裁剪零依赖孤岛 → 设计师 V3 页面移植为新首页并机械拆分组件 → 老工作台保留为 `/workbench` 调试页 → 完成 5 处纯前端接线。

## 2. 输入与路径

- **老后端（只读源）**：`<USER_HOME>/Desktop/3D宠物打印/web`（Next.js App Router + TS + Tailwind）
- **V3 前端（只读源）**：`<USER_HOME>/Desktop/设计师前端页面`——**以 `src/` 为准**（已确证比 dist 新）：`src/main.jsx`（266 行，全部页面代码）、`src/styles.css`（2471 行）、`public/assets/`（全部素材）、`index.html`（title="TinyHabitat AI" 等 meta）
- **目标**：`<USER_HOME>/Desktop/PetScape-final/web`（目前不存在，docs/ 已存在勿动）

## 3. 步骤（每步一个 conventional commit，英文）

### Step 1 `chore: copy backend skeleton`
- 复制老 `web/` → `PetScape-final/web/`，**排除**：`node_modules/`、`.next/`、`tsconfig.tsbuildinfo`、`public/uploads/*`（目录留空壳）。
- **保留** `public/generated/`（含 9709946e 真实产物链——后续批次的 mock 素材）。
- 在 `PetScape-final/` 根 `git init` 并首 commit（.gitignore 覆盖 node_modules/.next/uploads）。

### Step 2 `refactor: prune orphan legacy chains`
删除清单（均已终判 orphan/死代码，见 mapping 1C）：
- `app/legacy/`、`app/api/session/`
- `app/lib/agents/` 整目录 + `app/api/project/[id]/agent/` 路由（V3 无 chat UI）
- `app/lib/jobs/executor.ts`、`codexQueue.ts`、`meshyJob.ts`、`sliceJob.ts`
- `app/lib/meshy/`、`app/lib/images/renderScene.ts`、`app/lib/images/cleanItem.ts`
- `app/lib/store/sessions.ts`、`app/lib/types/session.ts`
- `app/lib/jobs/timeouts.ts`：保留 `withTimeout`（gate1/gate2 在用）；`runCodexTurn` 删除 agents 后若零调用则一并删。
- 清干净所有残余 import。**验收：`npx tsc --noEmit` 通过。**
- 不删：`app/lib/printability/`（gate1Job 引用它做本地诊断；挖腔调用的去留是批次1 的事，本批次不动 gate1Job 逻辑）。

### Step 3 `feat: port V3 landing as new home page`
- 老 `app/page.tsx` → `app/workbench/page.tsx`（修 import，保持可用——它是后端能力的调试入口）。
- V3 `main.jsx` 移植为新 `app/page.tsx` + **机械拆分**到 `app/components/landing/`：按现有组件边界一文件一组件（Navbar / HeroFooter / DetailDrawer / SpeciesShowcase / PetCreatorSection / ModuleCard / ModuleCommunitySection / EnvironmentPreviewSection / IntroSection / UploadVibeSection / RenderSection / ScenePackSection / ManufacturingSection / GiftSection / OrderFlowSection / FlipCards / 共享小件 GridIcon·AssetPlaceholder·ProductRender），数据常量（species/modules/wearables/scenePacks 等数组）拆到 `app/components/landing/data.js`。
- **机械拆分定义：逐字复制 JSX/逻辑/state 结构，只允许加 import/export 和 `'use client'`，禁止重命名、禁止改样式、禁止改行为、禁止 TS 化改写（保持 .jsx 即可，tsconfig allowJs 已开或开启之）。**
- `styles.css` 整体引入。**已知风险：老项目 Tailwind preflight 会 reset 按钮/标题默认样式，V3 是在无 Tailwind 环境写的。** 处理优先级：① 把 V3 styles.css 放在 cascade 后端并自查关键控件（button/input/h1-h3/img）视觉；② 若仍冲突，给 workbench 用的 Tailwind 关闭 preflight（`corePlugins.preflight=false`）并在 workbench 页局部补偿——首页视觉保真优先于 workbench 美观。
- `public/assets/` 素材整搬；hero 视频、各商品图路径修正为 `/assets/...`。
- root layout：title/description 用 V3 index.html 的（"TinyHabitat AI"）。
- 依赖补装：`motion`、`lucide-react`（装当前 latest 并锁版本）。

### Step 4 `feat: wire orphan frontend interactions`
最小 diff 接线（编号见 frontend AGGREGATE）：
- **F48**：`App` 把 `selectedSpeciesId` 传入 `ModuleCommunitySection`；模块列表把 `species.modules` 命中的模块**排序置顶并加"推荐"徽标**（复用现有徽标样式风格；不做隐藏式筛选，不改布局结构）。
- **F12**：「创建专属宠物档案」卡片 onClick 改为平滑滚动到 PetCreatorSection（参照现有 F05 的 scrollIntoView 模式）；Navbar「菜单」按钮保持开抽屉不动。
- **F02**：logo 加 onClick 平滑回顶。
- **F22**：`petImageUrl` 为空时「生成 3D 可旋转预览」按钮置 disabled（页面已有 HUD 文案"请先上传照片"作提示，不新增弹窗）。

## 4. 完成标准

### 4A. builder 自验（每条附证据进报告）

1. `pnpm install` 成功；`npx tsc --noEmit` 0 error（贴输出尾部）。
2. `pnpm build` 成功（贴输出尾部）。
3. dev server 启动后：`curl -s localhost:3000/ | grep -c "TinyHabitat\|白底标品"` ≥1；`curl -s localhost:3000/workbench` 返回 200（贴命令与输出）。
4. `grep -rE "from.*(meshy|sessions|executor|codexQueue|renderScene|cleanItem|/agents/)" app/ --include="*.ts*" --include="*.jsx"` 零命中（贴输出）。
5. git log 呈现 Step1-4 独立 commits（贴 `git log --oneline`）。
6. 组件拆分后 `app/page.tsx` 内不再有内联业务组件定义（只有组装），`ls app/components/landing/` 贴清单。

### 4B. 验收 Story（主控/独立 verifier 用浏览器执行，builder 无需处理；自包含断言）

视觉基准：先起原版 V3（`<USER_HOME>/Desktop/设计师前端页面` `pnpm dev`）截取全页截图，再对移植版同位置逐段对比。

1. **视觉零回归**：首屏/轮播/创建器/模块区/环境预览/报价/订单条 7 段截图与原版逐段对比，无布局错位、无字体/按钮样式漂移（Tailwind preflight 污染的典型症状：button 无边框背景、h1-h3 字号坍缩、img 变 block 产生间距变化）。
2. **轮播↔创建器联动**：点击轮播第 3 张卡 → 该卡居中放大，其余卡缩小半透；创建器物种行同一物种同步激活。
3. **装扮求和**：勾选任意 2 件装扮 → 商店头部"装扮合计：¥N"等于两件单价之和；取消 1 件 → 数字实时回落。
4. **模块加入联动**：任一模块卡点"加入 3D 场景" → 按钮文案变"已加入预览"+卡片描边强调；环境预览区已选列表出现该模块名，"模块小计 ¥N"=该模块价格。
5. **体型滑块**：拖到 5 → 徽标显示"Lv.5 档案"，avatar 明显变大；拖回 1 → 反向生效。
6. **照片上传预览**：选择任意本地图片 → 上传卡内出现该图预览，舞台出现"参考照片"浮层缩略图。
7. **F48 接线**：选中"守宫" → 模块区该物种 `species.modules` 关联模块置顶且带"推荐"徽标；切换物种 → 推荐集合随之变化。
8. **F22 接线**：未上传照片时"生成 3D 可旋转预览"按钮 disabled；上传后恢复可点。
9. **F12/F02 接线**：点"创建专属宠物档案"卡 → 页面平滑滚动至创建器区块；点 logo → 回到顶部。
10. **展开/收起**：模块区点"查看更多" → 从 3 个变 13 个、摘要行文案更新为"已加载13个"；点"收起" → 回到 3 个。

## 5. 不要做

- 不动老仓库 `<USER_HOME>/Desktop/3D宠物打印`（只读）与 `<USER_HOME>/Desktop/设计师前端页面`（只读）。
- 不改任何视觉样式/文案/动效（Step 4 的徽标/禁用态除外，且必须复用现有样式语汇）。
- 不实现批次1/2/3 的任何 API 或 UI（不碰 gate1Job/gate2Job 逻辑、不建 avatar 路由、不动 vibe 区行为、不嵌 scene-lab）。
- 不升级老骨架现有依赖版本。
- 不删 `public/generated/`。

## 6. 产出形式

- 详细报告写入 `<USER_HOME>/Desktop/PetScape-final/docs/reports/batch0-builder-report.md`：每条完成标准的证据、Tailwind preflight 冲突的处理方式与自查结论、遗留风险。
- stdout ≤200 字：{结论一句话, tsc/build 是否绿, 报告路径}。
- 任一完成标准未达 → 报告顶部 `INCOMPLETE:` + 已试路径。

## 7. 模型档位

opus（多文件移植+裁剪重构档）。失败历史：无（首派）。
