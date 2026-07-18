-- A4: Asset 以 User 为权限根，允许在 Project 之前存在。
ALTER TABLE "asset" DROP CONSTRAINT "asset_projectId_fkey";
ALTER TABLE "asset" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "asset" ADD CONSTRAINT "asset_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A4: 稳定业务代码，不把中文展示文案写入数据库枚举。
CREATE TYPE "PetSpeciesCode" AS ENUM ('rat', 'gecko', 'snake', 'parrot', 'spider', 'other');
CREATE TYPE "PetLifeStage" AS ENUM ('juvenile', 'adult', 'senior', 'unknown');

CREATE TABLE "pet" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "speciesCode" "PetSpeciesCode",
  "customSpeciesName" TEXT,
  "breed" TEXT,
  "sizeLevel" INTEGER,
  "lifeStage" "PetLifeStage",
  "behaviorTraits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "environmentNotes" TEXT,
  "specialNeeds" TEXT,
  "coverAssetId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pet_sizeLevel_check" CHECK ("sizeLevel" IS NULL OR ("sizeLevel" >= 1 AND "sizeLevel" <= 5)),
  CONSTRAINT "pet_custom_species_check" CHECK (
    ("speciesCode" = 'other' AND "customSpeciesName" IS NOT NULL)
    OR ("speciesCode" IS DISTINCT FROM 'other' AND "customSpeciesName" IS NULL)
  )
);

CREATE INDEX "pet_ownerUserId_deletedAt_idx" ON "pet"("ownerUserId", "deletedAt");
CREATE INDEX "pet_coverAssetId_idx" ON "pet"("coverAssetId");

ALTER TABLE "pet" ADD CONSTRAINT "pet_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pet" ADD CONSTRAINT "pet_coverAssetId_fkey"
  FOREIGN KEY ("coverAssetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
