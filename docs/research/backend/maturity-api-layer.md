# 成熟度取证：后端「API 路由层」（web/app/api/**）

取证日期：2026-07-04
取证方式：代码为唯一能力证据；跑现有测试（只跑不改）；git log 作成熟度证据；experiments 产物作 E2E 端到端曾跑通的证据。
红线遵守：未真调任何外部付费 API（fal/tripo/meshy/LLM）；未改任何源文件；未 npm install。

## 关键环境事实（决定多条能力判定）

- **dev server cwd = `web/`**：`.claude/launch.json` 的 `web-dev` = `npm run dev --prefix web` → `next dev` 进程 cwd 落在 `web/`，故所有路由里 `process.cwd()` = `web/`。据此校验脚本/资产路径解析：
  - gate2 `path.join(cwd,'scripts','normalize_mesh.py')` → `web/scripts/normalize_mesh.py` **存在**（15515B 前 `scripts/` 下只有 carve_shell.py + normalize_asset.py，一度误判缺失，实际在 `web/scripts/`）。
  - gate1 carve `path.join(cwd,'..','scripts','carve_shell.py')` → 项目根 `scripts/carve_shell.py` **存在**（15515B）。
  - upload/generated 全部落 `web/public/**` ✓。
  - 两处脚本路径解析不对称（normalize 在 web/scripts，carve 在根 scripts），但在 cwd=web 下**均正确解析**。
- 本地二进制均在：`uv` = `/opt/homebrew/bin/uv`（0.9.13），`PrusaSlicer` = `/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`（233MB，可执行）。gate2 硬编码默认路径命中。
- `.env`（项目根）含 `MESHY_API_KEY` / `TRIPO_API_KEY` / `FAL_KEY` 三个 key；`web/.env.local` **不存在**（tripo client 有 `../.env` 兜底解析，命中根 .env）。
- mock 资产齐全：`web/public/mockup-assets/` 有 mock-model.{glb,stl,gcode} + scheme-a/b/c + model3d-preview.jpg + scheme-a-mushroom-v2.jpg（revise mock）。缺任一会让对应 `?mock=1` 链 ENOENT——现均在。
- 现有测试 `web/tests/timeoutQueue.test.mjs` **通过**（1 pass 0 fail，验证 gate1/gate2/revise/extract 共用的 job-timeout 队列：挂死 job 超时释放槽位）。
- 所有委派的 lib 均存在：falClient / scenePrompt / multiviewPrompt / cropGrid / tripo/client / printability/localCheck / jobs/timeouts / types/project / agents/extract/instructions + carve_shell.py + normalize_mesh.py。
- 全部 9 条路由的调用点在 page.tsx 逐行核对命中声明的行号（77/85/119/137/170/178/194/208/221/232/251/261/273/285/727）。

## 逐能力终判

### 1. 创建项目 — 能跑
`web/app/api/project/route.ts:8-11` → `createProject()`（store/projects.ts）。纯 in-memory 单例，无外部依赖，无副作用；返回全量初始 PetScapeProject 201。逻辑自包含、审查即可证。caller page.tsx:85 命中。git 末次实质改动 `5273d75 tracer: workbench T1 end-to-end path verification`。

### 2. 读取项目全量状态 GET /api/project/[id] — 能跑
`web/app/api/project/[id]/route.ts:11-16`。getProject + missingRequiredFields，不存在返回 404。纯读、无外部依赖。是前端轮询所有异步 job 状态的唯一入口（page.tsx 7 处 fetch GET 全部命中）。git `5273d75`。

### 3. PATCH brief 表单字段 — 能跑
`brief/route.ts:24-39`。白名单 FIELD_KEYS（10 个 string 字段）+ taboos/traits 数组过滤，写回 in-memory brief，返回 {brief, missing}。纯本地、无副作用。caller page.tsx:137。git `a58e44e feat: PetProfile brief semantics + dual-mode scene generation (B1+B2)`。

### 4. 上传宠物照/笼箱照 — 能跑
`upload/route.ts:31-61`。multipart 解析 + kind 校验（pet|cage）+ MIME→ext 映射 + 落盘 `web/public/uploads/{id}/{kind}.{ext}` + 写回 brief。纯本地文件系统，无外部 API。dir/写盘路径在 cwd=web 下正确。caller page.tsx:727。git `a58e44e`。

### 5. 场景图生成（i2i/t2i 双分流）— 能跑
`scenes/route.ts:34-139`。校验必填 → hasCage 分流（有笼箱照走 falEditImage i2i + 先落「改造前」ready 卡；无则 t2i，有宠物照走 edit 参考、否则纯文生图）→ 202 generating → fire-and-forget 后台生图落 `public/generated/{id}/scene-{ts}-{i}.png` → 前端轮询。含 withRetry（fal 瞬时错误重试一次）+ 空文件校验。`?mock=1` 走 mockup-assets 零成本，链路与真调用同状态机。
真链路 E2E 证据：`experiments/img2img-test/test-log.md`（2026-07-03 本机实测 fal/订阅通道「场景图→物品→白底」多路径矩阵，含产物 test1/test3-output.png）。委派的 falClient.ts 导出 falGenerateImage/falEditImage/downloadImage 齐全。
未在本次真调 fal（红线）。caller page.tsx:170。git `d42f4c6 fix: retry transient fal failures once and version scene filenames`。

