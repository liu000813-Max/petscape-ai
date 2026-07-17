# 模块盘点：几何后处理原生脚本（geometry-native）

范围：`<USER_HOME>/Desktop/3D宠物打印`
覆盖路径：`scripts/carve_shell.py`、`scripts/normalize_asset.py`、`web/scripts/normalize_mesh.py`
排除：`design/` 全目录、`node_modules`、`.next`、`.git` 内部对象、`PRD.md`、`max最新版的PRD.docx`（均未读取）。
证据方式：直接读取三个脚本源码 + 全项目 grep 调用点（`.claude/worktrees/*` 下的重复副本视为同一 git worktree 的镜像，不算独立调用点，已在下方注明）+ `git log --oneline -- <file>`。

---

## 能力 1：`repair_watertight` — 水密化重网格修复（两级策略）

- **入口**：`scripts/carve_shell.py:31` 函数 `repair_watertight(in_glb, tmpdir)`，被 `main()`（`carve_shell.py:286`）调用，是 `carve_shell.py` CLI 主流程的第一步。
- **输入 → 输出**：输入任意 GLB（Tripo 产出的原始网格，可能非水密/多连通分量）；抽稀到 ≤150k 面 → `pymeshlab` 体素重网格（L1: `offset=50%` 逐级加粗 `cellsize` 0.5%→3.0%；L2 兜底: `offset=100%` + `meshing_close_holes` 逐级加粗 1.0%→5.0%）→ 输出水密单壳 `trimesh.Trimesh` + 修复过程记录 `rec`（含 `repair_strategy`、每档尝试的 watertight/is_volume/连通分量数）。
- **外部依赖**：无外部服务/API key。纯本地库：`pymeshlab`、`fast_simplification`、`trimesh`（均经 `uv run --with` 临时装配，无需预装）。
- **被谁调用**：`main()`（`carve_shell.py:286`），即 `carve_shell.py` CLI 入口本身；再往上由 `web/app/lib/printability/localCheck.ts:120`（函数 `carveShell`）以 `spawn('uv', [...scriptAbs...])` 子进程调用；再往上由 `web/app/lib/jobs/gate1Job.ts:214`（`carveShell(rawAbs, glbAbs, carveJsonAbs, carveScript, {...})`）触发，属于门 1（gate1）3D 生成链路的第 2d 步。
- **成熟度初判**：looks-working。两级降级策略有明确的实测触发依据（源码注释引用具体案例：`492 连通分量、最大单壳仅占 3.3% 面`，`carve_shell.py:36`），且 `CLAUDE.md`「Learned Constraints」章节记录了 L1/L2 分工与失败不阻塞的回退语义，与代码行为一致（`gate1Job.ts:219-231` 确认失败时回退原始 GLB 而非中断整条链路）。
- **核心管线能力**：是。门 1（gate1）3D 生成链路的必经步骤，无此步无法产出水密体供后续布尔挖腔。

---

## 能力 2：`detect_entrance_axis` — 入口朝向自动探测（射线法）

- **入口**：`scripts/carve_shell.py:128` 函数 `detect_entrance_axis(mesh)`，被 `main()`（`carve_shell.py:297`）调用。
- **输入 → 输出**：输入标定后的水密 mesh；对 ±x/±y/±z 六个方向发射中心射线，取「首次命中点距离该方向包围盒面最深」的方向为入口轴（即最像凹陷入口的朝向）；输出单位向量 + 轴名（如 `+x`）+ 深度值 mm。
- **外部依赖**：无。纯几何计算（`trimesh.ray` 光线求交）。
- **被谁调用**：`main()`（`carve_shell.py:297-299`），探测结果传给 `carve()`（`carve_shell.py:302`）决定挖腔入口朝向。链路上游同 能力1，最终由 `gate1Job.ts:214` 触发。
- **成熟度初判**：looks-working。`CLAUDE.md` 明确记录该能力替代了早期硬编码朝向的方案（"carve 入口轴自动探测，悬置关闭"），且实测坐实（"multiview front 落 +x（实测坐实）"），是收敛掉一个已知问题（朝向悬置）后的产物，非占位实现。
- **核心管线能力**：是。没有这一步，挖腔入口朝向只能硬编码，无法适配不同宠物造型输入。

---

## 能力 3：`carve` — 布尔挖腔（椭球内腔 + 圆柱贯通入口 + 壁厚自适应收缩）

