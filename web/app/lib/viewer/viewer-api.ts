import {
  DesignItemResponseSchema,
  ModelConfirmationResponseSchema,
  SceneApiErrorSchema,
  SceneConfirmationResponseSchema,
  SceneRecordSchema,
  ViewerStateResponseSchema,
  type CreateModelConfirmationRequest,
  type DesignItemResponse,
  type ModelConfirmationResponse,
  type SaveSceneRequest,
  type SceneConfirmationResponse,
  type SceneRecord,
  type ViewerStateResponse,
} from '@petscape/server/contracts/scenes';

export class ViewerApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly expectedRevision?: number;
  readonly currentRevision?: number;

  constructor(status: number, code: string, message: string, expectedRevision?: number, currentRevision?: number) {
    super(message);
    this.name = 'ViewerApiError';
    this.status = status;
    this.code = code;
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

async function jsonRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = SceneApiErrorSchema.safeParse(json);
    throw new ViewerApiError(
      response.status,
      parsed.success ? parsed.data.error : 'unexpected_response',
      parsed.success ? parsed.data.detail ?? parsed.data.error : `HTTP ${response.status}`,
      parsed.success ? parsed.data.expectedRevision : undefined,
      parsed.success ? parsed.data.currentRevision : undefined,
    );
  }
  return json;
}

export async function loadViewerState(projectId: string): Promise<ViewerStateResponse> {
  return ViewerStateResponseSchema.parse(await jsonRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/viewer-state`));
}

export async function createViewerDesignItem(projectId: string, name: string): Promise<DesignItemResponse> {
  return DesignItemResponseSchema.parse(await jsonRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/design-items`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  }));
}

export async function confirmViewerModel(designItemId: string, input: CreateModelConfirmationRequest): Promise<ModelConfirmationResponse> {
  return ModelConfirmationResponseSchema.parse(await jsonRequest(`/api/v1/design-items/${encodeURIComponent(designItemId)}/model-confirmations`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  }));
}

export async function saveViewerScene(projectId: string, input: SaveSceneRequest): Promise<SceneRecord> {
  return SceneRecordSchema.parse(await jsonRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/scene`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  }));
}

export async function confirmViewerScene(sceneId: string, sceneRevision: number): Promise<SceneConfirmationResponse> {
  return SceneConfirmationResponseSchema.parse(await jsonRequest(`/api/v1/scenes/${encodeURIComponent(sceneId)}/confirmations`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneId, sceneRevision }),
  }));
}
