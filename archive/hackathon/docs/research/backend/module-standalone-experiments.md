# 独立实验/原型模块盘点 — standalone-experiments

覆盖路径：`experiments/**`、`threejs-mouse-spiral-nest/**`（均相对 `<USER_HOME>/Desktop/3D宠物打印`）。
排除：`design/` 整目录、`node_modules`、`.next`、`.git` 内部对象、`__pycache__`、`venv`。
证据方式：直接读代码 + 项目根 `.env` key 是否非空 + 全项目 grep 调用点 + `git log --oneline -- <path>`（design/ 路径改动已排除）。**不读 PRD.md / max PRD.docx**，能力判定只以代码为准。

## 总体判定（先说结论）

这一分片是**历史决策证据仓**，不是待重构的生产代码。8 个子目录里 7 个是一次性/两次性运行的裸脚本（无测试、无 CI、部分文件是同一逻辑的重复实现），1 个（`threejs-mouse-spiral-nest`）是有 Playwright 视觉回归验证的独立三.js 原型。**全项目 grep 确认零 import 耦合**：`web/` 内仅 3 处以注释形式提到 `experiments/xxx.py 的逻辑`（"参考"/"移植自"），没有一处 `import`/`require`/动态 spawn 路径指向本分片。

外部依赖 key 状态（读 `<USER_HOME>/Desktop/3D宠物打印/.env`，只报长度不报明文）：

| Key | 是否存在于 .env | 长度 | 用途 |
|---|---|---|---|
| `TRIPO_API_KEY` | 是 | 47 | fidelity-test / fidelity-test-v2 / tripo-asset-demo 素材来源 |
| `MESHY_API_KEY` | 是 | 40 | fidelity-test / meshy-test / meshy-test-2 |
| `FAL_KEY` | 是 | 69 | fidelity-test 的 gen-inputs.mjs（nano-banana 生图/edit） |

`img2img-test` 的 OpenAI/Codex 凭证不读项目 `.env`，走 `~/.codex/auth.json`（ChatGPT 订阅 OAuth，见 `test-log.md` 末尾说明），不在上表覆盖范围内，也没有单独的 `.env` 文件可查。

---

## 1. `experiments/fidelity-test/` — E2：Meshy×Tripo × 单图/四视图 保真度矩阵（第一轮）

四配置交叉对比（meshy-single / meshy-multi / tripo-single / tripo-multi），用同一奶酪洞穴窝输入，跑通两家 3D 引擎 × 两种输入策略，产出评分表 + 对比长图。

