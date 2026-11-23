import { z } from 'zod';

export const UpdateMiniappProfileSchema = z.strictObject({
  nickname: z.string().trim().min(1).max(30),
  avatarAssetId: z.string().min(1).max(200).nullable().optional(),
});
export const MiniappProfileResponseSchema = z.strictObject({
  nickname: z.string().max(30),
  avatarAssetId: z.string().nullable(),
  avatarUrl: z.url().nullable(),
});
export type UpdateMiniappProfile = z.infer<typeof UpdateMiniappProfileSchema>;
