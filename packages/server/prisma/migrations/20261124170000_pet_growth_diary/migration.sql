-- CreateTable
CREATE TABLE "pet_growth_entry" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_growth_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_growth_entry_photo" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_growth_entry_photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pet_growth_entry_ownerUserId_petId_recordedAt_id_idx" ON "pet_growth_entry"("ownerUserId", "petId", "recordedAt", "id");

-- CreateIndex
CREATE INDEX "pet_growth_entry_ownerUserId_deletedAt_idx" ON "pet_growth_entry"("ownerUserId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pet_growth_entry_photo_assetId_key" ON "pet_growth_entry_photo"("assetId");

-- CreateIndex
CREATE INDEX "pet_growth_entry_photo_entryId_position_idx" ON "pet_growth_entry_photo"("entryId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pet_growth_entry_photo_entryId_position_key" ON "pet_growth_entry_photo"("entryId", "position");

-- AddForeignKey
ALTER TABLE "pet_growth_entry" ADD CONSTRAINT "pet_growth_entry_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_growth_entry" ADD CONSTRAINT "pet_growth_entry_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_growth_entry_photo" ADD CONSTRAINT "pet_growth_entry_photo_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "pet_growth_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_growth_entry_photo" ADD CONSTRAINT "pet_growth_entry_photo_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
