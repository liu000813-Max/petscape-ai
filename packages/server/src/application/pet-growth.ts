import { createHash } from 'node:crypto';
import type { PrismaClient } from '../infra/db/index.ts';
import type { OssStorage } from '../infra/oss/index.ts';
import { getAssetDownloadUrl } from './assets.ts';
import { NotFoundError } from '../domain/index.ts';
import {
  CreatePetGrowthEntrySchema,
  ListPetGrowthEntriesQuerySchema,
  UpdatePetGrowthEntrySchema,
  type CreatePetGrowthEntry,
  type UpdatePetGrowthEntry,
} from '../contracts/pet-growth.ts';
import { PET_COVER_MIME_TYPES } from '../contracts/pets.ts';

const PHOTO_KIND = 'growth_photo';

export class InvalidPetGrowthEntryError extends Error {
  constructor() {
    super('growth_entry_content_required');
    this.name = 'InvalidPetGrowthEntryError';
  }
}

export class GrowthEntrySaveConflictError extends Error {}

function ownedPhotoAssetIds(rows: { id: string; ownerUserId: string; status: string; kind: string; mime: string }[], ownerUserId: string, ids: string[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (ids.some((id) => {
    const asset = byId.get(id);
    return !asset || asset.ownerUserId !== ownerUserId || asset.status !== 'available' || asset.kind !== PHOTO_KIND
      || !PET_COVER_MIME_TYPES.includes(asset.mime as typeof PET_COVER_MIME_TYPES[number]);
  })) throw new NotFoundError('Asset');
  return ids;
}

async function petExists(prisma: PrismaClient, ownerUserId: string, petId: string) {
  const pet = await prisma.pet.findFirst({ where: { id: petId, ownerUserId, deletedAt: null }, select: { id: true } });
  if (!pet) throw new NotFoundError('Pet');
}

type GrowthEntryContext = { prisma: PrismaClient; oss: OssStorage; ownerUserId: string };

async function toEntry(context: GrowthEntryContext, entry: {
  id: string; petId: string; note: string | null; recordedAt: Date; createdAt: Date; updatedAt: Date;
  photos: { assetId: string; position: number; asset: { ownerUserId: string; kind: string; status: string; mime: string } }[];
}) {
  const { prisma, ownerUserId } = context;
  const photos = await Promise.all(entry.photos.map(async (photo) => {
    if (photo.asset.ownerUserId !== ownerUserId || photo.asset.kind !== PHOTO_KIND || photo.asset.status !== 'available'
        || !PET_COVER_MIME_TYPES.includes(photo.asset.mime as typeof PET_COVER_MIME_TYPES[number])) return null;
    const signed = await getAssetDownloadUrl({ prisma, oss: context.oss, ownerUserId, assetId: photo.assetId });
    return { assetId: photo.assetId, downloadUrl: signed.downloadUrl };
  }));
  return { id: entry.id, petId: entry.petId, note: entry.note, recordedAt: entry.recordedAt.toISOString(),
    createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString(), photos: photos.filter(Boolean) };
}

const photoInclude = { photos: { orderBy: { position: 'asc' as const }, include: { asset: { select: { ownerUserId: true, kind: true, status: true, mime: true } } } } };

export async function getPetGrowthEntry(context: GrowthEntryContext & { petId: string; entryId: string }) {
  const { prisma, ownerUserId, petId, entryId } = context;
  const row = await prisma.petGrowthEntry.findFirst({
    where: { id: entryId, ownerUserId, petId, deletedAt: null, pet: { ownerUserId, deletedAt: null } }, include: photoInclude,
  });
  if (!row) throw new NotFoundError('PetGrowthEntry');
  return toEntry(context, row);
}

export async function listPetGrowthEntries(context: GrowthEntryContext & { petId: string; query: unknown }) {
  const { prisma, ownerUserId, petId, query } = context;
  const input = ListPetGrowthEntriesQuerySchema.parse(query);
  await petExists(prisma, ownerUserId, petId);
  const rows = await prisma.petGrowthEntry.findMany({
    where: { ownerUserId, petId, deletedAt: null, pet: { ownerUserId, deletedAt: null } },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    skip: input.offset,
    take: input.limit + 1,
    include: photoInclude,
  });
  const hasMore = rows.length > input.limit;
  return { entries: await Promise.all(rows.slice(0, input.limit).map((row) => toEntry(context, row))), hasMore };
}

export async function createPetGrowthEntry(context: GrowthEntryContext & { petId: string; input: CreatePetGrowthEntry }) {
  const { prisma, ownerUserId, petId, input: rawInput } = context;
  const input = CreatePetGrowthEntrySchema.parse(rawInput);
  const note = input.note || null;
  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
  const id = input.saveKey
    ? 'growth_' + createHash('sha256').update(JSON.stringify([ownerUserId, petId, input.saveKey])).digest('hex')
    : undefined;
  const findSaved = async () => {
    if (!id) return null;
    const saved = await prisma.petGrowthEntry.findFirst({
      where: { id, ownerUserId, petId, pet: { ownerUserId, deletedAt: null } }, include: photoInclude,
    });
    if (saved?.deletedAt) throw new NotFoundError('PetGrowthEntry');
    if (saved && (saved.note !== note || saved.recordedAt.getTime() !== recordedAt.getTime()
      || saved.photos.length !== input.photoAssetIds.length
      || saved.photos.some((photo, index) => photo.assetId !== input.photoAssetIds[index]))) {
      throw new GrowthEntrySaveConflictError();
    }
    return saved;
  };
  const saved = await findSaved();
  if (saved) return toEntry(context, saved);

  const create = () => prisma.$transaction(async (tx) => {
    const pet = await tx.pet.findFirst({ where: { id: petId, ownerUserId, deletedAt: null }, select: { id: true } });
    if (!pet) throw new NotFoundError('Pet');
    if (input.photoAssetIds.length) {
      const assets = await tx.asset.findMany({ where: { id: { in: input.photoAssetIds } },
        select: { id: true, ownerUserId: true, status: true, kind: true, mime: true } });
      ownedPhotoAssetIds(assets, ownerUserId, input.photoAssetIds);
      const used = await tx.petGrowthEntryPhoto.findMany({ where: { assetId: { in: input.photoAssetIds } }, select: { assetId: true } });
      if (used.length) throw new GrowthEntrySaveConflictError();
      // Initialize storage before committing an entry that will require signed photo URLs.
      void context.oss;
    }
    return tx.petGrowthEntry.create({
      data: { id, ownerUserId, petId, note, recordedAt,
        photos: { create: input.photoAssetIds.map((assetId, position) => ({ assetId, position })) } },
      include: photoInclude,
    });
  });
  let row;
  try {
    row = await create();
  } catch (error) {
    // Another request can commit while this request is validating photo ownership.
    if (!id || !(error instanceof GrowthEntrySaveConflictError
      || (typeof error === 'object' && error && 'code' in error && error.code === 'P2002'))) throw error;
    row = await findSaved();
    if (!row) throw error;
  }
  return toEntry(context, row);
}

export async function updatePetGrowthEntry(context: GrowthEntryContext & { petId: string; entryId: string; input: UpdatePetGrowthEntry }) {
  const { prisma, ownerUserId, petId, entryId, input: rawInput } = context;
  const input = UpdatePetGrowthEntrySchema.parse(rawInput);
  const updated = await prisma.$transaction(async (tx) => {
    const scope = { id: entryId, petId, ownerUserId, deletedAt: null, pet: { ownerUserId, deletedAt: null } };
    const current = await tx.petGrowthEntry.findFirst({
      where: scope, include: photoInclude,
    });
    if (!current) throw new NotFoundError('PetGrowthEntry');
    const note = input.note === undefined ? current.note : input.note || null;
    if (!note && current.photos.length === 0) throw new InvalidPetGrowthEntryError();
    if (current.photos.length) void context.oss;
    const result = await tx.petGrowthEntry.updateMany({
      where: scope,
      data: { ...(input.note !== undefined ? { note } : {}), ...(input.recordedAt ? { recordedAt: new Date(input.recordedAt) } : {}) },
    });
    if (result.count !== 1) throw new NotFoundError('PetGrowthEntry');
    const row = await tx.petGrowthEntry.findFirst({
      where: scope, include: photoInclude,
    });
    if (!row) throw new NotFoundError('PetGrowthEntry');
    return row;
  });
  return toEntry(context, updated);
}

export async function deletePetGrowthEntry({ prisma, ownerUserId, petId, entryId }: {
  prisma: PrismaClient; ownerUserId: string; petId: string; entryId: string;
}) {
  const result = await prisma.petGrowthEntry.updateMany({
    where: { id: entryId, petId, ownerUserId, deletedAt: null, pet: { ownerUserId, deletedAt: null } },
    data: { deletedAt: new Date() },
  });
  if (result.count !== 1) throw new NotFoundError('PetGrowthEntry');
  return { deleted: true as const, id: entryId };
}
