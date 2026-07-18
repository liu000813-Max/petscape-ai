# R 线调研报告：模型处理与切片工具链（2026-07-18）

角色：ARCHITECTURE §13 待决策第 4 项的事实调研材料（`docs/plans/p0-batch-1-execution-plan.md` R 线产出之一）；供后续 ADR 草案引用，本文不做决定。来源：external-researcher 只读调研，事实/推断/未知分开标注，许可证逐个核实 LICENSE 原文（Open3D 一条除外，已标注置信度）。

## 结构性事实：业界把这条链拆成两层独立工具

没有一个工具同时做"几何检查修复"+"切片"。几何层（trimesh/pymeshlab 等）只处理网格拓扑，不产出 G-code；切片层（PrusaSlicer/CuraEngine 等）假定输入已是合理网格，切片失败时报错但通常不做深度修复。两层需要串联管道，这是普遍实践而非本项目特例。

## 层一：几何检查/修复/归一化

| 工具 | Headless 成熟度 | 非流形/破洞检测修复 | 薄壁/尖角检测 | 内存量级 | 许可证 | 最近维护 |
|---|---|---|---|---|---|---|
| trimesh | 纯 Python 库，天然 headless | 有（fill_holes 基于 fan 算法，非凸洞效果可能差；fix_normals/fix_winding） | 无原生薄壁分析 | 轻量 | **MIT** | 活跃（5.0.0rc1 迭代中） |
| pymeshlab (MeshLab) | 2020.12 起官方主推 headless 路径 | 有，功能全面（MeshLab filter 全集） | 有部分相关 filter | 中等（C++ 后端） | **GPL 3.0** | 活跃 |
| pymeshfix (MeshFix) | Python wrapper，headless | 专精：输出单一 watertight mesh | 无 | 轻量 | **GPL 家族**（原作者另有商业授权路径，条款未核实） | 活跃（pyvista 生态） |
| manifold3d | Python 绑定，可与 trimesh 互操作 | manifold 布尔运算保证；非通用修复工具（项目自述） | 无 | TBB 并行 | **Apache 2.0**（LICENSE 原文核实） | 活跃 |
| Open3D | Python 库 | 有 is_watertight() 等检测，未见强力自动修复 | 未见 | 未查得 | MIT（**未逐字核实，置信度低**） | — |
| admesh | 纯 CLI + C 库 | 有：连接邻近 facet、补洞、修法线、去退化 facet | 无 | 极轻量 | **GPLv2+**（已核实） | 维护中，频率低 |
| Blender headless | `--background` 官方支持 | 有（BMesh 工具集，需脚本调用） | 有部分 | 偏重；批处理有内存不完全释放的已知问题 | GPL 家族 | 活跃 |

许可证要点：MIT/Apache（trimesh、manifold3d）服务端商用无 copyleft 义务；GPL 类"服务端内部调用不分发通常不触发开源义务"是主流解读但**属推断**（未查得针对子进程调用场景的权威意见）；几何层无 AGPL。

## 层二：切片与 G-code

| 工具 | CLI 成熟度 | 时长/重量估算 | 内存（Linux x86_64） | 许可证 | 最近 release |
|---|---|---|---|---|---|
| PrusaSlicer CLI | 成熟，G-code 含结构化注释 | 可行：解析 G-code 注释（"total filament used [g]" + Time Estimator），无独立 JSON 输出 | **官方最低 4GB，推荐 8GB+** | **AGPLv3** | 2.9.6，2026-06-25 |
| CuraEngine | 成熟，纯 C++ console app | 未查得独立结构化输出细节 | 唯一实测数据点为桌面场景 ~2.6GB；纯 CLI 场景未查得，需实测 | **AGPLv3**（注意：Cura 主程序 LGPLv3+，引擎单独 AGPL） | 2.7.0，2026-03-04 |
| BambuStudio CLI | 有 CLI，社区认知度低 | 未查得 | 未查得 | **AGPLv3** | 未核实 |
| OrcaSlicer CLI | 成熟；`--pipe` 输出 newline-delimited JSON 实时进度（相对结构化，优于注释解析）；社区 cookbook 提示"文档稀薄、部分坑静默失败" | 经 --pipe/3mf 路径 | 未查得 | **AGPL-3.0**（继承 PrusaSlicer 血统；2026-05 BambuLab 与社区 fork 发生过 AGPL cease-and-desist 纠纷，许可证链实践中被严肃对待） | 活跃 |
| Kiri:Moto | Node.js CLI + Engine API | 未查得细节 | Node 生态，理论上特征不同，未量化 | **MIT**（唯一宽松许可证切片方案，已核实） | 4.7.1，2026-06-22 |

