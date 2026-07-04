# 成熟度取证：外部服务客户端

模块路径：`web/app/lib/tripo/**`, `web/app/lib/meshy/**`, `web/app/lib/images/**`
取证日期：2026-07-04
取证纪律：代码为唯一能力证据；不真调外部付费 API；不改源文件；不 npm install。
证据分级：本地执行 > 现有测试 > experiments 产物 > git log。

## 取证手段实测（本轮真跑）

- **本地执行（最高保真）**：node 24 `--experimental-strip-types` 直接 import 真实 `.ts` 源，喂 `experiments/multiview-test/object1-grid.png`（真实 fal 产出的 1254×1254 网格图）跑通：
  - `cropGridToViews` → 4 张 627×627 PNG，`orderedForTripo=[front,left,back,right]`（FLBR，与 Tripo 约定一致）
  - `publicImageToAbs`（相对→绝对 + 已存在绝对路径 passthrough）、`fileToDataUri`（输出 `data:image/png;base64,...` 492KB）、`buildMultiviewGridPrompt`（含固定 FLBR 顺序语义）、`buildScenePrompts`/`buildRevampPrompts`（3 方向、习性 hint 注入、petPhoto 分支分化、revamp「不改变原笼箱」硬约束）全部按文档行为返回。
- **现有测试**：`web/tests/timeoutQueue.test.mjs` 跑通（1 pass），但它只覆盖 job 超时队列，不覆盖本模块任何函数。
- **experiments 产物**：`fidelity-test/` 有 Tripo multiview 端到端 `status=success` 产物 + `run-tripo.mjs`（与 `client.ts` 近乎逐行同源的参考实现）。
- **配置**：根 `.env` 三把 key（`FAL_KEY`/`TRIPO_API_KEY`/`MESHY_API_KEY`）均已写入。

## 逐能力终判

### Tripo 客户端（`web/app/lib/tripo/client.ts`）

Tripo 全链在 experiments 有真实 `status=success` 端到端产物，且 `client.ts` 是从跑通的 `run-tripo.mjs` 提炼成模块并接进 `gate1Job.ts` 主链的。外部段无法本轮真调（红线），但参考脚本产出的真实响应可逐字段核对客户端解析逻辑。

| 能力 | 终判 | 证据 |
|---|---|---|
| `uploadImage` (:61) | 能跑 | `run-tripo.mjs` 的 `uploadImage` 与之逐行同源（FormData 字段名 `file`、`image_token\|\|file_token\|\|token` 三级兜底、`code!==0` 判错）；`tripo-multi-request.json` 内 4 个真实 `file_token`（UUID）证明上传确实拿到 token 并被提交。 |
| `submitMultiviewToModel` (:79) | 能跑 | `tripo-multi-submit.json` = `{code:0,data:{task_id:...}}` 真实提交成功；`tripo-multi-request.json` 请求体 `type=multiview_to_model`、`model_version=v3.0-20250812`、`orientation=align_image` 与 `client.ts` body 完全一致。caller `gate1Job.ts:182`。 |
| `pollTask` (:111) | 能跑 | `tripo-multi-result.json` `status=success`。关键：`tripo-multi.log` 实录 poll 在 25% 处 `fetch failed`——这正是 client 内「连续 ≤5 次 transient error 不判死」容错针对的真实故障（实验里靠 `resume-tripo.mjs` 外部恢复，client 已把该容错内建）。status 判定集（success/failed/cancelled/banned/expired…）与参考脚本一致。caller `gate1Job.ts:189`。 |
| `glbUrlFrom` (:144) | 能跑 | `tripo-multi-result.json` 的 `data.output` 键实测 = `['pbr_model','rendered_image']`，`pbr_model` 存在——正是 `glbUrlFrom` 首选字段；纯解析逻辑本地可推定正确。caller `gate1Job.ts:203`。 |
| `downloadFile` (:151) | 能跑 | `report.md` 记录 tripo-multi GLB 落盘 27M；下载=标准 fetch→arrayBuffer→writeFile+3 次重试，无外部依赖歧义。caller `gate1Job.ts:203`。 |

git log：`ad0afc3`（submit/upload 加重试 + 白底 prompt 单体约束）→ `0122c41`（E2E dry run 修 3 缺陷）→ `fccb34e`（gate1 切 Tripo multiview 主链 B3）。最后实质改动 07-04，处于活跃主链。

