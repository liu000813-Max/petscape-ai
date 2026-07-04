# 模块盘点：数据存储层（`web/app/lib/store/**`, `web/app/lib/types/**`）

范围：`<USER_HOME>/Desktop/3D宠物打印/web/app/lib/store/*.ts`、`web/app/lib/types/*.ts`。
排除：`design/` 目录（未读）、`PRD.md`/`max最新版的PRD.docx`（未读，能力以代码为准）。
证据方法：Read 全部 4 个源文件 + 全项目 grep 调用点 + 检查 `.env` key 是否配置（未读明文）。

## 模块职责回顾

进程内内存单例存储（`projects` / `sessions` 两个 `Map`），靠 `globalThis` 挂载躲过 Next dev 热重载清空模块状态；配套的 `types/` 定义两条并行数据模型的 DTO 契约（`PetScapeProject` 服务当前主前端工作台，`Session` 服务冻结的 legacy 聊天页）。存储层本身零外部服务依赖——外部依赖（fal/Tripo/Meshy）都在消费方 `lib/jobs/*` 里，不在这一层。

两套模型并存是产品迭代留下的双轨：`sessions.ts`/`session.ts` 是旧 8 阶段聊天页（`web/app/legacy/page.tsx`）的数据层，已冻结但仍是唯一可跑路径之一；`projects.ts`/`project.ts` 是当前工作台（`web/app/page.tsx`）主线，是本项目 CLAUDE.md 里点名的"真相源"。

---

## 能力清单

### 1. `projects` 单例 Map + 全局热重载保活

- **名称**：project 内存存储单例
- **入口**：`web/app/lib/store/projects.ts:5-11`
- **输入→输出**：无输入；模块 import 即产生一个跨请求持久的 `Map<string, PetScapeProject>`，通过 `globalThis.__petscapeProjects` 挂载防止 Next dev 每次热重载重新执行模块顶层代码清空数据。
- **外部依赖**：无。
- **被谁调用**：`getProject`/`createProject` 内部读写；间接被 11 个 API 路由 + 2 个 job 文件通过 `getProject`/`createProject`/`touch` 使用（见下方逐条）。
- **成熟度**：looks-working（模式与 `sessions.ts` 一致，是项目早前就验证过的手法，CLAUDE.md 有专门记录"沿用 sessions.ts 全局单例模式"）。
- **核心管线**：是——工作台所有状态持久化的地基。

### 2. `createProject()` — 新建工程 + 默认状态初始化

- **名称**：createProject
- **入口**：`web/app/lib/store/projects.ts:17-31`
- **输入→输出**：无输入（仅调用） → 返回新 `PetScapeProject`：`id`(uuid)、`userState:'briefing'`、空 `brief`（`species/taboos/traits` 初始化为空）、空 `canvasItems`、`generating:false`、`createdAt/updatedAt`。同时写入 `projects` Map。
- **外部依赖**：`crypto.randomUUID`（Node 内置，非外部服务）。
- **被谁调用**：`web/app/api/project/route.ts:2` （POST `/api/project`，工程创建入口）。
- **成熟度**：looks-working。
- **核心管线**：是。

### 3. `getProject(id)` — 按 id 取工程

- **名称**：getProject
- **入口**：`web/app/lib/store/projects.ts:33-35`
- **输入→输出**：`id: string` → `PetScapeProject | undefined`。
- **外部依赖**：无。
- **被谁调用**：广泛使用——
  - `web/app/lib/jobs/gate1Job.ts:4`
  - `web/app/lib/jobs/gate2Job.ts:5`
  - `web/app/api/project/[id]/route.ts:2`（GET 工程详情）
  - `web/app/api/project/[id]/gate1/route.ts:2`
  - `web/app/api/project/[id]/gate2/route.ts:2`
  - `web/app/api/project/[id]/scenes/route.ts:5`
  - `web/app/api/project/[id]/scenes/[sceneId]/revise/route.ts:5`
  - `web/app/api/project/[id]/agent/extract/route.ts:2`
  - `web/app/api/project/[id]/brief/route.ts:2`
  - `web/app/api/project/[id]/upload/route.ts:4`
