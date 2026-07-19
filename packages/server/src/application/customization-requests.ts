// WP-C1-1 — 定制申请用例：服务端解析确认记录并冻结不可变提交版本。
import { createHash } from 'node:crypto';
import {
  CreateCustomizationRequestSchema,
  CustomizationRequestResponseSchema,
  type CreateCustomizationRequest,
  type CustomizationRequestResponse,
} from '../contracts/customization-requests.ts';
import { SceneConfirmationCommerceInputSchema } from '../contracts/scene-confirmation-commerce.ts';
import type { PrismaClient } from '../infra/db/index.ts';
import { NotFoundError } from '../domain/index.ts';
import { resolveSandboxSceneConfirmation } from './commerce-estimates.ts';

const PRODUCT_CODE = 'cheese-lounge-bed' as const;
const MATERIAL_NAME = 'PETG 奶酪黄（沙箱）' as const;
const MATERIAL_VERSION = 'petg-cheese-yellow-sandbox-v0' as const;
const RESPONSE_LABEL = '沙箱定制申请（不会产生真实交易）' as const;

export class CustomizationRequestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomizationRequestConflictError';
  }
}

type RequestRecord = {
  id: string;
  ownerUserId: string;
  sceneConfirmation: unknown;
  productCode: string;
  materialName: string;
  materialVersion: string;
  sandboxOnly: boolean;
  contactName: string;
  contactPhone: string;
  usageDescription: string;
  additionalRequirements: string | null;
  status: string;
  requestFingerprint: string;
  supersedesRequestId: string | null;
  submittedAt: Date;
  createdAt: Date;
};

function fingerprint(input: {
  sceneConfirmationId: string;
  contactName: string;
  contactPhone: string;
  usageDescription: string;
  additionalRequirements: string | null;
  supersedesRequestId: string | null;
}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function isErrorCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function toResponse(record: RequestRecord): CustomizationRequestResponse {
  if (
    record.productCode !== PRODUCT_CODE ||
    record.materialName !== MATERIAL_NAME ||
    record.materialVersion !== MATERIAL_VERSION
  ) {
    throw new Error('C1 申请快照的固定商品或材料版本不受支持');
  }
  return CustomizationRequestResponseSchema.parse({
    id: record.id,
    status: record.status,
    sandboxOnly: record.sandboxOnly,
    label: RESPONSE_LABEL,
    productCode: record.productCode,
    materialName: record.materialName,
    materialVersion: record.materialVersion,
    contactName: record.contactName,
    contactPhone: record.contactPhone,
    usageDescription: record.usageDescription,
    additionalRequirements: record.additionalRequirements,
    supersedesRequestId: record.supersedesRequestId,
    sceneConfirmation: SceneConfirmationCommerceInputSchema.parse(record.sceneConfirmation),
    submittedAt: record.submittedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  });
}

async function readIdempotentResult({
  prisma,
  ownerUserId,
  idempotencyKey,
  requestFingerprint,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  idempotencyKey: string;
  requestFingerprint: string;
}) {
  const existing = await prisma.customizationRequest.findUnique({
    where: {
      ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey },
    },
  });
  if (!existing) return null;
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new CustomizationRequestConflictError('同一 idempotencyKey 不得提交不同申请内容');
  }
  return { request: toResponse(existing), created: false as const };
}

export async function createCustomizationRequest({
  prisma,
  ownerUserId,
  input,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  input: CreateCustomizationRequest;
}): Promise<{ request: CustomizationRequestResponse; created: boolean }> {
  const parsed = CreateCustomizationRequestSchema.parse(input);
  const scene = resolveSandboxSceneConfirmation(parsed.sceneConfirmationId);
  if (scene.eligibility !== 'sandbox_only') {
    throw new CustomizationRequestConflictError('当前 C1 入口只允许 sandbox_only 确认记录');
  }
  const canonical = {
    sceneConfirmationId: parsed.sceneConfirmationId,
    contactName: parsed.contactName,
    contactPhone: parsed.contactPhone,
    usageDescription: parsed.usageDescription,
    additionalRequirements: parsed.additionalRequirements ?? null,
    supersedesRequestId: parsed.supersedesRequestId ?? null,
  };
  const requestFingerprint = fingerprint(canonical);

  const priorResult = await readIdempotentResult({
    prisma,
    ownerUserId,
    idempotencyKey: parsed.idempotencyKey,
    requestFingerprint,
  });
  if (priorResult) return priorResult;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const created = await prisma.$transaction(
        async (tx) => {
          if (parsed.supersedesRequestId) {
            const previous = await tx.customizationRequest.findFirst({
              where: {
                id: parsed.supersedesRequestId,
                ownerUserId,
              },
              include: { checkRun: { select: { status: true } } },
            });
            if (!previous) throw new NotFoundError('CustomizationRequest');
            if (previous.status !== 'submitted') {
              throw new CustomizationRequestConflictError('旧申请已被替代，不能再次重提');
            }
            if (previous.checkRun?.status === 'queued' || previous.checkRun?.status === 'in_review') {
              throw new CustomizationRequestConflictError('旧申请正在审核，完成审核后才能重提');
            }
          }

          const request = await tx.customizationRequest.create({
            data: {
              ownerUserId,
              sceneConfirmationId: scene.sceneConfirmationId,
              projectId: scene.projectId,
              targetInstanceId: scene.targetInstanceId,
              sceneConfirmation: scene,
              productCode: PRODUCT_CODE,
              materialName: MATERIAL_NAME,
              materialVersion: MATERIAL_VERSION,
              sandboxOnly: true,
              contactName: parsed.contactName,
              contactPhone: parsed.contactPhone,
              usageDescription: parsed.usageDescription,
              additionalRequirements: parsed.additionalRequirements ?? null,
              status: 'submitted',
              idempotencyKey: parsed.idempotencyKey,
              requestFingerprint,
              supersedesRequestId: parsed.supersedesRequestId ?? null,
              submittedAt: new Date(),
            },
          });

          if (parsed.supersedesRequestId) {
            const updated = await tx.customizationRequest.updateMany({
              where: {
                id: parsed.supersedesRequestId,
                ownerUserId,
                status: 'submitted',
              },
              data: { status: 'superseded' },
            });
            if (updated.count !== 1) {
              throw new CustomizationRequestConflictError('旧申请已被替代，不能再次重提');
            }
          }
          return request;
        },
        { isolationLevel: 'Serializable' },
      );
      return { request: toResponse(created), created: true };
    } catch (error) {
      if (isErrorCode(error, 'P2002')) {
        const existing = await readIdempotentResult({
          prisma,
          ownerUserId,
          idempotencyKey: parsed.idempotencyKey,
          requestFingerprint,
        });
        if (existing) return existing;
        throw new CustomizationRequestConflictError('旧申请已存在后继版本');
      }
      if (isErrorCode(error, 'P2034') && attempt < 2) continue;
      throw error;
    }
  }
  throw new CustomizationRequestConflictError('申请提交并发冲突，请重试');
}

export async function listCustomizationRequests({
  prisma,
  ownerUserId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
}): Promise<CustomizationRequestResponse[]> {
  const rows = await prisma.customizationRequest.findMany({
    where: { ownerUserId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toResponse);
}

export async function getCustomizationRequest({
  prisma,
  ownerUserId,
  requestId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  requestId: string;
}): Promise<CustomizationRequestResponse> {
  const row = await prisma.customizationRequest.findFirst({
    where: { id: requestId, ownerUserId },
  });
  if (!row) throw new NotFoundError('CustomizationRequest');
  return toResponse(row);
}
