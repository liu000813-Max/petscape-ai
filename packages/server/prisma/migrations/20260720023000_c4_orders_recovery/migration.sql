-- WP-C4-1: one immutable sandbox order per trusted succeeded payment.
CREATE TABLE "order" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "checkRunId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sandboxOnly" BOOLEAN NOT NULL,
  "amountCent" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "productCode" TEXT NOT NULL,
  "materialName" TEXT NOT NULL,
  "materialVersion" TEXT NOT NULL,
  "pricingRuleVersion" TEXT NOT NULL,
  "purchaseSnapshot" JSONB NOT NULL,
  "deliveryAddressSnapshot" JSONB NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_status_valid" CHECK ("status" IN ('paid','canceled')),
  CONSTRAINT "order_sandbox_only" CHECK ("sandboxOnly" = TRUE),
  CONSTRAINT "order_amount_valid" CHECK ("amountCent" > 0),
  CONSTRAINT "order_currency_valid" CHECK ("currency" = 'CNY'),
  CONSTRAINT "order_purchase_snapshot_object" CHECK (jsonb_typeof("purchaseSnapshot") = 'object'),
  CONSTRAINT "order_address_snapshot_object" CHECK (jsonb_typeof("deliveryAddressSnapshot") = 'object')
);

CREATE TABLE "order_status_history" (
  "sequence" BIGSERIAL NOT NULL,
  "orderId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("sequence"),
  CONSTRAINT "order_history_from_status_valid" CHECK ("fromStatus" IS NULL OR "fromStatus" IN ('paid','canceled')),
  CONSTRAINT "order_history_to_status_valid" CHECK ("toStatus" IN ('paid','canceled')),
  CONSTRAINT "order_history_source_valid" CHECK ("source" IN ('system','owner'))
);

CREATE UNIQUE INDEX "order_paymentIntentId_key" ON "order"("paymentIntentId");
CREATE UNIQUE INDEX "order_quoteId_key" ON "order"("quoteId");
CREATE INDEX "order_ownerUserId_createdAt_idx" ON "order"("ownerUserId","createdAt");
CREATE INDEX "order_status_createdAt_idx" ON "order"("status","createdAt");
CREATE INDEX "order_status_history_orderId_sequence_idx" ON "order_status_history"("orderId","sequence");
CREATE INDEX "order_status_history_actorUserId_createdAt_idx" ON "order_status_history"("actorUserId","createdAt");

ALTER TABLE "order" ADD CONSTRAINT "order_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order" ADD CONSTRAINT "order_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order" ADD CONSTRAINT "order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order" ADD CONSTRAINT "order_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "customization_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order" ADD CONSTRAINT "order_checkRunId_fkey" FOREIGN KEY ("checkRunId") REFERENCES "check_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_order_insert() RETURNS trigger AS $$
DECLARE
  intent_row "payment_intent"%ROWTYPE;
  quote_row "quote"%ROWTYPE;
  request_row "customization_request"%ROWTYPE;
  check_row "check_run"%ROWTYPE;
  event_row "payment_event"%ROWTYPE;
  expected_purchase JSONB;
BEGIN
  SELECT * INTO intent_row FROM "payment_intent" WHERE "id"=NEW."paymentIntentId" FOR UPDATE;
  SELECT * INTO quote_row FROM "quote" WHERE "id"=NEW."quoteId" FOR KEY SHARE;
  SELECT * INTO request_row FROM "customization_request" WHERE "id"=NEW."requestId" FOR KEY SHARE;
  SELECT * INTO check_row FROM "check_run" WHERE "id"=NEW."checkRunId" FOR KEY SHARE;
  SELECT * INTO event_row FROM "payment_event" WHERE "id"=intent_row."lastAppliedEventId" FOR KEY SHARE;

  IF intent_row."id" IS NULL OR intent_row."status"<>'succeeded' OR intent_row."succeededAt" IS NULL
     OR NOT intent_row."sandboxOnly" OR event_row."id" IS NULL OR NOT event_row."verified"
     OR event_row."processingResult"<>'applied' OR event_row."providerStatus"<>'succeeded'
     OR event_row."amountCent"<>intent_row."amountCent" OR event_row."currency"<>intent_row."currency" THEN
    RAISE EXCEPTION 'order requires a trusted succeeded payment event' USING ERRCODE='23514';
  END IF;
  IF quote_row."id" IS NULL OR request_row."id" IS NULL OR check_row."id" IS NULL
     OR intent_row."ownerUserId"<>NEW."ownerUserId" OR intent_row."quoteId"<>NEW."quoteId"
     OR quote_row."ownerUserId"<>NEW."ownerUserId" OR quote_row."requestId"<>NEW."requestId"
     OR quote_row."checkRunId"<>NEW."checkRunId" OR request_row."ownerUserId"<>NEW."ownerUserId"
     OR check_row."requestId"<>NEW."requestId" OR check_row."status"<>'completed' OR check_row."result"<>'approved'
     OR quote_row."status"<>'accepted' OR NOT quote_row."sandboxOnly" THEN
    RAISE EXCEPTION 'order ancestry must match an accepted approved sandbox quote' USING ERRCODE='23514';
  END IF;
  IF NEW."status"<>'paid' OR NOT NEW."sandboxOnly" OR NEW."amountCent"<>intent_row."amountCent"
     OR NEW."currency"<>intent_row."currency" OR NEW."paidAt"<>intent_row."succeededAt"
     OR NEW."productCode"<>quote_row."productCode" OR NEW."materialName"<>quote_row."materialName"
     OR NEW."materialVersion"<>quote_row."materialVersion" OR NEW."pricingRuleVersion"<>quote_row."pricingRuleVersion"
     OR NEW."deliveryAddressSnapshot" IS DISTINCT FROM intent_row."deliveryAddressSnapshot" THEN
    RAISE EXCEPTION 'order money and address must match persisted payment facts' USING ERRCODE='23514';
  END IF;

  expected_purchase := jsonb_build_object(
    'schemaVersion','order-purchase.v0',
    'request',jsonb_build_object(
      'sceneConfirmationId',request_row."sceneConfirmationId",
      'sceneConfirmation',request_row."sceneConfirmation",
      'contactName',request_row."contactName",
      'contactPhone',request_row."contactPhone",
      'usageDescription',request_row."usageDescription",
      'additionalRequirements',request_row."additionalRequirements"
    ),
    'review',jsonb_build_object(
      'checkRunId',check_row."id",
      'result',check_row."result",
      'issues',check_row."issues",
      'evidence',check_row."evidence",
      'adjustmentSuggestions',check_row."adjustmentSuggestions",
      'note',check_row."note",
      'checklistVersion',check_row."checklistVersion",
      'ruleVersion',check_row."ruleVersion"
    ),
    'quoteInput',quote_row."inputSnapshot",
    'priceBreakdown',quote_row."priceBreakdown",
    'deliveryEstimate',quote_row."deliveryEstimate"
  );
  IF NEW."purchaseSnapshot" IS DISTINCT FROM expected_purchase THEN
    RAISE EXCEPTION 'order purchase and review snapshot must match persisted facts' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER order_insert_guard BEFORE INSERT ON "order" FOR EACH ROW EXECUTE FUNCTION guard_order_insert();

