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
  listProjectAssets,
  AssetVerificationError,
  InvalidAssetKindError,
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
  ListProjectAssetsInput,
  ProjectAssetSummary,
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

// WP-G3：vibe 效果图生成用例 + provider 端口 + prompt 组装。
export {
  createVibeRenderJob,
  getLatestVibeRender,
  buildVibeRenderPrompt,
  VIBE_RENDER_JOB_TYPE,
} from './vibe-render.ts';
export type {
  CreateVibeRenderJobInput,
  CreateVibeRenderJobResult,
  LatestVibeRenderInput,
  LatestVibeRenderResult,
  VibeRenderProvider,
  VibeRenderProviderInput,
  VibeRenderProviderResult,
  VibeRenderReferenceImage,
  BuildVibeRenderPromptInput,
} from './vibe-render.ts';

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
export {
  AdminRequiredError,
  CheckRunConflictError,
  bootstrapFirstAdmin,
  changeUserRole,
  completeCheckRun,
  createCheckRun,
  getApprovedCheckRunInput,
  listAdminCheckRuns,
  listAdminReviewCandidates,
  listOwnerCheckRuns,
  startCheckRun,
} from './check-runs.ts';

// WP-B45-2：Viewer 持久化、乐观锁与不可变确认。
export {
  RevisionConflictError,
  InvalidSceneError,
  createDesignItem,
  createModelConfirmation,
  getSceneForProject,
  getViewerState,
  saveScene,
  confirmScene,
  getSceneConfirmation,
} from './scenes.ts';

// WP-B45-3：不可变 SceneConfirmation → WP-SEAM-0 producer adapter。
export { produceSceneConfirmationCommerceInput } from './scene-confirmation-commerce-producer.ts';
export {
  QuoteConflictError,
  QuoteEligibilityError,
  acceptQuote,
  cancelQuote,
  createQuote,
  getQuote,
  listQuotes,
} from './quotes.ts';
export {
  DeliveryAddressConflictError,
  DeliveryAddressEligibilityError,
  confirmDeliveryAddress,
  getConfirmedDeliveryAddressInput,
  listDeliveryAddresses,
  saveDeliveryAddress,
} from './delivery-addresses.ts';
export {
  PaymentConflictError,
  PaymentEligibilityError,
  createPaymentIntent,
  getPaymentIntent,
  ingestPaymentEvent,
  listAdminPaymentAttention,
  listPaymentIntents,
  reconcilePaymentIntent,
  retryPaymentIntent,
  simulateSandboxPaymentAction,
} from './payments.ts';
export {
  PaymentProviderDisabledError,
  PaymentProviderSignatureError,
  type PaymentProviderPort,
} from './payment-provider.ts';
export {
  createPrismaSandboxPaymentStateStore,
  createSandboxPaymentProvider,
  type SandboxPaymentProvider,
  type SandboxPaymentStateStore,
} from './sandbox-payment-provider.ts';
export {
  ensureOrderForSucceededPayment,
  cancelOrder,
  getOrder,
  listOrders,
  processOrderRecoveryJob,
  OrderConflictError,
  ORDER_RECOVERY_JOB_TYPE,
} from './orders.ts';