- **入口**：`scripts/carve_shell.py:166` 函数 `carve(mesh, entrance_dir, entrance_r, wall_min, rec)`，被 `main()`（`carve_shell.py:302`）调用。
- **输入 → 输出**：输入水密外壳 mesh + 入口方向向量 + 入口半径(mm) + 最小壁厚(mm)；用 `manifold3d` 做布尔差集（外壳 − 椭球腔工具 − 圆柱贯通工具），最多迭代 3 轮、每轮 `cavity_scale` 递减 0.08 直至壁厚达标或轮次用尽；输出挖腔后 mesh + 摘要 `{watertight, entranceThrough, minWallMm, finalCavityScale, centerHollow, axisRayCrossings}`。
- **外部依赖**：无。核心计算库 `manifold3d`（布尔运算内核）+ `trimesh`（射线测厚、法线修复）。
- **被谁调用**：`main()`（`carve_shell.py:302`）；最终结果通过 `main()` 写入 `out_glb`/`out_json`（`carve_shell.py:305-315`），被 `gate1Job.ts:214-231` 使用（`printabilityIssues = summarizeCarve(carve)`，`gate1Job.ts:228`）。
- **成熟度初判**：looks-working，但有已知未解决缺口（half-done 证据，非本文件内 TODO，而是调用方文档明确记录）：`web/app/lib/printability/localCheck.ts:78` 注释「`scaleMm` 绑定（门2 缩放会破坏 Ø69 物理保证）本切片不解决 —— TODO，见 b31-report.md」——即挖腔时按 150mm 标定出的 Ø69mm 入口直径，在门 2（gate2/切片）阶段如果用户改缩放（`modelConfig.scaleMm`），入口物理尺寸会与设计目标（如「适配某笼箱开口」）脱钩，且当前代码没有联动修正。此外 `carve()` 内壁厚收敛失败时的兜底（`carve_shell.py:251-252`：3 轮不达标就直接采用最后一轮结果，不报错）是静默降级，摘要里 `minWallMm` 会如实反映未达标数值，调用方 `gate1Job.ts` 会记录但不会拒绝该产物。
- **核心管线能力**：是。`CLAUDE.md` 明确裁决"生成负责外壳，布尔负责孔洞...参数化挖腔是产出功能内腔的唯一可行路径"（`PRD.md:72`、`CLAUDE.md:20`），A3 实验证伪了生成式原生挖洞路线。

---

## 能力 4：`carve_shell.py` CLI 整体（标定 + 编排 + JSON 摘要落盘）

- **入口**：`scripts/carve_shell.py:271` 函数 `main()`；命令行形态 `uv run --with pymeshlab,manifold3d,trimesh,fast_simplification,numpy,rtree scripts/carve_shell.py IN.glb OUT.glb OUT.json [--stand-height-mm][--entrance-diameter-mm][--wall-min-mm]`（`carve_shell.py:7-10`）。
- **输入 → 输出**：输入 GLB 路径 + 三个可调参数（站高/入口直径/最小壁厚，均有默认值 150/69/3mm）；编排能力1→标定缩放（`carve_shell.py:290-292`，最长边缩放到 stand-height 并重定中心）→能力2→能力3；输出 `OUT.glb`（挖腔后水密单壳）+ `OUT.json`（`{watertight, entranceThrough, minWallMm, entranceAxis, detail}`，供 gate1 摘要消费）+ stdout 打印同一份 JSON（供调用方子进程解析最后一行）。
- **外部依赖**：无 API/key。运行时依赖本机 `uv`（`web/README.md:20` 记录默认路径 `/opt/homebrew/bin/uv`，可用 `UV_BIN` 覆盖）；`.env` 现存 key 为 `MESHY_API_KEY`/`TRIPO_API_KEY`/`FAL_KEY`（均与本模块无关，属于 `external-clients` 分片）。
- **被谁调用**：`web/app/lib/printability/localCheck.ts:97` 函数 `carveShell()` 以 `spawn('uv', args)` 方式调用（`localCheck.ts:105-120`，参数拼接为 `uv run --with pymeshlab --with manifold3d --with trimesh --with fast_simplification --with numpy --with rtree --with networkx python <scriptAbs> ...`）；再上游是 `web/app/lib/jobs/gate1Job.ts:211-231`（唯一生产调用点，属于门 1 链路第 2d 步，`mock=1` 模式不触发，见 `gate1Job.ts:148`）。
- **成熟度初判**：looks-working。有明确的 git 提交作证据：`8e876a2 feat: hybrid-kernel carve wired into gate1 — shell from Tripo, holes from booleans (B3.1)` 与后续 `0122c41 fix: three defects surfaced by the full E2E dry run`（`git log --oneline -- scripts/carve_shell.py`），说明经过一次全链路 dry run 并修过缺陷，非纸面设计。失败路径有完整回退（`gate1Job.ts:219-226`：carve 失败则拷贝原始 GLB 当最终产物、诚实标注挖腔失败摘要），不是"假装成功"的桩。
- **核心管线能力**：是。`_map.md` 明确列为唯一跨 Node/Python 边界的重计算层入口之一。

