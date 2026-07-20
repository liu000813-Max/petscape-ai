-- AlterTable
ALTER TABLE "payment_intent" ADD COLUMN     "attentionCode" TEXT;

ALTER TABLE "payment_intent" ADD CONSTRAINT "payment_intent_attention_code_consistent" CHECK (
  ("status" = 'needs_attention' AND ("attentionCode" IS NULL OR "attentionCode" IN (
    'amount_mismatch', 'stale_succeeded_attempt', 'provider_state_conflict'
  )))
  OR ("status" <> 'needs_attention' AND "attentionCode" IS NULL)
);

CREATE OR REPLACE FUNCTION guard_payment_intent_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment intent cannot be deleted' USING ERRCODE='55000'; END IF;
  IF ROW(NEW."id",NEW."ownerUserId",NEW."quoteId",NEW."deliveryAddressId",NEW."deliveryAddressVersion",NEW."deliveryAddressSnapshot",NEW."amountCent",NEW."currency",NEW."mode",NEW."provider",NEW."sandboxOnly",NEW."idempotencyKey",NEW."requestFingerprint",NEW."verificationKeyHash",NEW."createdAt")
     IS DISTINCT FROM ROW(OLD."id",OLD."ownerUserId",OLD."quoteId",OLD."deliveryAddressId",OLD."deliveryAddressVersion",OLD."deliveryAddressSnapshot",OLD."amountCent",OLD."currency",OLD."mode",OLD."provider",OLD."sandboxOnly",OLD."idempotencyKey",OLD."requestFingerprint",OLD."verificationKeyHash",OLD."createdAt") THEN
    RAISE EXCEPTION 'payment intent money and snapshots are immutable' USING ERRCODE='55000';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status"='requires_action' AND NEW."status" IN ('processing','succeeded','failed','canceled','needs_attention'))
      OR (OLD."status"='processing' AND NEW."status" IN ('succeeded','failed','canceled','needs_attention'))
      OR (OLD."status"='failed' AND NEW."status"='requires_action')
      OR (OLD."status" IN ('succeeded','failed','canceled') AND NEW."status"='needs_attention')
    ) THEN RAISE EXCEPTION 'illegal payment intent status transition' USING ERRCODE='55000'; END IF;
    IF NEW."status"='requires_action' AND OLD."status"='failed' THEN
      IF NEW."lastAppliedEventId" IS DISTINCT FROM OLD."lastAppliedEventId" THEN
        RAISE EXCEPTION 'payment retry cannot forge a provider event' USING ERRCODE='55000';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM "payment_attempt" WHERE "paymentIntentId"=OLD."id" AND "status"='requires_action') THEN
        RAISE EXCEPTION 'payment retry requires a new provider attempt' USING ERRCODE='55000';
      END IF;
    END IF;
  END IF;
  IF NOT (NEW."status"='requires_action' AND OLD."status"='failed')
     AND (ROW(NEW."status",NEW."attentionCode",NEW."lastAppliedEventId",NEW."succeededAt",NEW."failedAt",NEW."canceledAt",NEW."needsAttentionAt")
       IS DISTINCT FROM ROW(OLD."status",OLD."attentionCode",OLD."lastAppliedEventId",OLD."succeededAt",OLD."failedAt",OLD."canceledAt",OLD."needsAttentionAt"))
     AND (NEW."lastAppliedEventId" IS NOT DISTINCT FROM OLD."lastAppliedEventId" OR NOT EXISTS (
       SELECT 1 FROM "payment_event" pe WHERE pe."id"=NEW."lastAppliedEventId" AND pe."paymentIntentId"=OLD."id"
         AND ((pe."processingResult"='applied' AND pe."providerStatus"=NEW."status" AND NEW."attentionCode" IS NULL AND (
             (NEW."status" IN ('requires_action','processing') AND NEW."succeededAt" IS NULL AND NEW."failedAt" IS NULL AND NEW."canceledAt" IS NULL AND NEW."needsAttentionAt" IS NULL)
             OR (NEW."status"='succeeded' AND pe."occurredAt"=NEW."succeededAt")
             OR (NEW."status"='failed' AND pe."occurredAt"=NEW."failedAt")
             OR (NEW."status"='canceled' AND pe."occurredAt"=NEW."canceledAt")
           )) OR (pe."processingResult"='needs_attention' AND NEW."status"='needs_attention' AND pe."occurredAt"=NEW."needsAttentionAt" AND NEW."attentionCode" IN (
             'amount_mismatch', 'stale_succeeded_attempt', 'provider_state_conflict'
           )))
         AND (OLD."lastAppliedEventId" IS NULL OR pe."sequence" > (
           SELECT old_event."sequence" FROM "payment_event" old_event WHERE old_event."id"=OLD."lastAppliedEventId"
         ))
     )) THEN
    RAISE EXCEPTION 'payment status changes require a fresh trusted provider event' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
