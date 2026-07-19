import type {
  SceneConfirmationSnapshot,
  SceneDraft,
  SceneItem,
} from '@petscape/server/contracts/scenes';

import {
  aabbOverlap,
  cageViolation,
  calculateFinalBounds,
  rotatedWorldAabb,
  supportSurfaceY,
  type CageMm,
  type PositionMm,
} from './geometry.ts';

export type CageValidationIssue =
  | 'cage_width_invalid'
  | 'cage_height_invalid'
  | 'cage_depth_invalid';

export type SceneBlockingReason =
  | CageValidationIssue
  | 'context_role_required'
  | 'duplicate_instance_id'
  | 'item_not_found'
  | 'target_cannot_be_removed'
  | 'target_model_confirmation_missing'
  | 'target_asset_unreadable'
  | 'scene_revision_unsaved'
  | 'scene_target_invalid'
  | 'pet_reference_locked'
  | 'transform_invalid'
  | `item_out_of_bounds:${string}:${'x' | 'z' | 'floor' | 'height'}`
  | `item_collision:${string}:${string}`;

type SceneItemTransform = Pick<
  SceneItem,
  'positionMm' | 'rotationYRad' | 'uniformScale' | 'finalBoundsMm'
>;

export type SceneEditorState = {
  draft: SceneDraft;
  resetTransforms: Readonly<Record<string, SceneItemTransform>>;
  lastConfirmation: SceneConfirmationSnapshot | null;
};

export type SceneMutationResult = {
  state: SceneEditorState;
  accepted: boolean;
  blockingReasons: SceneBlockingReason[];
};

export type SceneConfirmationEligibility = {
  eligible: boolean;
  blockingReasons: SceneBlockingReason[];
};

const PET_REFERENCE_ASSET_KEY = 'procedural-adult-rat-reference-v1';
const PET_REFERENCE_CHECKSUM = '9a330c398ac69a5968e94688c73701848a3470140604a054dc88278d40448e3d';
const PET_REFERENCE_BOUNDS_MM = { x: 220, y: 110, z: 80 } as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function transformOf(item: SceneItem): SceneItemTransform {
  return clone({
    positionMm: item.positionMm,
    rotationYRad: item.rotationYRad,
    uniformScale: item.uniformScale,
    finalBoundsMm: item.finalBoundsMm,
  });
}

function accepted(state: SceneEditorState): SceneMutationResult {
  return { state, accepted: true, blockingReasons: [] };
}

function blocked(
  state: SceneEditorState,
  ...blockingReasons: SceneBlockingReason[]
): SceneMutationResult {
  return { state, accepted: false, blockingReasons };
}

function replaceItem(
  state: SceneEditorState,
  replacement: SceneItem,
): SceneEditorState {
  return {
    ...state,
    draft: {
      ...state.draft,
      items: state.draft.items.map((item) =>
        item.instanceId === replacement.instanceId ? replacement : item,
      ),
    },
  };
}

function isPhysicalItem(item: SceneItem): boolean {
  return item.role !== 'pet_reference';
}

function itemWorldAabb(item: SceneItem) {
  return rotatedWorldAabb(item.finalBoundsMm, item.positionMm, item.rotationYRad);
}

function placementReasons(
  candidate: SceneItem,
  cageMm: CageMm,
  otherItems: readonly SceneItem[],
): SceneBlockingReason[] {
  if (!isPhysicalItem(candidate)) return [];

  const candidateBox = itemWorldAabb(candidate);
  const violation = cageViolation(candidateBox, cageMm);
  if (violation) {
    return [`item_out_of_bounds:${candidate.instanceId}:${violation}`];
  }

  const collision = otherItems.find(
    (other) =>
      isPhysicalItem(other) &&
      other.instanceId !== candidate.instanceId &&
      aabbOverlap(candidateBox, itemWorldAabb(other)),
  );
  if (collision) {
    return [`item_collision:${candidate.instanceId}:${collision.instanceId}`];
  }
  return [];
}

function validFinitePosition(position: PositionMm): boolean {
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    position.y >= 0 &&
    Number.isFinite(position.z)
  );
}

export function validateCageDimensions(cageMm: CageMm): CageValidationIssue[] {
  const issues: CageValidationIssue[] = [];
  if (!Number.isFinite(cageMm.width) || cageMm.width <= 0) issues.push('cage_width_invalid');
  if (!Number.isFinite(cageMm.height) || cageMm.height <= 0) issues.push('cage_height_invalid');
  if (!Number.isFinite(cageMm.depth) || cageMm.depth <= 0) issues.push('cage_depth_invalid');
  return issues;
}

