-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ownerUserId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "targetVersion" INTEGER NOT NULL DEFAULT 1,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "progress" JSONB,
    "errorClass" TEXT,
    "errorDetail" JSONB,
    "vendorTaskId" TEXT,
    "resultRef" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_attempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "workerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "error" JSONB,

    CONSTRAINT "job_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_status_leaseExpiresAt_idx" ON "job"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_ownerUserId_type_idempotencyKey_key" ON "job"("ownerUserId", "type", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "job_attempt_jobId_attemptNo_key" ON "job_attempt"("jobId", "attemptNo");

-- AddForeignKey
ALTER TABLE "job_attempt" ADD CONSTRAINT "job_attempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
