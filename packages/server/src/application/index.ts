// application/ —— 用例层。
// WP-3.1：登录用例薄封装（getAuth）落地，见 ./auth.ts。
// WP-3.2：持久项目 + 私有资产用例落地，见 ./context.ts、./projects.ts、./assets.ts。
// 其余业务用例在后续工作包（Step 3 其余包）逐步添加。
export { getAuth } from './auth.ts';
export type { GetAuthOptions } from './auth.ts';

export { getServerContext } from './context.ts';
export type { ServerContext } from './context.ts';

export { createProject, listProjects, getProject } from './projects.ts';
export type {
  ProjectSummary,
  CreateProjectInput,
  ListProjectsInput,
  GetProjectInput,
} from './projects.ts';

export {
  requestAssetUpload,
  confirmAssetUpload,
  getAssetDownloadUrl,
  AssetVerificationError,
} from './assets.ts';

// A4：宠物档案 CRUD、软删除与封面 Asset 约束。
export {
  createPet,
  listPets,
  getPet,
  updatePet,
  deletePet,
  InvalidPetCoverError,
  InvalidPetProfileError,
} from './pets.ts';
export type { PetSummary } from './pets.ts';
export type {
  AssetSummary,
  RequestAssetUploadInput,
  RequestAssetUploadResult,
  ConfirmAssetUploadInput,
  GetAssetDownloadUrlInput,
  GetAssetDownloadUrlResult,
} from './assets.ts';

// WP-3.4：任务用例（createSampleJob/getJob），见 ./jobs.ts。
export { createSampleJob, getJob, SAMPLE_ECHO_JOB_TYPE } from './jobs.ts';
export type {
  JobSummary,
  SampleEchoInput,
  CreateSampleJobInput,
  CreateSampleJobResult,
  GetJobInput,
} from './jobs.ts';

export { NotFoundError } from '../domain/index.ts';

// WP-B7-1：服务端网格分析任务 + 沙箱 Estimate。
export {
  createSandboxEstimateJob,
  getSandboxEstimate,
  buildMeshAnalysisIdempotencyKey,
  resolveSandboxSceneConfirmation,
  MESH_ANALYSIS_JOB_TYPE,
} from './commerce-estimates.ts';
export {
  B7_SANDBOX_SCENE_CONFIRMATION_ID,
  b7SandboxSceneConfirmationFixture,
} from './commerce-sandbox-fixtures.ts';
export {
  CustomizationRequestConflictError,
  createCustomizationRequest,
  getCustomizationRequest,
  listCustomizationRequests,
} from './customization-requests.ts';