| 能力 | 入口 | 输入→输出 | 外部依赖 | 被谁调用 | 成熟度 | 核心管线 |
|---|---|---|---|---|---|---|
| fal 生成单图+四视图网格输入素材 | `experiments/fidelity-test/gen-inputs.mjs:59-71`（IIFE 主流程） | 文字 prompt → `input-single.png` + `input-grid.png`（fal nano-banana `/fal.run/fal-ai/nano-banana`） | fal.ai，读 `FAL_KEY`（脚本内硬编码 worktree 快照路径读取，见第13行，已随 worktree 合并失效，需改回项目根 `.env` 相对路径才可重跑） | orphan（仅本实验内被后续脚本消费产物文件，无代码 import） | looks-working（已跑出产物文件） | 否，是选型实验 |
| 四视图网格像素裁切 | `experiments/fidelity-test/crop_grid.py:1-29` | `input-grid.png`（1024×1024 2×2）→ `grid-view-{front,back,left,right}.png`（裁边+去label） | 无 | orphan | looks-working | 否 |
| Tripo 单图/多视图建模 | `experiments/fidelity-test/run-tripo.mjs:67-107`（`mode='single'\|'multi'`） | `input-single.png` 或 4 张裁切视图 → `tripo-{single,multi}.glb` | Tripo API，读 `.env` 的 `TRIPO_API_KEY`（`run-tripo.mjs:17-19`，走相对路径 `path.join(OUT_DIR,'..','..','.env')`，比 gen-inputs.mjs 更稳健） | orphan | looks-working | 否 |
| Tripo 任务断线续询 | `experiments/fidelity-test/resume-tripo.mjs:1-43` | `<slug> <task_id>` CLI 参数 → 续询已提交任务直到成功/超时并下载 GLB，**不重新提交**（避免重复计费，见文件头注释第2行） | 同上 TRIPO_API_KEY | orphan（CLI 手动调用，用于修复 `report.md` 记录的一次轮询中断） | looks-working（`report.md` 记载确实用它救回过一次中断） | 否 |
| Meshy 单图/多视图建模 | `experiments/fidelity-test/run-meshy.mjs:66-101`（`mode='single'\|'multi'`） | 同上输入 → `meshy-{single,multi}.glb` | Meshy API，读 `MESHY_API_KEY`（`run-meshy.mjs:12-16`） | orphan | looks-working | 否 |
| 软光栅渲染 + 功能性几何检测 | `experiments/fidelity-test/render_and_check.py:221-287`（`process()`/`__main__`） | 4 个 GLB → 每个产出 3 视角+洞口特写 PNG + `geom-checks.json`（watertight/连通分量/洞口贯通/空腔探测等指标） | 无外部服务，纯本地 numpy/trimesh/PIL；依赖 `fast_simplification`（可选，缺失时降级不简化） | orphan（仅 `assemble_comparison.py` 依赖其产出文件，非 import） | looks-working，但**已知缺陷记录在案**：`report.md` §已知局限明确指出原版 `mesh.split(only_watertight=False)` 在 5565 碎片网格上 OOM-kill（EXIT=137），已修复为 `scipy.sparse.csgraph.connected_components`（`render_and_check.py:108-114` 注释直接写明修复原因和验证方式） | 否，但其"质心射线穿透+空腔判定"逻辑思路后来影响了 A3 的检测器升级 |
| 拼装对比长图 | `experiments/fidelity-test/assemble_comparison.py:1-79` | 4 配置 × 5 行渲染图 → `comparison.png` | 无 | orphan | looks-working | 否 |
| 保真度评分报告 | `experiments/fidelity-test/report.md` | 人工评分表 + 结论 | — | 供 `CLAUDE.md` 硬裁决引用（"选型依据 = 保真度矩阵"） | 完成态文档，非代码 | 是（决策证据，非运行时能力） |

**关键发现（half-done/已知局限证据）**：`report.md` 明确写"没有一个配置可以直接进入生产主链"——四配置全部 `watertight=false`；`tripo-single` 的 `entrance_through=true` 被同一报告标注为假阳性（"洞口贯通"判定第一次坐实误报，后续 A2/A3 报告延续验证该指标不可信）。

---

## 2. `experiments/fidelity-test-v2/` — A2/A3：一致性四视图 + 挖洞可行性验证（第二轮）

两个子实验共享目录：A2（`report-v2.md`，无前缀文件）验证"fal edit 一致性网格 → Tripo multiview"能否修复第一轮的轮廓漂移；A3（`a3-*` 前缀文件，`a3-report.md`）验证"网格入口画纯黑能否让 Tripo 原生重建出贯通洞"。

