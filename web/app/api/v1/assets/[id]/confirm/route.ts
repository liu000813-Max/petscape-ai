// web/app/api/v1/assets/[id]/confirm/route.ts —— 上传完成确认（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2 验收 3：
//   伪造 key/尺寸不符时 Asset 不进入可用态；QA 修复补充 mime 嗅探不符同样拒绝。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import {
  confirmAssetUpload,
  AssetVerificationError,
  NotFoundError,
} from '@petscape/server/application';
import { ConfirmAssetUploadRequestSchema, AssetResponseSchema } from '@petscape/server/contracts/assets';
import { assetApiError, invalidAssetRequest, toAssetResponse } from '../../../../../lib/asset-api';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return assetApiError(401, { error: 'unauthorized' });

    let json: unknown = {};
    try {
      const text = await req.text();
      json = text ? JSON.parse(text) : {}; // 空 body 允许（declaredSize 落回 Asset 记录中已声明的 size）。
    } catch {
      return assetApiError(400, { error: 'invalid_json' }, session.user.id);
    }
    const request = ConfirmAssetUploadRequestSchema.safeParse(json);
    if (!request.success) return invalidAssetRequest(request.error, session.user.id);

    const { id: assetId } = await params;
    const { prisma, oss } = getWebServerContext();
    try {
      const asset = await confirmAssetUpload({
        prisma,
        oss,
        ownerUserId: session.user.id,
        assetId,
        declaredSize: request.data.size,
      });
      const res = NextResponse.json(AssetResponseSchema.parse(toAssetResponse(asset)));
      return Object.assign(res, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return assetApiError(404, { error: 'not_found' }, session.user.id);
      if (error instanceof AssetVerificationError) {
        return assetApiError(409, { error: 'verification_failed', detail: error.message }, session.user.id);
      }
      throw error;
    }
  });
}
