// WP-B45-2 — Viewer persistence use cases. Routes remain thin; ownership,
// asset provenance, optimistic locking and immutable snapshots live here.
import {
  ConfirmSceneRequestSchema,
  CreateDesignItemRequestSchema,
  CreateModelConfirmationRequestSchema,
  DesignItemResponseSchema,
  ModelConfirmationResponseSchema,
  SaveSceneRequestSchema,
  SceneConfirmationResponseSchema,
  SceneConfirmationSnapshotSchema,
  SceneDraftSchema,
  SceneRecordSchema,
  ViewerStateResponseSchema,
  type ConfirmSceneRequest,
  type CreateDesignItemRequest,
  type CreateModelConfirmationRequest,
  type DesignItemResponse,
  type ModelConfirmationResponse,
  type SaveSceneRequest,
  type SceneConfirmationResponse,
  type SceneDraft,
  type SceneRecord,
  type ViewerStateResponse,
} from '../contracts/scenes.ts';
import { NotFoundError } from '../domain/index.ts';
import type { PrismaClient } from '../infra/db/index.ts';
import { resolveViewerCatalogAsset } from '../contracts/viewer-catalog.ts';

export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly currentRevision: number;

  constructor(expectedRevision: number, currentRevision: number) {
    super(`Scene revision conflict: expected ${expectedRevision}, current ${currentRevision}`);
    this.name = 'RevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

export class InvalidSceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSceneError';
  }
}

function isErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

function iso(value: Date) {
  return value.toISOString();
}

function toDesignItemResponse(row: {
  id: string;
  projectId: string;
  name: string;
  currentModelConfirmationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DesignItemResponse {
  return DesignItemResponseSchema.parse({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });
}

function toModelConfirmationResponse(row: {
  id: string;
  designItemId: string;
  modelRef: unknown;
  sourceBoundsMm: unknown;
  uniformScale: number;
  finalBoundsMm: unknown;
  confirmedAt: Date;
}): ModelConfirmationResponse {
  return ModelConfirmationResponseSchema.parse({
    id: row.id,
    designItemId: row.designItemId,
    modelRef: row.modelRef,
    sourceBoundsMm: row.sourceBoundsMm,
    uniformScale: row.uniformScale,
    finalBoundsMm: row.finalBoundsMm,
    confirmedAt: iso(row.confirmedAt),
  });
}

function toSceneDraft(row: {
  projectId: string;
  targetDesignItemId: string;
  targetModelConfirmationId: string;
  targetInstanceId: string;
  cageMm: unknown;
  items: unknown;
}): SceneDraft {
  return SceneDraftSchema.parse({
    schemaVersion: 'scene-draft.v1',
    stage: 'scene_editing',
    projectId: row.projectId,
    targetDesignItemId: row.targetDesignItemId,
    targetModelConfirmationId: row.targetModelConfirmationId,
    targetInstanceId: row.targetInstanceId,
    cageMm: row.cageMm,
    items: row.items,
  });
}

function toSceneRecord(row: {
  id: string;
  revision: number;
  updatedAt: Date;
  projectId: string;
  targetDesignItemId: string;
  targetModelConfirmationId: string;
  targetInstanceId: string;
  cageMm: unknown;
  items: unknown;
}): SceneRecord {
  return SceneRecordSchema.parse({
    id: row.id,
    revision: row.revision,
    updatedAt: iso(row.updatedAt),
    draft: toSceneDraft(row),
  });
}

async function requireOwnedProject(prisma: PrismaClient, ownerUserId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerUserId } });
  if (!project) throw new NotFoundError('Project');
  return project;
}

async function validateOwnedModelRefs({
  prisma,
  ownerUserId,
  projectId,
  modelRefs,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  projectId: string;
  modelRefs: SceneDraft['items'][number]['modelRef'][];
}) {
  const ownedRefs = modelRefs.filter((ref): ref is Extract<typeof ref, { kind: 'owned_asset' }> => ref.kind === 'owned_asset');
  if (!ownedRefs.length) return;
  const assets = await prisma.asset.findMany({
    where: {
      id: { in: [...new Set(ownedRefs.map((ref) => ref.assetId))] },
      ownerUserId,
      projectId,
      status: 'available',
      checksum: { not: null },
    },
    select: { id: true, checksum: true },
  });
  const checksums = new Map(assets.map((asset) => [asset.id, asset.checksum]));
  if (ownedRefs.some((ref) => checksums.get(ref.assetId) !== ref.checksum)) {
    throw new NotFoundError('Asset');
  }
}

