// web/app/lib/pet-api.ts —— A4 Pet Route Handler 的边界胶水。
// 统一构造公开 DTO、Zod 错误 envelope；不承载领域规则。
import { NextResponse } from 'next/server';
import {
  PetApiErrorSchema,
  PetResponseSchema,
  type PetApiError,
  type PetResponse,
} from '@petscape/server/contracts/pets';
import {
  getAssetDownloadUrl,
  type PetSummary,
  type ServerContext,
} from '@petscape/server/application';

export function petApiError(
  status: number,
  body: PetApiError,
  userId?: string,
): Response & { _loggedUserId?: string } {
  const response = NextResponse.json(PetApiErrorSchema.parse(body), { status });
  return userId ? Object.assign(response, { _loggedUserId: userId }) : response;
}

export function invalidPetRequest(
  error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] },
  userId: string,
) {
  return petApiError(
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

export async function toPetResponse(
  pet: PetSummary,
  ownerUserId: string,
  context: ServerContext,
): Promise<PetResponse> {
  const coverUrl = pet.coverAssetId
    ? (
        await getAssetDownloadUrl({
          prisma: context.prisma,
          oss: context.oss,
          ownerUserId,
          assetId: pet.coverAssetId,
        })
      ).downloadUrl
    : null;

  // response parse 是故意的运行时门禁：应用层或转换代码漂移时在服务端失败，坏 DTO
  // 不会继续流入前端。
  return PetResponseSchema.parse({
    ...pet,
    coverUrl,
    createdAt: pet.createdAt.toISOString(),
    updatedAt: pet.updatedAt.toISOString(),
  });
}
