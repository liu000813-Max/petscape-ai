-- CreateTable
CREATE TABLE "content_article" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "speciesCode" "PetSpeciesCode",
    "coverUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "authorUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "speciesCode" "PetSpeciesCode",
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_comment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_like" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_log" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "value" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_reminder" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_provider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "contactUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "eventName" TEXT NOT NULL,
    "path" TEXT,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_article_slug_key" ON "content_article"("slug");

-- CreateIndex
CREATE INDEX "content_article_status_publishedAt_idx" ON "content_article"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "content_article_category_speciesCode_idx" ON "content_article"("category", "speciesCode");

-- CreateIndex
CREATE INDEX "community_post_status_createdAt_idx" ON "community_post"("status", "createdAt");

-- CreateIndex
CREATE INDEX "community_post_topic_speciesCode_idx" ON "community_post"("topic", "speciesCode");

-- CreateIndex
CREATE INDEX "community_comment_postId_status_createdAt_idx" ON "community_comment"("postId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "community_post_like_postId_createdAt_idx" ON "community_post_like"("postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_like_postId_ownerUserId_key" ON "community_post_like"("postId", "ownerUserId");

-- CreateIndex
CREATE INDEX "care_log_ownerUserId_recordedAt_idx" ON "care_log"("ownerUserId", "recordedAt");

-- CreateIndex
CREATE INDEX "care_log_petId_recordedAt_idx" ON "care_log"("petId", "recordedAt");

-- CreateIndex
CREATE INDEX "care_reminder_ownerUserId_completedAt_dueAt_idx" ON "care_reminder"("ownerUserId", "completedAt", "dueAt");

-- CreateIndex
CREATE INDEX "service_provider_status_city_serviceType_idx" ON "service_provider"("status", "city", "serviceType");

-- CreateIndex
CREATE INDEX "analytics_event_eventName_createdAt_idx" ON "analytics_event"("eventName", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_event_userId_createdAt_idx" ON "analytics_event"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "content_article" ADD CONSTRAINT "content_article_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post" ADD CONSTRAINT "community_post_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comment" ADD CONSTRAINT "community_comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comment" ADD CONSTRAINT "community_comment_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_like" ADD CONSTRAINT "community_post_like_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_like" ADD CONSTRAINT "community_post_like_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_reminder" ADD CONSTRAINT "care_reminder_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_reminder" ADD CONSTRAINT "care_reminder_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Application status contracts are also enforced at the database boundary.
ALTER TABLE "content_article" ADD CONSTRAINT "content_article_status_valid" CHECK ("status" IN ('draft', 'published', 'archived'));
ALTER TABLE "community_post" ADD CONSTRAINT "community_post_status_valid" CHECK ("status" IN ('pending', 'published', 'rejected', 'archived'));
ALTER TABLE "community_comment" ADD CONSTRAINT "community_comment_status_valid" CHECK ("status" IN ('pending', 'published', 'rejected', 'archived'));
ALTER TABLE "service_provider" ADD CONSTRAINT "service_provider_status_valid" CHECK ("status" IN ('pending', 'published', 'rejected', 'archived'));
