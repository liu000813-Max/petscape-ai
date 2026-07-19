// WP-B45-3 — Viewer-owned producer for the WP-SEAM-0 shared contract.
// The immutable SceneConfirmation snapshot is the only source of commerce data;
// mutable Scene and Asset rows are deliberately not consulted during mapping.
import {
  SCENE_CONFIRMATION_COMMERCE_SCHEMA_VERSION,
  SceneConfirmationCommerceInputSchema,
  type SceneConfirmationAssetRef,
  type SceneConfirmationCommerceInput,
} from '../contracts/scene-confirmation-commerce.ts';
import { SceneConfirmationSnapshotSchema, type ModelRef } from '../contracts/scenes.ts';
import { NotFoundError } from '../domain/index.ts';
import type { PrismaClient } from '../infra/db/index.ts';

function toCommerceAssetRef(modelRef: ModelRef): SceneConfirmationAssetRef {
  if (modelRef.kind === 'owned_asset') {
    return {
      kind: 'owned_asset',
      assetId: modelRef.assetId,
      sha256: modelRef.checksum,
    };
  }
  return {
    kind: 'temporary_catalog',
    assetKey: modelRef.assetKey,
    sha256: modelRef.checksum,
  };
}

export async function produceSceneConfirmationCommerceInput({
  prisma,
  ownerUserId,
  sceneConfirmationId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  sceneConfirmationId: string;
}): Promise<SceneConfirmationCommerceInput> {
  const row = await prisma.sceneConfirmation.findFirst({
    where: {
      id: sceneConfirmationId,
      scene: { project: { ownerUserId } },
    },
    select: {
      id: true,
      sceneId: true,
      sceneRevision: true,
      targetDesignItemId: true,
      targetModelConfirmationId: true,
      targetInstanceId: true,
      confirmedAt: true,
      snapshot: true,
      scene: { select: { projectId: true } },
    },
  });
  if (!row) throw new NotFoundError('SceneConfirmation');

  const snapshot = SceneConfirmationSnapshotSchema.parse(row.snapshot);
  const target = snapshot.items.find(
    (item) => item.role === 'target' && item.instanceId === snapshot.targetInstanceId,
  );
  const rowMatchesSnapshot =
    snapshot.sceneId === row.sceneId &&
    snapshot.sceneRevision === row.sceneRevision &&
    snapshot.projectId === row.scene.projectId &&
    snapshot.targetDesignItemId === row.targetDesignItemId &&
    snapshot.targetModelConfirmationId === row.targetModelConfirmationId &&
    snapshot.targetInstanceId === row.targetInstanceId &&
    snapshot.confirmedAt === row.confirmedAt.toISOString();
  if (!target || !rowMatchesSnapshot) throw new NotFoundError('SceneConfirmation');

  return SceneConfirmationCommerceInputSchema.parse({
    schemaVersion: SCENE_CONFIRMATION_COMMERCE_SCHEMA_VERSION,
    sceneConfirmationId: row.id,
    projectId: snapshot.projectId,
    targetInstanceId: target.instanceId,
    assetRef: toCommerceAssetRef(target.modelRef),
    dimensionsMm: target.finalBoundsMm,
    rotationYRad: target.rotationYRad,
    uniformScale: target.uniformScale,
    confirmedAt: row.confirmedAt.toISOString(),
    source: 'viewer_scene_confirmation',
    eligibility: target.modelRef.kind === 'temporary_catalog' ? 'sandbox_only' : 'formal_candidate',
  });
}