### fal 客户端 + 图像工具（`web/app/lib/images/**`）

| 能力 | 终判 | 证据 |
|---|---|---|
| `falGenerateImage` (falClient:48) | 能跑 | 薄封装 `falRun`（同步 `fal.run` 端点，`images[0].url` 解析）。`img2img-test/` 有 fal 端到端产物（test1/2/3 output PNG + test-log.md）证明 fal 通道实跑过。callers `renderScene.ts:40`、`scenes/route.ts:119`。外部段本轮不真调（红线）。 |
| `falEditImage` (falClient:52) | 能跑 | 同 `falRun`，传 `image_urls`（data URI 数组）。CLAUDE.md 记 07-04 实测定案 nano-banana/edit ~10-12s；`img2img-test` 产物佐证。主链重度调用（gate1 抠白底 + 四视图网格两处）。callers 多处（gate1Job:123/166 等）。 |
| `downloadImage` (falClient:56) | 能跑 | 标准 fetch→writeFile+AbortSignal。cleanItem/renderScene/gate1 落盘后均 `stat().size===0` 校验兜底，产物文件名规范清晰。 |
| `publicImageToAbs` (falClient:62) | 能跑 | **本轮本地实跑**：相对 `/generated/x/scene-1.png`→ 正确拼 `public/`；已存在绝对路径 passthrough 正确。 |
| `fileToDataUri` (falClient:68) | 能跑 | **本轮本地实跑**：真实 PNG → `data:image/png;base64,...`（492KB）；jpg/png mime 分支正确。 |
| `buildScenePrompts` / `buildRevampPrompts` (scenePrompt:50/64) | 能跑 | **本轮本地实跑**：返回 3 差异化方向；习性→功能 hint 注入（爱钻洞→隧道/洞穴）；petPhoto 有/无分支 prompt 分化；revamp 含「不改变原笼箱结构」硬约束。纯字符串组装，零外部依赖。callers `scenes/route.ts:7,46`。 |
| `buildMultiviewGridPrompt` (multiviewPrompt:17) | 能跑 | **本轮本地实跑**：377 字 prompt，含固定 FLBR 网格顺序语义（左上=front…），与 `cropGridToViews` 裁切约定单点对齐。caller `gate1Job.ts:163`。 |
| `cropGridToViews` (cropGrid:21) | 能跑 | **本轮本地实跑（最高保真）**：对真实 1254×1254 网格图输出 4 张 627×627 PNG + FLBR 排序数组，全部落盘成功、尺寸正确。纯 sharp 像素裁切，非生成式。caller `gate1Job.ts:175`。 |

git log：`3a710b0`（生图/抠图主通道 Codex→fal）、`fccb34e`（gate1 切 Tripo，新增 cropGrid/multiviewPrompt）。scenePrompt/cropGrid/multiviewPrompt mtime 07-04，活跃。

### Meshy 客户端（`web/app/lib/meshy/client.ts`）— 清单外，附带记录

不在本轮待取证清单中，但在模块路径内。终判：**死代码（现主链未接）**。
- 证据：`gate1Job.ts:24` 注释「Meshy client 保留不删（备选引擎裁决）」；主链 import 的是 tripo，非 meshy。CLAUDE.md 硬裁决「Meshy 降为备选…不走 Meshy」，可打印性改走本地 trimesh。
- 但**代码本身曾能跑**：git `9f8e04c` 独立验收 ACCEPT「实测 watertight 修复」；`fidelity-test/meshy-*-result.json` 有真实 SUCCEEDED 产物。即代码非坏死，是被架构裁决旁路，当前无 caller。

## 结论

清单 14 项 keyCapability 全部坐实为**能跑**，无一被推翻为半成品/死代码。初判 `looks-working` 成立且被强化：

- **纯本地 6 项**（cropGrid / publicImageToAbs / fileToDataUri / 两个 scenePrompt / multiviewPrompt）= 本轮真跑实测通过，最高保真。
- **Tripo 5 项 + fal 3 项** = experiments 端到端 `success` 产物 + 与跑通参考脚本逐行同源 + 主链 caller 齐全；外部段受红线未真调，但解析逻辑对真实响应逐字段核验无缺口。

唯一「爬不到顶」的残量：Tripo/fal 的真实 HTTP 往返本轮不可自动化验证（付费 API 红线）。但该段已有 experiments 里的真实成功响应做替代证据，非低保真桩替换——属可接受的证据档位。
