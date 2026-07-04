# 集成映射矩阵：V3 前端功能点 × 后端能力

> 主控汇合产物。上游：`research/frontend/AGGREGATE.md`（51 功能点 F01-F51）+ `research/backend/AGGREGATE.md`（74 能力 A/B/C/D/E/F 系）。
> 判定档：**直接可接**（后端能力原样可用）/ **需改造**（能力在、要适配）/ **后端缺失**（要新写或降级处理）/ **前端自足**（无需后端）/ **后端多余**（V3 用不到，不迁移即裁剪）。

## 0. 总判

- V3 是纯静态 SPA（零网络请求），后端是 Next.js 单体（API + lib + Python 子进程）。
- **V3 悬空四链路 × 后端对口情况**：
  | V3 悬空链路 | 后端对口 | 判定 |
  |---|---|---|
  | 照片→3D 可旋转角色（F16/F17/F21） | 门1 子链：fal 抠图(A11)→四视图(A16/A17)→Tripo(A18-A21)→GLB + model-viewer(B16) | **需改造**（去挖腔，加轮询）——demo 最高光点 |
  | vibe 生成效果图（F36-F39） | scenes 生成链：A4 upload(宠物照/笼箱照 kind 完全同构!)+A15 revamp prompt+A10/A11 fal | **直接可接**（改造量最小） |
  | 3D 环境预览（F31） | scene-lab three.js(C1) + normalize_asset.py(C3) | **需改造**（资产缺口：13 模块无 GLB） |
  | 动态报价（F43/F46） | 切片 meta 有真实重量/时长(A9)，但标品模块无切片数据 | **后端缺失**（降级：前端规则计算） |

## 1. 逐条映射

### 1A. 接入后端的功能点（竖切主料）

| F# | 功能点 | 判定 | 对口后端能力 | 改造要点 |
|---|---|---|---|---|
| F16 | 宠物照片上传 | 直接可接 | A4 upload（kind=pet 原生支持） | 前端已有真实 `<input type=file>`，改 POST |
| F21 | "生成 3D 可旋转预览"按钮 | 需改造 | gate1Job 子链 A11+A16+A17+A18-A21（**去掉 A22 挖腔**） | 新 API `POST /api/project/[id]/avatar`；202+轮询（B11 模式）；加 loading/失败态（V3 缺） |
| F17 | 3D 角色预览舞台 | 需改造 | B16 model-viewer | GLB 替换 CSS 2.5D avatar；F19 灰体 bug、F20 旋转滑块随之自然消解（model-viewer 自带轨道控制） |
| F36 | vibe prompt 输入框 | 前端改造 | — | 伪 span 改真 textarea |
| F37 | vibe "生成"按钮 | 直接可接 | A5 scenes 路由 + A15 buildRevampPrompts + A10/A11 | 输入=笼箱照+宠物照+vibe 文字，输出改造后效果图 |
| F38 | 笼箱照/宠物照上传位 | 直接可接 | A4 upload（kind=cage/pet **与后端语义逐字对齐**） | 占位壳补 `<input type=file>` |
| F39 | 效果图三态输出 | 需改造 | A10/A11（改造后图）；3:4 分享图 = 再调 fal 或 CSS 裁切 | 改造前图=用户上传原图，成本为零 |
| F31 | 3D 环境预览画布 | 需改造 | C1 SceneLabViewer + C3 normalize_asset.py | **资产缺口**：13 模块只有白底图无 GLB；降级方案=画布里放已生成的宠物 GLB+现有 scene-lab 资产，诚实标注 |
| F13/F14/F15 | 档案字段（名/物种/体型） | 需改造 | A1 createProject + A3 brief PATCH + B1-B7 store | 字段映射：V3 档案 → PetScapeProject.brief；体型档位可映射 scaleMm |
| F49/F50 | 性格标签/居住环境（前端完全缺失） | 需改造 | brief 已有 species/traits/habitat 族字段（A7 的映射白名单佐证） | 前端补两个输入控件 + 进 brief |
| F22 | 先传照片再生成的前置校验 | 直接可接 | B7 missingRequiredFields 模式 | handleGenerate 前置判 petImageUrl |
| F44 | 习性建议随物种联动 | 需改造 | A15 scenePrompt 的物种习性 hint 数据可抽出为常量表 | 前端接线 selectedSpeciesId → IntroSection |
| F34 | 适配评分（恒 92% 假数据） | 后端缺失 | 无真实评分算法 | 降级：前端规则计算（物种×模块 fit 匹配比例），至少不再恒 92 |
| F43/F46 | 报价面板/生成报价按钮 | 后端缺失（部分） | 切片 meta（A9）有真实重量/时长但仅对已切片模型 | 降级：前端规则计价（模块小计+材料单价表）；宠物模型走真切片数据可作加分项 |
| B22 | `?mock=1` 贯穿开关 | **必迁** | B22 + mockup-assets | demo 当天 API 挂掉的保险，所有新链路都要接 |

