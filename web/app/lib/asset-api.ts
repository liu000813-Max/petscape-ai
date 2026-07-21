// web/app/lib/asset-api.ts —— v1 Asset Route Handler 的边界胶水（WP-3.2/WP-G2）。
// 统一构造公开 DTO、Zod 错误 envelope；不承载领域规则（同 pet-api.ts 的模式，
// QA 复核后补齐：契约层校验请求/响应，替换手搓 typeof 强转）。
import { NextResponse } from 'next/server';
import {
  AssetApiErrorSchema,
  AssetResponseSchema,
  type AssetApiError,
  type AssetResponse,
} from '@petscape/server/contracts/assets';
import type { AssetSummary } from '@petscape/server/application';

export function assetApiError(
  status: number,
  body: AssetApiError,
  userId?: string,
): Response & { _loggedUserId?: string } {
  const response = NextResponse.json(AssetApiErrorSchema.parse(body), { status });
  return userId ? Object.assign(response, { _loggedUserId: userId }) : response;
}

export function invalidAssetRequest(
  error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] },
  userId: string,
) {
  return assetApiError(
    400,
    {
      error: 'invalid_request',
      issues: error.issues.map((issue) => ({
        path: issue.path.map((part) => (typeof part === 'symbol' ? part.description ?? 'symbol' : part)),
        message: issue.message,
      })),
    },
    userId,
  );
}

/**
 * response parse 是故意的运行时门禁：应用层或转换代码漂移时在服务端失败，坏 DTO
 * 不会继续流入前端。显式挑选公开字段（不 spread 整个 AssetSummary）——ossKey 是
 * 内部字段，绝不应该出现在客户端响应里；AssetResponseSchema 是 strictObject，
 * 多余字段会直接让 parse 失败，逼着这里显式列出契约允许的字段集合。
 */
export function toAssetResponse(asset: AssetSummary): AssetResponse {
  return AssetResponseSchema.parse({
    id: asset.id,
    ownerUserId: asset.ownerUserId,
    projectId: asset.projectId,
    kind: asset.kind,
    mime: asset.mime,
    size: asset.size,
    checksum: asset.checksum,
    status: asset.status,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  });
}