export function createSceneEditorState(
  draft: SceneDraft,
  lastConfirmation: SceneConfirmationSnapshot | null = null,
): SceneEditorState {
  const resetTransforms = Object.fromEntries(
    draft.items.map((item) => [item.instanceId, transformOf(item)]),
  );
  return {
    draft: clone(draft),
    resetTransforms,
    lastConfirmation: lastConfirmation ? clone(lastConfirmation) : null,
  };
}

export function updateCageDimensions(
  state: SceneEditorState,
  cageMm: CageMm,
): SceneEditorState {
  return {
    ...state,
    draft: { ...state.draft, cageMm: clone(cageMm) },
  };
}

export function addContextItem(
  state: SceneEditorState,
  context: SceneItem,
): SceneMutationResult {
  if (context.role !== 'context') return blocked(state, 'context_role_required');
  if (state.draft.items.some((item) => item.instanceId === context.instanceId)) {
    return blocked(state, 'duplicate_instance_id');
  }
  if (
    !validFinitePosition(context.positionMm) ||
    !Number.isFinite(context.rotationYRad) ||
    !Number.isFinite(context.uniformScale) ||
    context.uniformScale <= 0
  ) {
    return blocked(state, 'transform_invalid');
  }

  const normalizedContext = {
    ...context,
    finalBoundsMm: calculateFinalBounds(context.sourceBoundsMm, context.uniformScale),
  };
  const reasons = placementReasons(normalizedContext, state.draft.cageMm, state.draft.items);
  if (reasons.length > 0) return blocked(state, ...reasons);

  const next = clone(normalizedContext);
  return accepted({
    ...state,
    draft: { ...state.draft, items: [...state.draft.items, next] },
    resetTransforms: {
      ...state.resetTransforms,
      [next.instanceId]: transformOf(next),
    },
  });
}

export function addPetReference(
  state: SceneEditorState,
  instanceId: string,
  positionMm: PositionMm,
): SceneMutationResult {
  if (state.draft.items.some((item) => item.instanceId === instanceId)) {
    return blocked(state, 'duplicate_instance_id');
  }
  if (!validFinitePosition(positionMm)) return blocked(state, 'transform_invalid');

  const reference: SceneItem = {
    instanceId,
    role: 'pet_reference',
    modelConfirmationId: null,
    modelRef: {
      kind: 'temporary_catalog',
      assetKey: PET_REFERENCE_ASSET_KEY,
      checksum: PET_REFERENCE_CHECKSUM,
      quoteEligible: false,
    },
    positionMm: clone(positionMm),
    rotationYRad: 0,
    uniformScale: 1,
    sourceBoundsMm: clone(PET_REFERENCE_BOUNDS_MM),
    finalBoundsMm: clone(PET_REFERENCE_BOUNDS_MM),
  };

  return accepted({
    ...state,
    draft: { ...state.draft, items: [...state.draft.items, reference] },
    resetTransforms: {
      ...state.resetTransforms,
      [reference.instanceId]: transformOf(reference),
    },
  });
}

export function removeSceneItem(
  state: SceneEditorState,
  instanceId: string,
): SceneMutationResult {
  const item = state.draft.items.find((candidate) => candidate.instanceId === instanceId);
  if (!item) return blocked(state, 'item_not_found');
  if (item.role === 'target') return blocked(state, 'target_cannot_be_removed');

  const remainingTransforms = Object.fromEntries(
    Object.entries(state.resetTransforms).filter(([key]) => key !== instanceId),
  );
  return accepted({
    ...state,
    draft: {
      ...state.draft,
      items: state.draft.items.filter((candidate) => candidate.instanceId !== instanceId),
    },
    resetTransforms: remainingTransforms,
  });
}

export function updateSceneItemTransform(
  state: SceneEditorState,
  instanceId: string,
  patch: Partial<Pick<SceneItem, 'positionMm' | 'rotationYRad' | 'uniformScale'>>,
): SceneMutationResult {
  const item = state.draft.items.find((candidate) => candidate.instanceId === instanceId);
  if (!item) return blocked(state, 'item_not_found');
  if (item.role === 'pet_reference') return blocked(state, 'pet_reference_locked');

  const positionMm = patch.positionMm ?? item.positionMm;
  const rotationYRad = patch.rotationYRad ?? item.rotationYRad;
  const uniformScale = patch.uniformScale ?? item.uniformScale;
  if (
    !validFinitePosition(positionMm) ||
    !Number.isFinite(rotationYRad) ||
    !Number.isFinite(uniformScale) ||
    uniformScale <= 0
  ) {
    return blocked(state, 'transform_invalid');
  }

  let finalBoundsMm;
  try {
    finalBoundsMm = calculateFinalBounds(item.sourceBoundsMm, uniformScale);
  } catch {
    return blocked(state, 'transform_invalid');
  }

  const replacement: SceneItem = {
    ...item,
    positionMm: clone(positionMm),
    rotationYRad,
    uniformScale,
    finalBoundsMm,
  };
  const reasons = placementReasons(replacement, state.draft.cageMm, state.draft.items);
  if (reasons.length > 0) return blocked(state, ...reasons);
  return accepted(replaceItem(state, replacement));
}

