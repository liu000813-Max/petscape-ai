# 3D宠物打印 后端模块地图

范围：`<USER_HOME>/Desktop/3D宠物打印`，排除 `design/`、`node_modules`、`.next`、`.git` 内部对象、PRD 文档正文（仅代码 + git log 作证据）。
生成时间：2026-07-04。证据方式：文件树 + import 关系静态追踪 + git log（design/ 路径改动已剔除）。

## 分片总览

| id | 名称 | 覆盖路径 | 职责 |
|---|---|---|---|
| `api-layer` | API 路由层 | `web/app/api/**` | Next.js route handler：session/project/gate1/gate2/scenes/upload 的 HTTP 入口，薄封装，转发给 jobs 层 |
| `job-pipeline` | 任务管线 | `web/app/lib/jobs/**` | 全链路异步编排：Codex 串行队列、超时保护、gate1(3D生成+挖腔)/gate2(切片)/meshy 任务的状态机与后台执行 |
| `llm-agents` | LLM Agent 五件套 | `web/app/lib/agents/**` | 五个职责化 agent（collecting/extract/preview/rendering/selecting），封装 Codex SDK 调用+instructions，供 job-pipeline 调用做自然语言理解与决策 |
| `external-clients` | 外部服务客户端 | `web/app/lib/tripo/**`, `web/app/lib/meshy/**`, `web/app/lib/images/**` | 三方 API 封装：Tripo（图生3D主链）、Meshy（备选3D引擎+printability分析）、fal.ai（生图/改图/抠图/多视图裁切） |
| `data-store` | 数据存储层 | `web/app/lib/store/**`, `web/app/lib/types/**` | 进程内内存单例存储（projects/sessions），Next dev 热重载不丢；类型定义为 project/session 的 DTO 契约 |
| `geometry-native` | 几何后处理原生脚本 | 根 `scripts/*.py`（carve_shell, normalize_asset）+ `web/scripts/normalize_mesh.py` | Python + trimesh/pymeshlab/manifold3d 做水密化、挖腔、坐标系归一化、STL导出；被 job-pipeline 以子进程(uv run)方式调用，是唯一跨越 Node/Python 边界的重计算层 |
| `web-ui` | 前端展示层 | `web/app/page.tsx`, `web/app/legacy/**`, `web/app/components/**`, `web/app/scene-lab/**` | Next.js 页面与组件：主工作台(tldraw画布+ModelStudio)、legacy旧流程页、scene-lab（three.js场景预览/资产合成demo） |
| `standalone-experiments` | 独立实验/原型 | `experiments/**`, `threejs-mouse-spiral-nest/**` | 未被 web 主体 import 的独立验证项目：2D→3D保真度对比矩阵(fidelity-test系列)、Tripo/Meshy选型实验、一个独立 three.js 鼠标螺旋 demo（各自有独立 package.json，与主链路零耦合） |

## 依赖关系草图

```
                         web-ui (page.tsx / components / scene-lab)
                                    │  fetch()
                                    ▼
                         api-layer (app/api/**/route.ts)
                                    │  直接函数调用
                                    ▼
                         job-pipeline (app/lib/jobs/**)
                        ┌───────────┼────────────────┬───────────────┐
                        ▼           ▼                ▼               ▼
                 llm-agents   external-clients   geometry-native  data-store
              (collecting/    (tripo/meshy/       (carve_shell.py    (projects.ts
               selecting/      images-fal)         normalize_mesh.py  sessions.ts,
               rendering/                           via spawn/execFile 内存单例)
               extract/                             + uv run)
               preview)

                standalone-experiments（无箭头——不与上述任何模块产生 import 依赖）
```

### 关键耦合点（git log + import 证据）

- `job-pipeline` 是唯一枢纽：`executor.ts` 同时 import 五个 `llm-agents`、`images/renderScene`、`images/cleanItem`、`meshyJob`、`sliceJob`；`gate1Job.ts` import `printability/localCheck`（内部 spawn 根目录 `scripts/carve_shell.py`）；`sliceJob.ts`/`gate2Job.ts` execFile `web/scripts/normalize_mesh.py`。
- `geometry-native` 横跨两个物理位置但被同一层（job-pipeline）调用：根 `scripts/carve_shell.py`（挖腔，来自 gate1 hybrid-kernel，git `8e876a2`）与 `web/scripts/normalize_mesh.py`（切片前坐标系归一化，Y-up→Z-up）。根 `scripts/normalize_asset.py` 用于 scene-lab 资产入库（一次性烘焙，非 job-pipeline 触发，供 `web-ui` 的 scene-lab 静态资产准备阶段使用）。
- `data-store` 为进程内单例（无数据库），`api-layer` 与 `job-pipeline` 共享同一份内存对象。
- `web-ui` 内 `app/legacy/page.tsx` 是旧版单页流程（早期 M1-M5 里程碑遗留，git 早期 commit `c8f58a5`~`f440a55` 系列），与当前 `app/page.tsx`（tldraw 工作台，B系列 commit）并存，非同一条活跃路径。
- `standalone-experiments` 两个子目录各自有独立 `package.json`/`venv`，未被 `web/` 任何文件 import（已用 grep 交叉验证，唯一命中均为子串误伪：`tripo`/`cropGrid` 撞词，非路径引用）。git log 显示 `experiments/` 的活跃提交集中在 2D→3D 保真度选型阶段（`d4ce862`/`ef9a25d`/`bf06055`），`threejs-mouse-spiral-nest` 仅一条早期 checkpoint 提交，均为选型/预研残留，非生产依赖。

## 分片边界备注（供后续分片盘点使用）

- `api-layer` 与 `job-pipeline` 强耦合但物理分离清晰（route.ts vs lib/jobs），按"API 契约 vs 业务编排"切开，便于分别盘点 HTTP 层薄封装质量与后台任务健壮性（超时/重试/状态机）。
- `llm-agents` 单独成片：五个 agent 结构高度同构（agent.ts + instructions.ts），适合一次性横向盘点 prompt 质量与 Codex SDK 用法一致性。
- `external-clients` 三个三方封装耦合度低（各自独立 client 文件），但因职责同构（都是"发请求-轮询-解析"模式）合并一片，避免碎片化。
- `geometry-native` 是唯一的语言边界（TS→Python），风险特征（子进程失败处理、路径解析、超时）与其余 TS 模块完全不同，必须单独盘点。
- `standalone-experiments` 建议盘点时降低优先级或跳过——非生产代码路径，价值是历史决策证据（fidelity 对比结论），不是待重构对象。
