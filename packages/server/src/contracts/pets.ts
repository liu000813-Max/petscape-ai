// contracts/pets.ts —— A4 宠物档案内部业务 API 的运行时契约正本。
// Route Handler 在进程边界 parse request，并在返回前 parse response；TypeScript DTO
// 全部从这些 Schema 推导，避免手写类型与运行时行为漂移。
import { z } from 'zod';

export const PET_SPECIES_CODES = ['rat', 'gecko', 'snake', 'parrot', 'spider', 'other'] as const;
export const PET_LIFE_STAGES = ['juvenile', 'adult', 'senior', 'unknown'] as const;
export const PET_COVER_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PET_COVER_MAX_BYTES = 10 * 1024 * 1024;

export const PetSpeciesCodeSchema = z.enum(PET_SPECIES_CODES);
export const PetLifeStageSchema = z.enum(PET_LIFE_STAGES);

const nameSchema = z.string().trim().min(1, 'name 不能为空').max(80, 'name 最多 80 个字符');
const optionalTextSchema = z.string().trim().min(1).max(2_000).nullable();
const shortOptionalTextSchema = z.string().trim().min(1).max(120).nullable();
const behaviorTraitsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .transform((traits) => [...new Set(traits)]);

const petMutableFields = {
  name: nameSchema,
  speciesCode: PetSpeciesCodeSchema.nullable(),
  customSpeciesName: shortOptionalTextSchema,
  breed: shortOptionalTextSchema,
  sizeLevel: z.number().int().min(1).max(5).nullable(),
  lifeStage: PetLifeStageSchema.nullable(),
  behaviorTraits: behaviorTraitsSchema,
  environmentNotes: optionalTextSchema,
  specialNeeds: optionalTextSchema,
  coverAssetId: z.string().min(1).nullable(),
} as const;

function checkCustomSpecies(
  value: { speciesCode?: string | null; customSpeciesName?: string | null },
  ctx: z.RefinementCtx,
) {
  if (value.speciesCode === 'other' && !value.customSpeciesName) {
    ctx.addIssue({
      code: 'custom',
      path: ['customSpeciesName'],
      message: 'speciesCode 为 other 时必须填写 customSpeciesName',
    });
  }
  if (
    value.speciesCode !== undefined &&
    value.speciesCode !== 'other' &&
    value.customSpeciesName
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['customSpeciesName'],
      message: '只有 speciesCode 为 other 时才能填写 customSpeciesName',
    });
  }
}

export const CreatePetRequestSchema = z
  .strictObject({
    name: petMutableFields.name,
    speciesCode: petMutableFields.speciesCode.optional(),
    customSpeciesName: petMutableFields.customSpeciesName.optional(),
    breed: petMutableFields.breed.optional(),
    sizeLevel: petMutableFields.sizeLevel.optional(),
    lifeStage: petMutableFields.lifeStage.optional(),
    behaviorTraits: petMutableFields.behaviorTraits.default([]),
    environmentNotes: petMutableFields.environmentNotes.optional(),
    specialNeeds: petMutableFields.specialNeeds.optional(),
    coverAssetId: petMutableFields.coverAssetId.optional(),
  })
  .superRefine((value, ctx) => {
    checkCustomSpecies(value, ctx);
    if (value.speciesCode === undefined && value.customSpeciesName) {
      ctx.addIssue({
        code: 'custom',
        path: ['customSpeciesName'],
        message: '只有 speciesCode 为 other 时才能填写 customSpeciesName',
      });
    }
  });

export const UpdatePetRequestSchema = z
  .strictObject({
    name: petMutableFields.name.optional(),
    speciesCode: petMutableFields.speciesCode.optional(),
    customSpeciesName: petMutableFields.customSpeciesName.optional(),
    breed: petMutableFields.breed.optional(),
    sizeLevel: petMutableFields.sizeLevel.optional(),
    lifeStage: petMutableFields.lifeStage.optional(),
    behaviorTraits: petMutableFields.behaviorTraits.optional(),
    environmentNotes: petMutableFields.environmentNotes.optional(),
    specialNeeds: petMutableFields.specialNeeds.optional(),
    coverAssetId: petMutableFields.coverAssetId.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个待更新字段' })
  .superRefine(checkCustomSpecies);

export const PetIdParamsSchema = z.strictObject({ id: z.string().min(1) });

export const PetCoverUploadRequestSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  mime: z.enum(PET_COVER_MIME_TYPES),
  size: z.number().int().positive().max(PET_COVER_MAX_BYTES),
});

export const PetCoverUploadResponseSchema = z.strictObject({
  assetId: z.string().min(1),
  uploadUrl: z.url(),
  expiresInSeconds: z.number().int().positive(),
});

export const PetResponseSchema = z.strictObject({
  id: z.string().min(1),
  name: nameSchema,
  speciesCode: PetSpeciesCodeSchema.nullable(),
  customSpeciesName: shortOptionalTextSchema,
  breed: shortOptionalTextSchema,
  sizeLevel: z.number().int().min(1).max(5).nullable(),
  lifeStage: PetLifeStageSchema.nullable(),
  behaviorTraits: z.array(z.string().trim().min(1).max(40)).max(20),
  environmentNotes: optionalTextSchema,
  specialNeeds: optionalTextSchema,
  coverAssetId: z.string().min(1).nullable(),
  coverUrl: z.url().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PetListResponseSchema = z.strictObject({ pets: z.array(PetResponseSchema) });
export const DeletePetResponseSchema = z.strictObject({ deleted: z.literal(true), id: z.string().min(1) });

export const PetApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'invalid_json', 'invalid_request', 'not_found', 'invalid_cover_asset']),
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

export type CreatePetRequest = z.infer<typeof CreatePetRequestSchema>;
export type UpdatePetRequest = z.infer<typeof UpdatePetRequestSchema>;
export type PetResponse = z.infer<typeof PetResponseSchema>;
export type PetListResponse = z.infer<typeof PetListResponseSchema>;
export type PetCoverUploadRequest = z.infer<typeof PetCoverUploadRequestSchema>;
export type PetCoverUploadResponse = z.infer<typeof PetCoverUploadResponseSchema>;
export type PetApiError = z.infer<typeof PetApiErrorSchema>;