---

## 能力 5：`normalize_asset.py` — 资产入库归一化（GLB → Y-up mm 标定 + meta.json 烘焙）

- **入口**：`scripts/normalize_asset.py:42` 函数 `main()`；命令行形态 `uv run --with trimesh --with numpy scripts/normalize_asset.py --input <glb> --target-height-mm <mm> [--output]`（`normalize_asset.py:15-17`）。
- **输入 → 输出**：输入任意 GLB + 目标高度(mm，沿 Y 轴)；按 Y 轴 extent 缩放到目标高度 → 重新取包围盒、贴地（min.y=0）+ x/z 居中 → 输出 `<name>.norm.glb`（Y-up，1 unit = 1mm）+ `<name>.meta.json`（`{heightMm, footprint:{xMm,zMm}, boundsMm, transform:{...}}`）。
- **外部依赖**：无。纯本地 `trimesh` + `numpy`。
- **被谁调用**：**无 Node/job-pipeline 调用点**——全项目 grep 未发现任何 `spawn`/`execFile`/`child_process` 引用 `normalize_asset.py`（对照能力4/能力6均有明确 `spawn(...)` 调用点，本脚本没有）。唯一命中是 `web/app/scene-lab/SceneLabViewer.tsx:4` 的注释："资产已用 `scripts/normalize_asset.py` 一次性烘焙为 1 unit = 1mm 的 `.norm.glb` + `.meta.json`"——即该组件**消费脚本产出的静态文件**（已在 `web/public/scene-lab-assets/` 下核实存在 `custom-item.norm.glb`/`.meta.json`、`module-2.norm.glb`/`.meta.json`、`module-climber.norm.glb`/`.meta.json` 三组产物），但不在运行时调用脚本本身。属于人工离线运行一次的资产预处理工具，不是 job-pipeline 的一环。
- **成熟度初判**：looks-working（脚本本身逻辑完整、有输出产物落盘为证），但**调用方式与模块描述给出的"被 job-pipeline 以子进程调用"不符**——本脚本是唯一的例外：它是手工 CLI 工具，不经过 job-pipeline 子进程调用。`_map.md` 对此有明确记录："根 `scripts/normalize_asset.py` 用于 scene-lab 资产入库（一次性烘焙，非 job-pipeline 触发）"。
- **核心管线能力**：否（辅助工具）。是 `scene-lab` demo（组合场景预览）的资产预处理步骤，不在门1/门2主链路（gate1Job/gate2Job）上；`scene-lab` 本身也不在 `PRD.md` 定义的 Max 电商漏斗主干上（`CLAUDE.md` 开头："三栏工作台...是漏斗的实现容器"，scene-lab 是独立 demo 页）。

---

## 能力 6：`web/scripts/normalize_mesh.py` — 切片前坐标系归一化（Y-up→Z-up + 缩放 + 落床贴地）