function sameBounds(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
) {
  return (['x', 'y', 'z'] as const).every((axis) => Math.abs(left[axis] - right[axis]) <= 1e-6);
}

function validateTemporaryModelRef({
  modelRef,
  sourceBoundsMm,
  expectedRole,
}: {
  modelRef: SceneDraft['items'][number]['modelRef'];
  sourceBoundsMm: { x: number; y: number; z: number };
  expectedRole: 'target' | 'context' | 'pet_reference';
}) {
  if (modelRef.kind !== 'temporary_catalog') return;
  let catalog;
  try {
    catalog = resolveViewerCatalogAsset(modelRef.assetKey);
  } catch {
    throw new NotFoundError('TemporaryCatalogAsset');
  }
  if (
    catalog.role !== expectedRole ||
    catalog.checksum !== modelRef.checksum ||
    !sameBounds(catalog.sourceBoundsMm, sourceBoundsMm)
  ) {
    throw new NotFoundError('TemporaryCatalogAsset');
  }
}

function worldAabb(item: SceneDraft['items'][number]) {
  const cosine = Math.abs(Math.cos(item.rotationYRad));
  const sine = Math.abs(Math.sin(item.rotationYRad));
  const halfX = (item.finalBoundsMm.x * cosine + item.finalBoundsMm.z * sine) / 2;
  const halfZ = (item.finalBoundsMm.x * sine + item.finalBoundsMm.z * cosine) / 2;
  return {
    min: { x: item.positionMm.x - halfX, y: item.positionMm.y, z: item.positionMm.z - halfZ },
    max: { x: item.positionMm.x + halfX, y: item.positionMm.y + item.finalBoundsMm.y, z: item.positionMm.z + halfZ },
  };
}

function validateSceneGeometry(draft: SceneDraft) {
  const physical = draft.items.filter((item) => item.role !== 'pet_reference');
  const boxes = physical.map((item) => ({ item, box: worldAabb(item) }));
  for (const { item, box } of boxes) {
    if (
      box.min.x < -draft.cageMm.width / 2 || box.max.x > draft.cageMm.width / 2 ||
      box.min.z < -draft.cageMm.depth / 2 || box.max.z > draft.cageMm.depth / 2 ||
      box.min.y < 0 || box.max.y > draft.cageMm.height
    ) {
      throw new InvalidSceneError(`Scene geometry invalid: ${item.instanceId} is outside cage bounds`);
    }
  }
  for (let index = 0; index < boxes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < boxes.length; otherIndex += 1) {
      const left = boxes[index]!;
      const right = boxes[otherIndex]!;
      const overlap =
        left.box.min.x < right.box.max.x && left.box.max.x > right.box.min.x &&
        left.box.min.y < right.box.max.y && left.box.max.y > right.box.min.y &&
        left.box.min.z < right.box.max.z && left.box.max.z > right.box.min.z;
      if (overlap) throw new InvalidSceneError(`Scene geometry invalid: ${left.item.instanceId} collides with ${right.item.instanceId}`);
    }
  }
}

export async function createDesignItem({
  prisma,
  ownerUserId,
  projectId,
  input,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  projectId: string;
  input: CreateDesignItemRequest;
}): Promise<DesignItemResponse> {
  const parsed = CreateDesignItemRequestSchema.parse(input);
  await requireOwnedProject(prisma, ownerUserId, projectId);
  return toDesignItemResponse(await prisma.designItem.create({ data: { projectId, name: parsed.name } }));
}

export async function createModelConfirmation({
  prisma,
  ownerUserId,
  designItemId,
  input,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  designItemId: string;
  input: CreateModelConfirmationRequest;
}): Promise<ModelConfirmationResponse> {
  const parsed = CreateModelConfirmationRequestSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const designItem = await tx.designItem.findFirst({
      where: { id: designItemId, project: { ownerUserId } },
      select: { id: true, projectId: true },
    });
    if (!designItem) throw new NotFoundError('DesignItem');
    validateTemporaryModelRef({
      modelRef: parsed.modelRef,
      sourceBoundsMm: parsed.sourceBoundsMm,
      expectedRole: 'target',
    });
    await validateOwnedModelRefs({
      prisma: tx as PrismaClient,
      ownerUserId,
      projectId: designItem.projectId,
      modelRefs: [parsed.modelRef],
    });
    const confirmation = await tx.modelConfirmation.create({
      data: {
        designItemId,
        modelRef: parsed.modelRef,
        sourceBoundsMm: parsed.sourceBoundsMm,
        uniformScale: parsed.uniformScale,
        finalBoundsMm: parsed.finalBoundsMm,
        confirmedByUserId: ownerUserId,
      },
    });
    await tx.designItem.update({
      where: { id: designItemId },
      data: { currentModelConfirmationId: confirmation.id },
    });
    return toModelConfirmationResponse(confirmation);
  });
}

