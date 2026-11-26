-- CreateTable
CREATE TABLE "community_post_photo" (
    "postId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "community_post_photo_pkey" PRIMARY KEY ("postId","assetId")
);

-- CreateIndex
CREATE INDEX "community_post_photo_assetId_idx" ON "community_post_photo"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_photo_postId_position_key" ON "community_post_photo"("postId", "position");

-- AddForeignKey
ALTER TABLE "community_post_photo" ADD CONSTRAINT "community_post_photo_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_photo" ADD CONSTRAINT "community_post_photo_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
