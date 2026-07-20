-- Payment recovery may reopen failed or canceled intents only in the same
-- transaction that persists a newly provider-proven attempt.
CREATE OR REPLACE FUNCTION guard_payment_intent_history() RETURNS trigger AS $$
DECLARE creation_proof TEXT;
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
      OR (OLD."status" IN ('failed','canceled') AND NEW."status"='requires_action')
      OR (OLD."status" IN ('succeeded','failed','canceled') AND NEW."status"='needs_attention')
    ) THEN RAISE EXCEPTION 'illegal payment intent status transition' USING ERRCODE='55000'; END IF;
    IF NEW."status"='requires_action' AND OLD."status" IN ('failed','canceled') THEN
      IF NEW."lastAppliedEventId" IS DISTINCT FROM OLD."lastAppliedEventId" THEN
        RAISE EXCEPTION 'payment retry cannot forge a provider event' USING ERRCODE='55000';
      END IF;
      creation_proof := current_setting('petscape.payment_attempt_proof', TRUE);
      IF creation_proof IS NULL OR encode(sha256(convert_to(creation_proof, 'UTF8')), 'hex')<>OLD."verificationKeyHash" THEN
        RAISE EXCEPTION 'payment retry requires trusted provider creation proof' USING ERRCODE='55000';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM "payment_attempt" pa
        WHERE pa."paymentIntentId"=OLD."id" AND pa."status"='requires_action'
          AND pa."providerObservedStatus"='requires_action'
          AND pa."attemptNo"=(SELECT MAX(latest."attemptNo") FROM "payment_attempt" latest WHERE latest."paymentIntentId"=OLD."id")
      ) THEN
        RAISE EXCEPTION 'payment retry requires a new provider attempt' USING ERRCODE='55000';
      END IF;
    END IF;
  END IF;
  IF NOT (NEW."status"='requires_action' AND OLD."status" IN ('failed','canceled'))
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

CREATE OR REPLACE FUNCTION guard_payment_attempt_insert() RETURNS trigger AS $$
DECLARE intent_row "payment_intent"%ROWTYPE; expected_attempt_no INTEGER; creation_proof TEXT;
BEGIN
  SELECT * INTO intent_row FROM "payment_intent" WHERE "id"=NEW."paymentIntentId" FOR UPDATE;
  IF intent_row."id" IS NULL OR intent_row."provider"<>NEW."provider" THEN
    RAISE EXCEPTION 'payment attempt must match its payment intent provider' USING ERRCODE='23514';
  END IF;
  creation_proof := current_setting('petscape.payment_attempt_proof', TRUE);
  IF creation_proof IS NULL OR encode(sha256(convert_to(creation_proof, 'UTF8')), 'hex')<>intent_row."verificationKeyHash" THEN
    RAISE EXCEPTION 'payment attempt requires a valid provider creation proof' USING ERRCODE='55000';
  END IF;
  IF NEW."status"<>'requires_action' OR NEW."providerObservedStatus"<>'requires_action'
     OR NEW."failureCode" IS NOT NULL OR NEW."failureMessage" IS NOT NULL
     OR NEW."lastEventAt" IS NOT NULL OR NEW."lastAppliedEventId" IS NOT NULL OR NEW."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'payment attempt must start in pristine requires_action state' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "payment_attempt" WHERE "paymentIntentId"=NEW."paymentIntentId"
      AND "attemptNo"=NEW."attemptNo" AND "providerPaymentId"=NEW."providerPaymentId"
  ) THEN RETURN NEW; END IF;
  SELECT COALESCE(MAX("attemptNo"),0)+1 INTO expected_attempt_no FROM "payment_attempt" WHERE "paymentIntentId"=NEW."paymentIntentId";
  IF NEW."attemptNo"<>expected_attempt_no
     OR (NEW."attemptNo"=1 AND intent_row."status"<>'requires_action')
     OR (NEW."attemptNo">1 AND intent_row."status" NOT IN ('failed','canceled')) THEN
    RAISE EXCEPTION 'payment attempt sequence does not match intent state' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