export function snapSceneItemToSupport(
  state: SceneEditorState,
  instanceId: string,
): SceneMutationResult {
  const item = state.draft.items.find((candidate) => candidate.instanceId === instanceId);
  if (!item) return blocked(state, 'item_not_found');
  if (!isPhysicalItem(item)) return accepted(state);

  const floorCandidate = itemWorldAabb({
    ...item,
    positionMm: { ...item.positionMm, y: 0 },
  });
  const supports = state.draft.items
    .filter((candidate) => candidate.instanceId !== instanceId && isPhysicalItem(candidate))
    .map(itemWorldAabb);
  const y = supportSurfaceY(floorCandidate, supports);
  return updateSceneItemTransform(state, instanceId, {
    positionMm: { ...item.positionMm, y },
  });
}

export function resetSceneItem(
  state: SceneEditorState,
  instanceId: string,
): SceneMutationResult {
  const item = state.draft.items.find((candidate) => candidate.instanceId === instanceId);
  const reset = state.resetTransforms[instanceId];
  if (!item || !reset) return blocked(state, 'item_not_found');
  return accepted(replaceItem(state, { ...item, ...clone(reset) }));
}

export function resetAllSceneItems(state: SceneEditorState): SceneEditorState {
  return {
    ...state,
    draft: {
      ...state.draft,
      items: state.draft.items.map((item) => {
        const reset = state.resetTransforms[item.instanceId];
        return reset ? { ...item, ...clone(reset) } : item;
      }),
    },
  };
}

export function isQuoteEligibleItem(item: SceneItem): boolean {
  return item.role === 'target' && item.modelRef.quoteEligible;
}

function sceneGeometryReasons(state: SceneEditorState): SceneBlockingReason[] {
  const reasons: SceneBlockingReason[] = [];
  const physicalItems = state.draft.items.filter(isPhysicalItem);

  for (const item of physicalItems) {
    const violation = cageViolation(itemWorldAabb(item), state.draft.cageMm);
    if (violation) reasons.push(`item_out_of_bounds:${item.instanceId}:${violation}`);
  }
  for (let left = 0; left < physicalItems.length; left += 1) {
    for (let right = left + 1; right < physicalItems.length; right += 1) {
      const a = physicalItems[left];
      const b = physicalItems[right];
      if (a && b && aabbOverlap(itemWorldAabb(a), itemWorldAabb(b))) {
        reasons.push(`item_collision:${a.instanceId}:${b.instanceId}`);
      }
    }
  }
  return reasons;
}

export function getSceneConfirmationEligibility(
  state: SceneEditorState,
  status: { targetAssetReadable: boolean; savedRevisionMatches: boolean },
): SceneConfirmationEligibility {
  const reasons: SceneBlockingReason[] = [];
  const targets = state.draft.items.filter((item) => item.role === 'target');
  const target = targets[0];

  if (!state.draft.targetModelConfirmationId.trim()) {
    reasons.push('target_model_confirmation_missing');
  }
  if (!status.targetAssetReadable) reasons.push('target_asset_unreadable');
  if (!status.savedRevisionMatches) reasons.push('scene_revision_unsaved');
  reasons.push(...validateCageDimensions(state.draft.cageMm));
  if (
    targets.length !== 1 ||
    !target ||
    target.instanceId !== state.draft.targetInstanceId ||
    target.modelConfirmationId !== state.draft.targetModelConfirmationId
  ) {
    reasons.push('scene_target_invalid');
  }
  reasons.push(...sceneGeometryReasons(state));
  return { eligible: reasons.length === 0, blockingReasons: reasons };
}

function confirmationComparable(value: SceneDraft | SceneConfirmationSnapshot) {
  return {
    projectId: value.projectId,
    targetDesignItemId: value.targetDesignItemId,
    targetModelConfirmationId: value.targetModelConfirmationId,
    targetInstanceId: value.targetInstanceId,
    cageMm: value.cageMm,
    items: value.items,
  };
}

function stableJson(value: unknown): string {
  const canonicalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonicalize);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonicalize(child)]),
      );
    }
    return entry;
  };
  return JSON.stringify(canonicalize(value));
}

export function draftDiffersFromLastConfirmation(state: SceneEditorState): boolean {
  if (!state.lastConfirmation) return false;
  return (
    stableJson(confirmationComparable(state.draft)) !==
    stableJson(confirmationComparable(state.lastConfirmation))
  );
}
