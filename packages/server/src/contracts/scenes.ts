// B4/B5 two-stage viewer runtime contracts.
// Persistence is intentionally absent from this package: WP-B45-2 will map these
// versioned values to Prisma records without changing their user-visible meaning.
import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(191);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'checksum 必须是小写 SHA-256');
const positiveMmSchema = z.number().finite().positive();
const nonNegativeMmSchema = z.number().finite().nonnegative();

export const SCENE_DRAFT_SCHEMA_VERSION = 'scene-draft.v1' as const;
export const SCENE_CONFIRMATION_SCHEMA_VERSION = 'scene-confirmation.v1' as const;

export const ViewerStageSchema = z.enum(['model_review', 'scene_editing']);

export const BoundsMmSchema = z.strictObject({
  x: positiveMmSchema,
  y: positiveMmSchema,
  z: positiveMmSchema,
});

export const PositionMmSchema = z.strictObject({
  x: z.number().finite(),
  y: nonNegativeMmSchema,
  z: z.number().finite(),
});

export const CageMmSchema = z.strictObject({
  width: positiveMmSchema,
  height: positiveMmSchema,
  depth: positiveMmSchema,
});

const TemporaryCatalogModelRefSchema = z.strictObject({
  kind: z.literal('temporary_catalog'),
  assetKey: idSchema,
  checksum: sha256Schema,
  quoteEligible: z.literal(false),
});

const OwnedAssetModelRefSchema = z.strictObject({
  kind: z.literal('owned_asset'),
  assetId: idSchema,
  checksum: sha256Schema,
  quoteEligible: z.literal(true),
});

export const ModelRefSchema = z.discriminatedUnion('kind', [
  TemporaryCatalogModelRefSchema,
  OwnedAssetModelRefSchema,
]);

export const SceneItemSchema = z
  .strictObject({
    instanceId: idSchema,
    role: z.enum(['target', 'context', 'pet_reference']),
    modelConfirmationId: idSchema.nullable(),
    modelRef: ModelRefSchema,
    positionMm: PositionMmSchema,
    rotationYRad: z.number().finite(),
    uniformScale: z.number().finite().positive().max(10),
    sourceBoundsMm: BoundsMmSchema,
    finalBoundsMm: BoundsMmSchema,
  })
  .superRefine((item, ctx) => {
    const axes = ['x', 'y', 'z'] as const;
    for (const axis of axes) {
      const expected = item.sourceBoundsMm[axis] * item.uniformScale;
      // Viewer displays and persists millimetres rounded to 0.001 mm.
      const tolerance = Math.max(0.001, Math.abs(expected) * 1e-6);
      if (Math.abs(item.finalBoundsMm[axis] - expected) > tolerance) {
        ctx.addIssue({
          code: 'custom',
          path: ['finalBoundsMm', axis],
          message: `finalBoundsMm.${axis} 必须等于 sourceBoundsMm.${axis} × uniformScale`,
        });
      }
    }

    if (item.role === 'target' && !item.modelConfirmationId) {
      ctx.addIssue({
        code: 'custom',
        path: ['modelConfirmationId'],
        message: 'target 必须绑定 ModelConfirmation',
      });
    }
    if (item.role !== 'target' && item.modelConfirmationId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['modelConfirmationId'],
        message: 'context 与 pet_reference 不能绑定目标 ModelConfirmation',
      });
    }
  });

const sceneDraftFields = {
  schemaVersion: z.literal(SCENE_DRAFT_SCHEMA_VERSION),
  stage: z.literal('scene_editing'),
  projectId: idSchema,
  targetDesignItemId: idSchema,
  targetModelConfirmationId: idSchema,
  targetInstanceId: idSchema,
  cageMm: CageMmSchema,
  items: z.array(SceneItemSchema).min(1).max(64),
} as const;

function validateSceneTarget(
  scene: {
    targetModelConfirmationId: string;
    targetInstanceId: string;
    items: z.infer<typeof SceneItemSchema>[];
  },
  ctx: z.RefinementCtx,
) {
  const instanceIds = new Set(scene.items.map((item) => item.instanceId));
  if (instanceIds.size !== scene.items.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'SceneItem.instanceId 在同一 Scene 内必须唯一',
    });
  }

  const targets = scene.items.filter((item) => item.role === 'target');
  if (targets.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'Scene 必须恰有一个 target',
    });
    return;
  }

  const target = targets[0];
  if (target?.instanceId !== scene.targetInstanceId) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetInstanceId'],
      message: 'targetInstanceId 必须指向唯一 target',
    });
  }
  if (target?.modelConfirmationId !== scene.targetModelConfirmationId) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetModelConfirmationId'],
      message: 'target 必须对应 targetModelConfirmationId',
    });
  }
}

