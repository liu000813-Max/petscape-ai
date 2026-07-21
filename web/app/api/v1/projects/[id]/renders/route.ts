// web/app/api/v1/projects/[id]/renders/route.ts —— vibe 效果图任务创建（WP-G3）。
// spec: docs/plans/g-line-execution-plan.md WP-G3 + §一.3（renders 端点）。
// 薄传输层：session 鉴权 + 契约校验 body + 调用 createVibeRenderJob，不含业务逻辑。
//
// 契约禁止客户端注入产物字段（g-line §一 G0a）：CreateRenderRequestSchema 是
// strictObject，只接受 vibeText/environmentAssetId/petAssetId/idempotencyKey；
// 产物 assetId、ossKey、kind、金额出现在 body 即被 strict 拒绝（400）。状态查询
// 走既有 GET /api/v1/jobs/:id；产物经 GET /api/v1/assets/:id/download 拿签名 URL。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { createVibeRenderJob, getLatestVibeRender, NotFoundError } from '@petscape/server/application';
import {
  CreateRenderRequestSchema,
  CreateRenderResponseSchema,
  LatestRenderResponseSchema,
} from '@petscape/server/contracts/renders';

// GET：项目下最新 vibe_render 展示态（RenderSection 消费）——环境照/产物 assetId +
// 任务状态；前端凭 assetId 走既有 GET /api/v1/assets/:id/download 换签名 URL。
// 项目非本人 → 404（getLatestVibeRender 内部 assertOwner）。
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const { id: projectId } = await params;
    const { prisma } = getWebServerContext();
    try {
      const latest = await getLatestVibeRender({ prisma, ownerUserId: session.user.id, projectId });
      const body = LatestRenderResponseSchema.parse(latest);
      const res = NextResponse.json(body);
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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async ({ requestId }) => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      const res = NextResponse.json({ error: 'invalid_json' }, { status: 400 });
      return Object.assign(res, { _loggedUserId: session.user.id });
    }

    const parsed = CreateRenderRequestSchema.safeParse(json);
    if (!parsed.success) {
      const res = NextResponse.json(
        {
          error: 'invalid_request',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        { status: 400 },
      );
      return Object.assign(res, { _loggedUserId: session.user.id });
    }

    const { id: projectId } = await params;
    const { prisma } = getWebServerContext();
    try {
      const result = await createVibeRenderJob({
        prisma,
        ownerUserId: session.user.id,
        input: {
          projectId,
          vibeText: parsed.data.vibeText,
          environmentAssetId: parsed.data.environmentAssetId,
          petAssetId: parsed.data.petAssetId,
          _requestId: requestId,
        },
        idempotencyKey: parsed.data.idempotencyKey,
      });
      const body = CreateRenderResponseSchema.parse({
        job: { id: result.jobId, type: 'vibe_render', status: result.status },
        created: result.created,
      });
      const res = NextResponse.json(body, { status: result.created ? 201 : 200 });
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
