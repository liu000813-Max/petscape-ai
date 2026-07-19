import { VIEWER_ASSET_CATALOG, getViewerAsset } from './catalog.ts';
import type { BoundsMm } from './geometry';

export const TARGET_INSPECTION_ASSETS = VIEWER_ASSET_CATALOG.filter((asset) => asset.role === 'target');

export type InspectionLoadStatus = 'loading' | 'ready' | 'error';
export type InspectionStage = 'model_review' | 'scene_editing';

export type ModelConfirmationSnapshot = Readonly<{
  modelRef: Readonly<{
    kind: 'temporary_catalog';
    assetKey: string;
    checksum: string;
    quoteEligible: false;
  }>;
  sourceBoundsMm: Readonly<BoundsMm>;
  uniformScale: number;
  finalBoundsMm: Readonly<BoundsMm>;
  confirmedAt: string;
}>;

export type ModelInspectionState = Readonly<{
  stage: InspectionStage;
  assetKey: string;
  uniformScale: number;
  finalBoundsMm: BoundsMm;
  loadStatus: InspectionLoadStatus;
  loadError: string | null;
  loadRequestId: number;
  confirmations: readonly ModelConfirmationSnapshot[];
}>;

function roundedMillimetres(value: number) {
  return Number(value.toFixed(3));
}

function scaledBounds(assetKey: string, uniformScale: number): BoundsMm {
  const source = getViewerAsset(assetKey).sourceBoundsMm;
  return {
    x: roundedMillimetres(source.x * uniformScale),
    y: roundedMillimetres(source.y * uniformScale),
    z: roundedMillimetres(source.z * uniformScale),
  };
}

export function createModelInspectionState(assetKey = TARGET_INSPECTION_ASSETS[0].assetKey): ModelInspectionState {
  const asset = getViewerAsset(assetKey);
  if (asset.role !== 'target') throw new Error('单品检视只接受 target 资产');
  return {
    stage: 'model_review',
    assetKey,
    uniformScale: 1,
    finalBoundsMm: scaledBounds(assetKey, 1),
    loadStatus: 'loading',
    loadError: null,
    loadRequestId: 1,
    confirmations: [],
  };
}

export function selectInspectionAsset(state: ModelInspectionState, assetKey: string): ModelInspectionState {
  const asset = getViewerAsset(assetKey);
  if (asset.role !== 'target') throw new Error('单品检视只接受 target 资产');
  return {
    ...state,
    stage: 'model_review',
    assetKey,
    uniformScale: 1,
    finalBoundsMm: scaledBounds(assetKey, 1),
    loadStatus: 'loading',
    loadError: null,
    loadRequestId: state.loadRequestId + 1,
  };
}

export function retryInspectionLoad(state: ModelInspectionState): ModelInspectionState {
  return {
    ...state,
    loadStatus: 'loading',
    loadError: null,
    loadRequestId: state.loadRequestId + 1,
  };
}

export function markInspectionLoadReady(
  state: ModelInspectionState,
  loadRequestId: number,
): ModelInspectionState {
  if (loadRequestId !== state.loadRequestId) return state;
  return { ...state, loadStatus: 'ready', loadError: null };
}

export function markInspectionLoadError(
  state: ModelInspectionState,
  loadRequestId: number,
  error: string,
): ModelInspectionState {
  if (loadRequestId !== state.loadRequestId) return state;
  return { ...state, loadStatus: 'error', loadError: error };
}

export function setInspectionUniformScale(
  state: ModelInspectionState,
  uniformScale: number,
): ModelInspectionState {
  if (!Number.isFinite(uniformScale) || uniformScale <= 0) throw new Error('统一比例必须大于 0');
  return {
    ...state,
    uniformScale,
    finalBoundsMm: scaledBounds(state.assetKey, uniformScale),
  };
}

export function confirmInspectionModel(
  state: ModelInspectionState,
  confirmedAt: string,
): ModelInspectionState {
  if (state.loadStatus !== 'ready') throw new Error('模型加载完成后才能确认');
  const asset = getViewerAsset(state.assetKey);
  const snapshot = Object.freeze({
    modelRef: Object.freeze({ ...asset.modelRef }),
    sourceBoundsMm: Object.freeze({ ...asset.sourceBoundsMm }),
    uniformScale: state.uniformScale,
    finalBoundsMm: Object.freeze({ ...state.finalBoundsMm }),
    confirmedAt,
  });
  return {
    ...state,
    stage: 'scene_editing',
    confirmations: Object.freeze([...state.confirmations, snapshot]),
  };
}