- **成熟度**：looks-working。
- **核心管线**：是。

### 4. `touch(project)` — 更新 updatedAt 时间戳

- **名称**：touch
- **入口**：`web/app/lib/store/projects.ts:37-39`
- **输入→输出**：`project: PetScapeProject`（引用传入，原地修改）→ 无返回值，副作用是把 `project.updatedAt` 设为当前 ISO 时间。
- **外部依赖**：无。
- **被谁调用**：几乎所有写路径都在变更后调用，密集分布于：
  - `web/app/lib/jobs/gate1Job.ts`（10 处：:78,91,136,156,172,178,187,195,206,233,252 — 3D 生成任务每个进度节点都 touch）
  - `web/app/lib/jobs/gate2Job.ts`（6 处：:63,69,90,102,120,141 — 切片任务每个进度节点）
  - `web/app/api/project/[id]/route.ts:27`、`scenes/route.ts:77,132,138`、`scenes/[sceneId]/revise/route.ts:66,109`、`agent/extract/route.ts:37`、`brief/route.ts:36`、`upload/route.ts:58`
- **成熟度**：looks-working——用途单一但覆盖面广，是前端轮询判断"有无新变化"的基础设施（配合 `updatedAt` 字段）。
- **核心管线**：是（支撑轮询/进度展示）。

### 5. `nowIso()`（projects.ts 版本）— ISO 时间戳工具

- **名称**：nowIso（projects 模块内）
- **入口**：`web/app/lib/store/projects.ts:13-15`
- **输入→输出**：无输入 → `string`（`new Date().toISOString()`）。
- **外部依赖**：无。
- **被谁调用**：`createProject`/`touch` 内部使用。
- **成熟度**：looks-working，但**存在 SSOT 漂移**：`sessions.ts:12-14` 有几乎一模一样的重复定义（两处代码完全相同，未共享）。不影响功能正确性，但违反单一真相源——将来若时间戳逻辑要改（如加时区/自定义格式），两处必须同步改，容易漏改一处。轻微技术债，非功能性缺陷。
- **核心管线**：否（工具函数）。

### 6. `sessions` 单例 Map + 全局热重载保活

- **名称**：session 内存存储单例
- **入口**：`web/app/lib/store/sessions.ts:4-10`
- **输入→输出**：同 `projects` 单例，模式一致（`globalThis.__petscapeSessions`）。
- **外部依赖**：无。
- **被谁调用**：`createSession`/`getSession` 内部；间接被 legacy 页 API 路由与 3 个 job 文件使用。
- **成熟度**：looks-working。
- **核心管线**：否——服务对象是 `web/app/legacy/page.tsx`（CLAUDE.md 明确标注"旧 8 阶段聊天页……保留可访问但已冻结"），非当前产品主线；但代码路径本身完整可跑，不是 dead code。

### 7. `makeMessage(...)` — 构造聊天消息对象

- **名称**：makeMessage
- **入口**：`web/app/lib/store/sessions.ts:16-18`
- **输入→输出**：`(role, text?, imagePath?, modelPath?, sliceResult?)` → `ChatMessage`（补全 `id`(uuid) 和 `createdAt`）。
- **外部依赖**：`crypto.randomUUID`。
- **被谁调用**：高频，遍布 legacy 聊天流程的 job 执行器——
  - `web/app/lib/jobs/executor.ts`（约 18 处调用，:23,28,39,55,63,75,89,99,105,111,121,126,134,142,147,166,177,181,210,226）
  - `web/app/lib/jobs/sliceJob.ts:134,144,152`
  - `web/app/lib/jobs/meshyJob.ts:48,57,147`
  - `web/app/api/session/[id]/message/route.ts:58`