| 能力 | 入口 | 输入→输出 | 外部依赖 | 被谁调用 | 成熟度 | 核心管线 |
|---|---|---|---|---|---|---|
| fal edit 一致性网格生成（A2） | `experiments/fidelity-test-v2/gen-grid-edit.mjs`（104行）、`gen-grid-edit2.mjs`（34行，attempt2 修正版） | 参考图 + prompt → 四视图一致性网格 `grid-attempt{1,2}.png` | fal.ai，`FAL_KEY` | orphan | looks-working（第2次尝试即合格，report-v2.md 有详细自查记录） | 否，但**验证结论被写入 CLAUDE.md 硬裁决**："一致性锚点=fal edit 通道喂白底件为参考" |
| 四视图裁切（A2） | `experiments/fidelity-test-v2/crop_grid.py` | `grid-attempt2.png` → 4 张裁切视图 | 无 | orphan | looks-working | 否 |
| Tripo multiview 建模（A2） | `experiments/fidelity-test-v2/run-tripo.mjs` | 4 视图 → `tripo-multi-v2.glb` | TRIPO_API_KEY | orphan | looks-working | 否 |
| 断线续询（A2） | `experiments/fidelity-test-v2/resume-tripo.mjs` | 同 fidelity-test 版本 | TRIPO_API_KEY | orphan | looks-working | 否 |
| 渲染+几何检测（A2） | `experiments/fidelity-test-v2/render_and_check.py` | GLB → 渲染图 + geom json | 无 | orphan | looks-working，但 `report-v2.md` 明确指出该版本的 `entrance_through`/`hollow_signature` 双双假阳性（89% 实心却报"贯通/空心"），催生了 A3 的检测器升级 | 否 |
| 纯黑入口网格生成（A3） | `experiments/fidelity-test-v2/a3-gen-grid-blackhole.mjs`（48行） | `grid-attempt2.png` → FRONT 格入口涂纯黑的 `a3-grid-blackhole-attempt1.png` | fal.ai edit，`FAL_KEY` | orphan | looks-working（1次调用即合格，见 a3-report.md §网格一致性自查） | 否 |
| A3 四视图裁切（重复实现×2） | `experiments/fidelity-test-v2/a3-crop-grid.py`（852字节）**与** `a3-crop_grid.py`（1042字节，多一个 `sys.argv` 可选输入参数） | 同一份 `a3-grid-blackhole-attempt1.png` → 4 张裁切视图 | 无 | orphan（两份都不被其他脚本 import，各自独立可执行） | looks-working，但**两份并行实现是并发执行事故的直接产物**——`a3-report.md` 执行备注明确记录"出现了两个并行执行者写同一目录"，产物内容一致，非功能分裂 | 否 |
| Tripo multiview 建模（A3） | `experiments/fidelity-test-v2/a3-run-tripo.mjs` | 纯黑入口 4 视图 → `a3-tripo-multi.glb`（28.1MB，975774 面） | TRIPO_API_KEY | orphan | looks-working | 否 |
| 升级版几何检测：质心射线穿透判定 + 剖切渲染（A3，重复实现×2） | `experiments/fidelity-test-v2/a3-render-check.py:35-69`（`centroid_ray_verdict()`，211行，**通过 `importlib` 动态加载复用同目录 `render_and_check.py` 的基础渲染逻辑**，见文件第25-33行） **与** `a3-render_and_check.py`（342行，独立完整实现，不复用外部模块） | GLB → `centroid_ray_verdict` 判定（质心在腔内+双层壁穿越 vs 单层实心）+ 剖切渲染图 `a3-tripo-multi-view-section.png` | 无 | orphan（两份互不调用，各自完整可运行；`a3-report.md` 结论数字经作者用工具独立复核，两份结果一致） | looks-working。这是本分片**唯一被"下一步建议"直接采纳的技术产物**——`a3-report.md` 建议"把质心射线穿透计数+背面着色剖切渲染固化进检测流程，替换已三次误报的 `entrance_through`"，而 `CLAUDE.md` 记载的生产管线 `web/app/lib/printability/localCheck.ts` 确实改用"vol/hull 比 + 质心射线单穿判定"（Learned Constraints 一节原文），逻辑血缘直接对应 | 否（实验代码本身不被生产调用），但**结论被移植进生产** |
| A3 对比长图（重复实现×2） | `a3-comparison-main.png` 生成脚本与 `a3-comparison.png`（并行副本），均由裁切/渲染产物拼装而成 | — | 无 | orphan | looks-working | 否 |
| A2/A3 结论报告 | `experiments/fidelity-test-v2/report-v2.md`、`a3-report.md` | 人工分析报告 | — | 被 `CLAUDE.md`"功能结构挖腔=混合内核（唯一路径）"硬裁决直接引用为证据（"A3 实验证伪生成式原生贯通"原文） | 完成态文档 | 是（决策证据） |

**关键发现（重复实现，非功能性 half-done）**：`a3-crop-grid.py`/`a3-crop_grid.py` 与 `a3-render-check.py`/`a3-render_and_check.py` 两对文件均为同一逻辑的独立实现，报告作者已在 `a3-report.md` 执行备注中说明这是"两个并行执行者写同一目录"的并发事故，非设计上的双路径，且已核实产物一致、成本护栏（fal ≤2 次、Tripo ≤1 次提交）未被打破。**不构成"假阳性检测"或"死代码分支"意义上的 half-done**，只是待清理的技术债（保留两份不影响正确性，纯冗余）。

**A3 核心结论（写入 CLAUDE.md 的决策依据）**：纯黑入口未被 Tripo 读成洞，反而被读成平面深色贴花，`vol/hull` 从 A2 的 0.8944 升到 0.9465（更实心）。据此排除"生成式原生贯通"路线，转向确定性布尔挖腔（`scripts/carve_shell.py`，在生产 `geometry-native` 分片）。

---

## 3. `experiments/img2img-test/` — 图生图（订阅通道）保真度路径验证

验证"输入场景图 → 提取单个物品 → 纯白底产品图"在 ChatGPT 订阅 OAuth 通道（无 API key）下的可行路径，横向对比 5 条技术路径。