### 6. 按标注修改场景图 revise — 能跑
`scenes/[sceneId]/revise/route.ts:30-111`。源须 kind=scene2d & status=ready & 有 imagePath（否则 400）+ annotatedImageDataUri 须 data: 前缀 + note 非空校验 → 202 → 后台 falEditImage（带 withTimeout revise 超时）→ 版本化命名（nextVersionName：方案 A → v2 → v3）+ parentId 溯源。`?mock=1` 用 scheme-a-mushroom-v2.jpg。
mock 资产在盘。未真调 fal（红线）。caller page.tsx:194。git `9f5d6cf feat: canvas annotation + revise-by-annotation loop (T2 tracer bullet)`。

### 7. Chat 一句话抽取字段（静默 Agent）— 半成品（路由/编排能跑，LLM 依赖未核实）
`agent/extract/route.ts:13-44` → `runExtractAgent`（agents/extract/agent.ts）。路由本身：message 校验 + patch 白名单落 brief（isSpeciesSlug/TRAIT_CHIPS 枚举校验、空值跳过）+ 返回 {patched, missing, reply}——这层能跑、审查即证。
但核心抽取依赖 `@openai/codex-sdk` 的 Codex thread（本地 CLI/ChatGPT 订阅态鉴权，**非 .env key**），本次未核实登录态、未真调 LLM（红线）。**关键设计缓冲**：SDK 调用包在 try/catch，失败返回 `FALLBACK_REPLY='我这边开小差了，请直接在左侧表单填写'` + 空 patch——即 LLM 不可用时路由仍 200、不阻塞表单（表单是真相源）。超时 60s（注释说明本机实测裸调 27.5s，故放宽避免必然超时）。
故：路由编排层能跑且有优雅降级，但「LLM 真抽出字段」这条主路径的运行时依赖未坐实 → 判半成品。caller page.tsx:273。git `df1ce85 feat: agent silent-extract — chat message auto-fills the brief (B4)`。

### 8. 门1：选场景卡→抠图→提交3D生成 — 能跑
`gate1/route.ts:13-31` 薄封装转发 `startGate1`（jobs/gate1Job.ts）。路由：sceneId/itemName 校验（400）+ 同步建 item2d/model3d 两张 generating 卡 + userState=tuning3d + 202。后台链（gate1Job）：fal edit 抠白底 → fal edit 四视图网格 → 像素裁切 4 张 → Tripo multiview_to_model 提交/轮询（带重试、超时 10min）→ 下载 GLB 落 model-raw.glb → carve_shell.py 混合内核挖腔覆盖 model.glb（失败回退原始 GLB + 诚实标注）→ model3d ready。`?mock=1` 拷 mock-model.glb 零成本。
真链路 E2E 证据：`experiments/fidelity-test-v2/` 有真 Tripo GLB（tripo-multi-v2.glb 28.7MB / a3-tripo-multi.glb 28.1MB，均 07-04）+ `report.md`/`a3-report.md`（记录 Tripo multiview 真实 API 生成、耗时、保真评分）；`experiments/multiview-test/3d/` 多个真 GLB。carve_shell.py + tripo client（submitMultiviewToModel/pollTask/glbUrlFrom/downloadFile）+ cropGrid + multiviewPrompt 均在。TRIPO_API_KEY 在根 .env（client 有 ../.env 兜底）。
未真调 Tripo（红线）。caller page.tsx:221。git `d94f9ae feat: gate1→3D→gate2 tracer bullet (T3 vertical slice)`（后续 `0122c41`/`ad0afc3` 有 Tripo 重试/白底 prompt 修复）。

### 9. 门2：3D就绪确认→归一化→切片 — 能跑
`gate2/route.ts:14-38` 薄封装转发 `startGate2`（jobs/gate2Job.ts）。路由：前置校验 model3d.status===ready（否则 400）+ scaleMm clamp 80-160 + color/material 兜底默认 + 202。后台链（gate2Job）：uv run trimesh normalize_mesh.py 归一到 scaleMm 出 STL → PrusaSlicer --export-gcode（layer 0.2/fill 15%/support）出 gcode → 解析警告/耗时/耗材 → slice ready。`?mock=1` 拷 mock-model.{stl,gcode}。
真链路 E2E 证据：`experiments/meshy-test/` 有真 PrusaSlicer 产物（mushroom-house.gcode 22.5MB、mushroom-house-repaired-120mm.stl、mushroom-house-supported.gcode 28.9MB）；`experiments/tripo-asset-demo/out/object2-mv-normalized-120mm.stl`（48.8MB，真 normalize 产物）。两个二进制（uv 0.9.13 / PrusaSlicer 233MB）实测在盘可执行；normalize_mesh.py（web/scripts/）真实存在含 trimesh load/scale 逻辑。
未真跑切片（红线，但依赖二进制已核实存在）。caller page.tsx:251。git `d94f9ae`。

## 死代码：无
9 条能力对应文件全部有活跃 caller（page.tsx 逐行命中）+ 近日 git 提交，无死代码。

## 与初判对照
初判全部 looks-working。取证结论：8 条坐实为「能跑」；仅 #7 extract 因核心 LLM 运行时依赖（Codex SDK 订阅态）本次未核实、且真抽取路径未跑通验证，降为「半成品」——注意其路由编排层与降级兜底是能跑的，卡点仅在 LLM 依赖的活性，非代码缺失。