### 1B. 前端自足（纯前端接线/顺手修，无需后端）

| F# | 功能点 | 动作 |
|---|---|---|
| F48 | 选物种→推荐配件（数据就绪，App:263 漏传 prop） | 接线，改动极小 |
| F12/F03 | 创建档案 CTA 只开抽屉（文案≠行为） | 改为滚动到创建器 |
| F02 | logo 无点击 | 补回顶部 |
| F01,F04-F11,F18,F23,F25-F30,F32,F33,F35,F40,F41,F45,F47,F51 | 真交互/写死展示均保持原样 | 不动（明天交稿，视觉零回归） |

### 1C. 后端多余（V3 用不到 → 不迁移即自然裁剪，老仓库原地保留）

| 后端能力 | 处置 |
|---|---|
| Legacy 完整链 D1-D16（8 阶段聊天/session/executor/meshyJob/sliceJob/4 agent） | 不迁移 |
| Meshy client E1-E8（终判死代码） | 不迁移 |
| standalone-experiments F1-F10 | 不迁移（决策证据留原仓） |
| tldraw 工作台 UI + 画布标注改图（B12-B14/A6） | 不迁移（V3 无画布标注交互；A6 revise 能力若时间富余可作 vibe 二次修改的隐藏加分项） |
| A7 extract Chat 静默抽取 | 不迁移（V3 是表单式创建器，无 chat UI） |
| 门1 挖腔 A22 / 门2 切片 A9 / STL 下载 B19 | **待拍板**：V3 电商叙事里用户不下载 STL；但"首单挂件"（F45）与真报价可用它撑"能真打印"的故事 |

## 2. 集成架构（拍板项 1）