| 能力 | 入口 | 输入→输出 | 外部依赖 | 被谁调用 | 成熟度 | 核心管线 |
|---|---|---|---|---|---|---|
| 路径1：`/responses` + `image_generation` 工具 | `experiments/img2img-test/test1-responses-with-image.mjs`（67行） | 场景图 base64 + 详细描述 prompt → 白底产品图 | OpenAI，凭证走 `~/.codex/auth.json`（ChatGPT 订阅 OAuth，非项目 `.env`） | orphan | looks-working（`test-log.md` 记为✅可行，29.7s，保真度优秀） | 否（该实验路径未被生产采纳——生产用 fal nano-banana，见 CLAUDE.md） |
| 路径1b：极简 prompt 对照 | `experiments/img2img-test/test1b-minimal-prompt.mjs`（67行） | 同上但不含颜色描述 | 同上 | orphan | looks-working但保真度打折（颜色渐变丢失，纯色替代） | 否 |
| 路径2：`/images/edits` 与 JSON `image` 字段两种试探 | `experiments/img2img-test/test2-images-edits.mjs`（71行） | multipart 编辑请求 / JSON body 塞图 → 均失败 | 同上 | orphan | **dead-code 性质的失败探索**：2a 返回 HTTP 400 `Unsupported content type`（订阅通道不支持该端点）；2b 图片字段被静默忽略、退化为纯文生图（`test-log.md` 明确记录"❌ 不存在"/"❌ 图片被静默忽略"） | 否，此路径已被证伪，仅作记录 |
| 路径3：Codex SDK + `local_image` + `$imagegen` | `experiments/img2img-test/test3-codex-sdk-local-image.mjs`（26行） | 本地图片路径 + prompt → 白底产品图，agent 自主验证并保存 | `@openai/codex-sdk`，凭证 `~/.codex/auth.json` | **被 `experiments/meshy-test-2` 的输入引用**（`meshy-test-2/test-log.md:11-14` 明确写"选用 `experiments/img2img-test/test3-output.png`"），跨实验目录的文件级复用，非代码 import | looks-working，`test-log.md` 评为 5 条路径中保真度最佳，但耗时 103.8s（约路径1的3.5倍） | 否（生产未采用 Codex SDK 图生图路径，改用 fal nano-banana/edit，见 CLAUDE.md 外部服务小节） |
| 图生图路径对比结论 | `experiments/img2img-test/test-log.md` | 人工评测表 | — | 供内部选型参考 | 完成态文档 | 是（决策证据，不含在生产选型内——最终生产选了 fal 而非本实验的任何 OpenAI 路径） |

---

## 4. `experiments/meshy-test/` — Meshy 首测：裁剪图直转 + printability 检测/修复 + 切片验证

只有一份 `test-log.md`，**无可执行脚本文件**（`.mjs`/`.py` 均已产出后清理或本就是手工 curl/CLI 调用未落脚本），是纯文档化实验记录。

| 能力 | 入口 | 输入→输出 | 外部依赖 | 被谁调用 | 成熟度 | 核心管线 |
|---|---|---|---|---|---|---|
| Meshy image-to-3D 硬裁图直转 | `experiments/meshy-test/test-log.md` 测试1 一节（`POST /openapi/v1/image-to-3d`） | 含杂物的硬裁图 → GLB（51934顶点/103940面，watertight=False） | Meshy API，`MESHY_API_KEY` | 无代码入口，orphan（纯记录） | 完成态记录，非可运行代码 | 否，但**结论证成生产需求**："带杂物裁剪图会被整体建模"直接证实需要模块3（干净单物品图） |
| Meshy printability analyze/repair | `test-log.md` 测试3 一节（`POST /openapi/v1/print/analyze`、`POST /openapi/v1/print/repair`） | task_id → 检测报告（0积分）/ 修复后GLB（10积分） | Meshy API | 无代码入口，orphan | 完成态记录 | 否，但**该结论后来被 CLAUDE.md 明确推翻其生产适用性**："Meshy 的 analyze/print API 不吃外部模型，故可打印性检查=本地 trimesh 替代，不走 Meshy"——即该 API 只对 Meshy 自己生成的 task_id 有效，无法喂 Tripo 产出的 GLB，故未被生产管线采纳 |
| PrusaSlicer CLI 切片验证 | `test-log.md` 测试4 一节 | STL + 参数 → G-code + 稳定性警告 | 本地 PrusaSlicer 2.9.6 CLI（非云端API，非本文档"注册获取key"范畴） | 无代码入口，orphan | 完成态记录，MVP 链路终点首次打通 | 否（记录性验证，具体切片器封装应在 `web/scripts` 或 job-pipeline 分片，不在本片） |

