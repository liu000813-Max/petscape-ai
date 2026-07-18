// web/app/api/auth/[...all]/route.ts —— Better Auth catch-all handler（WP-3.1）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.1。薄层：只挂 handler，不含逻辑。
//
// 不直接用 `toNextJsHandler(auth.handler)`（tracer 的写法）：那要求在模块顶层就
// 拿到 auth 实例，而 auth 实例的构造需要 DATABASE_URL 等运行时配置，会在
// `next build` 静态收集页面数据阶段提前执行并因缺少配置而构建失败。这里手写与
// `toNextJsHandler` 等价的最小转发，但把 getWebAuth() 的调用推迟到请求到达时。
import { getWebAuth } from '../../../lib/auth';

async function handle(request: Request): Promise<Response> {
  return getWebAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
