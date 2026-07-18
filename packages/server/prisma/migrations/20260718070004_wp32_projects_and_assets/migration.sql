-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('editable', 'archived');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('pending', 'available');

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'editable',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT,
    "ossKey" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_ownerUserId_idx" ON "project"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_ossKey_key" ON "asset"("ossKey");

-- CreateIndex
CREATE INDEX "asset_ownerUserId_idx" ON "asset"("ownerUserId");

-- CreateIndex
CREATE INDEX "asset_projectId_idx" ON "asset"("projectId");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
