# 成熟度取证 — 数据存储层 (web/app/lib/store/**, web/app/lib/types/**)

取证日期：2026-07-04
取证方式：真源码执行验证（Node 24 `--experimental-strip-types` 直接 import 真实源文件，无 mock、无桩、无外部 API）+ 全量 caller grep + git log。
红线遵守：未改任何源文件；未调外部 API；未 npm install。harness 落 scratchpad。

## 证据总览

- 该模块两文件均为纯代码（`crypto.randomUUID` + `Date`，无外部依赖），因此全部 7 条能力可实测执行。
- 验证 harness：`/private/tmp/.../scratchpad/verify-store.mjs`，直接 `import('web/app/lib/store/projects.ts')` 与 `types/project.ts`，6 组断言全 PASS。
- 无专用单测（`web/tests/` 仅 `timeoutQueue.test.mjs`，不触及本模块）。已跑现有测试：1 pass，确认工程可运行。
- git：两文件最后实质改动均在 `a58e44e feat: PetProfile brief semantics + dual-mode scene generation (B1+B2)`（brief 字段语义扩展）；types 还经 `d94f9ae` T3 门1门2 竖切引入 Model3dJob/SliceJob/ModelConfig。均是竖切 feat commit，非孤儿/占位。
- 全部 caller grep 坐实：11 个 API 路由 + 2 个 job 文件真实 import 并调用，无死引用。

## 逐能力终判

### 1. projects 单例 Map + 全局热重载保活 — 能跑
`projects.ts:5-11`。实测：`globalThis.__petscapeProjects` 是 Map，导出的 `projects` === 该全局实例；重复 import 返回同一 Map 实例（global 回退机制生效）。
残量诚实标注：harness 验证的是「global 回退机制」本身（重 import 同实例），**未**在真实 Next.js dev HMR 下坐实跨热重载不丢——但该机制正是社区标准 HMR-safe 单例写法（注释亦引用同仓 sessions.ts 同模式），机制层已坐实。判「能跑」。

### 2. createProject() — 能跑
`projects.ts:17-31`。实测：产出 uuid v4 id（正则匹配通过）、userState=briefing、brief={species:'',taboos:[],traits:[]}、canvasItems=[]、generating=false、createdAt===updatedAt，且写入 Map（`projects.has(id)` 真）。caller：`api/project/route.ts:9`。

### 3. getProject(id) — 能跑
`projects.ts:33-35`。实测：命中返回同一对象引用；未命中返回 undefined。caller 遍布 10 处路由/job（gate1Job 8 处 getProject、gate2Job 5 处、8 个 [id] 路由），grep 全部坐实。

### 4. touch(project) — 能跑
`projects.ts:37-39`。实测：原地修改 project.updatedAt 至更晚 ISO 串（跨 ms 边界后 notEqual 且单调向前），Map 内仍同引用。26 处调用点 grep 坐实（gate1Job/gate2Job/6 个路由）。

### 5. PetScapeProject 类型契约族 (Brief/CanvasItem/Model3dJob/SliceJob/ModelConfig) — 能跑
`types/project.ts:5-87`。纯类型，无运行时行为——成熟度证据为「被真实消费且随功能演进」：createProject 产出的对象结构与 PetScapeProject 契约一致（实测字段全对齐）；类型被 api/**、gate1Job/gate2Job、page.tsx、ModelStudio.tsx 真实 import 消费（grep 坐实）；git 显示 Model3dJob/SliceJob 随 T3 门1门2 竖切（d94f9ae）引入、Brief 随 B1+B2（a58e44e）扩展，是活契约非死定义。
文档漂移备注（非功能）：`Model3dJob.taskId` 注释写「Meshy image-to-3d」，实际引擎已切 Tripo（见项目 CLAUDE.md）；纯注释漂移，不影响类型正确性。

### 6. defaultModelConfig() — 能跑
`types/project.ts:90-92`。实测：返回 `{scaleMm:120,color:'#C08A5A',material:'PLA 木纹'}`；每次调用返回全新对象（无共享可变默认，避免跨 project 污染）。caller：page.tsx、ModelStudio.tsx、gate1Job:77、gate2/route:23，grep 坐实。

### 7. missingRequiredFields(brief) — 能跑
`types/project.ts:95-101`。实测：全空 → ['物种','宠物尺寸','风格']；三项齐全 → []；空白串（'  '）计为缺失（`?.trim()` 生效）；optional 字段 undefined 不崩、正确判缺。caller：route.ts:15、agent/extract:41、scenes:39、brief:38，grep 坐实。

## 结论

初判 7 条全为 looks-working。取证后**全部坐实为「能跑」**，无一降级。该模块是纯内存状态层，逻辑简单、被 13 个下游文件真实消费、随两次竖切 feat 演进，运行时行为经真源码执行逐条验证通过。唯一非功能瑕疵为 Model3dJob 一处注释残留「Meshy」字样（引擎已切 Tripo），属文档漂移，不影响能力判定。