**成熟度说明**：这是本分片里**唯一有 API key 消耗账本**的实验（"消耗累计：1100→1060 积分"），说明确有真实调用而非纸面推测，但因无脚本文件留存，无法重跑复核，只能以文档为证据。

---

## 5. `experiments/meshy-test-2/` — Meshy 二测：白底干净图输入对照

| 能力 | 入口 | 输入→输出 | 外部依赖 | 被谁调用 | 成熟度 | 核心管线 |
|---|---|---|---|---|---|---|
| Meshy image-to-3D（M0，干净图） | `experiments/meshy-test-2/run-meshy-m0.mjs` | `img2img-test/test3-output.png`（跨目录复用，见上）→ `mushroom-house-clean.glb`（56846顶点/96653面） | Meshy API，`MESHY_API_KEY` | orphan | looks-working，`test-log.md` 记录任务成功（178s，30 credits） | 否 |
| trimesh 独立复核 | `experiments/meshy-test-2/check_trimesh.py` | GLB（原始+repair后）→ `trimesh-check.json`（watertight/connected_components等对比表） | 无外部服务，纯本地 trimesh | orphan | looks-working | 否 |
| M0 判定报告 | `experiments/meshy-test-2/test-log.md` | 与首测对比表 | — | 供选型参考 | 完成态文档 | 是（决策证据："干净图直接可用"、"PRD Q4 可关闭"结论），但**最终主链选了 Tripo 而非 Meshy**（CLAUDE.md："3D主链引擎=Tripo multiview_to_model，已落地"，"Meshy 降为备选"），本实验的正面结论未改变最终选型结果 |

---

## 6. `experiments/multiview-test/` — E3：多视图一致性生成策略对比（网格 vs 分次 vs Tripo原生）

规模最大的实验目录，横向对比三种多视图图片生成来源：①单次生图内出 2×2 网格（同图内一致性）②分 4 次独立生成 ③Tripo 厂商自带的 `generate_multiview_image` API。结论直接决定 CLAUDE.md 的"禁用 Tripo 等 3D 厂商的多视图图片 API"硬裁决。

