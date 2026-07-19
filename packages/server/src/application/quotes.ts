// WP-C2-1 — server-authoritative Quote creation and one-way lifecycle.
import { createHash } from 'node:crypto';
import {
  CreateQuoteSchema,
  QuoteDeliveryEstimateSchema,
  QuoteInputSnapshotSchema,
  QuotePriceBreakdownSchema,
  QuoteResponseSchema,
  QuoteTransitionSchema,
  type CreateQuote,
  type QuoteResponse,
  type QuoteTransition,
} from '../contracts/quotes.ts';
import { MeshAnalysisJobInputSchema, MeshAnalysisResultSchema } from '../contracts/commerce-estimates.ts';
import { SceneConfirmationCommerceInputSchema } from '../contracts/scene-confirmation-commerce.ts';
import { calculateSandboxPrice, assertFormalPricingAllowed, PricingEligibilityError } from '../domain/pricing.ts';
import { NotFoundError } from '../domain/index.ts';
import type { PrismaClient } from '../infra/db/index.ts';

const VALIDITY_MS = 7 * 86_400_000;
const DELIVERY_ESTIMATE = QuoteDeliveryEstimateSchema.parse({
  status: 'unverified_sandbox',
  label: '沙箱交期未验证，不构成履约承诺',
});

export class QuoteEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteEligibilityError';
  }
}

export class QuoteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteConflictError';
  }
}

function errorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

function isSerializationFailure(error: unknown) {
  if (errorCode(error, 'P2034') || errorCode(error, '40001')) return true;
  return error instanceof Error && /(?:SQLSTATE\s*)?40001|could not serialize|write conflict/i.test(error.message);
}

type QuoteRecord = {
  id: string; requestId: string; checkRunId: string; estimateJobId: string;
  quoteMode: string; sandboxOnly: boolean; status: string; productCode: string;
  materialName: string; materialVersion: string; pricingRuleVersion: string;
  amountCent: number; currency: string; taxMode: string; roundingMode: string;
  deliveryEstimate: unknown; validFrom: Date; expiresAt: Date; acceptedAt: Date | null;
  expiredAt: Date | null; supersededAt: Date | null; canceledAt: Date | null;
  supersedesQuoteId: string | null; createdAt: Date;
};

function toResponse(row: QuoteRecord): QuoteResponse {
  return QuoteResponseSchema.parse({
    id: row.id,
    requestId: row.requestId,
    checkRunId: row.checkRunId,
    estimateJobId: row.estimateJobId,
    quoteMode: row.quoteMode,
    label: row.quoteMode === 'sandbox_test' ? '沙箱测试报价（不可用于真实交易）' : '正式报价候选',
    sandboxOnly: row.sandboxOnly,
    status: row.status,
    productCode: row.productCode,
    materialName: row.materialName,
    materialVersion: row.materialVersion,
    pricingRuleVersion: row.pricingRuleVersion,
    amountCent: row.amountCent,
    currency: row.currency,
    taxMode: row.taxMode,
    roundingMode: row.roundingMode,
    deliveryEstimate: row.deliveryEstimate,
    validFrom: row.validFrom.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    expiredAt: row.expiredAt?.toISOString() ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    supersedesQuoteId: row.supersedesQuoteId,
    createdAt: row.createdAt.toISOString(),
  });
}

function canonicalHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sameScene(left: unknown, right: unknown) {
  return canonicalHash(SceneConfirmationCommerceInputSchema.parse(left)) ===
    canonicalHash(SceneConfirmationCommerceInputSchema.parse(right));
}

