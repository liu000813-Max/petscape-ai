// web/app/api/v1/projects/[id]/assets/route.ts —— 请求资产上传（WP-3.2）+ 列出项目资产（WP-G2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2；docs/plans/g-line-execution-plan.md WP-G2。
// POST：session 鉴权 → 契约校验 body（filename/mime/size，无 kind——QA 修复：
//   kind 不是客户端可控字段，本路由固定传 'upload_raw'）→ 建 pending Asset →
//   签发短 TTL PUT 签名 URL。
// GET：session 鉴权 → 列出该项目下当前用户 available 资产 + 短 TTL 下载签名 URL
//   （WP-G2「重启后图仍可见」：内存态清零后，landing 靠 assetId 持久引用 + 按需
//   签发的下载 URL 恢复图片可见性，不依赖进程内存缓存的 URL 字符串）。
// 项目必须属于当前用户，否则 404（requestAssetUpload/listProjectAssets 内部走 assertOwner）。
import { NextResponse } from 'next/server';
import { getWebAuth } from '../../../../../lib/auth';
import { getWebServerContext, withApiLogging } from '../../../../../lib/server-context';
import { requestAssetUpload, listProjectAssets, NotFoundError } from '@petscape/server/application';
import {
  CreateAssetUploadRequestSchema,
  CreateAssetUploadResponseSchema,
  ListProjectAssetsResponseSchema,
} from '@petscape/server/contracts/assets';
import { assetApiError, invalidAssetRequest, toAssetResponse } from '../../../../../lib/asset-api';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return assetApiError(401, { error: 'unauthorized' });

    const { id: projectId } = await params;
    const { prisma, oss } = getWebServerContext();
    try {
      const assets = await listProjectAssets({
        prisma,
        oss,
        ownerUserId: session.user.id,
        projectId,
      });
      const body = ListProjectAssetsResponseSchema.parse({
        assets: assets.map((asset) => ({
          ...toAssetResponse(asset),
          downloadUrl: asset.downloadUrl,
        })),
      });
      const res = NextResponse.json(body);
      return Object.assign(res, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return assetApiError(404, { error: 'not_found' }, session.user.id);
      throw error;
    }
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiLogging(req, async () => {
    const session = await getWebAuth().api.getSession({ headers: req.headers });
    if (!session) return assetApiError(401, { error: 'unauthorized' });

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return assetApiError(400, { error: 'invalid_json' }, session.user.id);
    }
    const request = CreateAssetUploadRequestSchema.safeParse(json);
    if (!request.success) return invalidAssetRequest(request.error, session.user.id);

    const { id: projectId } = await params;
    const { prisma, oss } = getWebServerContext();
    try {
      // kind 不接受客户端输入（QA 修复：g-line §一 G0a"客户端不得注入产物字段"）。
      // 本路由服务于 landing 宠物照/环境照上传场景，固定为 upload_raw；
      // requestAssetUpload 内部另有 allowlist 兜底（双重防线）。
      const result = await requestAssetUpload({
        prisma,
        oss,
        ownerUserId: session.user.id,
        projectId,
        filename: request.data.filename,
        mime: request.data.mime,
        size: request.data.size,
        kind: 'upload_raw',
      });
      const body = CreateAssetUploadResponseSchema.parse({
        asset: toAssetResponse(result.asset),
        uploadUrl: result.uploadUrl,
        expiresInSeconds: result.expiresInSeconds,
      });
      const res = NextResponse.json(body, { status: 201 });
      return Object.assign(res, { _loggedUserId: session.user.id });
    } catch (error) {
      if (error instanceof NotFoundError) return assetApiError(404, { error: 'not_found' }, session.user.id);
      throw error;
    }
  });
}
