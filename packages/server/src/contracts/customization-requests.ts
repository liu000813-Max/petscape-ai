// WP-C1-1 — 定制申请 API 的进程边界契约。
import { z } from 'zod';
import { SceneConfirmationCommerceInputSchema } from './scene-confirmation-commerce.ts';

export const CUSTOMIZATION_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'superseded',
  'canceled',
] as const;

const idSchema = z.string().trim().min(1).max(191);
const contactNameSchema = z.string().trim().min(1, 'contactName 不能为空').max(80);
const contactPhoneSchema = z
  .string()
  .trim()
  .min(6, 'contactPhone 长度不足')
  .max(32)
  .regex(/^[0-9+() -]+$/, 'contactPhone 格式无效');
const usageSchema = z.string().trim().min(1, 'usageDescription 不能为空').max(2_000);
const additionalSchema = z.string().trim().min(1).max(2_000).nullable();

export const CustomizationRequestIdParamSchema = z.strictObject({ id: idSchema });

export const CreateCustomizationRequestSchema = z.strictObject({
  sceneConfirmationId: idSchema,
  idempotencyKey: idSchema,
  contactName: contactNameSchema,
  contactPhone: contactPhoneSchema,
  usageDescription: usageSchema,
  additionalRequirements: additionalSchema.optional(),
  supersedesRequestId: idSchema.optional(),
});

export const CustomizationRequestResponseSchema = z.strictObject({
  id: idSchema,
  status: z.enum(CUSTOMIZATION_REQUEST_STATUSES),
  sandboxOnly: z.literal(true),
  label: z.literal('沙箱定制申请（不会产生真实交易）'),
  productCode: z.literal('cheese-lounge-bed'),
  materialName: z.literal('PETG 奶酪黄（沙箱）'),
  materialVersion: z.literal('petg-cheese-yellow-sandbox-v0'),
  contactName: contactNameSchema,
  contactPhone: contactPhoneSchema,
  usageDescription: usageSchema,
  additionalRequirements: additionalSchema,
  supersedesRequestId: idSchema.nullable(),
  sceneConfirmation: SceneConfirmationCommerceInputSchema,
  submittedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const CustomizationRequestListResponseSchema = z.strictObject({
  requests: z.array(CustomizationRequestResponseSchema),
});

export const CustomizationRequestApiErrorSchema = z.strictObject({
  error: z.enum([
    'unauthorized',
    'invalid_json',
    'invalid_request',
    'not_found',
    'conflict',
  ]),
  detail: z.string().optional(),
  issues: z
    .array(
      z.strictObject({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      }),
    )
    .optional(),
});

export type CreateCustomizationRequest = z.infer<typeof CreateCustomizationRequestSchema>;
export type CustomizationRequestResponse = z.infer<
  typeof CustomizationRequestResponseSchema
>;