async function resolveInputs(prisma: PrismaClient, ownerUserId: string, input: CreateQuote) {
  const request = await prisma.customizationRequest.findFirst({
    where: { id: input.requestId, ownerUserId },
    include: { checkRun: true },
  });
  if (!request) throw new NotFoundError('CustomizationRequest');
  const checkRun = request.checkRun;
  if (request.status !== 'submitted' || !checkRun || checkRun.status !== 'completed' ||
      checkRun.result !== 'approved' || !checkRun.completedAt) {
    throw new QuoteEligibilityError('只有 submitted 申请的 completed + approved 可信审核可生成 Quote');
  }

  const job = await prisma.job.findFirst({
    where: { id: input.estimateJobId, ownerUserId, type: 'mesh_analysis' },
  });
  if (!job) throw new NotFoundError('Estimate');
  if (job.status !== 'succeeded' || !job.resultRef) {
    throw new QuoteEligibilityError('B7 mesh_analysis 尚未成功，报价输入不完整');
  }
  const jobInput = MeshAnalysisJobInputSchema.parse(job.input);
  const analysis = MeshAnalysisResultSchema.parse(job.resultRef);
  const scene = SceneConfirmationCommerceInputSchema.parse(request.sceneConfirmation);
  if (!sameScene(scene, jobInput.sceneConfirmation) || analysis.assetChecksum !== scene.assetRef.sha256 ||
      Math.abs(analysis.dimensionsMm.x - scene.dimensionsMm.x) > 0.001 ||
      Math.abs(analysis.dimensionsMm.y - scene.dimensionsMm.y) > 0.001 ||
      Math.abs(analysis.dimensionsMm.z - scene.dimensionsMm.z) > 0.001) {
    throw new QuoteEligibilityError('B7 分析结果与申请冻结的 SceneConfirmation 不匹配');
  }

  const [material, rule] = await Promise.all([
    prisma.material.findUniqueOrThrow({ where: { versionCode: request.materialVersion } }),
    prisma.pricingRule.findUniqueOrThrow({ where: { versionCode: 'v0-sandbox' } }),
  ]);
  if (rule.materialId !== material.id || request.materialName !== material.displayName) {
    throw new QuoteEligibilityError('申请材料与定价规则版本不匹配');
  }
  if (input.quoteMode === 'formal_candidate') {
    try {
      assertFormalPricingAllowed({ material, rule: { ...rule, multiplier: rule.multiplier.toString() } });
    } catch (error) {
      if (error instanceof PricingEligibilityError) throw new QuoteEligibilityError(error.message);
      throw error;
    }
  } else if (!material.sandboxOnly || !rule.sandboxOnly || material.isSellable || rule.isSellable) {
    throw new QuoteEligibilityError('sandbox_test 只能使用明确不可售的沙箱材料与规则');
  }

  const price = calculateSandboxPrice({
    volumeMm3: analysis.volumeMm3.toString(),
    material,
    rule: { ...rule, multiplier: rule.multiplier.toString() },
  });
  const inputSnapshot = QuoteInputSnapshotSchema.parse({
    schemaVersion: 'quote-input.v0',
    request: {
      id: request.id,
      sceneConfirmation: scene,
      productCode: request.productCode,
      materialName: request.materialName,
      materialVersion: request.materialVersion,
      submittedAt: request.submittedAt.toISOString(),
    },
    review: {
      id: checkRun.id,
      result: 'approved',
      requestSnapshot: checkRun.requestSnapshot,
      checklistVersion: checkRun.checklistVersion,
      ruleVersion: checkRun.ruleVersion,
      completedAt: checkRun.completedAt.toISOString(),
    },
    b7: { estimateJobId: job.id, jobInput, analysis },
  });
  const priceBreakdown = QuotePriceBreakdownSchema.parse({
    schemaVersion: 'quote-price.v0',
    materialCostCent: price.materialCostCent,
    weightGrams: price.weightGrams,
    baseFeeCent: rule.baseFeeCent,
    multiplier: rule.multiplier.toString(),
    floorPriceCent: rule.floorPriceCent,
    amountBeforeRoundingCent: price.amountBeforeRoundingCent,
    amountCent: price.amountCent,
    formulaVersion: rule.formulaVersion,
  });
  const inputFingerprint = canonicalHash({
    quoteMode: input.quoteMode,
    inputSnapshot,
    priceBreakdown,
    materialId: material.id,
    pricingRuleId: rule.id,
  });
  return { request, checkRun, job, material, rule, price, inputSnapshot, priceBreakdown, inputFingerprint };
}

async function readByIdempotencyKey(
  prisma: PrismaClient,
  ownerUserId: string,
  input: CreateQuote,
  now: Date,
) {
  await expireOwnedQuotes(prisma, ownerUserId, now);
  const byKey = await prisma.quote.findFirst({
    where: { ownerUserId, idempotencyKey: input.idempotencyKey },
  });
  if (!byKey) return null;
  if (byKey.requestId !== input.requestId || byKey.estimateJobId !== input.estimateJobId ||
      byKey.quoteMode !== input.quoteMode) {
    throw new QuoteConflictError('同一 idempotencyKey 不得创建不同 Quote');
  }
  return { quote: toResponse(byKey), created: false as const };
}

