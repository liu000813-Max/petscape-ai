// web/app/api/v1/assets/[id]/download/route.ts —— 资产下载签名 URL（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2。owner 校验 → 短 TTL GET 签名 URL。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getAssetDownloadUrl, NotFoundError } from '@petscape/server/application';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { id: assetId } = await params;
    const { prisma, oss } = getWebServerContext();
    try {
      const result = await getAssetDownloadUrl({
        prisma,
        oss,
        ownerUserId: session.user.id,
        assetId,
      });
      const res = NextResponse.json(result);
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
