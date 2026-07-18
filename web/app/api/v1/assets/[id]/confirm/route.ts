// web/app/api/v1/assets/[id]/confirm/route.ts —— 上传完成确认（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2 验收 3：
//   伪造 key/尺寸不符时 Asset 不进入可用态。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext } from '../../../../../lib/server-context';
import {
  confirmAssetUpload,
  AssetVerificationError,
  NotFoundError,
} from '@petscape/server/application';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getWebAuth().api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id: assetId } = await params;
  let body: { size?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // 空 body 允许（declaredSize 落回 Asset 记录中已声明的 size）。
  }
  const declaredSize = typeof body.size === 'number' ? body.size : undefined;

  const { prisma, oss } = getWebServerContext();
  try {
    const asset = await confirmAssetUpload({
      prisma,
      oss,
      ownerUserId: session.user.id,
      assetId,
      declaredSize,
    });
    return NextResponse.json(asset);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (error instanceof AssetVerificationError) {
      return NextResponse.json({ error: 'verification_failed', detail: error.message }, { status: 409 });
    }
    throw error;
  }
}
