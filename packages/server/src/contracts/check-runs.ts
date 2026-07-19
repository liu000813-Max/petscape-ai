// WP-B6-0 — admin role changes and trusted manual review process boundaries.
import { z } from 'zod';
import { SceneConfirmationCommerceInputSchema } from './scene-confirmation-commerce.ts';

export const USER_ROLES = ['user', 'admin'] as const;
export const CHECK_RUN_STATUSES = ['queued', 'in_review', 'completed'] as const;
export const CHECK_RUN_RESULTS = ['approved', 'rejected', 'uncertain'] as const;

const idSchema = z.string().trim().min(1).max(191);
const shortText = z.string().trim().min(1).max(500);
const issueSchema = z.string().trim().min(1).max(1000);

export const ChangeUserRoleSchema = z.strictObject({
  role: z.enum(USER_ROLES),
  expectedRole: z.enum(USER_ROLES),
  reason: shortText,
});

export const CreateCheckRunSchema = z.strictObject({ requestId: idSchema });
export const CheckRunIdParamSchema = z.strictObject({ id: idSchema });

export const CheckRunEvidenceSchema = z.strictObject({
  kind: z.enum(['note', 'image', 'document', 'measurement']),
  ref: z.string().trim().min(1).max(1000),
  summary: z.string().trim().min(1).max(1000),
});

export const CompleteCheckRunSchema = z
  .strictObject({
    result: z.enum(CHECK_RUN_RESULTS),
    issues: z.array(issueSchema).max(100),
    evidence: z.array(CheckRunEvidenceSchema).max(100),
    adjustmentSuggestions: z.array(issueSchema).max(100),
    note: z.string().trim().min(1).max(4000).nullable(),
  })
  .superRefine((value, context) => {
    if (value.result === 'approved' && value.evidence.length === 0) {
      context.addIssue({ code: 'custom', path: ['evidence'], message: '通过审核必须至少提供一条证据' });
    }
  });

export const CheckRunRequestSnapshotSchema = z.strictObject({
  customizationRequestId: idSchema,
  contactName: z.string().trim().min(1).max(80),
  contactPhone: z.string().trim().min(6).max(32),
  usageDescription: z.string().trim().min(1).max(2000),
  additionalRequirements: z.string().trim().min(1).max(2000).nullable(),
  productCode: z.literal('cheese-lounge-bed'),
  materialName: z.literal('PETG 奶酪黄（沙箱）'),
  materialVersion: z.literal('petg-cheese-yellow-sandbox-v0'),
  sandboxOnly: z.literal(true),
  sceneConfirmation: SceneConfirmationCommerceInputSchema,
  submittedAt: z.iso.datetime(),
});

export const CheckRunResponseSchema = z
  .strictObject({
    id: idSchema,
    requestId: idSchema,
    status: z.enum(CHECK_RUN_STATUSES),
    result: z.enum(CHECK_RUN_RESULTS).nullable(),
    issues: z.array(issueSchema),
    evidence: z.array(CheckRunEvidenceSchema),
    adjustmentSuggestions: z.array(issueSchema),
    note: z.string().max(4000).nullable(),
    reviewerUserId: idSchema.nullable(),
    checklistVersion: z.literal('fdm-manual-sandbox-v0'),
    ruleVersion: z.literal('b6-manual-review-v0-sandbox'),
    requestSnapshot: CheckRunRequestSnapshotSchema,
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    const queued = value.status === 'queued' && value.result === null && value.reviewerUserId === null && value.startedAt === null && value.completedAt === null;
    const reviewing = value.status === 'in_review' && value.result === null && value.reviewerUserId !== null && value.startedAt !== null && value.completedAt === null;
    const completed = value.status === 'completed' && value.result !== null && value.reviewerUserId !== null && value.startedAt !== null && value.completedAt !== null;
    if (!queued && !reviewing && !completed) {
      context.addIssue({ code: 'custom', message: 'CheckRun 状态、结论、审核人与时间不一致' });
    }
  });

export const CheckRunListResponseSchema = z.strictObject({
  checkRuns: z.array(CheckRunResponseSchema),
});

export const AdminReviewCandidateSchema = z.strictObject({
  request: CheckRunRequestSnapshotSchema,
  checkRun: CheckRunResponseSchema.nullable(),
  canComplete: z.boolean(),
});

export const AdminReviewCandidateListSchema = z.strictObject({
  candidates: z.array(AdminReviewCandidateSchema),
});

export const UserRoleResponseSchema = z.strictObject({
  userId: idSchema,
  role: z.enum(USER_ROLES),
});

export const CheckRunApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'forbidden', 'invalid_json', 'invalid_request', 'not_found', 'conflict']),
  detail: z.string().optional(),
  issues: z.array(z.strictObject({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional(),
});

export type ChangeUserRole = z.infer<typeof ChangeUserRoleSchema>;
export type CreateCheckRun = z.infer<typeof CreateCheckRunSchema>;
export type CompleteCheckRun = z.infer<typeof CompleteCheckRunSchema>;
export type CheckRunResponse = z.infer<typeof CheckRunResponseSchema>;
export type CheckRunRequestSnapshot = z.infer<typeof CheckRunRequestSnapshotSchema>;
