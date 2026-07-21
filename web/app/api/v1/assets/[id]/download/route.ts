// web/app/api/v1/assets/[id]/download/route.ts —— 资产下载签名 URL（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2。owner 校验 → 短 TTL GET 签名 URL。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { getAssetDownloadUrl, NotFoundError } from '@petscape/server/application';
import { AssetDownloadResponseSchema } from '@petscape/server/contracts/assets';
import { assetApiError, toAssetResponse } from '../../../../../lib/asset-api';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return assetApiError(401, { error: 'unauthorized' });

    const { id: assetId } = await params;
    const { prisma, oss } = getWebServerContext();
    try {
      const result = await getAssetDownloadUrl({
        prisma,
        oss,
        ownerUserId: session.user.id,
        assetId,
      });
      const body = AssetDownloadResponseSchema.parse({
        asset: toAssetResponse(result.asset),
        downloadUrl: result.downloadUrl,
        expiresInSeconds: result.expiresInSeconds,
      });
      const res = NextResponse.json(body);
      return Object.assign(res, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return assetApiError(404, { error: 'not_found' }, session.user.id);
      throw error;
    }
  });
}