- **成熟度**：looks-working——是 legacy 聊天页消息流的核心构造器，逻辑完整、覆盖每个 stage 的回复文案。
- **核心管线**：否（legacy 专属，不在当前产品主线，但内部自洽、非半成品）。

### 8. `createSession()` — 新建会话 + 欢迎消息

- **名称**：createSession
- **入口**：`web/app/lib/store/sessions.ts:20-38`
- **输入→输出**：无输入 → 新 `Session`：`stage:'collecting'`、预置一条 assistant 欢迎消息（引导用户填物种/尺寸/风格或传照片）、空 `brief.species`、空 `constraints`、`renderRounds:0`、空 `sceneImages`。
- **外部依赖**：无。
- **被谁调用**：`web/app/api/session/route.ts:2`（POST `/api/session`）。
- **成熟度**：looks-working。
- **核心管线**：否（legacy 专属）。

### 9. `getSession(id)` — 按 id 取会话

- **名称**：getSession
- **入口**：`web/app/lib/store/sessions.ts:40-42`
- **输入→输出**：`id: string` → `Session | undefined`。
- **外部依赖**：无。
- **被谁调用**：`web/app/lib/jobs/sliceJob.ts:5`、`web/app/lib/jobs/executor.ts:2`、`web/app/lib/jobs/meshyJob.ts:3`、`web/app/api/session/[id]/route.ts:3`、`web/app/api/session/[id]/message/route.ts:6`。
- **成熟度**：looks-working。
- **核心管线**：否（legacy 专属）。

### 10. `PetScapeProject` 类型契约（含 `Brief`/`CanvasItem`/`Model3dJob`/`SliceJob`/`ModelConfig`）

- **名称**：PetScapeProject DTO 族
- **入口**：`web/app/lib/types/project.ts:5-87`
- **输入→输出**：纯类型定义，无运行时行为；描述工作台的完整状态形状：`userState`（briefing/designing2d/tuning3d 三段）、`brief`（物种/尺寸/风格/禁忌/性格/照片等）、`canvasItems`（画布真相源，含 scene2d/item2d/model3d 三种卡片）、`canvasSnapshot`（仅视图层布局，已在 `web/app/page.tsx:160,518` 和 `api/project/[id]/route.ts:19-26` 验证为真正只存位置/相机、未被误用为第二内容真相源，符合 CLAUDE.md 约束）、`model3d`/`modelConfig`/`slice`（门1/门2 状态）。
- **外部依赖**：字段注释里点名 Tripo（`taskId: // 3D 引擎任务 id（Meshy image-to-3d）` 注释文字写的是 Meshy，但根据 CLAUDE.md 当前主链引擎已切换为 **Tripo** `multiview_to_model`——**此处存在字段注释与实际引擎不一致的文档漂移**，字段本身仍在用，功能不受影响，仅注释文字过期）。Key 是否配置见下方"外部服务配置"节。
- **被谁调用**：全项目类型引用面极广，`api/project/**`、`lib/jobs/gate1Job.ts`、`lib/jobs/gate2Job.ts`、`web/app/page.tsx`、`web/app/components/ModelStudio.tsx` 等。
- **成熟度**：looks-working。
- **核心管线**：是。

### 11. `defaultModelConfig()` — 门2前默认调参值

- **名称**：defaultModelConfig
- **入口**：`web/app/lib/types/project.ts:90-92`
- **输入→输出**：无输入 → `{ scaleMm:120, color:'#C08A5A', material:'PLA 木纹' }`。
- **外部依赖**：无。
- **被谁调用**：`web/app/page.tsx:6,33`、`web/app/components/ModelStudio.tsx:5,40`、`web/app/lib/jobs/gate1Job.ts:6,77`、`web/app/api/project/[id]/gate2/route.ts:3,23`——前后端都用同一份默认值，未各自硬编码重复常量，符合 SSOT。
- **成熟度**：looks-working。
- **核心管线**：是（3D 预览调参链路的默认落点）。

### 12. `missingRequiredFields(brief)` — 必填三项校验