async function validateDraftReferences({
  prisma,
  ownerUserId,
  projectId,
  draft,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  projectId: string;
  draft: SceneDraft;
}) {
  if (draft.projectId !== projectId) throw new NotFoundError('Project');
  const modelConfirmation = await prisma.modelConfirmation.findFirst({
    where: {
      id: draft.targetModelConfirmationId,
      designItemId: draft.targetDesignItemId,
      confirmedByUserId: ownerUserId,
      designItem: { projectId, project: { ownerUserId } },
    },
    select: { id: true, modelRef: true },
  });
  if (!modelConfirmation) throw new NotFoundError('ModelConfirmation');
  const target = draft.items.find((item) => item.instanceId === draft.targetInstanceId);
  if (!target || JSON.stringify(target.modelRef) !== JSON.stringify(modelConfirmation.modelRef)) {
    throw new NotFoundError('ModelConfirmation');
  }
  for (const item of draft.items) {
    validateTemporaryModelRef({
      modelRef: item.modelRef,
      sourceBoundsMm: item.sourceBoundsMm,
      expectedRole: item.role,
    });
  }
  await validateOwnedModelRefs({
    prisma,
    ownerUserId,
    projectId,
    modelRefs: draft.items.map((item) => item.modelRef),
  });
  validateSceneGeometry(draft);
}

export async function getSceneForProject({
  prisma,
  ownerUserId,
  projectId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  projectId: string;
}): Promise<SceneRecord | null> {
  await requireOwnedProject(prisma, ownerUserId, projectId);
  const row = await prisma.scene.findUnique({ where: { projectId } });
  return row ? toSceneRecord(row) : null;
}

