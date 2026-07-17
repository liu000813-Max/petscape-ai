# 成熟度取证：任务管线（job-pipeline）

覆盖路径：`web/app/lib/jobs/**`（`<USER_HOME>/Desktop/3D宠物打印/`）
取证时间：2026-07-04。取证手段：跑现有测试 + 本地无副作用脚本实跑（normalize_mesh.py 对真实 GLB）+ git log + experiments/generated 产物核验 + 全项目 grep 调用点（已剔除 `design/`）。
红线遵守：未真调任何外部付费 API（tripo/meshy/fal/LLM）；未改任何源文件；未 npm install。

---

## 关键更正（推翻初判）

**能力 2 的 `runCodexTurn` 初判「orphan（全项目零调用）」是错的。** 初盘点的 grep 漏了 `web/app/lib/agents/` 目录。实测 `runCodexTurn` 被 **6 个 LLM agent 全部调用**：

```
web/app/lib/agents/selecting/agent.ts:76
web/app/lib/agents/preview/agent.ts:46
web/app/lib/agents/rendering/agent.ts:44
web/app/lib/agents/extract/agent.ts:70
web/app/lib/agents/collecting/agent.ts:59
```

`runCodexTurn` 不是 orphan，是 LLM agent 层统一的「超时 + 生命周期日志」包装器。其中 `extract/agent.ts` 属于当前主链（静默抽取器，CLAUDE.md 明确「已落地」），故 `runCodexTurn` 有活跃主链调用点。能力 2 整体应判**能跑**，不是半成品。

---

## 逐条终判

### 1. Codex 串行队列（CodexSerialQueue）— **能跑**

- 入口 `codexQueue.ts:15-45`（类）+`:47-48`（globalThis 单例）。逻辑：FIFO `enqueue` + `drain` 串行、`position` 查位。`finally` 里 `this.active=undefined; this.drain()` 保证槽位释放、不死锁。
- **证据（最高档：实跑测试）**：`web/tests/timeoutQueue.test.mjs` 直接 import `CodexSerialQueue`，实跑通过：
  ```
  ✔ hung Codex-like job times out and releases queue slot for the next message (28ms)
  ℹ pass 1  fail 0
  ```
  该测试坐实「一个 job 超时后队列槽位正确释放、下一条能跑」——正是 commit `8d73a99` 修的死锁 blocker。
- 调用点（grep 实证）：`executor.ts:202`（enqueue）、`:233`（position）。仅 legacy session 流用，主链（gate1/gate2）不经此队列（fire-and-forget）。
- git：最后实质改动 `c8f58a5`（M1，独立验收 ACCEPT）。
- 定性：核心能力基础设施，逻辑简单且有实跑测试背书。仅服务 legacy，但代码本身能跑。

### 2. 超时保护 + 统一日志（withTimeout / runCodexTurn）— **能跑**

- `withTimeout`（`timeouts.ts:32-52`）：AbortController + setTimeout race，超时抛 `JobTimeoutError` 并 abort 下游 signal；`finally` 兜底 abort（防 SDK/子进程泄漏）。`userTimeoutMessage` 中文提示。
- **证据（实跑测试）**：同上 timeoutQueue 测试直接调 `withTimeout('cleanItem', 25, ...)` 触发超时路径并断言抛 `JobTimeoutError`，通过。
- **证据（grep 调用点，两条管线 + agent 层通用）**：`withTimeout` 被 gate1Job:80、gate2Job:65、meshyJob:50、sliceJob:145、cleanItem:30、renderScene:37、revise route:93 调用；`runCodexTurn` 被 6 个 agent（含主链 extract）调用。**推翻初判 orphan 说**。
- git：`9f5d6cf`/`8d73a99`（从真实 E2E 死锁 bug 修出，非拍脑袋）。
- 定性：两条管线 + LLM agent 层通用的活跃基础设施，有实跑测试 + 主链调用点，判能跑。

### 3. Gate1 编排（图生3D + 混合内核挖腔）— **能跑**

- 入口 `gate1Job.ts:51-94`（startGate1 同步建卡）+`:96-254`（runGate1 后台）。链路：fal 抠白底 → fal 四视图网格 → 像素裁切 → Tripo multiview_to_model 轮询下载 → carve_shell 挖腔 → 落 model.glb。含 withRetry、失败回退原始 GLB、mock 分支。
- **证据（experiments/generated 端到端产物，最强证据）**：`web/public/generated/9709946e-699f-4223-a5f4-7e4bb28bcc56/` 存有一次真实非 mock 端到端跑通的完整产物链：
  - `model-raw.glb`（28,119,584 bytes，Tripo 原始输出）
  - `carve.json`（挖腔结果：watertight=true, entranceThrough=true, minWallMm=5.59, entranceAxis=+x, L1 策略, 5.2s）
  - `model.glb`（2,444,856 bytes，挖腔后最终文件）
  - `gate1.log` 明确 `SUCCEEDED glb=.../model.glb ... issues=watertight=true; entranceThrough=true; minWallMm=5.59; entranceAxis=+x`，且 Tripo 轮询 `poll #14 status=success progress=100`、GLB 下载 28MB 全程真实完成。