async function readByFingerprint(
  prisma: PrismaClient,
  ownerUserId: string,
  fingerprint: string,
  idempotencyKey: string,
) {
  const byFingerprint = await prisma.quote.findFirst({
    where: { ownerUserId, inputFingerprint: fingerprint },
  });
  if (byFingerprint && byFingerprint.idempotencyKey !== idempotencyKey) {
    if (byFingerprint.status !== 'active') {
      throw new QuoteConflictError('同一申请已有 Quote；续价请提交新的申请版本');
    }
    throw new QuoteConflictError('相同报价输入已由不同 idempotencyKey 创建');
  }
  return byFingerprint ? { quote: toResponse(byFingerprint), created: false as const } : null;
}

export async function createQuote({ prisma, ownerUserId, input: untrusted, now = new Date() }: {
  prisma: PrismaClient; ownerUserId: string; input: CreateQuote; now?: Date;
}): Promise<{ quote: QuoteResponse; created: boolean }> {
  const input = CreateQuoteSchema.parse(untrusted);
  const existingByKey = await readByIdempotencyKey(prisma, ownerUserId, input, now);
  if (existingByKey) return existingByKey;
  let attemptedFingerprint: string | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Serialize quote creation against request cancellation/resubmission. Eligibility
        // is resolved only after this lock, inside the same transaction that inserts.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "customization_request"
          WHERE "id" = ${input.requestId} AND "ownerUserId" = ${ownerUserId}
          FOR UPDATE
        `;
        if (locked.length !== 1) throw new NotFoundError('CustomizationRequest');
        const racedByKey = await readByIdempotencyKey(tx as PrismaClient, ownerUserId, input, now);
        if (racedByKey) return racedByKey;
        const resolved = await resolveInputs(tx as PrismaClient, ownerUserId, input);
        attemptedFingerprint = resolved.inputFingerprint;
        const prior = await readByFingerprint(
          tx as PrismaClient,
          ownerUserId,
          resolved.inputFingerprint,
          input.idempotencyKey,
        );
        if (prior) return prior;

        let supersedesQuoteId: string | null = null;
        if (resolved.request.supersedesRequestId) {
          const old = await tx.quote.findFirst({
            where: { requestId: resolved.request.supersedesRequestId, ownerUserId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          if (old?.status === 'active') {
            const updated = await tx.quote.updateMany({
              where: { id: old.id, status: 'active' },
              data: { status: 'superseded', supersededAt: now },
            });
            if (updated.count !== 1) throw new QuoteConflictError('旧 Quote 并发变化，请重试');
            supersedesQuoteId = old.id;
          } else if (old?.status === 'superseded') {
            supersedesQuoteId = old.id;
          }
        }
        const row = await tx.quote.create({ data: {
          ownerUserId,
          requestId: resolved.request.id,
          checkRunId: resolved.checkRun.id,
          estimateJobId: resolved.job.id,
          materialId: resolved.material.id,
          pricingRuleId: resolved.rule.id,
          quoteMode: input.quoteMode,
          sandboxOnly: input.quoteMode === 'sandbox_test',
          status: 'active',
          productCode: resolved.request.productCode,
          materialName: resolved.material.displayName,
          materialVersion: resolved.material.versionCode,
          pricingRuleVersion: resolved.rule.versionCode,
          inputSnapshot: resolved.inputSnapshot,
          priceBreakdown: resolved.priceBreakdown,
          deliveryEstimate: DELIVERY_ESTIMATE,
          amountCent: resolved.price.amountCent,
          currency: resolved.price.currency,
          taxMode: resolved.price.taxMode,
          roundingMode: resolved.price.roundingMode,
          idempotencyKey: input.idempotencyKey,
          inputFingerprint: resolved.inputFingerprint,
          supersedesQuoteId,
          validFrom: now,
          expiresAt: new Date(now.getTime() + VALIDITY_MS),
        } });
        return { quote: toResponse(row), created: true as const };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (errorCode(error, 'P2002')) {
        const byKey = await readByIdempotencyKey(prisma, ownerUserId, input, now);
        if (byKey) return byKey;
        if (attemptedFingerprint) {
          const byFingerprint = await readByFingerprint(
            prisma,
            ownerUserId,
            attemptedFingerprint,
            input.idempotencyKey,
          );
          if (byFingerprint) return byFingerprint;
        }
        const existingRequestQuote = await prisma.quote.findFirst({
          where: { ownerUserId, requestId: input.requestId },
          select: { id: true },
        });
        if (existingRequestQuote) {
          throw new QuoteConflictError('同一申请已有 Quote；续价请提交新的申请版本');
        }
      }
      if (isSerializationFailure(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new QuoteConflictError('Quote 并发创建冲突，请重试');
}

async function expireOwnedQuotes(prisma: PrismaClient, ownerUserId: string, now: Date) {
  await prisma.quote.updateMany({
    where: { ownerUserId, status: 'active', expiresAt: { lte: now } },
    data: { status: 'expired', expiredAt: now },
  });
}

export async function listQuotes({ prisma, ownerUserId, now = new Date() }: {
  prisma: PrismaClient; ownerUserId: string; now?: Date;
}) {
  await expireOwnedQuotes(prisma, ownerUserId, now);
  const rows = await prisma.quote.findMany({ where: { ownerUserId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return rows.map(toResponse);
}

export async function getQuote({ prisma, ownerUserId, quoteId, now = new Date() }: {
  prisma: PrismaClient; ownerUserId: string; quoteId: string; now?: Date;
}) {
  await expireOwnedQuotes(prisma, ownerUserId, now);
  const row = await prisma.quote.findFirst({ where: { id: quoteId, ownerUserId } });
  if (!row) throw new NotFoundError('Quote');
  return toResponse(row);
}

export async function acceptQuote({ prisma, ownerUserId, quoteId, input: untrusted, now = new Date() }: {
  prisma: PrismaClient; ownerUserId: string; quoteId: string; input: QuoteTransition; now?: Date;
}) {
  QuoteTransitionSchema.parse(untrusted);
  await expireOwnedQuotes(prisma, ownerUserId, now);
  const current = await prisma.quote.findFirst({ where: { id: quoteId, ownerUserId } });
  if (!current) throw new NotFoundError('Quote');
  if (current.status === 'accepted') return toResponse(current);
  if (current.status !== 'active') throw new QuoteConflictError(`${current.status} Quote 不可接受`);
  let updated;
  try {
    updated = await prisma.quote.updateMany({
      where: { id: quoteId, ownerUserId, status: 'active', expiresAt: { gt: now } },
      data: { status: 'accepted', acceptedAt: now },
    });
  } catch (error) {
    if (String(error).includes('invalid quote lifecycle transition')) {
      throw new QuoteConflictError('Quote 已过期或并发变化');
    }
    throw error;
  }
  if (updated.count === 1) return getQuote({ prisma, ownerUserId, quoteId, now });
  const raced = await prisma.quote.findFirst({ where: { id: quoteId, ownerUserId } });
  if (raced?.status === 'accepted') return toResponse(raced);
  throw new QuoteConflictError('Quote 已过期或并发变化');
}

export async function cancelQuote({ prisma, ownerUserId, quoteId, input: untrusted, now = new Date() }: {
  prisma: PrismaClient; ownerUserId: string; quoteId: string; input: QuoteTransition; now?: Date;
}) {
  QuoteTransitionSchema.parse(untrusted);
  await expireOwnedQuotes(prisma, ownerUserId, now);
  const updated = await prisma.quote.updateMany({
    where: { id: quoteId, ownerUserId, status: 'active' },
    data: { status: 'canceled', canceledAt: now },
  });
  if (updated.count !== 1) {
    const row = await prisma.quote.findFirst({ where: { id: quoteId, ownerUserId } });
    if (!row) throw new NotFoundError('Quote');
    if (row.status === 'canceled') return toResponse(row);
    throw new QuoteConflictError(`${row.status} Quote 不可取消`);
  }
  return getQuote({ prisma, ownerUserId, quoteId, now });
}