| 能力 | 入口 | 输入→输出 | 外部依赖 | 被谁调用 | 成熟度 | 核心管线 |
|---|---|---|---|---|---|---|
| E3-1：网格 vs 分次生成对比驱动脚本 | `experiments/multiview-test/run-e3-1.mjs:104-137`（`main()`） | 2 个测试物体（对称蘑菇屋+非对称攀爬架）× {网格生成, 分4次独立生成} → 12+ 张 PNG + `e3-1-log.md` 逐条耗时/usage 记录 | `@openai/codex-sdk`（复用 `../img2img-test/node_modules`，见文件第1行 import 路径），凭证 `~/.codex/auth.json` | orphan（后续 e3-3 复用其产出的 grid 裁切文件，非代码 import） | looks-working，全部12项 Status: success（`e3-1-log.md` 逐条记录） | 否，但**结论直接写入 CLAUDE.md**："多视图策略=生图模型单张图内生成2×2正交四视图网格" |
| 四视图网格裁切（内联） | `run-e3-1.mjs:71-92`（`cropGrid()`，spawn python3 内联脚本，非独立 .py 文件） | grid PNG → 4 张裁切视图 | 依赖系统 `python3` + PIL（无 package.json 声明，隐式假设环境已装） | 同上 | looks-working | 否 |
| E3-2：一致性人工评审 | `experiments/multiview-test/e3-2-review.md` | 目测评分表（1-5分，判据"平均≥4且无结构性矛盾") | — | 供决策参考 | 完成态文档 | 是（决策证据）。**发现的关键风险已写入报告但未见生产代码兜底**：非对称物体的网格视图会出现 front/left 标注错位（"视图语义漂移"），报告建议"管线必须加视图语义校验"，**该建议是否已被生产实现，本分片内无对应代码，需在 `job-pipeline`/`external-clients` 分片核实，此处只能标注为悬置的产品要求** |
| E3-3：单视图编辑 + 多视图同步一致性验证 | `experiments/multiview-test/run-e3-3.mjs:81-123`（`main()`） | 编辑1张视图（加粗支撑）→ 用编辑后视图作参考同步其余3视图 | 同 E3-1，Codex SDK + `~/.codex/auth.json` | orphan | looks-working，4/4 步骤 Status: success（含1次477.1s的慢请求，`e3-3-log.md:48` 记录，未报错但明显慢于其余步骤，可能是 agent 侧多轮修正导致，报告未深挖原因） | 否 |
| Tripo 原生多视图生成 API 对比素材 | `experiments/multiview-test/object{1,2}-tripo-{front,back,left,right}.jpg`、`compare.html`、`compare-object{1,2}-gpt-vs-tripo.jpg` | Tripo `generate_multiview_image`（厂商多视图图片生成，非 `multiview_to_model` 建模接口）产出 vs GPT/gpt-image-2 网格产出并排对比 | Tripo API，`TRIPO_API_KEY` | 无生成脚本留存于本目录（生成该素材的脚本未在当前文件树中，只留产物图 + 对比页），**这批产物是 CLAUDE.md "已禁用 Tripo 多视图图片 API"裁决的直接证据来源**（CLAUDE.md 原文引用路径正是 `experiments/multiview-test/compare-object1-gpt-vs-tripo.jpg`） | looks-working（产物存在，对比页可打开），但**生成脚本本身缺失**，无法重跑复核，只能信产物图与 CLAUDE.md 的转述 | 否，是被否决路线的证据留存 |
| 3D 建模对比（4 种输入来源） | `experiments/multiview-test/3d/render_views.py`、`3d/` 目录下 `object2-{single,mv,mvgrid,meshymv}.glb` 及各自 turntable 渲染 | 4 种输入来源（单图/Tripo原生多视图/网格/Meshy多视图）分别建模 → 4 组 GLB + 转盘对比图 | 隐含 Tripo/Meshy API 调用产出这些 GLB，但**提交这些任务的脚本本身未在当前文件树中找到**（`render_views.py` 只做渲染消费，不做建模提交） | orphan | 产物存在（looks-working 的渲染消费侧），但建模提交侧脚本缺失，成熟度对该子能力只能定为**half-done**（有产出物、无可复核的生成代码） | 否 |
| tripo-asset-demo 消费的源资产 | `experiments/multiview-test/3d/object2-mv.glb` | 被 `experiments/tripo-asset-demo/` 直接引用（见下节） | — | 被 `tripo-asset-demo/README.md:7` 与 `demo.js:5` 引用 | looks-working | 否 |

**关键发现（half-done 证据）**：`multiview-test/3d/` 下 4 组 GLB（single/mv/mvgrid/meshymv）明显是跑了 Tripo/Meshy 建模 API 才能产出的文件，但**提交这些建模任务的脚本不在当前文件树里**——可能是一次性交互式调用（未留脚本）或已被清理。这意味着"4种输入来源建模对比"这条能力链路的**前半段（生成 GLB）不可重跑复核**，只有后半段（`render_views.py` 消费 GLB 转渲染图）是可运行代码。同理，"Tripo 原生多视图图片生成"对比素材（`object{1,2}-tripo-*.jpg`）的生成脚本也缺失。

---

## 7. `experiments/tripo-asset-demo/` — Tripo GLB 资产消费方式教学 demo（未提交 git）

**git 状态：未跟踪（`git status --porcelain` 显示 `??`），无提交历史**——这是当前会话最新、尚未落 git 的产物，成熟度判定需格外保守。

| 能力 | 入口 | 输入→输出 | 外部依赖 | 被谁调用 | 成熟度 | 核心管线 |
|---|---|---|---|---|---|---|
| Three.js GLB 资产查看 + 参数化代理层演示 | `experiments/tripo-asset-demo/demo.js:1-252` | `../multiview-test/3d/object2-mv.glb`（读取路径写死在第5行）→ 浏览器内可缩放/可导出 JSON 参数规格的三.js 场景 | 无外部 API 调用（纯前端读取本地 GLB 文件），需 `python3 -m http.server` 起静态服务（README.md:16-18） | orphan（README 自称"throwaway demo"，明确定位为解释用途，非生产代码） | looks-working（README 详细描述了如何跑，逻辑自洽：GLTFLoader 加载→包围盒归一化缩放→独立的橙色参数代理层） | 否，README 原文自我定位："这些控件仍不能从 Tripo 网格恢复参数化建模历史……PetScape 应该把用户可编辑层保持为结构化参数，再与生成的外观壳在制造管线后期结合"——即这是一个**论证"为什么不能直接把 GLB 当 CAD 用"的教学产物**，不是待孵化的生产功能 |
| Python 资产检查 + 120mm 归一化导出 | `experiments/tripo-asset-demo/inspect_asset.py:46-94`（`main()`） | 同一 GLB → mesh 统计 JSON（顶点/面/watertight/连通体数）+ `out/object2-mv-normalized-120mm.stl` | 无外部服务，`uv run --with trimesh --with pygltflib --with networkx`（README.md:39 明确写运行方式，含依赖声明） | orphan | looks-working（`out/object2-mv-normalized-120mm.stl` 产物文件已实际生成，非空跑） | 否，同上教学定位 |

