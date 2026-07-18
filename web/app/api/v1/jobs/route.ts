// web/app/api/v1/jobs/route.ts —— 任务创建（WP-3.4）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.4。薄层：鉴权 + 参数解析 +
// 调用 application 用例，不含业务逻辑。同 WP-3.2 v1/projects 路由的模式。
//
// 当前仅支持样例任务（sample.echo）。业务幂等键由调用方（客户端）传入
// body.idempotencyKey；缺省时用请求内容自身兜底，避免同一浏览器重复点击
// 产生多个任务（幂等键规则见 createSampleJob 的 spec 注释）。
//
// WP-3.5：本路由是 requestId→jobId 关联的落点——把 withApiLogging 生成的
// requestId 写入 job.input._requestId（不改 Job schema），worker 侧执行完成/
// 失败时把同一 requestId 写进日志，从而 API 入口日志与 worker 生命周期日志
// 可用同一关联 ID grep 串起。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../lib/server-context';
import { createSampleJob, NotFoundError } from '@petscape/server/application';

export async function POST(req: Request) {
  return withApiLogging(req, async ({ requestId }) => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    let body: {
      projectId?: unknown;
      text?: unknown;
      sleepMs?: unknown;
      idempotencyKey?: unknown;
    } = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
    const text = typeof body.text === 'string' ? body.text : undefined;
    const sleepMs = typeof body.sleepMs === 'number' ? body.sleepMs : undefined;
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0
        ? body.idempotencyKey
        : undefined;

    if (!projectId || !text || !idempotencyKey) {
      return NextResponse.json(
        { error: 'invalid_body', detail: 'projectId, text, idempotencyKey 均必填' },
        { status: 400 },
      );
    }

    const { prisma } = getWebServerContext();
    try {
      const result = await createSampleJob({
        prisma,
        ownerUserId: session.user.id,
        input: { projectId, text, sleepMs, _requestId: requestId },
        idempotencyKey,
      });
      const res = NextResponse.json(result, { status: result.created ? 201 : 200 });
      return Object.assign(res, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) {
        const res = NextResponse.json({ error: 'not_found' }, { status: 404 });
        return Object.assign(res, { _loggedUserId: session.user.id });
      }
      throw error;
    }
  });
}