**低内存关键发现**：PrusaSlicer 官方最低 4GB → **ECS 1.6GB 上明显不可行**；其余切片器 CLI 场景内存均无权威数字，需实测。业界低内存通行形态是把切片拆为独立可伸缩的执行单元（与主服务解耦），非同进程内嵌（一般架构模式，推断级）。

## 外部服务路线

| 平台 | 能力边界 | 商务门槛 |
|---|---|---|
| Shapeways API | 上传 + 即时可打印性检查 + 订单管理 + 材料库；报价/时长估算 API 未查得 | API 免费，每笔交易 5% 手续费 |
| Slant3D API | 订单管理、打印全流程跟踪；报价/检查机制未能核实（文档抓取受限） | 需申请 API key |
| Xometry | AI 报价秒级返回（CAD 上传） | 未查得公开开发者 API 入口 |
| Craftcloud (All3DP) | 180+ 制造伙伴比价聚合 | 未查得开发者 API |
| **嘉立创3D打印 / 三维猴（国内）** | STL/STP/OBJ/3MF 上传、一键在线报价、SLA/SLS/SLM/FDM/MJF 多工艺、24h 自动化生产 | **是否开放 API 未查得**——页面是终端用户 Web 下单界面，程序化对接需直接联系商务核实 |

## 未知（需后续动作才能闭合）

1. CuraEngine/BambuStudio/OrcaSlicer 纯 CLI 单模型场景的内存峰值——需实测（tracer 探针级任务）。
2. GPL 工具"仅服务端调用"的义务边界——建议采用前法务确认。
3. 国内代工平台（嘉立创等）是否有可程序化 API——需商务询问（与开放问题②"第一单履约方式"直接相关）。
4. Open3D 许可证、admesh 最近 release 日期——未逐字核实。
5. GitHub Releases 二进制在大陆的实际下载可行性——通用共识是"慢、用镜像"，无针对性实测。

## 推断（依据标注，非事实）

- 几何层与切片层作为两个独立进程/服务边界时，GPL/AGPL 风险可被架构性隔离在切片层内部；几何层选 MIT/Apache（trimesh、manifold3d）在混合许可证约束下最自由。
- AGPL 切片器"调用未修改官方二进制作为内部子进程、不对外暴露定制版"通常被认为风险较低——常规条款理解，非法律意见。

## 关键来源

trimesh.repair 文档 / trimesh LICENSE；PyMeshLab GitHub；pymeshfix LICENSE；manifold3d GitHub（LICENSE 原文）；admesh GitHub + CLI 文档；PrusaSlicer GitHub Releases / LICENSE / 最低系统要求（help.prusa3d.com article 305250）/ issue #13038；CuraEngine GitHub + Ultimaker 社区 AGPL→LGPL 讨论帖；OrcaSlicer discussion #8593；BambuLab AGPL 纠纷（HN item 48175820）；BambuStudio LICENSE + Command Line Usage wiki；Kiri:Moto grid-apps GitHub；Shapeways Developer Portal；Slant3D API 页；嘉立创3D打印官网（jlc-3dp.cn）。
