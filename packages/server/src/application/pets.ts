// application/pets.ts —— A4 宠物档案用例。
// Pet 是长期档案；ownerUserId 只用于授权与持久化，不进入公开应用 DTO。
import type { PrismaClient } from '../infra/db/index.ts';
import { assertOwner, NotFoundError } from '../domain/index.ts';
import {
  CreatePetRequestSchema,
  UpdatePetRequestSchema,
  PET_COVER_MIME_TYPES,
  type CreatePetRequest,
  type UpdatePetRequest,
} from '../contracts/pets.ts';

export { NotFoundError };

export class InvalidPetCoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPetCoverError';
  }
}

export class InvalidPetProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPetProfileError';
  }
}

export interface PetSummary {
  id: string;
  name: string;
  speciesCode: 'rat' | 'gecko' | 'snake' | 'parrot' | 'spider' | 'other' | null;
  customSpeciesName: string | null;
  breed: string | null;
  sizeLevel: number | null;
  lifeStage: 'juvenile' | 'adult' | 'senior' | 'unknown' | null;
  behaviorTraits: string[];
  environmentNotes: string | null;
  specialNeeds: string | null;
  coverAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type PetRecord = PetSummary & { ownerUserId: string; deletedAt: Date | null };

async function assertUsableCover(prisma: PrismaClient, ownerUserId: string, assetId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  assertOwner(asset, ownerUserId, 'Asset');
  if (
    asset.status !== 'available' ||
    asset.kind !== 'pet_cover' ||
    !PET_COVER_MIME_TYPES.includes(asset.mime as (typeof PET_COVER_MIME_TYPES)[number])
  ) {
    throw new InvalidPetCoverError('封面 Asset 必须是当前用户已确认的 pet_cover 图片');
  }
}

function assertProfileConsistency(value: {
  speciesCode: PetSummary['speciesCode'];
  customSpeciesName: string | null;
}) {
  if (value.speciesCode === 'other' && !value.customSpeciesName) {
    throw new InvalidPetProfileError('speciesCode 为 other 时必须填写 customSpeciesName');
  }
  if (value.speciesCode !== 'other' && value.customSpeciesName) {
    throw new InvalidPetProfileError('只有 speciesCode 为 other 时才能填写 customSpeciesName');
  }
}

export async function createPet({
  prisma,
  ownerUserId,
  input,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  input: CreatePetRequest;
}): Promise<PetSummary> {
  const parsed = CreatePetRequestSchema.parse(input);
  const speciesCode = parsed.speciesCode ?? null;
  const customSpeciesName = parsed.customSpeciesName ?? null;
  assertProfileConsistency({ speciesCode, customSpeciesName });

  if (parsed.coverAssetId) {
    await assertUsableCover(prisma, ownerUserId, parsed.coverAssetId);
  }

  const pet = await prisma.pet.create({
    data: {
      ownerUserId,
      name: parsed.name,
      speciesCode,
      customSpeciesName,
      breed: parsed.breed ?? null,
      sizeLevel: parsed.sizeLevel ?? null,
      lifeStage: parsed.lifeStage ?? null,
      behaviorTraits: parsed.behaviorTraits,
      environmentNotes: parsed.environmentNotes ?? null,
      specialNeeds: parsed.specialNeeds ?? null,
      coverAssetId: parsed.coverAssetId ?? null,
    },
  });
  return toSummary(pet);
}

export async function listPets({
  prisma,
  ownerUserId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
}): Promise<PetSummary[]> {
  const pets = await prisma.pet.findMany({
    where: { ownerUserId, deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
  return pets.map(toSummary);
}

export async function getPet({
  prisma,
  ownerUserId,
  petId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  petId: string;
}): Promise<PetSummary> {
  const pet = await prisma.pet.findFirst({
    where: { id: petId, ownerUserId, deletedAt: null },
  });
  if (!pet) throw new NotFoundError('Pet');
  return toSummary(pet);
}

export async function updatePet({
  prisma,
  ownerUserId,
  petId,
  input,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  petId: string;
  input: UpdatePetRequest;
}): Promise<PetSummary> {
  const parsed = UpdatePetRequestSchema.parse(input);
  const current = await prisma.pet.findFirst({
    where: { id: petId, ownerUserId, deletedAt: null },
  });
  if (!current) throw new NotFoundError('Pet');

  if (parsed.coverAssetId) {
    await assertUsableCover(prisma, ownerUserId, parsed.coverAssetId);
  }

  const nextSpeciesCode = parsed.speciesCode === undefined ? current.speciesCode : parsed.speciesCode;
  const nextCustomSpeciesName =
    parsed.speciesCode !== undefined && parsed.speciesCode !== 'other'
      ? null
      : parsed.customSpeciesName === undefined
        ? current.customSpeciesName
        : parsed.customSpeciesName;
  assertProfileConsistency({
    speciesCode: nextSpeciesCode as PetSummary['speciesCode'],
    customSpeciesName: nextCustomSpeciesName,
  });

  const pet = await prisma.pet.update({
    where: { id: petId },
    data: {
      ...parsed,
      speciesCode: nextSpeciesCode,
      customSpeciesName: nextCustomSpeciesName,
    },
  });
  return toSummary(pet);
}

export async function deletePet({
  prisma,
  ownerUserId,
  petId,
}: {
  prisma: PrismaClient;
  ownerUserId: string;
  petId: string;
}): Promise<{ deleted: true; id: string }> {
  const result = await prisma.pet.updateMany({
    where: { id: petId, ownerUserId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count !== 1) throw new NotFoundError('Pet');
  return { deleted: true, id: petId };
}

function toSummary(pet: PetRecord): PetSummary {
  return {
    id: pet.id,
    name: pet.name,
    speciesCode: pet.speciesCode,
    customSpeciesName: pet.customSpeciesName,
    breed: pet.breed,
    sizeLevel: pet.sizeLevel,
    lifeStage: pet.lifeStage,
    behaviorTraits: pet.behaviorTraits,
    environmentNotes: pet.environmentNotes,
    specialNeeds: pet.specialNeeds,
    coverAssetId: pet.coverAssetId,
    createdAt: pet.createdAt,
    updatedAt: pet.updatedAt,
  };
}