export const SceneDraftSchema = z.strictObject(sceneDraftFields).superRefine(validateSceneTarget);

export const SceneConfirmationSnapshotSchema = z
  .strictObject({
    ...sceneDraftFields,
    schemaVersion: z.literal(SCENE_CONFIRMATION_SCHEMA_VERSION),
    sceneId: idSchema,
    sceneRevision: z.number().int().nonnegative(),
    confirmedAt: z.iso.datetime(),
  })
  .superRefine(validateSceneTarget);

export const SaveSceneRequestSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  draft: SceneDraftSchema,
});

export const RevisionConflictResponseSchema = z
  .strictObject({
    error: z.literal('revision_conflict'),
    expectedRevision: z.number().int().nonnegative(),
    currentRevision: z.number().int().nonnegative(),
  })
  .refine((value) => value.currentRevision !== value.expectedRevision, {
    message: '冲突响应中的 currentRevision 必须不同于 expectedRevision',
  });

export const ConfirmSceneRequestSchema = z.strictObject({
  sceneId: idSchema,
  sceneRevision: z.number().int().nonnegative(),
});

export const CreateDesignItemRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export const DesignItemResponseSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  name: z.string().min(1).max(120),
  currentModelConfirmationId: idSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateModelConfirmationRequestSchema = z
  .strictObject({
    modelRef: ModelRefSchema,
    sourceBoundsMm: BoundsMmSchema,
    uniformScale: z.number().finite().positive().max(10),
    finalBoundsMm: BoundsMmSchema,
  })
  .superRefine((confirmation, ctx) => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const expected = confirmation.sourceBoundsMm[axis] * confirmation.uniformScale;
      const tolerance = Math.max(0.001, Math.abs(expected) * 1e-6);
      if (Math.abs(confirmation.finalBoundsMm[axis] - expected) > tolerance) {
        ctx.addIssue({
          code: 'custom',
          path: ['finalBoundsMm', axis],
          message: `finalBoundsMm.${axis} 必须等于 sourceBoundsMm.${axis} × uniformScale`,
        });
      }
    }
  });

export const ModelConfirmationResponseSchema = z.strictObject({
  id: idSchema,
  designItemId: idSchema,
  modelRef: ModelRefSchema,
  sourceBoundsMm: BoundsMmSchema,
  uniformScale: z.number().finite().positive().max(10),
  finalBoundsMm: BoundsMmSchema,
  confirmedAt: z.iso.datetime(),
});

export const SceneRecordSchema = z.strictObject({
  id: idSchema,
  revision: z.number().int().nonnegative(),
  draft: SceneDraftSchema,
  updatedAt: z.iso.datetime(),
});

export const SceneConfirmationResponseSchema = z.strictObject({
  id: idSchema,
  sceneId: idSchema,
  sceneRevision: z.number().int().nonnegative(),
  snapshot: SceneConfirmationSnapshotSchema,
  confirmedAt: z.iso.datetime(),
});

export const ViewerStateResponseSchema = z.strictObject({
  designItem: DesignItemResponseSchema.nullable(),
  modelConfirmation: ModelConfirmationResponseSchema.nullable(),
  scene: SceneRecordSchema.nullable(),
  latestSceneConfirmation: SceneConfirmationResponseSchema.nullable(),
});

export const SceneApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'invalid_json', 'invalid_request', 'not_found', 'revision_conflict']),
  detail: z.string().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  currentRevision: z.number().int().nonnegative().optional(),
  issues: z.array(z.strictObject({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string(),
  })).optional(),
});

export type ViewerStage = z.infer<typeof ViewerStageSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type SceneItem = z.infer<typeof SceneItemSchema>;
export type SceneDraft = z.infer<typeof SceneDraftSchema>;
export type SceneConfirmationSnapshot = z.infer<typeof SceneConfirmationSnapshotSchema>;
export type SaveSceneRequest = z.infer<typeof SaveSceneRequestSchema>;
export type RevisionConflictResponse = z.infer<typeof RevisionConflictResponseSchema>;
export type ConfirmSceneRequest = z.infer<typeof ConfirmSceneRequestSchema>;
export type CreateDesignItemRequest = z.infer<typeof CreateDesignItemRequestSchema>;
export type DesignItemResponse = z.infer<typeof DesignItemResponseSchema>;
export type CreateModelConfirmationRequest = z.infer<typeof CreateModelConfirmationRequestSchema>;
export type ModelConfirmationResponse = z.infer<typeof ModelConfirmationResponseSchema>;
export type SceneRecord = z.infer<typeof SceneRecordSchema>;
export type SceneConfirmationResponse = z.infer<typeof SceneConfirmationResponseSchema>;
export type ViewerStateResponse = z.infer<typeof ViewerStateResponseSchema>;
