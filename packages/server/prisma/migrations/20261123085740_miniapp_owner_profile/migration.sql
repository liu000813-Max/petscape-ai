-- CreateTable
CREATE TABLE "miniapp_profile" (
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "avatarAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "miniapp_profile_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "miniapp_profile" ADD CONSTRAINT "miniapp_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "miniapp_profile" ADD CONSTRAINT "miniapp_profile_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