- **证据（依赖核验）**：fal/tripo key 在 `.env` 已配（`FAL_KEY=`/`TRIPO_API_KEY=` 键存在）；`uv` 二进制 `/opt/homebrew/bin/uv` 存在；carve 脚本路径 `gate1Job.ts:211 path.join(workingDir,'..','scripts','carve_shell.py')` 解析到 `/Users/.../3D宠物打印/scripts/carve_shell.py`，文件实存（15KB）。
- git：`d94f9ae→fccb34e→8e876a2→0122c41→ad0afc3` 五次连续迭代（含「E2E dry run 三缺陷修复」「Tripo submit/upload 重试」），最新 `ad0afc3`（2026-07-04 17:02，jobs 目录最新提交）。
- **半成品残点（有意识缺口，不改判）**：`gate1Job.ts:139` TODO — Tripo 产物无几何修复通道，只做挖腔 + 本地诊断。此为已知功能边界，非阻断主路径。
- 定性：主链枢纽能力，有一次完整非 mock 端到端产物 + 五次迭代打磨 + 依赖齐备，判能跑。

### 4. Gate2 编排（归一化 + PrusaSlicer 切片）— **能跑**

- 入口 `gate2Job.ts:58-71`（startGate2）+`:73-143`（runGate2）。链路：uv+normalize_mesh.py（Y-up→Z-up + 缩放到 mm）→ PrusaSlicer CLI 切 G-code → parseGcodeMeta（时间/耗材）+ parseWarnings。
- **证据（本地实跑核心脚本，第二高档）**：我用 `uv run --with trimesh python3 web/scripts/normalize_mesh.py` 对上面那个真实 `model.glb` 实跑（无 API、无副作用、输出到 scratchpad），成功：
  ```
  actualExtentsMm: [119.987, 120.0, 118.792]  targetMm: 120
  transform: Y-up→Z-up rotate +90°X, scale 0.8, droppedToZ0, centeredXY
  输出 STL 6,789,084 bytes
  ```
  该 STL 尺寸与原 gate2 落盘的 `print-120mm.stl`（6,789,084 bytes）**逐字节一致**，证明 gate2 归一化步骤可复现。
- **证据（generated 端到端产物）**：同一目录 `gate2.log` 明确 `SUCCEEDED stl=.../print-120mm.stl gcode=.../print-120mm.gcode bytes=38451361 time=21h 14m 41s`；`print-120mm.gcode`（38MB）header 含 `estimated printing time (normal mode) = 21h 14m 41s`、`filament used [cm3] = 270.73`——正是 parseGcodeMeta 读取的字段，PrusaSlicer 真实跑通导出。
- **证据（依赖核验）**：PrusaSlicer 二进制 `/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer` 实存（233MB）；normalize 脚本 `web/scripts/normalize_mesh.py` 实存且已实跑通过；无网络 key 依赖。
- git：最后实质改动 `d94f9ae`（T3 竖切）；脚本移植自 legacy `fe15525`（独立验收 ACCEPT: STL 120mm/落底/watertight, G-code）。
- 定性：主链能力，核心脚本本地实跑 + 一次完整非 mock G-code 产物 + 二进制齐备，判能跑。切片参数写死（layer 0.2/fill 15%/support）是设计选择，非缺陷。

---

## 交叉证据汇总

| 依赖 | 核验 |
|---|---|
| FAL_KEY / TRIPO_API_KEY / MESHY_API_KEY | `.env` 三键均存在（仅验键名，未读明文） |
| uv | `/opt/homebrew/bin/uv` → Cellar/uv/0.9.13，存在 |
| PrusaSlicer | `/Applications/PrusaSlicer.app/.../PrusaSlicer` 233MB，存在 |
| carve_shell.py | `scripts/carve_shell.py` 15KB，存在，gate1 路径解析正确 |
| normalize_mesh.py | `web/scripts/normalize_mesh.py`，存在，**本地实跑通过** |
| 端到端产物 | `generated/9709946e.../` 含 raw.glb→carve.json→model.glb→stl→gcode 全链 + 两条 log 均 SUCCEEDED |
| 测试 | `tests/timeoutQueue.test.mjs` 实跑 pass（覆盖能力 1+2） |

## 与初判的差异

- 能力 2 `runCodexTurn` 从「orphan/half-done」更正为**能跑**（漏 grep agents/ 目录，实有 6 处调用含主链 extract）。
- 能力 1/3/4 初判 looks-working，本次用「实跑测试 / 本地实跑脚本 / 完整非 mock 端到端产物」把保真度从「读代码看起来能跑」抬到「有可复现证据坐实能跑」，终判**能跑**。
- 未发现死代码级问题；能力 3 的 `gate1Job.ts:139` TODO 是有意识功能边界（Tripo 无修复通道），不改判整条能力。