export async function getViewerState({
  prisma,
  ownerUserId,
  projectId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  projectId: string;
}): Promise<ViewerStateResponse> {
  await requireOwnedProject(prisma, ownerUserId, projectId);
  const scene = await prisma.scene.findUnique({ where: { projectId } });
  const designItem = scene
    ? await prisma.designItem.findUniqueOrThrow({ where: { id: scene.targetDesignItemId } })
    : await prisma.designItem.findFirst({ where: { projectId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
  const modelConfirmation = scene
    ? await prisma.modelConfirmation.findUniqueOrThrow({ where: { id: scene.targetModelConfirmationId } })
    : designItem?.currentModelConfirmationId
      ? await prisma.modelConfirmation.findUnique({ where: { id: designItem.currentModelConfirmationId } })
      : null;
  const latestSceneConfirmation = scene
    ? await prisma.sceneConfirmation.findFirst({
        where: { sceneId: scene.id },
        orderBy: [{ sceneRevision: 'desc' }, { confirmedAt: 'desc' }],
      })
    : null;
  return ViewerStateResponseSchema.parse({
    designItem: designItem ? toDesignItemResponse(designItem) : null,
    modelConfirmation: modelConfirmation ? toModelConfirmationResponse(modelConfirmation) : null,
    scene: scene ? toSceneRecord(scene) : null,
    latestSceneConfirmation: latestSceneConfirmation ? toSceneConfirmationResponse(latestSceneConfirmation) : null,
  });
}

export async function saveScene({
  prisma,
  ownerUserId,
  projectId,
  input,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  projectId: string;
  input: SaveSceneRequest;
}): Promise<SceneRecord> {
  const parsed = SaveSceneRequestSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireOwnedProject(tx as PrismaClient, ownerUserId, projectId);
    // Serialize create/CAS writers for this Project. This closes the first-Scene
    // unique race and makes the stale revision observed after the lock definitive.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "project" WHERE "id" = ${projectId} FOR UPDATE
    `;
    await validateDraftReferences({ prisma: tx as PrismaClient, ownerUserId, projectId, draft: parsed.draft });
    const existing = await tx.scene.findUnique({ where: { projectId } });
    if (!existing) {
      if (parsed.expectedRevision !== 0) throw new RevisionConflictError(parsed.expectedRevision, 0);
      try {
        return toSceneRecord(await tx.scene.create({
          data: {
            projectId,
            targetDesignItemId: parsed.draft.targetDesignItemId,
            targetModelConfirmationId: parsed.draft.targetModelConfirmationId,
            targetInstanceId: parsed.draft.targetInstanceId,
            cageMm: parsed.draft.cageMm,
            items: parsed.draft.items,
            revision: 1,
          },
        }));
      } catch (error) {
        if (!isErrorCode(error, 'P2002')) throw error;
        const concurrent = await tx.scene.findUniqueOrThrow({ where: { projectId } });
        throw new RevisionConflictError(parsed.expectedRevision, concurrent.revision);
      }
    }
    if (existing.revision !== parsed.expectedRevision) {
      throw new RevisionConflictError(parsed.expectedRevision, existing.revision);
    }
    const updated = await tx.scene.updateMany({
      where: { id: existing.id, revision: parsed.expectedRevision },
      data: {
        targetDesignItemId: parsed.draft.targetDesignItemId,
        targetModelConfirmationId: parsed.draft.targetModelConfirmationId,
        targetInstanceId: parsed.draft.targetInstanceId,
        cageMm: parsed.draft.cageMm,
        items: parsed.draft.items,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      const current = await tx.scene.findUniqueOrThrow({ where: { id: existing.id } });
      throw new RevisionConflictError(parsed.expectedRevision, current.revision);
    }
    return toSceneRecord(await tx.scene.findUniqueOrThrow({ where: { id: existing.id } }));
  }, { isolationLevel: 'ReadCommitted' });
}

export async function confirmScene({
  prisma,
  ownerUserId,
  input,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  input: ConfirmSceneRequest;
}): Promise<SceneConfirmationResponse> {
  const parsed = ConfirmSceneRequestSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const owned = await tx.scene.findFirst({
      where: { id: parsed.sceneId, project: { ownerUserId } },
      select: { id: true },
    });
    if (!owned) throw new NotFoundError('Scene');
    // A confirmation and a draft save cannot cross: whichever locks the Scene
    // first completes, and the follower observes the definitive revision.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "scene" WHERE "id" = ${parsed.sceneId} FOR UPDATE
    `;
    const existing = await tx.sceneConfirmation.findUnique({
      where: { sceneId_sceneRevision: { sceneId: parsed.sceneId, sceneRevision: parsed.sceneRevision } },
    });
    if (existing) return toSceneConfirmationResponse(existing);

    const scene = await tx.scene.findFirst({ where: { id: parsed.sceneId, project: { ownerUserId } } });
    if (!scene) throw new NotFoundError('Scene');
    if (scene.revision !== parsed.sceneRevision) throw new RevisionConflictError(parsed.sceneRevision, scene.revision);
    const draft = toSceneDraft(scene);
    await validateDraftReferences({ prisma: tx as PrismaClient, ownerUserId, projectId: scene.projectId, draft });
    const confirmedAt = new Date();
    const snapshot = SceneConfirmationSnapshotSchema.parse({
      ...draft,
      schemaVersion: 'scene-confirmation.v1',
      sceneId: scene.id,
      sceneRevision: scene.revision,
      confirmedAt: iso(confirmedAt),
    });
    return toSceneConfirmationResponse(await tx.sceneConfirmation.create({
      data: {
        sceneId: scene.id,
        sceneRevision: scene.revision,
        targetDesignItemId: scene.targetDesignItemId,
        targetModelConfirmationId: scene.targetModelConfirmationId,
        targetInstanceId: scene.targetInstanceId,
        snapshotSchemaVersion: 'scene-confirmation.v1',
        snapshot,
        confirmedByUserId: ownerUserId,
        confirmedAt,
      },
    }));
  });
}

function toSceneConfirmationResponse(row: {
  id: string;
  sceneId: string;
  sceneRevision: number;
  snapshot: unknown;
  confirmedAt: Date;
}): SceneConfirmationResponse {
  return SceneConfirmationResponseSchema.parse({
    id: row.id,
    sceneId: row.sceneId,
    sceneRevision: row.sceneRevision,
    snapshot: row.snapshot,
    confirmedAt: iso(row.confirmedAt),
  });
}

export async function getSceneConfirmation({
  prisma,
  ownerUserId,
  sceneConfirmationId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  sceneConfirmationId: string;
}): Promise<SceneConfirmationResponse> {
  const row = await prisma.sceneConfirmation.findFirst({
    where: { id: sceneConfirmationId, scene: { project: { ownerUserId } } },
  });
  if (!row) throw new NotFoundError('SceneConfirmation');
  return toSceneConfirmationResponse(row);
}
