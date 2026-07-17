# 批次0 独立验收报告（4B. 验收 Story 1-10）

- **验收人**：独立 verifier（全新 context，未参与实现）
- **日期**：2026-07-04
- **被验对象**：移植版 `http://localhost:3000`（Next.js dev，只读验收，未改任何代码）
- **视觉基准**：原版 V3 `http://localhost:5173`（`<USER_HOME>/Desktop/设计师前端页面` `pnpm dev`，只读）
- **工具**：Playwright 1.55 headless Chromium，视口 1440×900，DPR 1；像素 diff 用 pixelmatch（threshold 0.1，`includeAA:false` 抗锯齿不计）
- **驱动脚本**：`tools/verify-batch0/{lib.js, story1.js, run-stories.js}`；截图 `tools/verify-batch0/shots/`（下文相对路径均相对本文件）

**结果总览：9 PASS / 1 FAIL（Story 1）/ 0 BLOCKED**

| Story | 断言 | 判定 |
|---|---|---|
| 1 | 视觉零回归（7 段对比） | **FAIL**（preflight line-height 漂移，见下） |
| 2 | 轮播↔创建器联动 | PASS |
| 3 | 装扮求和 | PASS |
| 4 | 模块加入联动 | PASS |
| 5 | 体型滑块 | PASS |
| 6 | 照片上传预览 | PASS |
| 7 | F48 推荐置顶接线 | PASS |
| 8 | F22 生成按钮禁用接线 | PASS |
| 9 | F12/F02 滚动接线 | PASS |
| 10 | 展开/收起 | PASS |

## 测量方法说明（保证两侧可比）

- 轮播每 4.2s 自动轮转（`setInterval(fn, 4200)`），两侧页面均以同一 init script 吞掉该 timer，冻结在初始（花枝鼠）位；不改任何源代码。
- hero 视频两侧均暂停并 seek 到第 0 帧（同一 mp4 素材）。
- Story 1 截图前两侧均注入 `animation:none`，等待 2.6s 让 motion 入场动画收敛；按 7 个区块做元素级截图（自动对齐区块边界）。
- 已知截图杂质（不计入回归判定）：移植版左下角 Next.js dev-tools 圆形徽标（dev 模式产物）；固定 navbar 在元素截图中的相对位置随滚动偏移。

## Story 1 视觉零回归 — **FAIL**

### 逐段 diff 粗筛（>2% 进入人工细看）

| 段 | 原版尺寸 | 移植版尺寸 | diff 率 | 结论 |
|---|---|---|---|---|
| 01 首屏 | 1440×900 | 1440×900 | 0.15% | 一致 |
| 02 轮播 | 1440×1366 | 1440×1373 | 1.67% | 阈内（高度 +7px 同源于下述根因） |
| 03 创建器 | 1440×1271 | 1440×1269 | 1.69% | 阈内 |
| 04 模块区 | 1440×1204 | 1440×1214 | 2.87% | 人工细看：diff 主体 = F48 新增「推荐」徽标（Step 4 拍板变更，不计回归）+ 行高漂移竖向错位 |
| 05 环境预览 | 1440×1011 | 1440×1012 | 1.42% | 阈内 |
| 06 报价 | 1440×965 | 1440×999 | 6.63% | 人工细看：**真实样式漂移**，报价面板 478→507px（+29px） |
| 07 订单条 | 1440×810 | 1440×813 | 2.02% | 人工细看：纯竖向 2-4px 重影，同一根因，无布局错位 |

证据：`../../tools/verify-batch0/shots/s1-orig-{段名}.png` / `s1-port-{段名}.png` / `s1-diff-{段名}.png`（7 段 × 3 张，如 `s1-orig-06-quote.png`、`s1-port-06-quote.png`、`s1-diff-06-quote.png`）。

### 根因（computed style 双侧实测）

移植版全局继承 **`line-height: 24px`（1.5）**，原版为 `line-height: normal` —— 即 spec 预警的 Tailwind preflight 污染（`html{line-height:1.5}` 未被 V3 styles.css 覆盖）。V3 显式设了行高的元素（h1/h2/h3、正文 p、flow-step 等）两侧完全一致；**未显式设行高的元素被拉高**：

| 元素 | 原版 | 移植版 |
|---|---|---|
| `html` / `body` line-height | normal | **24px** |
| `.material-row strong` 高 | 19px | **23px** |
| `.material-row em` 高 | 16px | **20px** |
| `.quote-panel` 高 | 478px | **507px** |
| `.module-card` 高 | 520px | **530px** |
| 整页高度 | 12479px | **12555px**（+76px） |

次要发现（无可见影响）：`.module-body button` padding 被 preflight 重置（UA 默认 `1px 6px`→`0`，渲染盒同为 411×48）；input border 颜色值差异（0 宽不可见）。**未出现** spec 列举的灾难症状：button 无边框背景、h1-h3 字号坍缩、img 间距变化均不存在（h1/h2/h3/cta/字体族/字号双侧逐项 SAME）。

### 判定

按 spec 判据「无字体/按钮样式漂移，preflight 污染典型症状算 FAIL」：这是系统性、可测量的 preflight 行高漂移（非抗锯齿/动画帧差异），报价面板高度 +6%，**FAIL**。修复方向（builder 侧）：在 V3 styles.css cascade 末端补 `html{line-height:normal}`（或对首页作用域关闭 preflight），一行级修复；顺手可补 button padding 还原。修复后仅需复跑 `node tools/verify-batch0/story1.js` 复验。

