// web/app/api/v1/projects/[id]/assets/route.ts —— 请求资产上传（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2。
// POST：session 鉴权 → 建 pending Asset → 签发短 TTL PUT 签名 URL。
// 项目必须属于当前用户，否则 404（requestAssetUpload 内部走 assertOwner）。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { requestAssetUpload, NotFoundError } from '@petscape/server/application';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { id: projectId } = await params;
    let body: { filename?: unknown; mime?: unknown; size?: unknown; kind?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 });
    }

    const filename = typeof body.filename === 'string' ? body.filename : undefined;
    const mime = typeof body.mime === 'string' ? body.mime : undefined;
    const size = typeof body.size === 'number' ? body.size : undefined;
    const kind = typeof body.kind === 'string' ? body.kind : undefined;

    if (!filename || !mime || size === undefined) {
      const res = NextResponse.json(
        { error: 'invalid_body', detail: 'filename, mime, size 均为必填' },
        { status: 400 },
      );
      return Object.assign(res, { _loggedUserId: session.user.id });
    }

    const { prisma, oss } = getWebServerContext();
    try {
      const result = await requestAssetUpload({
        prisma,
        oss,
        ownerUserId: session.user.id,
        projectId,
        filename,
        mime,
        size,
        kind,
      });
      const res = NextResponse.json(result, { status: 201 });
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