---

## 8. `threejs-mouse-spiral-nest/` — 独立三.js 螺旋岩石窝概念原型（唯一有自动化视觉回归验证的实验）

独立顶层目录（不在 `experiments/` 下），有自己的 `package.json`/`package-lock.json`，用 Vite 起本地开发服务器，用 Playwright 做无头浏览器视觉回归检查。**git 记录只有一条批量 checkpoint 提交（`332a2a5`），非迭代式开发痕迹**，说明是一次性生成后基本未再改动。

| 能力 | 入口 | 输入→输出 | 外部依赖 | 被谁调用 | 成熟度 | 核心管线 |
|---|---|---|---|---|---|---|
| 程序化螺旋岩石窝三维场景构建 | `threejs-mouse-spiral-nest/src/main.js:117-120`（`setupLighting()`/`createBaseWorld()`/`buildModel()`/`wireControls()` 启动序列） | 无外部输入（纯程序化生成：噪声+S形螺旋管道叠层+苔藓/星形/珊瑚装饰几何） → Three.js 场景（272 网格，含 248 个苔藓 blob，`visual-check-report.json:6-8` 实测数字） | 无外部 API，纯本地 three.js 渲染 | orphan（独立 index.html 入口，未被 web/ 引用） | **looks-working，且有实测证据**：`artifacts/visual-check-report.json` 记录 `"passed": true, "failures": []`，含桌面/移动端截图、非背景像素占比 99.93%/99.73%、亮度方差达标 | 否，是独立预研原型 |
| 交互参数调整（粗糙度/螺旋高度/窝口宽度） | `main.js` 内 `state` 对象（第9-17行）+ 对应 slider 绑定 | 滑块输入 → 实时重建模型 | 无 | 前端自身（HTML slider），非其他模块调用 | looks-working（`visual-check-report.json:64-65` 记录 `zoomDelta:2.423`/`dragDelta:5.4245`，证明交互确实改变了相机状态，非死绑定） | 否 |
| STL 导出 | `main.js:697-704`（`exportStl()`，用 `STLExporter`） | 当前模型 group → 二进制 STL 下载（`mouse-spiral-rock-nest-concept.stl`） | 无外部服务 | 由 UI 按钮 `#exportStl` 触发（`main.js:684`），被 `scripts/visual-check.mjs:142-154`（`verifyStlExport()`）自动化验证过 | **looks-working，有强证据**：`artifacts/visual-check-report.json:67-71` 记录导出文件 3,450,284 bytes（>阈值100000，检查脚本第52行会在导出过小时判定失败，本次未触发） | 否 |
| Playwright 自动化视觉回归检查 | `threejs-mouse-spiral-nest/scripts/visual-check.mjs:1-75`（主流程） | 起 vite dev server 后跑该脚本 → 桌面+移动截图 + 交互验证 + STL导出验证 + `visual-check-report.json` | 无外部 API，`@playwright/test`（本地 chromium） | 由 `package.json:8` 的 `npm run check:visual` 调用；`README.md` 未提及，但 `_d_meta.json` 标注 `"status": "needs-review"` | **looks-working 且已实际跑通并通过**（不是"写了检查脚本但没跑"的空转，`visual-check-report.json` 是真实产出的通过报告，非模板占位） | 否，属预研/prototype 验证工具，非生产 CI |
| README 使用说明 | `threejs-mouse-spiral-nest/README.md` | — | — | 供人工参考 | 完成态文档，含正确的免责声明（"导出的 STL 是造型概念网格，不等于最终打印件……进入切片前还要做实体壁厚/排水孔/支撑角度/倒扣/材料安全性和宠物尺寸约束检查"） | 否 |