## Story 2 轮播↔创建器联动 — **PASS**

点击轮播第 3 张卡（蛇）后：该卡 `aria-pressed=true`、透明度 1、渲染宽 410px 居中放大；其余四卡宽 353/317px、透明度 0.68/0.36 缩小半透（实测 `widths [317,353,410,353,317]`、`opacities [0.36,0.68,1,0.68,0.36]`）；创建器物种行 `.active` 按钮同步为「蛇」。
证据：`../../tools/verify-batch0/shots/s2-before-carousel.png` → `s2-after-carousel.png`、`s2-after-creator-row.png`

## Story 3 装扮求和 — **PASS**

先取消默认勾选（¥39→¥0）排除歧义；勾选「小厨师围巾 ¥29」+「名字小吊牌 ¥19」→ 头部显示「装扮合计：¥48」= 两件之和；取消吊牌 → 实时回落「¥29」。
证据：`../../tools/verify-batch0/shots/s3-before.png` → `s3-two-selected.png` → `s3-one-cancelled.png`

## Story 4 模块加入联动 — **PASS**

先清空 2 个默认预选（小计 ¥0）使「小计=该模块价格」断言无歧义；点「香蕉软垫小床」的「加入 3D 场景」→ 按钮变「已加入预览」+ 卡片 `selected` 描边；环境预览区 chips 与已选列表出现「香蕉软垫小床」，模块小计 **¥89** = 该模块单价。
证据：`../../tools/verify-batch0/shots/s4-before-preview-empty.png`、`s4-before-card.png` → `s4-after-card.png`、`s4-after-preview.png`

## Story 5 体型滑块 — **PASS**

拖到 5 → 徽标「Lv. 5 档案」，avatar 驱动缩放 1.03→**1.17**（`matrix(1.17,...)`，与原版公式 `0.82+size×0.07` 一致）；拖回 1 → 「Lv. 1 档案」，缩放 **0.89** 反向生效。截图可见大小差异明显。
证据：`../../tools/verify-batch0/shots/s5-size3-default.png` → `s5-size5.png` → `s5-size1.png`

## Story 6 照片上传预览 — **PASS**

`setInputFiles` 上传本地图（`web/public/assets/species-rat.png`）→ 上传卡内出现该图预览（img 可见）；舞台左上出现「参考照片」浮层缩略图（overlay img 可见，label 文本 =「参考照片」）。
证据：`../../tools/verify-batch0/shots/s6-before-upload.png` → `s6-after-upload.png`

## Story 7 F48 推荐置顶接线 — **PASS**

选「守宫」→ 模块区前 3 位 = 多巴胺攀爬站 / 星月魔法躲屋 / 星桥拱门躲屋，均属守宫 `species.modules` 且各带「推荐」徽标；切「鹦鹉」→ 前 3 位变为 悬挂藤篮阶梯 / 藤蔓觅食托盘 / 多巴胺攀爬站（均属鹦鹉集合，带徽标），推荐集合随物种切换。其余模块未隐藏、布局未变。
证据：`../../tools/verify-batch0/shots/s7-before-rat.png` → `s7-after-gecko.png` → `s7-after-parrot.png`

## Story 8 F22 生成按钮禁用接线 — **PASS**

未上传照片时「生成 3D 可旋转预览」`disabled=true`（HUD 显示「请先上传照片」）；上传后 `disabled=false` 且实际可点（点击后文案变「重新生成 3D 可旋转预览」）。
证据：`../../tools/verify-batch0/shots/s8-before-disabled.png` → `s8-after-enabled-clicked.png`

## Story 9 F12/F02 滚动接线 — **PASS**

点「创建专属宠物档案」卡 → 平滑滚动至创建器区块（scrollY 0→2272，`.pet-creator-section` rect.top=0.03px 即精确对齐视口顶）；点 logo（DOM click，排除 Playwright 自动滚动干扰）→ scrollY 回 0。
证据：`../../tools/verify-batch0/shots/s9-before-top.png` → `s9-after-card-scrolled.png` → `s9-after-logo-top.png`

## Story 10 展开/收起 — **PASS**

初始 3 卡（「当前展示 3 个入门配件」）→ 点「查看更多」→ 13 卡，摘要行更新为「已加载 13 个梦想配件」→ 点「收起」→ 回到 3 卡。
证据：`../../tools/verify-batch0/shots/s10-before-collapsed.png` → `s10-expanded.png` → `s10-collapsed-again.png`

## 总判

**9/10 PASS。可进入并行批次，但 Story 1 的 preflight 行高漂移需在并行期间修掉并复验。** 理由：唯一 FAIL 是全局 CSS cascade 层的一行级问题（`line-height:normal` 未覆盖 preflight），不涉及组件结构、数据流或任何交互接线，与后续批次改动面（API/avatar/vibe/scene-lab）正交，不构成集成阻塞；但它违反「视觉零回归」硬标准，且随并行批次堆 UI 会越晚越难归因，应作为并行批次开跑前/初期的首个小修，修后仅复跑 `story1.js` 即可闭环。

## 复现方式

```bash
# 前置：3000（移植版）与 5173（原版）dev server 均在运行
cd <REPOSITORY_ROOT>/tools/verify-batch0
node story1.js       # Story 1：7 段截图 + pixelmatch diff 率
node run-stories.js  # Story 2-10：交互断言 + 前后截图
```
