// WP-SEAM-0 — SceneConfirmation 到电商线的唯一共享输入契约正本。
// 本契约只描述跨线不可变输出，不规定 Viewer 的表结构或内部状态机。
import { z } from 'zod';

export const SCENE_CONFIRMATION_COMMERCE_SCHEMA_VERSION =
  'scene-confirmation-commerce.v0' as const;

export const SCENE_CONFIRMATION_COMMERCE_SOURCES = [
  'viewer_scene_confirmation',
  'sandbox_fixture',
] as const;

export const SCENE_CONFIRMATION_COMMERCE_ELIGIBILITY = [
  'sandbox_only',
  'formal_candidate',
] as const;

const immutableIdSchema = z.string().trim().min(1).max(191);
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'sha256 必须是 64 位小写十六进制内容校验值');
const millimetersSchema = z.number().finite().positive().max(10_000);

export const SceneConfirmationAssetRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('owned_asset'),
    assetId: immutableIdSchema,
    sha256: sha256Schema,
  }),
  z.strictObject({
    kind: z.literal('temporary_catalog'),
    assetKey: immutableIdSchema,
    sha256: sha256Schema,
  }),
]);

export const SceneConfirmationCommerceInputSchema = z
  .strictObject({
    schemaVersion: z.literal(SCENE_CONFIRMATION_COMMERCE_SCHEMA_VERSION),
    sceneConfirmationId: immutableIdSchema,
    projectId: immutableIdSchema,
    targetInstanceId: immutableIdSchema,
    assetRef: SceneConfirmationAssetRefSchema,
    // 单位固化在字段名，避免无单位数字穿过进程边界。
    dimensionsMm: z.strictObject({
      x: millimetersSchema,
      y: millimetersSchema,
      z: millimetersSchema,
    }),
    rotationYRad: z.number().finite(),
    uniformScale: z.number().finite().positive().max(1_000),
    confirmedAt: z.iso.datetime({ offset: true }),
    source: z.enum(SCENE_CONFIRMATION_COMMERCE_SOURCES),
    eligibility: z.enum(SCENE_CONFIRMATION_COMMERCE_ELIGIBILITY),
  })
  .superRefine((value, ctx) => {
    if (value.assetRef.kind === 'temporary_catalog' && value.eligibility !== 'sandbox_only') {
      ctx.addIssue({
        code: 'custom',
        path: ['eligibility'],
        message: 'temporary_catalog 只能进入 sandbox_only 下游',
      });
    }

    if (value.source === 'sandbox_fixture' && value.eligibility !== 'sandbox_only') {
      ctx.addIssue({
        code: 'custom',
        path: ['eligibility'],
        message: 'sandbox_fixture 不能成为 formal_candidate',
      });
    }
  });

export type SceneConfirmationAssetRef = z.infer<typeof SceneConfirmationAssetRefSchema>;
export type SceneConfirmationCommerceInput = z.infer<
  typeof SceneConfirmationCommerceInputSchema
>;

