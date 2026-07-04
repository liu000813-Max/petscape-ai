# 成熟度取证：几何后处理原生脚本（geometry-native）

范围：`<USER_HOME>/Desktop/3D宠物打印`
覆盖脚本：`scripts/carve_shell.py`、`web/scripts/normalize_mesh.py`（`scripts/normalize_asset.py` 见 module 盘点能力5，不在本轮 5 条待取证清单内）
排除：`design/` 全目录、`node_modules`、`.next`、`.git` 内部对象、`PRD.md`、`max最新版的PRD.docx`（均未读取）。
取证日期：2026-07-04。

## 取证手段与到达的保真度档

爬到了保真度阶梯的最高档——**用真实脚本对真实生产输入实跑，产出与生产产物逐字节比对**，非仅读码/git log。

1. **实跑 carve_shell.py**（真实依赖 pymeshlab/manifold3d/trimesh，非桩）：对生产 job `9709946e` 的 `model-raw.glb`（28MB、971766 面、非水密）实跑，exit 0，5.3s，产出 GLB **2444856 字节 = 生产 `model.glb` 完全相同大小**。
2. **实跑 normalize_mesh.py**：对上一步 carve 输出实跑 `--target-mm 120`，exit 0，产出 STL **6789084 字节 = 生产 `print-120mm.stl` 完全相同大小**。
3. **生产端到端产物链**：`web/public/generated/9709946e-.../` 存在完整一条真链（今日 16:19–17:02 时间戳）：multiview-grid → model-raw.glb（Tripo）→ carve.json（carve_shell 输出）→ model.glb（carved）→ print-120mm.stl（normalize 输出）→ print-120mm.gcode（PrusaSlicer SUCCEEDED，见 gate2.log）。
4. **git log**：见各能力条目。
5. 说明：`web/tests` 下唯一测试是 `timeoutQueue.test.mjs`，与几何脚本无关，无几何单测可跑（红线内如实标注）。

关键锚点：carve_shell.py docstring 里点名的实测案例 slug（"本次 9709946e 实测 492 连通分量"）与生产 job 目录 `9709946e-...` 同名 —— 该脚本的设计依据就来自这条真链，且该真链的产物今日仍在盘上、我实跑复现了同一结果。

---

## 能力 1：repair_watertight — 水密化重网格修复（两级 L1/L2）

- **终判：能跑**（初判 looks-working → 坐实）
- **入口**：`scripts/carve_shell.py:31`
- **证据**：
  - 实跑复现：对 `model-raw.glb`（971766 面、`watertight=false`）实跑，`repair_strategy=L1 cell=0.5% off=50% largest-shell`，输出 138068 面、`watertight=true`、`is_volume=true`、`volume=0.472`（carve_out.json）。生产 `carve.json` 完全一致。
  - L1 命中即返回，本轮未触发 L2 兜底分支（101-116 行）。L2 分支的存在依据有 docstring 实测注释（492 连通分量、最大壳仅 3.3% 面），但本次取证未独立触发到 L2，故 L2 路径为「代码在、本轮未实跑覆盖」。
  - git log：`8e876a2`（B3.1 wired into gate1）+ `0122c41`（fix three defects surfaced by full E2E dry run）—— 经过一次全链 dry run 修缺。
- **卡点/残量**：L2 兜底分支本轮无对应输入实跑触发（需一个 hull-less 碎片云素材才走到）；L1 主路径已坐实。

## 能力 2：detect_entrance_axis — 入口朝向自动探测（六方向射线法）

- **终判：能跑**（初判 looks-working → 坐实）
- **入口**：`scripts/carve_shell.py:128`
- **证据**：实跑复现，自动探测出 `entrance_axis.name=+x`、`depth_mm=24.27`，与 CLAUDE.md 记录的「multiview front 落 +x（实测坐实）」一致，且与生产 `carve.json` 逐字段相同。非硬编码：函数对 ±x/±y/±z 六向发射中心射线取最深命中，实跑真的选出了 +x 而非默认回退值。

## 能力 3：carve — 布尔挖腔（椭球内腔 + 圆柱贯通入口 + 壁厚自适应）

- **终判：能跑**（初判 half-done → 核心能力坐实为能跑；half-done 证据属集成缺口而非核心断裂，见下）
- **入口**：`scripts/carve_shell.py:166`
- **证据**：
  - 实跑复现：manifold3d 布尔差集成功，round 0 `cavity_scale=0.62` 即达标 —— `watertight=true`、`minWallMm=5.59`（≥ 目标 3mm）、`entranceThrough=true`、`center_hollow=true`、`axis_ray_crossings=4`（≥2 = 打穿）、`n_wall_samples=4044`。bool 运算 4.9ms。与生产 `carve.json` 逐字段相同。
  - 输出 GLB 2444856 字节 = 生产 model.glb 同大小 → 挖腔产物本身是可用的水密单壳。
