import type { ModelConfirmationResponse, SceneDraft } from '@petscape/server/contracts/scenes';
import { resolveViewerCatalogAsset } from '@petscape/server/contracts/viewer-catalog';

const rat = resolveViewerCatalogAsset('procedural-adult-rat-reference-v1');

export function createPersistedSceneDraft(
  projectId: string,
  designItemId: string,
  confirmation: ModelConfirmationResponse,
): SceneDraft {
  return {
    schemaVersion: 'scene-draft.v1',
    stage: 'scene_editing',
    projectId,
    targetDesignItemId: designItemId,
    targetModelConfirmationId: confirmation.id,
    targetInstanceId: 'target-primary',
    cageMm: { width: 800, height: 500, depth: 500 },
    items: [
      {
        instanceId: 'target-primary', role: 'target', modelConfirmationId: confirmation.id,
        modelRef: { ...confirmation.modelRef }, positionMm: { x: 0, y: 0, z: 0 }, rotationYRad: 0,
        uniformScale: confirmation.uniformScale, sourceBoundsMm: { ...confirmation.sourceBoundsMm },
        finalBoundsMm: { ...confirmation.finalBoundsMm },
      },
      {
        instanceId: 'pet-reference-rat', role: 'pet_reference', modelConfirmationId: null,
        modelRef: { kind: 'temporary_catalog', assetKey: rat.assetKey, checksum: rat.checksum, quoteEligible: false },
        positionMm: { x: 250, y: 0, z: -120 }, rotationYRad: 0, uniformScale: 1,
        sourceBoundsMm: { ...rat.sourceBoundsMm }, finalBoundsMm: { ...rat.sourceBoundsMm },
      },
    ],
  };
}

export function saveResponseLeavesDraftDirty(requestVersion: number, currentVersion: number) {
  return currentVersion !== requestVersion;
}
