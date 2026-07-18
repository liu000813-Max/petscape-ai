// worker-api.ts —— Worker 进程专属导出面（WP-3.4）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.4。
//
// 背景（PR #4/#8 裁决链遗留问题）：主入口 src/index.ts 顶部 `import 'server-only'`，
// 这道防线在纯 Node（非 Next/webpack）进程下会直接抛错——`server-only` 的包 exports
// 条件映射只在打包器识别的场景下生效，裸 `node` ESM 加载器不理解该条件，等价于加载了
// 一个执行期抛错的模块。WP-2.2 时已经为此给 infra/config 单独开了 `./infra/config`
// 子路径导出（不经过主入口，不触发 server-only）；worker/src/main.ts 目前也是这样用的。
//
// WP-3.4 的 worker 正式循环需要的面更宽：application 层的 createSampleJob 用例、
// infra/jobs 的 claimNextJob/heartbeat/completeJob/failJob/recoverOrphans/shutdownJobs、
// infra/oss 的 OssStorage、infra/db 的 createPrismaClient、infra/config 的
// loadWorkerConfig/loadCommonConfig。继续让 worker 一个个新增独立子路径
// （`./infra/jobs`、`./infra/oss`...）会导致子路径导出面碎片化增长、与 package.json
// exports 字段脱节维护。
//
// 本次落地方案（二选一：(a) 更宽的不带 server-only 子路径导出面 vs (b)
// `node --conditions=react-server` 覆盖 exports 条件解析）：选 (a)。
// 理由：(b) 需要 worker 启动脚本额外传 `--conditions` flag，且该 flag 语义
// 是"伪装成 react-server 环境"，与 worker 实际上不是任何 React/Next 运行时的
// 事实不符，属于用条件伪装绕过防线而非表达真实边界；一旦仓库将来引入更多
// 依赖 react-server 条件做不同导出的包，worker 会被动进入所有那些分支，
// 影响面不可控。(a) 显式地开一个新入口文件，只重新导出 worker 实际需要的面，
// 边界清楚、可读、可 grep，且沿用本包已确立的"关键子系统各开一个子路径"的既有约定
// （infra/config、infra/db、application 均已如此），是最小改动、最一致的做法。
// 不带 `import 'server-only'`——这正是本文件存在的意义（worker-api 面向裸 Node
// 进程，不面向浏览器打包场景，不需要该防线；防线仍然只守 src/index.ts 这一个
// Web/Client Component 可能误 import 的主入口）。

export {
  loadWorkerConfig,
  loadCommonConfig,
  ConfigValidationError,
} from './infra/config/index.ts';
export type { WorkerConfig, CommonConfig } from './infra/config/index.ts';

export { createPrismaClient } from './infra/db/index.ts';
export type { PrismaClient } from './infra/db/index.ts';

export { OssStorage } from './infra/oss/index.ts';
export type { OssClientOptions, OssObjectHead } from './infra/oss/index.ts';

export {
  claimNextJob,
  heartbeat,
  completeJob,
  failJob,
  recoverOrphans,
  shutdownJobs,
} from './infra/jobs/index.ts';
export type {
  JobRecord,
  JobStatus,
  JobErrorClass,
  ClaimNextJobParams,
  HeartbeatParams,
  CompleteJobParams,
  CompleteJobOutcome,
  FailJobParams,
  FailJobOutcome,
  RecoverOrphansParams,
  RecoverOrphanResult,
  RecoverOrphanAction,
} from './infra/jobs/index.ts';
