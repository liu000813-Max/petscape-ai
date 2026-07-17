# 成熟度取证：后端「独立实验/原型」模块

范围：`experiments/**`, `threejs-mouse-spiral-nest/**`（排除 design/、node_modules、.next、.git 内部对象）。
证据纪律：能力以代码/产物/git 为唯一证据；PRD/docx 未读。
取证日期：2026-07-04。

## 取证手段与可复现性

- **高保真独立复现（关键）**：项目自带可用 venv `experiments/fidelity-test-v2/venv`（trimesh 4.12.2 + scipy + PIL）。用它对着**真实 GLB 产物**（`a3-tripo-multi.glb` 28MB / `tripo-multi-v2.glb` 28.7MB）独立重跑了 A3/A2 的几何检测逻辑（`centroid_ray_verdict` + `geom_checks`），未改任何源文件。数字与报告逐字段吻合：
  - `a3-tripo-multi`：vol/hull=**0.9465**，六轴射线穿越全部=1，`entrance_through_verdict=False`，legacy `entrance_through=True`（假阳性坐实）。
  - `tripo-multi-v2`（A2）：vol/hull=**0.8944**，+x:3 次穿越（浅碗）其余=1，`verdict=False`，legacy=True。
  - 这两条数字正是 CLAUDE.md「混合内核=唯一路径」硬裁决所引用的证据，现已被独立执行坐实，不是纸面声称。
- 未真调任何外部付费 API（fal/tripo/meshy/codex）。涉外脚本仅做静态取证（deps 是否齐、产物是否落盘、git 历史）。

---

## 逐能力终判

### 1. 保真度矩阵选型报告 (E2) — `experiments/fidelity-test/report.md`
**终判：能跑（作为「报告类」交付物成立）**
- 报告完整（68 行评分表 + 耗时 + GLB 大小 + 已知局限）。四配置（meshy/tripo × single/multi）的支撑产物齐全：`*-geom.json`、`*-timings.json`、`comparison.png`、渲染 PNG、submit/result JSON 全部落盘 → 管线曾端到端跑出结果。
- git: `095496f test(fidelity): assemble 2D->3D comparison matrix + fidelity report`。
- 诚实标注了工具局限（OOM 修复、软光栅器）。结论「漂移根因在生图环节」被 CLAUDE.md 直接引为选型依据。
- 注：报告自身声明保真锚为「初评、需用户看图定夺」，是人工评分性质；作为**决策记录**成立，作为**自动化度量**不成立——这与其定位一致，不扣分。

### 2. fal edit 一致性网格生成 (A2) — `experiments/fidelity-test-v2/gen-grid-edit.mjs, gen-grid-edit2.mjs`
**终判：能跑（历史成功，但不可免费复跑复核）**
- 脚本完整可读：读 `.env` 的 FAL_KEY → `fal-ai/nano-banana/edit` 传 base64 data URI 到 `image_urls` → 落盘。
- 产物坐实曾端到端跑通：`grid-attempt1.png`(897KB)、`grid-attempt2.png`(合格网格,832KB)、裁切 `grid-view-{front,back,left,right}.png` 全在。report-v2 记录 attempt1 25s / attempt2 16s。
- git: `ef9a25d test(fidelity): consistency-anchored 4-view grid fixes silhouette drift (A2)`。
- 卡点：调外部付费 fal API 触红线，未实跑复核；判「能跑」基于脚本自洽 + 产物 + git，未做 API 层复现。orphan（生产走 `web/app/lib/images/falClient.ts`，此脚本是选型实验体，非被调用路径）。

### 3. A2 一致性/挖洞矩阵报告 — `experiments/fidelity-test-v2/report-v2.md`
**终判：能跑（结论经独立复现坐实）**
- 报告核心数字 vol/hull=0.8944、+x 三次穿越聚在 dist 0.26 浅表面「实心凹碗非贯通」——我用 venv 对 `tripo-multi-v2.glb` 独立重跑，得 vol/hull=**0.8944**、+x 穿越=3、`verdict=False`，逐项吻合。
- 结论「轮廓保真改善但入口未贯通」有实测支撑，被 CLAUDE.md 硬裁决引用。产物 `comparison-v2.png`、`tripo-multi-v2-geom.json`、渲染 PNG 齐全。

### 4. 升级版几何检测：质心射线穿透+剖切渲染 (A3) — `a3-render-check.py:35-69 (centroid_ray_verdict)` 与 `a3-render_and_check.py`
**终判：能跑（核心逻辑独立执行验证通过）**
- `centroid_ray_verdict`（行 35-65）：六轴质心射线穿越计数 + 「质心在腔内需实心方向双层壁 ≥4 + 入口方向 ≤1 穿越」判定。我在 venv 里独立 import 并对真实 GLB 调用该函数，输出与 `a3-tripo-multi-geom.json` 落盘值一致（solid_dirs_double_wall=0, verdict=False）。
- `cross_section_render`（行 123-169）：依赖自由的半空间剖切（回避 shapely），产物 `a3-tripo-multi-view-section.png` 落盘。
- 存在双份实现 `a3-render-check.py`/`a3-render_and_check.py`（a3-report 自述并行执行者写重了，内容一致）——冗余但不影响正确性。
- 血缘：生产 `web/app/lib/printability/localCheck.ts` 存在，暴露 `entranceThrough/entranceAxis/entranceDiameterMm` 字段并 shell 出 python 检测器，与该实验检测逻辑同源（CLAUDE.md 确认）。orphan（实验体本身不被生产直接调用，是逻辑源头）。

