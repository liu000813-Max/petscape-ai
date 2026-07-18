// web/app/lib/server-context.ts —— Web 进程侧共享依赖装配胶水层（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2。
//
// 与 web/app/lib/auth/index.ts 同一模式：只读已校验的 WebConfig，调用
// @petscape/server 的 getServerContext() 用例拿到 { prisma, oss }。不包含业务
// 逻辑——Route Handler 是薄层，这里也是薄层。懒初始化，理由同 auth/index.ts
// （避免 next build 静态收集阶段因缺配置提前失败）。
import { loadWebConfig } from '@petscape/server/infra/config';
import { getServerContext, type ServerContext } from '@petscape/server/application';

let cached: ServerContext | undefined;

export function getWebServerContext(): ServerContext {
  if (!cached) {
    cached = getServerContext(loadWebConfig());
  }
  return cached;
}
