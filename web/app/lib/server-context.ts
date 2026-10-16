// web/app/lib/server-context.ts —— Web 进程侧共享依赖装配胶水层（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2。
//
// 与 web/app/lib/auth/index.ts 同一模式：只读已校验的 WebConfig，调用
// @petscape/server 的 getServerContext() 用例拿到 { prisma, oss }。不包含业务
// 逻辑——Route Handler 是薄层，这里也是薄层。懒初始化，理由同 auth/index.ts
// （避免 next build 静态收集阶段因缺配置提前失败）。
//
// WP-3.5：withApiLogging 是本文件新增的请求上下文胶水——每个 `/api/v1/*`
// Route Handler 的公共入口/出口/错误日志逻辑收在这一处，避免 6 个路由各自
// 重复实现。requestId 由 crypto.randomUUID() 生成（web 侧唯一的关联 ID 来源），
// 经 handler 回调参数下传给路由体，路由体在创建 job 时把它塞进
// `input._requestId`（不改 Job schema），worker 侧执行完成时把同一 requestId
// 写进 completed 日志，从而让一次 API 调用与其触发的任务在日志里可用同一
// 关联 ID grep 串起（WP-3.5 验收 1）。
import { loadWebConfig } from '@petscape/server/infra/config';
import { getServerContext, type ServerContext } from '@petscape/server/application';
import { logInfo, logError } from '@petscape/server/infra/logging';

let cached: ServerContext | undefined;

export function getWebServerContext(): ServerContext {
  if (!cached) {
    cached = getServerContext(loadWebConfig());
  }
  return cached;
}

export interface ApiRequestContext {
  requestId: string;
}

/**
 * 包一层 Route Handler：生成 requestId → 记入口日志 → 调用真正的处理函数
 * （拿到 requestId，可选把 userId 塞进日志/传给下游）→ 记出口日志（含 status/
 * durationMs）→ 处理函数抛错时记错误日志后重新抛出（保留原有 Next.js 错误处理
 * 行为，本层只加日志旁路，不改变响应语义）。
 *
 * userId 由处理函数自行在鉴权后通过返回值的 `userId` 字段回传（在拿到 session
 * 之前无法预知），因此出口日志里的 userId 是"尽力而为"字段：未鉴权失败路径
 * （401 之前）该字段为空。
 */
export async function withApiLogging(
  req: Request,
  handler: (ctx: ApiRequestContext) => Promise<Response & { _loggedUserId?: string }>,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const method = req.method;
  const path = new URL(req.url).pathname;
  const startedAt = Date.now();

  logInfo('api.request.start', { requestId, method, path });

  try {
    const res = await handler({ requestId });
    const durationMs = Date.now() - startedAt;
    logInfo('api.request.end', {
      requestId,
      method,
      path,
      status: res.status,
      durationMs,
      ...(res._loggedUserId ? { userId: res._loggedUserId } : {}),
    });
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logError('api.request.error', { requestId, method, path, durationMs, err });
    throw err;
  }
}
