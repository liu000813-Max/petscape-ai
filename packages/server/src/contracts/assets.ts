// contracts/assets.ts —— WP-3.2/WP-G2 资产上传 HTTP 契约正本。
// Route Handler 在进程边界 safeParse request；TypeScript DTO 全部从这些 Schema
// 推导，避免手写类型与运行时行为漂移（同 contracts/pets.ts 的模式）。
//
// QA 修复（G2 复核）：请求契约只列 filename/mime/size——kind 不是客户端可控字段
// （g-line §一 G0a"客户端不得注入产物字段"），upload_raw/pet_cover 等 kind 完全
// 由各 Route Handler 在服务端固定指定，不从 HTTP body 读取；应用层 requestAssetUpload
// 另有 allowlist 兜底（双重防线：路由层不传、应用层不收未列入的值）。
import { z } from 'zod';

export const ASSET_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
] as const;
export const ASSET_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export const CreateAssetUploadRequestSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  mime: z.enum(ASSET_UPLOAD_MIME_TYPES),
  size: z.number().int().positive().max(ASSET_UPLOAD_MAX_BYTES),
});

export const AssetResponseSchema = z.strictObject({
  id: z.string().min(1),
  ownerUserId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  kind: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  checksum: z.string().nullable(),
  status: z.enum(['pending', 'available']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateAssetUploadResponseSchema = z.strictObject({
  asset: AssetResponseSchema,
  uploadUrl: z.url(),
  expiresInSeconds: z.number().int().positive(),
});

export const ConfirmAssetUploadRequestSchema = z.strictObject({
  size: z.number().int().positive().max(ASSET_UPLOAD_MAX_BYTES).optional(),
});

export const AssetDownloadResponseSchema = z.strictObject({
  asset: AssetResponseSchema,
  downloadUrl: z.url(),
  expiresInSeconds: z.number().int().positive(),
});

export const ProjectAssetResponseSchema = AssetResponseSchema.extend({
  downloadUrl: z.url(),
});

export const ListProjectAssetsResponseSchema = z.strictObject({
  assets: z.array(ProjectAssetResponseSchema),
});

export const AssetApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'invalid_json', 'invalid_request', 'not_found', 'verification_failed']),
  detail: z.string().optional(),
  issues: z
    .array(
      z.strictObject({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      }),
    )
    .optional(),
});

export type CreateAssetUploadRequest = z.infer<typeof CreateAssetUploadRequestSchema>;
export type AssetResponse = z.infer<typeof AssetResponseSchema>;
export type CreateAssetUploadResponse = z.infer<typeof CreateAssetUploadResponseSchema>;
export type ConfirmAssetUploadRequest = z.infer<typeof ConfirmAssetUploadRequestSchema>;
export type AssetDownloadResponse = z.infer<typeof AssetDownloadResponseSchema>;
export type ProjectAssetResponse = z.infer<typeof ProjectAssetResponseSchema>;
export type ListProjectAssetsResponse = z.infer<typeof ListProjectAssetsResponseSchema>;
export type AssetApiError = z.infer<typeof AssetApiErrorSchema>;
