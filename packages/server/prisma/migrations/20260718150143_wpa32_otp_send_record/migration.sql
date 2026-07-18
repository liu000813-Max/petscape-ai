-- CreateTable
CREATE TABLE "otp_send_record" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_send_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_send_record_target_sentAt_idx" ON "otp_send_record"("target", "sentAt");
