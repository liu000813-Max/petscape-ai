# 批次1 独立验收报告（4B. 验收 Story 1-5）

- **验收人**：独立 verifier（全新 context，未参与实现，未读实现过程）
- **日期**：2026-07-04
- **被验对象**：worktree 检出（HEAD 含 `ce55c14` 批次1 提交）自起 dev server `http://localhost:3011`，全程 `?mock=1`（真链已由 builder 自验，本轮不烧付费 API）
- **工具**：Playwright 1.55 headless Chromium，视口 1440×900 DPR 1；像素 diff 用 pixelmatch（threshold 0.1，`includeAA:false`）
- **驱动脚本**：`tools/verify-batch1/{lib.js, run-stories.js, story1-timing.js, story4.js, story5.js}`；截图 `tools/verify-batch1/shots/`（下文相对路径均相对本文件）
- **环境备注**：gitignored 的 mock 3D 资产（`mock-model.glb/.stl/.gcode`）从主 repo `web/public/mockup-assets/` 拷入 worktree；判定只依据 spec `docs/specs/batch1-pet-avatar.md` 4B 断言原文

**结果总览：4 PASS / 1 FAIL（Story 2）/ 0 BLOCKED**

| Story | 断言 | 判定 |
|---|---|---|
| 1 | mock 全流程（上传→生成→阶段进度→canvas 旋转→报价/下载） | **PASS**（两处偏差已记录，均为 spec §2.4 meshy 缩短序列/mock 速度产物） |
| 2 | 换档重切（3→5 → 计算中 → 重量变大） | **FAIL**（mock 保真度缺口：重量不变、计算中不可见） |
| 3 | 装扮定妆提示 + 重新生成 | **PASS** |
| 4 | 失败态 + 重试 | **PASS** |
| 5 | 生成前视觉不变 | **PASS**（与批次0 验收截图 0.00% diff） |

---

## Story 1 mock 全流程 — **PASS**

逐项断言与观测：

| 断言原文 | 观测 | 判定 |
|---|---|---|
| 上传任意本地图片 | `setInputFiles(pet-hamster-ref.jpg)` → 上传卡出现预览 img | ✓ |
| 点"生成 3D 可旋转预览"→ 按钮立即 disabled | 点击后同帧读取：`disabled=true`，文案"生成中…" | ✓ |
| 舞台出现阶段进度，全程 ≤10s | 100ms 采样两轮实测：`[1.0s] 风格化立绘 active → [3.2s] 风格化✓ 三视图✓ 建模中 active → [8.2s/8.5s] canvas 出现`，≤10s | ✓ |
| 4 阶段依次高亮、已完成打勾 | 阶段进度条 4 格呈现；高亮依次 = 1→3，完成格打 ✓（见偏差说明） | ✓* |
| 舞台变为 three.js canvas，拖拽可 360° 旋转 | canvas 出现；静置 1s autorotate 基线 diff 0.55%，水平拖拽 320px 后 diff 7.76%（拖拽显著改变视角） | ✓ |
| 报价面板标题含当前宠物名，改名后跟随 | "Nomi 的专属模型" → `#pet-name` 改"米糕" → "米糕 的专属模型" | ✓ |
| 显示"重量 N g"与打印时长 | "重量 129.8 g / 打印 10 时 39 分"，价格 ¥104 - ¥228 | ✓ |
| 下载 STL / G-code 按钮可点且 href 200 | `/generated/{id}/avatar/print-120mm.stl` HTTP 200（5,185,884 B）；`.gcode` HTTP 200（28,875,966 B） | ✓ |

**\*两处偏差（不改判定，需主控知悉）**：
1. "生成三视图"步从未处于高亮态——直接从 pending 跳为打勾。这是 spec §2.4 的既定行为（`MESH_ENGINE='meshy'` 默认路径"跳过三视图生成与裁切，stage 序列缩短为 styling→modeling"），4B.1 断言文本写于 meshy 拍板前，与 §2.4 以 §2.4 为准。
2. "切片报价"步的高亮窗口未被观测到：mock 切片为文件拷贝（<0.3s），小于前端 2s 轮询间隔，UI 从"建模中"直接切到 canvas。代码路径存在（`computeStageIndex` 映射 slice running→index 3），真链切片约 7s 时该高亮可见；mock 下不可见与 Story 2 的"计算中"同根因。

证据：`../../tools/verify-batch1/shots/s1-01-before-generate.png`（生成前）→ `s1-02-stage-1-t1_1s.png`（阶段1 高亮 + 按钮"生成中…"）→ `s1-02-stage-3-t12_5s.png`（canvas + HUD"已生成 3D 模型/拖拽可 360° 旋转"，旋转滑块已隐藏）→ `s1-03/04/05-rotate-*.png`（autorotate 基线 vs 拖拽对比）→ `s1-06-quote-ready.png`（Nomi 标题 + 重量/时长/价格 + 两下载按钮）→ `s1-07-quote-renamed.png`（米糕标题跟随）。
时序数据：`story1-timing.js` 两轮输出（8.2s / 8.5s）。注：`run-stories.js` 首轮观测到 12.5s 出 canvas，系 dev 模式首次编译 three.js chunk + 采样循环内截图开销所致，剔除干扰后复测两轮均 ≤10s。

## Story 2 换档重切 — **FAIL**

断言原文：体型滑块 3→5 → 1 秒内报价面板出现"计算中"态 → 数秒后重量数字变大（160mm > 120mm）。