- **名称**：missingRequiredFields
- **入口**：`web/app/lib/types/project.ts:95-101`
- **输入→输出**：`Brief` → `string[]`（缺失字段的中文名列表：物种/宠物尺寸/风格）。
- **外部依赖**：无。
- **被谁调用**：`web/app/api/project/[id]/route.ts:15`（GET 详情附带 `missing`）、`scenes/route.ts:39`（生图前置校验）、`agent/extract/route.ts:41`、`brief/route.ts:38`——四处调用点全部一致复用同一校验函数，未各自重写校验逻辑，SSOT 良好。
- **成熟度**：looks-working。
- **核心管线**：是（生图前置闸门）。

### 13. `Session` 类型契约（含 `Stage`/`ChatMessage`/`PendingJob`/各 Agent Result 类型）

- **名称**：Session DTO 族
- **入口**：`web/app/lib/types/session.ts:1-92`
- **输入→输出**：纯类型定义；描述 legacy 8 阶段聊天页状态：`stage`（8 段状态机）、`pendingJob`（任务队列状态，含 `queuePosition` 由 API 层动态附加）、`messages`、`brief`、`meshy`/`slice` 结果、以及 4 个 Agent 输出契约（`CollectingAgentResult`/`RenderingAgentResult`/`SelectingAgentResult`/`PreviewAgentResult`）。
- **外部依赖**：注释点名 Meshy（`meshy?: { taskId... }` 对应 legacy 页仍走 Meshy 而非 Tripo——这是产品分叉后的历史正确状态，legacy 页本就是旧管线，未随主链切换而改，不算漂移）。
- **被谁调用**：`web/app/legacy/page.tsx` 全量消费；`lib/jobs/executor.ts`/`sliceJob.ts`/`meshyJob.ts`、`api/session/**` 路由。
- **成熟度**：looks-working（legacy 专属，完整可跑，非半成品）。
- **核心管线**：否。

---

## 外部服务配置核查（仅核查 key 是否配置，未读明文）

存储层本身零外部依赖；以下是消费方（jobs/ 层）依赖、在 `.env` 中核查到的配置状态，供交叉参考：

| 服务 | env key | 是否配置 |
|---|---|---|
| fal.ai（生图主通道） | `FAL_KEY` | 已配置（非空，69 字符） |
| Tripo（3D 主链引擎） | `TRIPO_API_KEY` | 已配置（非空，47 字符） |
| Meshy（备选/legacy 引擎） | `MESHY_API_KEY` | 已配置（非空，40 字符） |

`.env` 位置：`<USER_HOME>/Desktop/3D宠物打印/.env`（项目根，未入库，CLAUDE.md 已注明）。

---

## TODO/FIXME/死代码核查结论

对 `web/app/lib/store/**` 和 `web/app/lib/types/**` 全文 grep `TODO|FIXME|XXX`：**零命中**。未发现被注释掉的调用、永远为 false 的 feature flag，或声明未实现的字段。本层 13 条能力全部在运行时代码中被实际引用（无 orphan），成熟度判定均为 looks-working。

发现的两处非功能性漂移（均已在对应条目标注，不影响运行）：
1. `nowIso()` 在 `projects.ts:13-15` 与 `sessions.ts:12-14` 重复定义（SSOT 违反，纯技术债）。
2. `Model3dJob.taskId` 字段注释（`project.ts:36`）文字写"Meshy image-to-3d"，但当前主链已切换 Tripo（CLAUDE.md 定案），字段本身仍在用、逻辑无误，仅注释文案过期。

## Git 成熟度佐证

`git log --oneline -- web/app/lib/store web/app/lib/types`（排除 design/ 路径改动）显示两套模型历经 M1→M5（legacy 聊天页 8 阶段管线，独立验收 ACCEPT 记录完整）到 T1/T3（工作台重构，tracer-bullet + gate1→3D→gate2 竖切）再到 B1/B2（PetProfile brief 语义 + 双模式生图），是持续演进而非一次性草稿，佐证 looks-working 判定。