- **入口**：`web/scripts/normalize_mesh.py:26` 函数 `main()`；命令行形态 `uv run --with trimesh python3 normalize_mesh.py --input <glb> --output <stl> --target-mm <mm>`（对照调用处 `gate2Job.ts:94-98` 拼参）。
- **输入 → 输出**：输入 GLB（门1产出的挖腔后模型）+ 目标最大边长(mm)；绕 X 轴旋转 +90°（Y-up → Z-up，适配 PrusaSlicer 坐标约定，`normalize_mesh.py:41-42`）→ 按旋转后最大 extent 缩放到 target-mm → Z 轴落床（min.z=0）→ XY 居中 → 导出 STL；stdout 打印 JSON `{stlPath, targetMm, actualExtentsMm, boundsMm, transform:{...}}`。
- **外部依赖**：无 API/key。纯本地 `trimesh` + `numpy`；运行时依赖本机 `uv`（`UV_BIN`，默认 `/opt/homebrew/bin/uv`，已确认本机存在）。下游依赖本机 `PrusaSlicer.app`（`PRUSASLICER_BIN`，默认 `/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`）做实际切片，但那是调用方 `gate2Job.ts`/`sliceJob.ts` 的后续步骤，不属于本脚本职责。
- **被谁调用**：两个独立调用点（均为生产路径，非重复镜像）：
  1. `web/app/lib/jobs/gate2Job.ts:91` — 门 2（gate2/切片）当前活跃链路，`gate2Job.ts:94-98` 用 `execFileAsync(UV_BIN, ['run','--with','trimesh','python3', script, '--input', inputAbs, '--output', stlAbs, '--target-mm', String(targetMm)])` 调用。
  2. `web/app/lib/jobs/sliceJob.ts:105` — legacy 旧流程（`web/app/legacy/page.tsx` 对应的旧 session 状态机）的切片调用点，逻辑与 gate2Job 几乎一致（同款参数拼接，`sliceJob.ts:106`）。`CLAUDE.md`/`design/t3-report.md`（未读取该目录内容，仅 grep 命中文件名与行号，符合排除 design/ 目录内容的红线——此处只引用 `web/README.md` 与 `web/app/lib/jobs/gate2Job.ts:9` 注释中的说明）确认 gate2Job 是"复用 legacy sliceJob 的 normalize_mesh.py + PrusaSlicer，但驱动 project 单例"的新路径，两者并存、legacy 未删除。
- **成熟度初判**：looks-working。有独立验收记录佐证（git log 命中 `fe15525 M5: trimesh normalize + PrusaSlicer 切片 + done页 (独立验收 ACCEPT: STL 120mm/落底/watertight, G-code 10h49m/120cm³)`），是三个脚本中唯一有"验收 ACCEPT"字样 commit message 的一个，证明经过实测验证而非仅完成编码。
- **核心管线能力**：是。门 2（切片）链路的必经前置步骤，无坐标系转换 PrusaSlicer 无法正确处理 Y-up 模型。

---

## 附：模块级共性观察（非独立能力，供后续分片盘点参考）

- **无 TODO/FIXME/注释掉的调用/永远为 false 的 feature flag**：对三个脚本源码本身做过 `grep -n "TODO\|FIXME\|XXX"`，零命中。半成品证据均来自**调用方**而非脚本自身：
  - `web/app/lib/printability/localCheck.ts:78`：`carve` 的 Ø69 入口尺寸与门2 `scaleMm` 缩放未联动的 TODO（见能力3）。
  - `web/app/lib/jobs/gate1Job.ts:139`：挖腔前的 repair 步骤注释「repair 暂不做（TODO：Tripo 产物需外部修复通道，Meshy print/repair 只吃自家 task）」——这条 TODO 指的是 Tripo 原始产物在喂给 `carve_shell.py` 之前缺一道独立修复步骤，但 `carve_shell.py` 自身的 `repair_watertight`（能力1）已经内含水密修复，故此 TODO 更像是历史注释未随 carve_shell 的引入更新，不构成本模块的功能缺口。
- **三脚本均为纯本地计算，零外部 API/key 依赖**：已对三份源码分别 grep `os.environ|getenv|API_KEY`，零命中，与 `_map.md`/`CLAUDE.md` 对该模块"零外部 API"的定性一致。项目根 `.env` 现有的 `MESHY_API_KEY`/`TRIPO_API_KEY`/`FAL_KEY` 均属于 `external-clients` 分片（`web/app/lib/tripo/**`、`web/app/lib/meshy/**`、`web/app/lib/images/**`），与本模块无关。
- **`normalize_asset.py` 是模块内唯一偏离"被 job-pipeline 子进程调用"这一模块级职责描述的脚本**：它是人工离线运行的资产预处理 CLI，产物被前端静态消费，不在任何后端 job 的运行时路径上。盘点时应将其与另外两个脚本（真正跑在 gate1/gate2 请求路径上）区分对待。
- **`.claude/worktrees/**` 下发现的同名文件（`sliceJob.ts`/`gate2Job.ts`/`web/README.md` 等多份重复路径）已确认是 git worktree 机制产生的镜像副本（同一仓库的并行工作树），不是独立调用点，已从"被谁调用"中排除，仅计入主工作树 `<USER_HOME>/Desktop/3D宠物打印` 下的调用。
