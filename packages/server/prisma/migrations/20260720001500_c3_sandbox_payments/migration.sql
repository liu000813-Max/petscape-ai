-- WP-C3-1: server-priced sandbox payment intents, attempts and trusted event ledger.
CREATE TABLE "payment_provider_trust" (
  "provider" TEXT NOT NULL,
  "verificationKeyHash" TEXT NOT NULL,
  "sandboxOnly" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_provider_trust_pkey" PRIMARY KEY ("provider"),
  CONSTRAINT "payment_provider_trust_key_valid" CHECK ("verificationKeyHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payment_provider_trust_sandbox_only" CHECK ("sandboxOnly" = TRUE)
);

INSERT INTO "payment_provider_trust" ("provider","verificationKeyHash","sandboxOnly")
VALUES ('sandbox','0000000000000000000000000000000000000000000000000000000000000000',TRUE);

CREATE TABLE "payment_intent" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "deliveryAddressId" TEXT NOT NULL,
  "deliveryAddressVersion" INTEGER NOT NULL,
  "deliveryAddressSnapshot" JSONB NOT NULL,
  "amountCent" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "sandboxOnly" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "verificationKeyHash" TEXT NOT NULL,
  "lastAppliedEventId" TEXT,
  "succeededAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "needsAttentionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_intent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_intent_amount_valid" CHECK ("amountCent" > 0),
  CONSTRAINT "payment_intent_currency_valid" CHECK ("currency" = 'CNY'),
  CONSTRAINT "payment_intent_mode_valid" CHECK ("mode" = 'sandbox_test'),
  CONSTRAINT "payment_intent_provider_valid" CHECK (length("provider") BETWEEN 1 AND 191),
  CONSTRAINT "payment_intent_verification_key_valid" CHECK ("verificationKeyHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payment_intent_sandbox_only" CHECK ("sandboxOnly" = TRUE),
  CONSTRAINT "payment_intent_status_valid" CHECK ("status" IN ('requires_action','processing','succeeded','failed','canceled','needs_attention')),
  CONSTRAINT "payment_intent_address_version_valid" CHECK ("deliveryAddressVersion" > 0),
  CONSTRAINT "payment_intent_address_snapshot_object" CHECK (jsonb_typeof("deliveryAddressSnapshot") = 'object'),
  CONSTRAINT "payment_intent_state_consistent" CHECK (
    ("status" IN ('requires_action','processing') AND "succeededAt" IS NULL AND "failedAt" IS NULL AND "canceledAt" IS NULL AND "needsAttentionAt" IS NULL)
    OR ("status" = 'succeeded' AND "succeededAt" IS NOT NULL AND "failedAt" IS NULL AND "canceledAt" IS NULL AND "needsAttentionAt" IS NULL)
    OR ("status" = 'failed' AND "succeededAt" IS NULL AND "failedAt" IS NOT NULL AND "canceledAt" IS NULL AND "needsAttentionAt" IS NULL)
    OR ("status" = 'canceled' AND "succeededAt" IS NULL AND "failedAt" IS NULL AND "canceledAt" IS NOT NULL AND "needsAttentionAt" IS NULL)
    OR ("status" = 'needs_attention' AND "succeededAt" IS NULL AND "failedAt" IS NULL AND "canceledAt" IS NULL AND "needsAttentionAt" IS NOT NULL)
  )
);

CREATE TABLE "payment_attempt" (
  "id" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "providerObservedStatus" TEXT NOT NULL,
  "providerObservedAt" TIMESTAMP(3) NOT NULL,
  "lastEventAt" TIMESTAMP(3),
  "lastAppliedEventId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_attempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_attempt_no_valid" CHECK ("attemptNo" > 0),
  CONSTRAINT "payment_attempt_provider_valid" CHECK (length("provider") BETWEEN 1 AND 191),
  CONSTRAINT "payment_attempt_status_valid" CHECK ("status" IN ('requires_action','processing','succeeded','failed','canceled')),
  CONSTRAINT "payment_attempt_observed_status_valid" CHECK ("providerObservedStatus" IN ('requires_action','processing','succeeded','failed','canceled')),
  CONSTRAINT "payment_attempt_failure_consistent" CHECK (
    ("status" = 'failed' AND "failureCode" IS NOT NULL AND "resolvedAt" IS NOT NULL)
    OR ("status" IN ('succeeded','canceled') AND "resolvedAt" IS NOT NULL)
    OR ("status" IN ('requires_action','processing') AND "resolvedAt" IS NULL)
  )
);

CREATE TABLE "payment_event" (
  "id" TEXT NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "paymentAttemptId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerPaymentId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "providerStatus" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL,
  "amountCent" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "sanitizedPayload" JSONB NOT NULL,
  "processingResult" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_event_sequence_key" UNIQUE ("sequence"),
  CONSTRAINT "payment_event_provider_valid" CHECK (length("provider") BETWEEN 1 AND 191),
  CONSTRAINT "payment_event_source_valid" CHECK ("source" IN ('webhook','sandbox_action','query')),
  CONSTRAINT "payment_event_status_valid" CHECK ("providerStatus" IN ('requires_action','processing','succeeded','failed','canceled')),
  CONSTRAINT "payment_event_verified" CHECK ("verified" = TRUE),
  CONSTRAINT "payment_event_amount_valid" CHECK ("amountCent" > 0 AND "currency" = 'CNY'),
  CONSTRAINT "payment_event_payload_object" CHECK (jsonb_typeof("sanitizedPayload") = 'object'),
  CONSTRAINT "payment_event_result_valid" CHECK ("processingResult" IN ('applied','ignored_stale','needs_attention'))
);

CREATE UNIQUE INDEX "payment_intent_quoteId_key" ON "payment_intent"("quoteId");
CREATE UNIQUE INDEX "payment_intent_owner_idempotency_key" ON "payment_intent"("ownerUserId","idempotencyKey");
CREATE INDEX "payment_intent_ownerUserId_createdAt_idx" ON "payment_intent"("ownerUserId","createdAt");
CREATE INDEX "payment_intent_status_updatedAt_idx" ON "payment_intent"("status","updatedAt");
CREATE INDEX "payment_intent_deliveryAddressId_idx" ON "payment_intent"("deliveryAddressId");
CREATE UNIQUE INDEX "payment_attempt_providerPaymentId_key" ON "payment_attempt"("providerPaymentId");
CREATE UNIQUE INDEX "payment_attempt_paymentIntentId_attemptNo_key" ON "payment_attempt"("paymentIntentId","attemptNo");
CREATE INDEX "payment_attempt_paymentIntentId_status_idx" ON "payment_attempt"("paymentIntentId","status");
CREATE UNIQUE INDEX "payment_event_providerEventId_key" ON "payment_event"("providerEventId");
CREATE INDEX "payment_event_paymentIntentId_receivedAt_idx" ON "payment_event"("paymentIntentId","receivedAt");
CREATE INDEX "payment_event_paymentAttemptId_occurredAt_idx" ON "payment_event"("paymentAttemptId","occurredAt");

ALTER TABLE "payment_intent" ADD CONSTRAINT "payment_intent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_intent" ADD CONSTRAINT "payment_intent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_intent" ADD CONSTRAINT "payment_intent_deliveryAddressId_fkey" FOREIGN KEY ("deliveryAddressId") REFERENCES "delivery_address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "payment_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_payment_provider_trust_history() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'payment provider trust registry is immutable' USING ERRCODE='55000';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_provider_trust_history_guard BEFORE INSERT OR UPDATE OR DELETE ON "payment_provider_trust" FOR EACH ROW EXECUTE FUNCTION guard_payment_provider_trust_history();

CREATE FUNCTION guard_payment_intent_insert() RETURNS trigger AS $$
DECLARE quote_row "quote"%ROWTYPE; address_row "delivery_address"%ROWTYPE; trust_row "payment_provider_trust"%ROWTYPE;
BEGIN
  SELECT * INTO quote_row FROM "quote" WHERE "id"=NEW."quoteId" FOR KEY SHARE;
  SELECT * INTO address_row FROM "delivery_address" WHERE "id"=NEW."deliveryAddressId" FOR KEY SHARE;
  SELECT * INTO trust_row FROM "payment_provider_trust" WHERE "provider"=NEW."provider" FOR KEY SHARE;
  IF quote_row."id" IS NULL OR quote_row."ownerUserId"<>NEW."ownerUserId" OR quote_row."status"<>'accepted'
     OR quote_row."amountCent"<>NEW."amountCent" OR quote_row."currency"<>NEW."currency" OR NOT quote_row."sandboxOnly" THEN
    RAISE EXCEPTION 'payment intent requires exact accepted sandbox quote facts' USING ERRCODE='23514';
  END IF;
  IF address_row."id" IS NULL OR address_row."ownerUserId"<>NEW."ownerUserId" OR address_row."quoteId"<>NEW."quoteId"
     OR address_row."confirmedAt" IS NULL OR address_row."version"<>NEW."deliveryAddressVersion" OR NOT address_row."sandboxOnly" THEN
    RAISE EXCEPTION 'payment intent requires the current confirmed owner address' USING ERRCODE='23514';
  END IF;
  IF trust_row."provider" IS NULL OR trust_row."verificationKeyHash"<>NEW."verificationKeyHash" OR NOT trust_row."sandboxOnly" THEN
    RAISE EXCEPTION 'payment intent requires a trusted provider verification key' USING ERRCODE='23514';
  END IF;
  IF NEW."deliveryAddressSnapshot" IS DISTINCT FROM jsonb_build_object(
    'schemaVersion', 'delivery-address.v0',
    'addressId', address_row."id",
    'quoteId', quote_row."id",
    'version', address_row."version",
    'sandboxOnly', address_row."sandboxOnly",
    'fields', jsonb_build_object(
      'recipientName', address_row."recipientName",
      'mobile', address_row."mobile",
      'province', address_row."province",
      'city', address_row."city",
      'district', address_row."district",
      'detail', address_row."detail",
      'postalCode', address_row."postalCode"
    ),
    'confirmedAt', to_char(address_row."confirmedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) THEN
    RAISE EXCEPTION 'payment address snapshot must match confirmed persisted facts' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_intent_insert_guard BEFORE INSERT ON "payment_intent" FOR EACH ROW EXECUTE FUNCTION guard_payment_intent_insert();

CREATE FUNCTION guard_payment_intent_history() RETURNS trigger AS $$
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
      OR (OLD."status" IN ('failed','canceled') AND NEW."status"='needs_attention')
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
     AND (ROW(NEW."status",NEW."lastAppliedEventId",NEW."succeededAt",NEW."failedAt",NEW."canceledAt",NEW."needsAttentionAt")
       IS DISTINCT FROM ROW(OLD."status",OLD."lastAppliedEventId",OLD."succeededAt",OLD."failedAt",OLD."canceledAt",OLD."needsAttentionAt"))
     AND (NEW."lastAppliedEventId" IS NOT DISTINCT FROM OLD."lastAppliedEventId" OR NOT EXISTS (
       SELECT 1 FROM "payment_event" pe WHERE pe."id"=NEW."lastAppliedEventId" AND pe."paymentIntentId"=OLD."id"
         AND ((pe."processingResult"='applied' AND pe."providerStatus"=NEW."status" AND (
             (NEW."status" IN ('requires_action','processing') AND NEW."succeededAt" IS NULL AND NEW."failedAt" IS NULL AND NEW."canceledAt" IS NULL AND NEW."needsAttentionAt" IS NULL)
             OR (NEW."status"='succeeded' AND pe."occurredAt"=NEW."succeededAt")
             OR (NEW."status"='failed' AND pe."occurredAt"=NEW."failedAt")
             OR (NEW."status"='canceled' AND pe."occurredAt"=NEW."canceledAt")
           )) OR (pe."processingResult"='needs_attention' AND NEW."status"='needs_attention' AND pe."occurredAt"=NEW."needsAttentionAt"))
         AND (OLD."lastAppliedEventId" IS NULL OR pe."sequence" > (
           SELECT old_event."sequence" FROM "payment_event" old_event WHERE old_event."id"=OLD."lastAppliedEventId"
         ))
     )) THEN
    RAISE EXCEPTION 'payment status changes require a fresh trusted provider event' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_intent_history_guard BEFORE UPDATE OR DELETE ON "payment_intent" FOR EACH ROW EXECUTE FUNCTION guard_payment_intent_history();

CREATE FUNCTION guard_payment_attempt_insert() RETURNS trigger AS $$
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
     OR (NEW."attemptNo">1 AND intent_row."status"<>'failed') THEN
    RAISE EXCEPTION 'payment attempt sequence does not match intent state' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_attempt_insert_guard BEFORE INSERT ON "payment_attempt" FOR EACH ROW EXECUTE FUNCTION guard_payment_attempt_insert();

CREATE FUNCTION guard_payment_attempt_history() RETURNS trigger AS $$
DECLARE intent_key_hash TEXT; state_proof TEXT;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment attempt cannot be deleted' USING ERRCODE='55000'; END IF;
  IF ROW(NEW."id",NEW."paymentIntentId",NEW."attemptNo",NEW."provider",NEW."providerPaymentId",NEW."createdAt")
     IS DISTINCT FROM ROW(OLD."id",OLD."paymentIntentId",OLD."attemptNo",OLD."provider",OLD."providerPaymentId",OLD."createdAt") THEN
    RAISE EXCEPTION 'payment attempt ancestry is immutable' USING ERRCODE='55000';
  END IF;
  IF ROW(NEW."providerObservedStatus",NEW."providerObservedAt")
     IS DISTINCT FROM ROW(OLD."providerObservedStatus",OLD."providerObservedAt") THEN
    SELECT "verificationKeyHash" INTO intent_key_hash FROM "payment_intent" WHERE "id"=OLD."paymentIntentId";
    state_proof := current_setting('petscape.payment_provider_state_proof', TRUE);
    IF state_proof IS NULL OR encode(sha256(convert_to(state_proof, 'UTF8')), 'hex')<>intent_key_hash THEN
      RAISE EXCEPTION 'provider state changes require a valid provider state proof' USING ERRCODE='55000';
    END IF;
    IF NEW."providerObservedAt" <= OLD."providerObservedAt" THEN
      RAISE EXCEPTION 'provider state observation time cannot regress' USING ERRCODE='55000';
    END IF;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status"='requires_action' AND NEW."status" IN ('processing','succeeded','failed','canceled'))
    OR (OLD."status"='processing' AND NEW."status" IN ('succeeded','failed','canceled'))
  ) THEN RAISE EXCEPTION 'illegal payment attempt status transition' USING ERRCODE='55000'; END IF;
  IF ROW(NEW."status",NEW."failureCode",NEW."failureMessage",NEW."lastEventAt",NEW."lastAppliedEventId",NEW."resolvedAt")
     IS DISTINCT FROM ROW(OLD."status",OLD."failureCode",OLD."failureMessage",OLD."lastEventAt",OLD."lastAppliedEventId",OLD."resolvedAt")
     AND (NEW."lastAppliedEventId" IS NOT DISTINCT FROM OLD."lastAppliedEventId" OR NOT EXISTS (
       SELECT 1 FROM "payment_event" pe WHERE pe."id"=NEW."lastAppliedEventId" AND pe."paymentAttemptId"=OLD."id"
         AND pe."providerStatus"=NEW."status" AND pe."processingResult"='applied' AND pe."occurredAt"=NEW."lastEventAt"
         AND ((NEW."status"='failed' AND NEW."failureCode"=COALESCE(pe."sanitizedPayload"->>'failureCode','provider_failed')
               AND NEW."failureMessage"=COALESCE(pe."sanitizedPayload"->>'failureMessage','支付失败') AND NEW."resolvedAt"=pe."occurredAt")
           OR (NEW."status" IN ('succeeded','canceled') AND NEW."failureCode" IS NULL AND NEW."failureMessage" IS NULL AND NEW."resolvedAt"=pe."occurredAt")
           OR (NEW."status" IN ('requires_action','processing') AND NEW."failureCode" IS NULL AND NEW."failureMessage" IS NULL AND NEW."resolvedAt" IS NULL))
         AND (OLD."lastAppliedEventId" IS NULL OR pe."sequence" > (
           SELECT old_event."sequence" FROM "payment_event" old_event WHERE old_event."id"=OLD."lastAppliedEventId"
         ))
     )) THEN RAISE EXCEPTION 'attempt status changes require a fresh trusted provider event' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_attempt_history_guard BEFORE UPDATE OR DELETE ON "payment_attempt" FOR EACH ROW EXECUTE FUNCTION guard_payment_attempt_history();

CREATE FUNCTION guard_payment_event_insert() RETURNS trigger AS $$
DECLARE attempt_row "payment_attempt"%ROWTYPE; intent_row "payment_intent"%ROWTYPE; persistence_proof TEXT;
BEGIN
  SELECT * INTO attempt_row FROM "payment_attempt" WHERE "id"=NEW."paymentAttemptId" FOR KEY SHARE;
  IF attempt_row."id" IS NULL OR attempt_row."paymentIntentId"<>NEW."paymentIntentId"
     OR attempt_row."provider"<>NEW."provider" OR attempt_row."providerPaymentId"<>NEW."providerPaymentId" THEN
    RAISE EXCEPTION 'payment event ancestry must match its provider attempt' USING ERRCODE='23514';
  END IF;
  SELECT * INTO intent_row FROM "payment_intent" WHERE "id"=attempt_row."paymentIntentId" FOR KEY SHARE;
  persistence_proof := current_setting('petscape.payment_event_proof', TRUE);
  IF persistence_proof IS NULL OR encode(sha256(convert_to(persistence_proof, 'UTF8')), 'hex')<>intent_row."verificationKeyHash" THEN
    RAISE EXCEPTION 'payment event requires a valid persistence proof' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_event_insert_guard BEFORE INSERT ON "payment_event" FOR EACH ROW EXECUTE FUNCTION guard_payment_event_insert();

CREATE FUNCTION guard_payment_event_history() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'payment event ledger is append-only' USING ERRCODE='55000';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_event_history_guard BEFORE UPDATE OR DELETE ON "payment_event" FOR EACH ROW EXECUTE FUNCTION guard_payment_event_history();