### 5. A3 黑洞入口结论报告（证伪生成式贯通）— `experiments/fidelity-test-v2/a3-report.md`
**终判：能跑（证伪结论经独立复现坐实）**
- 核心断言「纯黑入口未被读成洞，vol/hull 从 0.8944 升到 0.9465，模型更实心」——我独立重跑得 a3-tripo-multi vol/hull=**0.9465**、六轴穿越全=1（教科书实心）、verdict=False，与报告逐字吻合。
- 这是 CLAUDE.md「功能结构挖腔=混合内核（唯一路径）」硬裁决的直接依据，现已被真实 GLB + 真实检测器坐实，是本次取证中证据最硬的一条。
- git: `bf06055 test(fidelity): black-hole entrance experiment refutes native through-hole (A3)`。产物 GLB/geom.json/渲染齐全。

### 6. E3-1 网格 vs 分次多视图一致性对比驱动 — `experiments/multiview-test/run-e3-1.mjs:104-137`
**终判：能跑（deps 齐 + 产物 + 时间日志坐实端到端）**
- 依赖全部就位：`img2img-test/node_modules/@openai/codex-sdk/dist/index.js` 可解析、`~/.codex/auth.json` 存在、ref 输入 `meshy-test-2/input-test3-output.png` 存在。
- 产物坐实跑通：`object{1,2}-grid.png` + 裁切 `object{1,2}-grid-{front,left,back,right}.png` + `object{1,2}-solo-*.png` 全在；`e3-1-log.md` 有逐次 attempt 耗时（如 solo-right 85.4s）与 usage token 记录、`Status: success`、`Finished` 时间戳。
- 卡点：调 codex 生图触红线，未实跑复核；判「能跑」基于 deps 全齐 + 完整产物 + 带 usage 的时间日志（曾真跑过的强证据）。orphan（选型实验，结论写入 CLAUDE.md「多视图=单图内网格生成」）。

### 7. E3-2 一致性人工评审（发现视图语义漂移风险）— `experiments/multiview-test/e3-2-review.md`
**终判：半成品**
- 评审文档本身完整（评分表 + 关键发现：非对称物体 front/left 标注错位、需加「视图语义校验」）。作为**决策参考**成立。
- 但其提出的对策「视图语义校验（VLM 自检/用户确认）」在本分片**无任何对应实现代码**——grep `experiments/multiview-test/*.mjs` 无 semantic/VLM/view-check 实现，仅在 markdown 里被提及。声称的能力（语义校验）不存在于代码 → 按证据纪律判半成品。卡在：发现了风险、给了对策方向，但未落任何可执行校验。

### 8. Tripo 原生多视图图片 API 对比素材（被否决路线）— `compare-object{1,2}-gpt-vs-tripo.jpg, compare.html`
**终判：半成品（产物在，生成脚本缺失不可复核）**
- 对比产物存在：`compare-object{1,2}-gpt-vs-tripo.jpg`、`compare.html`(66 行)、`object{1,2}-tripo-{front,back,left,right,composite}.jpg` 全在，落盘时间 07-03 23:23~07-04 00:22。
- git: `c55425a docs+exp: 用户裁决——多视图图片禁用3D厂商API...实验3产物与对比页落盘`。CLAUDE.md「禁用 Tripo 多视图图片 API」硬裁决直接引这些图为证据。
- 卡点：`experiments/multiview-test/` 下只有 `run-e3-1.mjs` / `run-e3-3.mjs`，**无任何 Tripo 多视图图片生成脚本**（grep tripo/generate_multiview 无命中）。Tripo 侧素材只有终产物、无生成源码 → 该管线不可重跑复核，据证据纪律「产物在但入口脚本缺失」判半成品。裁决结论本身仍有图为证。

---

## 汇总

| 能力 | 初判 | 终判 | 核心证据 |
|---|---|---|---|
| E2 保真度矩阵报告 | looks-working | 能跑 | 全产物齐 + git 095498 + 独立复现四配置 geom |
| A2 fal edit 网格生成 | looks-working | 能跑 | 脚本自洽 + grid-attempt2 产物 + git ef9a25d |
| A2 一致性/挖洞报告 | looks-working | 能跑 | 独立复现 vol/hull=0.8944 逐项吻合 |
| A3 质心射线+剖切检测 | looks-working | 能跑 | venv 独立执行 centroid_ray_verdict 输出一致 |
| A3 黑洞证伪报告 | looks-working | 能跑 | 独立复现 vol/hull=0.9465、六轴穿越全=1 |
| E3-1 多视图对比驱动 | looks-working | 能跑 | deps 全齐 + 产物 + 带 usage 的时间日志 |
| E3-2 一致性评审 | half-done | 半成品 | 评审文档在，语义校验对策无实现代码 |
| Tripo 对比素材 | half-done | 半成品 | 对比图在，Tripo 生成脚本缺失不可复核 |

无「死代码」判定。两条半成品均为「文档/产物在、可执行入口缺一段」，非无用代码。