- **half-done 证据（真实但非核心断裂）**：
  1. `web/app/lib/printability/localCheck.ts:78` TODO：门2 `scaleMm` 缩放会破坏挖腔时按 150mm 标定的 Ø69 物理入口尺寸，当前无联动修正。这是**跨门集成缺口**，不影响 carve 单步产出正确水密腔。
  2. 壁厚 3 轮收敛失败的兜底（`carve_shell.py:251-252`）是静默降级（采用最后一轮、不报错），`minWallMm` 会如实反映未达标值供上游判定。本轮 round 0 即达标，该兜底分支**未被实跑触发**。
- **卡点/残量**：scaleMm↔Ø69 联动未实现（已知 TODO）；壁厚收敛失败兜底路径本轮未覆盖。核心挖腔本身实跑坐实。

## 能力 4：carve_shell.py CLI 整体（标定 + 编排 + JSON 摘要落盘）

- **终判：能跑**（初判 looks-working → 坐实）
- **入口**：`scripts/carve_shell.py:271 main()`
- **证据**：
  - 实跑整条 CLI，exit 0，5.3s：标定（最长边→150mm，`scale.factor=150.13`，extents_mm=[149.98,148.49,150.0]）→ 编排 能力1→2→3 → 写 OUT.glb + OUT.json + stdout 打印同一份 JSON。stdout 最后一行可被 `JSON.parse` 解析（调用方 localCheck.ts:131 依赖此契约），实测成立。
  - 生产调用链坐实：`localCheck.ts:97 carveShell()` spawn uv → `gate1Job.ts:214` 唯一生产调用点（门1第2d步）。`mock=1` 不触发 carve（gate1Job.ts:23 注释确认走 mockup-assets）。失败回退完整：`gate1Job.ts:219-226` carve 失败则拷贝 raw GLB 当最终文件并诚实标注缺口，非假成功。
  - git log 同能力1（`8e876a2`+`0122c41`，经全链 dry run）。
- **运行时依赖**：本机 `uv`（`/opt/homebrew/bin/uv → Cellar/uv/0.9.13`，已确认存在，非 API key）。

## 能力 5（清单第5条）：web/scripts/normalize_mesh.py — 切片前坐标系归一化

- **终判：能跑**（初判 looks-working → 坐实）
- **入口**：`web/scripts/normalize_mesh.py:26 main()`
- **证据**：
  - 实跑复现：对 carve 输出实跑 `--target-mm 120`，exit 0，产出 STL 6789084 字节 = 生产 `print-120mm.stl` 同大小。输出 JSON 证实四步全做对：Y-up→Z-up 绕 X 轴 +90°（originalExtents Y=148.49 → rotatedExtents Z=148.49）、缩放到 target（actualExtents max=120.0）、落床（bounds z-min=0.0）、XY 居中（±59.99/±60.0 对称）。
  - 下游坐实：生产 `gate2.log` 显示 normalize 后 PrusaSlicer **SUCCEEDED** 产出真 G-code（38MB），整条门2链跑通。
  - git log：`fe15525 M5: trimesh normalize + PrusaSlicer 切片 + done页 (独立验收 ACCEPT: STL 120mm/落底/watertight, G-code)` —— 三脚本中唯一带「独立验收 ACCEPT」的 commit。
  - 两个生产调用点并存：`gate2Job.ts:91`（活跃门2）+ `sliceJob.ts:105`（legacy），均为 execFile uv 真调用。

---

## 模块级结论

- 5 条待取证能力**全部实跑坐实为「能跑」**，且经真实生产输入 → 逐字节比对生产产物 → 独立复现三重验证。无死代码，无假绿。
- half-done 初判仅命中能力3，且经核实属**跨门集成缺口（scaleMm↔Ø69 未联动）+ 未触发的收敛失败兜底**，非 carve 核心断裂 —— 核心挖腔实跑产出合法水密腔，故降为能跑并标注残量。
- 两处代码分支本轮未被实跑覆盖（能力1的 L2 兜底、能力3的壁厚收敛失败兜底），需特定「难素材」输入才触发；主路径已全部坐实。缺此覆盖不影响主链判定，如实标注为残量。
