import { z } from 'zod';
import { PET_COVER_MAX_BYTES, PET_COVER_MIME_TYPES } from './pets.ts';

const idSchema = z.string().trim().min(1).max(191);
const optionalNote = z.string().trim().max(2000).nullable();
const photoIds = z.array(idSchema).max(6).default([]);

export const PetGrowthEntryParamsSchema = z.strictObject({
  id: idSchema,
  entryId: idSchema,
});

export const ListPetGrowthEntriesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export const CreatePetGrowthEntrySchema = z.strictObject({
  note: optionalNote.optional().default(null),
  recordedAt: z.iso.datetime().optional(),
  photoAssetIds: photoIds,
}).superRefine((value, ctx) => {
  if (!value.note && value.photoAssetIds.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['note'], message: '记录文字或至少一张照片' });
  }
  if (new Set(value.photoAssetIds).size !== value.photoAssetIds.length) {
    ctx.addIssue({ code: 'custom', path: ['photoAssetIds'], message: '照片不能重复' });
  }
});

export const UpdatePetGrowthEntrySchema = z.strictObject({
  note: optionalNote.optional(),
  recordedAt: z.iso.datetime().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: '至少提供一个待更新字段' });

export const PetGrowthPhotoUploadSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  mime: z.enum(PET_COVER_MIME_TYPES),
  size: z.number().int().positive().max(PET_COVER_MAX_BYTES),
});

export const PetGrowthPhotoUploadResponseSchema = z.strictObject({
  assetId: idSchema,
});

export const PetGrowthPhotoResponseSchema = z.strictObject({
  assetId: idSchema,
  downloadUrl: z.url(),
});

export const PetGrowthEntryResponseSchema = z.strictObject({
  id: idSchema,
  petId: idSchema,
  note: optionalNote,
  recordedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  photos: z.array(PetGrowthPhotoResponseSchema).max(6),
});

export const ListPetGrowthEntriesResponseSchema = z.strictObject({
  entries: z.array(PetGrowthEntryResponseSchema),
  hasMore: z.boolean(),
});

export const DeletePetGrowthEntryResponseSchema = z.strictObject({
  deleted: z.literal(true),
  id: idSchema,
});

export type CreatePetGrowthEntry = z.infer<typeof CreatePetGrowthEntrySchema>;
export type UpdatePetGrowthEntry = z.infer<typeof UpdatePetGrowthEntrySchema>;
