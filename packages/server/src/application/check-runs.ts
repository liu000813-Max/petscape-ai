// WP-B6-0 — protected admin use cases for role grants and trusted manual reviews.
import {
  ChangeUserRoleSchema,
  CheckRunRequestSnapshotSchema,
  CheckRunResponseSchema,
  CompleteCheckRunSchema,
  CreateCheckRunSchema,
  type ChangeUserRole,
  type CheckRunRequestSnapshot,
  type CheckRunResponse,
  type CompleteCheckRun,
  type CreateCheckRun,
} from '../contracts/check-runs.ts';
import type { PrismaClient } from '../infra/db/index.ts';
import { NotFoundError } from '../domain/index.ts';

const CHECKLIST_VERSION = 'fdm-manual-sandbox-v0' as const;
const RULE_VERSION = 'b6-manual-review-v0-sandbox' as const;

export class AdminRequiredError extends Error {
  constructor() {
    super('此操作仅限 admin');
    this.name = 'AdminRequiredError';
  }
}

export class CheckRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckRunConflictError';
  }
}

function errorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

async function requireAdmin(prisma: PrismaClient, actorUserId: string) {
  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
  if (actor?.role !== 'admin') throw new AdminRequiredError();
}

type CheckRunRecord = {
  id: string;
  requestId: string;
  requestSnapshot: unknown;
  status: string;
  result: string | null;
  issues: unknown;
  evidence: unknown;
  adjustmentSuggestions: unknown;
  note: string | null;
  reviewerUserId: string | null;
  checklistVersion: string;
  ruleVersion: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

function toResponse(row: CheckRunRecord): CheckRunResponse {
  return CheckRunResponseSchema.parse({
    ...row,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

function buildRequestSnapshot(request: {
  id: string;
  sceneConfirmation: unknown;
  productCode: string;
  materialName: string;
  materialVersion: string;
  sandboxOnly: boolean;
  contactName: string;
  contactPhone: string;
  usageDescription: string;
  additionalRequirements: string | null;
  submittedAt: Date;
}): CheckRunRequestSnapshot {
  return CheckRunRequestSnapshotSchema.parse({
    customizationRequestId: request.id,
    contactName: request.contactName,
    contactPhone: request.contactPhone,
    usageDescription: request.usageDescription,
    additionalRequirements: request.additionalRequirements,
    productCode: request.productCode,
    materialName: request.materialName,
    materialVersion: request.materialVersion,
    sandboxOnly: request.sandboxOnly,
    sceneConfirmation: request.sceneConfirmation,
    submittedAt: request.submittedAt.toISOString(),
  });
}

export async function changeUserRole({ prisma, actorUserId, targetUserId, input }: {
  prisma: PrismaClient;
  actorUserId: string;
  targetUserId: string;
  input: ChangeUserRole;
}) {
  const parsed = ChangeUserRoleSchema.parse(input);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await requireAdmin(tx as PrismaClient, actorUserId);
        const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
        if (!target) throw new NotFoundError('User');
        if (target.role !== parsed.expectedRole || target.role === parsed.role) {
          throw new CheckRunConflictError('用户角色已变化，请刷新后重试');
        }
        if (target.role === 'admin' && parsed.role === 'user') {
          const activeReviews = await tx.checkRun.count({
            where: { reviewerUserId: targetUserId, status: 'in_review' },
          });
          if (activeReviews > 0) throw new CheckRunConflictError('该 admin 仍有进行中的审核，不能降级');
          const adminCount = await tx.user.count({ where: { role: 'admin' } });
          if (adminCount <= 1) throw new CheckRunConflictError('不能移除最后一个 admin');
        }
        await tx.$queryRaw`SELECT
          set_config('petscape.role_change_source', 'admin_api', true),
          set_config('petscape.role_change_actor', ${actorUserId}, true),
          set_config('petscape.role_change_reason', ${parsed.reason}, true)`;
        const updated = await tx.user.updateMany({
          where: { id: targetUserId, role: parsed.expectedRole },
          data: { role: parsed.role },
        });
        if (updated.count !== 1) throw new CheckRunConflictError('用户角色并发变化');
        return { userId: targetUserId, role: parsed.role };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (errorCode(error, 'P2034') && attempt < 2) continue;
      throw error;
    }
  }
  throw new CheckRunConflictError('用户角色并发变化');
}

export async function bootstrapFirstAdmin({ prisma, targetUserId, reason }: {
  prisma: PrismaClient;
  targetUserId: string;
  reason: string;
}) {
  const parsedReason = ChangeUserRoleSchema.shape.reason.parse(reason);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const adminCount = await tx.user.count({ where: { role: 'admin' } });
        if (adminCount !== 0) throw new CheckRunConflictError('首个 admin 已存在，bootstrap 已关闭');
        const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
        if (!target) throw new NotFoundError('User');
        if (target.role !== 'user') throw new CheckRunConflictError('bootstrap 目标必须是普通用户');
        await tx.$queryRaw`SELECT
          set_config('petscape.role_change_source', 'bootstrap_operator', true),
          set_config('petscape.role_change_actor', '', true),
          set_config('petscape.role_change_reason', ${parsedReason}, true)`;
        const updated = await tx.user.updateMany({
          where: { id: targetUserId, role: 'user' },
          data: { role: 'admin' },
        });
        if (updated.count !== 1) throw new CheckRunConflictError('bootstrap 目标角色并发变化');
        return { userId: targetUserId, role: 'admin' as const };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (errorCode(error, 'P2034') && attempt < 2) continue;
      throw error;
    }
  }
  throw new CheckRunConflictError('bootstrap 并发冲突');
}