CREATE FUNCTION guard_order_history() RETURNS trigger AS $$ BEGIN
  IF TG_OP='INSERT' THEN
    IF pg_trigger_depth() <> 2 OR NOT (
      (NEW."fromStatus" IS NULL AND NEW."toStatus"='paid' AND NEW."reason"='trusted_payment_succeeded'
       AND NEW."source"='system' AND NEW."actorUserId" IS NULL)
      OR
      (NEW."fromStatus"='paid' AND NEW."toStatus"='canceled' AND NEW."reason"='owner_canceled_sandbox'
       AND NEW."source"='owner' AND NEW."actorUserId" IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'order history insert requires order creation trigger' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order status history is append-only' USING ERRCODE='55000';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER order_history_guard BEFORE INSERT OR UPDATE OR DELETE ON "order_status_history" FOR EACH ROW EXECUTE FUNCTION guard_order_history();

CREATE FUNCTION create_initial_order_history() RETURNS trigger AS $$ BEGIN
  INSERT INTO "order_status_history" ("orderId","actorUserId","fromStatus","toStatus","reason","source")
  VALUES (NEW."id",NULL,NULL,'paid','trusted_payment_succeeded','system');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER order_initial_history AFTER INSERT ON "order" FOR EACH ROW EXECUTE FUNCTION create_initial_order_history();

CREATE FUNCTION guard_order_history_rewrite() RETURNS trigger AS $$
DECLARE cancel_proof TEXT; cancel_actor TEXT; intent_key_hash TEXT;
BEGIN
  IF TG_OP='UPDATE' AND OLD."status"='paid' AND NEW."status"='canceled'
     AND (to_jsonb(NEW) - 'status') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    cancel_proof := current_setting('petscape.order_cancel_proof', TRUE);
    cancel_actor := current_setting('petscape.order_cancel_actor', TRUE);
    SELECT pi."verificationKeyHash" INTO intent_key_hash
      FROM "payment_intent" pi WHERE pi."id"=OLD."paymentIntentId";
    IF cancel_proof IS NULL OR cancel_actor IS DISTINCT FROM OLD."ownerUserId"
       OR encode(sha256(convert_to(cancel_proof, 'UTF8')), 'hex') IS DISTINCT FROM intent_key_hash THEN
      RAISE EXCEPTION 'order cancellation requires trusted owner proof' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order snapshots are immutable and only paid to canceled is allowed' USING ERRCODE='55000';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER order_history_rewrite_guard BEFORE UPDATE OR DELETE ON "order" FOR EACH ROW EXECUTE FUNCTION guard_order_history_rewrite();

CREATE FUNCTION create_order_cancel_history() RETURNS trigger AS $$ BEGIN
  INSERT INTO "order_status_history" ("orderId","actorUserId","fromStatus","toStatus","reason","source")
  VALUES (NEW."id",current_setting('petscape.order_cancel_actor', TRUE),'paid','canceled','owner_canceled_sandbox','owner');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER order_cancel_history AFTER UPDATE OF "status" ON "order" FOR EACH ROW
WHEN (OLD."status"='paid' AND NEW."status"='canceled') EXECUTE FUNCTION create_order_cancel_history();