**`_d_meta.json` 说明**：该文件标注 `"type": "design", "status": "needs-review"`，是设计/原型资产管理工具的元数据（与本项目 `design/` 目录同源的资产追踪格式），**但该目录本身不在任务隔离红线排除的 `design/` 路径下**（它是独立顶层目录 `threejs-mouse-spiral-nest/`），故按任务覆盖路径清单纳入盘点。其 `"needs-review"` 状态本身是"尚待人工过目"的信号，与代码层面的 `looks-working` 判定（有可运行证据支撑）不矛盾——代码确实跑通，但设计侧尚未走完人工复核流程。

---

## 汇总：橙色旗标（TODO/FIXME/被注释调用/永假 flag 排查结果）

按任务要求专项排查 half-done 证据，全分片 grep 结果：

```
grep -rn "TODO\|FIXME\|XXX" experiments/ threejs-mouse-spiral-nest/ (排除 __pycache__/venv/node_modules)
```

未发现代码内 TODO/FIXME 标记。半成品证据全部以**结构性信号**呈现（而非注释标记），已在上文各条目标注：

1. **重复实现（非死代码，是并发事故遗留）**：`a3-crop-grid.py`/`a3-crop_grid.py`、`a3-render-check.py`/`a3-render_and_check.py`（`experiments/fidelity-test-v2/`）。已核实产物一致，无功能分裂。
2. **建模提交脚本缺失，只留消费侧代码**：`experiments/multiview-test/3d/` 下 4 组 GLB 及 `object{1,2}-tripo-*.jpg` 素材，找不到对应的提交/生成脚本，判定为该子能力链路"前半段不可复核"。
3. **假阳性检测指标（三次坐实，非 flag 但性质等价于"永假的可靠性声明"）**：`entrance_through`/`hollow_signature` 两个几何指标在 `fidelity-test/report.md`（tripo-single）→ `fidelity-test-v2/report-v2.md`（V2 tripo-multi）→ `fidelity-test-v2/a3-report.md`（A3 黑洞入口）三个独立实验中连续三次误报，最终被 A3 报告建议弃用，改用"质心射线穿透判定+剖切渲染"。
4. **写死的本地绝对路径**：`experiments/fidelity-test/gen-inputs.mjs:8,13` 硬编码了一次性 worktree 快照路径（`<USER_HOME>/Desktop/3D宠物打印/.claude/worktrees/agent-a4a0ade8cc87bf36c/...`），worktree 合并后该路径已失效，脚本若不改路径无法重跑（同目录 `run-tripo.mjs`/`run-meshy.mjs` 用相对路径写法更健壮，未受影响）。
5. **产品要求悬置未见对应代码**：`experiments/multiview-test/e3-2-review.md` 发现"非对称物体网格视图 front/left 标注错位"风险，建议"管线必须加视图语义校验"，本分片内无对应实现代码（需在 `job-pipeline`/`external-clients` 分片核实是否已落地，本文档不越界断言）。

## 与生产管线的证据血缘关系（跨分片指针，供交叉核对）

- `experiments/fidelity-test-v2/a3-render-check.py`/`a3-render_and_check.py` 的"质心射线穿透判定"→ 生产 `web/app/lib/printability/localCheck.ts`（CLAUDE.md Learned Constraints 原文确认）。
- `experiments/fidelity-test-v2/a3-report.md` 的"生成式原生贯通不可行"结论 → 生产 `scripts/carve_shell.py`（确定性布尔挖腔，CLAUDE.md"混合内核=唯一路径"硬裁决）。
- `experiments/multiview-test/compare-object{1,2}-gpt-vs-tripo.jpg` → CLAUDE.md"禁用 Tripo 等 3D 厂商的多视图图片 API"硬裁决的直接证据引用。
- `experiments/fidelity-test/crop_grid.py` 的裁切逻辑 → 生产 `web/app/lib/images/cropGrid.ts`（该文件注释第8行明确写"参考 experiments/fidelity-test/crop_grid.py 的均分逻辑"）。
- `experiments/fidelity-test/run-tripo.mjs` 的调用范式 → 生产 `web/app/lib/tripo/client.ts`（该文件注释第6行明确写"用法参考 experiments/fidelity-test/run-tripo.mjs"）。

以上 5 条是**注释级引用**，均为"读过/参考过"而非 `import`，不构成运行时耦合，符合模块地图对本分片"零耦合"的定性。