观测（`run-stories.js`，UI 100ms 采样 + API 轮询）：
- 滑块 3→5 后重切**确实触发**：API `avatarSlice` 变为 `{status:"done", scaleMm:160, stlUrl:.../print-160mm.stl, gcodeUrl:.../print-160mm.gcode, weightG:129.8, printTimeMin:639}`，`print-160mm.stl/.gcode` 与 120mm 产物并存于磁盘。
- **"计算中"态未出现**（100ms 采样 20s 内 NOT SEEN）：mock 切片是即时文件拷贝，running 窗口 <0.3s，小于报价面板 2s 轮询间隔，UI 无法捕获。"计算中"分支代码存在（`ManufacturingSection.jsx` `computing` 态），mock 下不可见。
- **重量数字未变大**：120mm = 129.8 g，160mm = 129.8 g（UI 与 API 一致）。根因：mock 重切对任何 mm 均拷贝同一份 `mockup-assets/mock-model.gcode` 并从其头部解析重量，重量与 mm 无关（`avatarJob.ts` mock 分支无按档缩放）。两档 stl/gcode 文件字节完全相同（5,185,884 / 28,875,966）佐证。

**定性**：这是 **mock 保真度缺口**，非重切链路缺陷——重切触发、防抖、幂等、产物落盘、状态回写全部正常；builder 报告 4A.4 的真链 curl 证据（128.3g→274.9g）表明真实路径重量确实随档变化，但那是 builder 自验、非本 verifier 独立复核，且 4B.2 是浏览器断言、在指定的 mock 环境下不成立。
**建议修复**（供主控裁决）：mock 切片按 `(scaleMm/120)³` 缩放解析出的 weightG，并加 1-2s 人工延时使"计算中"可见；改动仅限 `avatarJob.ts` mock 分支，改后仅需复跑 `run-stories.js` 的 S2 段。

证据：`s2-02-after-160.png`（换档后面板，重量仍 129.8 g，与 `s1-07-quote-renamed.png` 字节级相同）；stdout 中 avatarSlice API 摘录。

## Story 3 装扮定妆 — **PASS**

- 勾选装扮（迷你针织帽）后生成（Story 1 主链即带装扮生成）。
- 完成后切换装扮勾选（点第 2 张装扮卡）→ 装扮区出现胶囊提示 **"已更换装扮 · 重新生成以应用新装扮"**。
- 再点生成按钮 → 立即 disabled、文案"生成中…"、管线进度条重新出现（提示随之清除）→ **生成期间**再次切换装扮 → 提示再次出现 → 全链重新走完，canvas 于 15.4s 回归（含重切至 160mm）。

证据：`s3-01-hint-after-done-toggle.png`（完成后提示）→ `s3-02-regen-running.png`（重生成进行中）→ `s3-03-hint-during-regen.png`（生成期间提示）→ `s3-04-regen-done.png`（重生成完成回到 canvas）。

## Story 4 失败态 — **PASS**

builder 报告未定义失败注入方式（其报告只覆盖 4A），按验收指引采用 mock 下临时注入：**临时改名 `web/public/mockup-assets/mock-model.glb`** → mock 建模步 `copyFile` 抛 ENOENT → job catch 置 `avatar.status=failed`（走的是后端 job 失败→前端轮询感知的完整通路，非前端桩）。验证后文件已复原（脚本 finally 兜底）。

- 点生成后 **5.1s** 舞台出现失败浮层：标题"生成失败" + 具体错误信息 + "重试"按钮。
- **不白屏**：整页 13 个 section 正常渲染（全页截图佐证）；**不卡永久 loading**：管线进度浮层已撤（count=0），生成按钮恢复可点（disabled=false）。
- 复原 glb 后点"重试" → 失败浮层消失、管线进度重新出现 → **7.8s** canvas 出现，链路完整恢复。

证据：`s4-01-failure-state.png`（失败浮层 + 重试按钮，舞台其余原样）→ `s4-02-fullpage-not-white.png`（全页无白屏）→ `s4-03-retry-running.png`（重试后阶段1 高亮）→ `s4-04-retry-done.png`（重试成功回到 canvas）。

## Story 5 生成前视觉不变 — **PASS**

复刻批次0 验收的截图条件（1440×900、DPR1、冻结轮播、`animation:none`、2.6s 收敛、整页预滚动、`.pet-creator-section` 元素级截图），与批次0 验收存档 `tools/verify-batch0/shots/s1-port-03-creator.png` 逐像素对比：

```
refSize 1440x1269 / curSize 1440x1269 / diffPixels 0 / diffRate 0.00%
```

尺寸相同、**0 像素差异**——未点生成时创建器区（CSS avatar、转盘、HUD、滑块、装扮商店）与批次0 验收时完全一致。

证据：`s5-creator-now.png`（本次）、`s5-diff.png`（全黑 diff 图）。

---

## 总判

**4/5 PASS，1 FAIL（Story 2）。** 唯一 FAIL 的根因是 mock 切片分支的保真度缺口（重量常量化 + running 窗口过短），不涉及重切触发/防抖/幂等/产物/状态回写等真实链路逻辑；建议按上文一小改修复 mock 分支后仅复跑 S2 段闭环。其余四条 Story（含失败态的后端级注入与批次0 视觉零回归）全部通过。

## 残量声明（保真度阶梯）

- 本轮全部断言在 `?mock=1` 下以浏览器自动化真实执行（真实 DOM/真实轮询/真实文件产物/真实 HTTP 下载），无桩替身；Story 4 注入发生在后端 job 内部（文件缺失→job failed→轮询感知），非前端翻标志位。
- 未爬到的一档：**真链**（fal/Meshy/PrusaSlicer）浏览器全流程——被验收指引明确排除（不烧付费 API），真链证据现状 = builder 自验报告 4A.2-4A.5（curl 级，非独立复核）。真链下 Story 2 的"重量变大"与"计算中"两断言按 builder 4A.4 数据（128.3g→274.9g、真实切片约 7s）应可成立，但此判断**尚未经独立验证**。