**方案 A（推荐）：V3 页面移植进 Next.js 单体，落地 PetScape-final/**
- V3 只有 main.jsx(266 行)+styles.css，React→React 移植成本低；后端全部 lib/API 原地可用，无 CORS、单一部署。
- 批次0 顺带把 main.jsx 机械拆为组件文件（视觉零变化）——否则单文件会让后续批次无法并行（都改 main.jsx 必冲突）。
- 风险：styles.css 与后端 Tailwind 共存需隔离（V3 纯 CSS 直接引入即可）；motion/lucide-react 补依赖。

**方案 B：V3 Vite 独立跑 + Next.js 纯作 API（CORS）**
- 保设计师工程原封不动；代价=两个进程、CORS、部署复杂、mock 开关跨域传递别扭。明天交稿不推荐。

## 3. 竖切批次（拍板项 2）

- **批次0（基座，必须先行串行）**：PetScape-final 建 Next.js 骨架 → V3 页面整体移植 + 组件化拆分 → 截图对比验证视觉零回归 → 1B 的纯前端接线顺手修。
- **批次1（S1 宠物 3D 生成）**：F16/F21/F17，照片→Tripo→GLB→model-viewer。demo 最高光。依赖批次0。
- **批次2（S2 vibe 效果图）**：F36-F39，fal 生成链。依赖批次0，与批次1 并行。
- **批次3（S3 环境预览）**：F31 scene-lab 嵌入。依赖批次0，可并行；先确认资产缺口的降级方案。
- **批次4（S4 档案持久化 + S5 真报价 + F44/F34 联动）**：时间富余才做。
- 批次1/2/3 并行前提=批次0 完成组件化拆分；各批次 builder 改各自组件文件 + 各自 API 路由，无共享写入点。

## 4. 用户拍板结果（2026-07-04 晚，全部已决）

1. **集成架构 = 方案 A**：Next.js 单体，落地 PetScape-final/。
2. **交付范围 = 批次 0+1+2+3**；批次4 时间富余才做。
3. **电商环节 = 假闭环**：场景包加"加入预览"按钮联动已选模块；订单条随用户实际进度高亮当前步。
4. **打印能力 = 全量接入含 STL/G-code 下载**；报价面板显示真实重量与打印时长（来自切片 meta）。
5. **挖腔（carve_shell / A22）明确不接**：用户实测有过度挖导致模型残缺的问题。切片链直接吃 Tripo 原始 GLB（normalize → PrusaSlicer），gate1 流程去掉 carve 步骤。代价=实心打印重量偏大，已知取舍。

### 批次划分（终版，含 2026-07-04 晚 grilling 拍板）

- **批次0（串行先行）**：复制老 web/ 为骨架 → 裁剪零依赖孤岛（legacy 页、session API、agents、executor/codexQueue/meshyJob/sliceJob、meshy client、renderScene/cleanItem、sessions store/types）→ V3 页面移植为新首页 + main.jsx 机械拆组件 → 老工作台挪 `/workbench` 留作调试页 → 纯前端接线（F48/F12/F02/F22）→ 截图对比验证视觉零回归。
- **批次A（离线资产，与批次0 并行）**：用老仓库现成四视图管线离线生成 9 个 GLB——4 件装扮（文生图→四视图→Tripo）+ 5 个热门标品模块（白底商品图→四视图→Tripo；选各物种 species.modules 出现频率最高者）。产物+渲染截图落盘，人工挑质量后入库。真调付费 API（已获用户授权）。
- **批次1**：照片→3D 角色 + 制造链下半段。**先风格化再 3D**（fal 把宠物照转"游戏角色/手办风格"立绘，prompt 外置为可调配置，含已选装扮词表与"主体居中、固定站姿"约束；效果不佳回退直喂原图）→ **3 视图**（网格 prompt/像素裁切/Tripo 提交三处从 2×2 四视图改为 3 视图）→ **裁切后独立性自动验证**（尺寸/边缘留白/内容占比启发式，不合格重生成网格图）→ Tripo → GLB。舞台渲染用 **three.js PetViewer**（弃 model-viewer，为挂点与批次3 复用留门）。生成完成后**自动切片**：体型 1-5 档线性映射 scaleMm 80/100/120/140/160，换档 1s 防抖重切；**不挖腔**（gate 链跳过 carve_shell，切原始 GLB）；报价面板显示真实重量/打印时长 + STL/G-code 下载按钮（切片就绪才亮）。loading 做成管线阶段可视化（风格化→三视图→3D 建模→切片报价）。
- **批次1b（增量，批次1 通过后）**：实时 3D 换装——批次A 的装扮 GLB + 包围盒启发式挂点（帽=顶部中心/围巾=上1/3颈带/吊牌=前胸/斗篷=贴背）+ 物种×配件 offset 常量表调参。
- **批次2**：vibe 效果图（F36-F39）。改造前=用户原图直用；改造后=fal revamp（主体居中约束）；分享图=CSS 中心裁切+品牌角标（无重采样、画质无损；构图偏移则后补拖动裁切窗）；创建器已传宠物照自动带入可换。
- **批次3**：3D 环境预览（F31，scene-lab 嵌入，复用 PetViewer 底座；资产=批次A 的 5 模块 GLB + 宠物 GLB，未入库模块显示白底图立牌）+ 电商假闭环（场景包配 modules 子集常量、点击批量入 selectedIds 流经真实数据流；订单条按 state 推导高亮至"确认模型"，后两步保持未达）。
- **批次4（富余才做）**：档案持久化收尾、适配评分规则化（替换恒 92%）、习性面板随物种联动（F44/F34）。
- 批次1/2/3 在批次0 验证通过后并行；批次A 与批次0 并行。

### demo 策略（grilling #4）

双轨编排：现场真实点击"生成"（后台真跑全链 2-4 分钟），期间切换到预生成完毕的第二个项目继续讲装扮/商城/预览，讲完回来第一个项目 3D 已出炉。后端多 project 并存天然支持。`?mock=1` 保留为网络全挂的最后保险丝。

### 文档收敛（grilling #9）

不写新 PRD。三件套：TinyHabitat-PRD.md 原样拷入（愿景层）+ 本文档（工程真相层，做没做/做到哪以此为准）+ 交付 README.md（运行方式/架构图/demo 脚本，收尾时写）。V1/V2 旧 PRD 留老仓库不迁。
