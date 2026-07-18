// infra/config/ —— common/web/worker 三个进程级配置的统一入口（WP-2.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-2.2。
//
// 这是本仓库中唯一允许读取 process.env 的模块（其余模块由 lint 边界规则拦截，
// 见 packages/server/eslint.config.mjs 与 web/eslint.config.mjs 的 baseline 豁免清单）。
// 各进程入口只应调用 loadWebConfig() / loadWorkerConfig()，拿到已校验的配置对象消费，
// 不应自行读取 process.env。
//
// 本地开发约定：`node --env-file=../.env` 指向仓库根目录 `.env`（进程工作目录在
// web/ 或 worker/ 内时，相对路径写作 `../.env`）；部署环境由 Compose 直接注入环境变量，
// 不依赖 --env-file。worker/package.json 的 dev/start 脚本已按此约定接线，见该文件。
//
// Web 侧现状与迁移路径：`web/` 目前由 Next.js dev/build 自带的 .env 加载机制注入
// process.env（Next 在 web/ 目录内查找 .env*，本仓库的 .env 在仓库根、web/ 上一级，
// 不在 Next 默认搜索路径内——这也是现有 4 个散点文件手读 `../.env` 的原因，见
// CLAUDE.md 与 web/eslint.config.mjs 的 PROCESS_ENV_BASELINE）。本包不改变这一现状：
// Next 的 env 注入不经过、也不会覆盖本统一配置入口。迁移路径是 Phase C 收编那 4 个
// 散点文件时，让它们改为调用 loadWebConfig()（该函数默认读 process.env，只要 Next 已
// 把值注入 process.env，loadWebConfig() 就能正确读到，无需额外接线）；在此之前，
// web 侧 Route Handler 若要接入统一配置，可直接 import loadWebConfig 使用，
// 不依赖 --env-file（该 flag 只是 worker 等裸 Node 进程的本地开发便利手段）。

import {
  webConfigSchema,
  workerConfigSchema,
  type WebConfig,
  type WorkerConfig,
} from './schema.ts';

export {
  commonSchema,
  webSchema,
  workerSchema,
  webConfigSchema,
  workerConfigSchema,
} from './schema.ts';
export type {
  CommonConfig,
  WebOnlyConfig,
  WorkerOnlyConfig,
  WebConfig,
  WorkerConfig,
} from './schema.ts';

export class ConfigValidationError extends Error {
  readonly issues: string[];

  constructor(processName: string, issues: string[]) {
    super(
      `[config] ${processName} 配置校验失败，以下键缺失或非法：\n` +
        issues.map((issue) => `  - ${issue}`).join('\n'),
    );
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${key}: ${issue.message}`;
  });
}

/**
 * 校验并返回 Web 进程的配置对象。校验失败时抛出 ConfigValidationError，
 * 错误信息包含全部缺失/非法键名，调用方（进程入口）应任其抛出使进程 fail-fast 退出。
 */
export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const result = webConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError('web', formatIssues(result.error));
  }
  return result.data;
}

/**
 * 校验并返回 Worker 进程的配置对象。校验失败时抛出 ConfigValidationError，
 * 错误信息包含全部缺失/非法键名，调用方（进程入口）应任其抛出使进程 fail-fast 退出。
 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = workerConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError('worker', formatIssues(result.error));
  }
  return result.data;
}