export async function createCheckRun({ prisma, actorUserId, input }: {
  prisma: PrismaClient;
  actorUserId: string;
  input: CreateCheckRun;
}): Promise<{ checkRun: CheckRunResponse; created: boolean }> {
  const parsed = CreateCheckRunSchema.parse(input);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await requireAdmin(tx as PrismaClient, actorUserId);
        const request = await tx.customizationRequest.findUnique({ where: { id: parsed.requestId } });
        if (!request) throw new NotFoundError('CustomizationRequest');
        if (request.status !== 'submitted') throw new CheckRunConflictError('只有 submitted 申请可以进入审核');
        const existing = await tx.checkRun.findUnique({ where: { requestId: parsed.requestId } });
        if (existing) return { checkRun: toResponse(existing), created: false };
        const created = await tx.checkRun.create({
          data: {
            requestId: request.id,
            requestSnapshot: buildRequestSnapshot(request),
            status: 'queued', result: null, issues: [], evidence: [], adjustmentSuggestions: [], note: null,
            checklistVersion: CHECKLIST_VERSION, ruleVersion: RULE_VERSION,
          },
        });
        return { checkRun: toResponse(created), created: true };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if ((errorCode(error, 'P2002') || errorCode(error, 'P2034')) && attempt < 2) continue;
      if (errorCode(error, 'P2002')) {
        await requireAdmin(prisma, actorUserId);
        const raced = await prisma.checkRun.findUnique({ where: { requestId: parsed.requestId } });
        if (raced) return { checkRun: toResponse(raced), created: false };
      }
      throw error;
    }
  }
  throw new CheckRunConflictError('审核创建并发冲突，请重试');
}

export async function startCheckRun({ prisma, actorUserId, checkRunId }: {
  prisma: PrismaClient;
  actorUserId: string;
  checkRunId: string;
}): Promise<CheckRunResponse> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await requireAdmin(tx as PrismaClient, actorUserId);
        const updated = await tx.checkRun.updateMany({
          where: { id: checkRunId, status: 'queued' },
          data: { status: 'in_review', reviewerUserId: actorUserId, startedAt: new Date() },
        });
        if (updated.count !== 1) throw new CheckRunConflictError('审核已被认领或不在 queued 状态');
        return toResponse(await tx.checkRun.findUniqueOrThrow({ where: { id: checkRunId } }));
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (errorCode(error, 'P2034') && attempt < 2) continue;
      throw error;
    }
  }
  throw new CheckRunConflictError('审核认领并发冲突');
}

export async function completeCheckRun({ prisma, actorUserId, checkRunId, input }: {
  prisma: PrismaClient;
  actorUserId: string;
  checkRunId: string;
  input: CompleteCheckRun;
}): Promise<CheckRunResponse> {
  const parsed = CompleteCheckRunSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireAdmin(tx as PrismaClient, actorUserId);
    const updated = await tx.checkRun.updateMany({
      where: { id: checkRunId, status: 'in_review', reviewerUserId: actorUserId },
      data: {
        status: 'completed',
        result: parsed.result,
        issues: parsed.issues,
        evidence: parsed.evidence,
        adjustmentSuggestions: parsed.adjustmentSuggestions,
        note: parsed.note,
        completedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new CheckRunConflictError('仅认领该审核的 admin 可以完成');
    return toResponse(await tx.checkRun.findUniqueOrThrow({ where: { id: checkRunId } }));
  }, { isolationLevel: 'Serializable' });
}

export async function listOwnerCheckRuns({ prisma, ownerUserId }: { prisma: PrismaClient; ownerUserId: string }) {
  const rows = await prisma.checkRun.findMany({
    where: { request: { ownerUserId } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toResponse);
}

export async function listAdminCheckRuns({ prisma, actorUserId }: { prisma: PrismaClient; actorUserId: string }) {
  await requireAdmin(prisma, actorUserId);
  const rows = await prisma.checkRun.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return rows.map(toResponse);
}

export async function listAdminReviewCandidates({ prisma, actorUserId }: { prisma: PrismaClient; actorUserId: string }) {
  await requireAdmin(prisma, actorUserId);
  const rows = await prisma.customizationRequest.findMany({
    where: { status: 'submitted' },
    include: { checkRun: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    request: buildRequestSnapshot(row),
    checkRun: row.checkRun ? toResponse(row.checkRun) : null,
    canComplete: row.checkRun?.status === 'in_review' && row.checkRun.reviewerUserId === actorUserId,
  }));
}

export async function getApprovedCheckRunInput({ prisma, requestId }: { prisma: PrismaClient; requestId: string }) {
  const row = await prisma.checkRun.findUnique({ where: { requestId }, include: { request: true } });
  if (!row) throw new NotFoundError('CheckRun');
  const { request, ...checkRunRow } = row;
  const checkRun = toResponse(checkRunRow);
  if (request.status !== 'submitted' || checkRun.status !== 'completed' || checkRun.result !== 'approved' || !checkRun.completedAt) {
    throw new CheckRunConflictError('只有 completed + approved 的可信审核可供 C2 消费');
  }
  return {
    checkRunId: checkRun.id,
    requestId: checkRun.requestId,
    requestSnapshot: checkRun.requestSnapshot,
    checklistVersion: checkRun.checklistVersion,
    ruleVersion: checkRun.ruleVersion,
    completedAt: checkRun.completedAt,
  };
}
