-- WP-C2-1: immutable server-priced Quote snapshots and one-way lifecycle.
CREATE TABLE "quote" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "checkRunId" TEXT NOT NULL,
  "estimateJobId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "pricingRuleId" TEXT NOT NULL,
  "quoteMode" TEXT NOT NULL,
  "sandboxOnly" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL,
  "productCode" TEXT NOT NULL,
  "materialName" TEXT NOT NULL,
  "materialVersion" TEXT NOT NULL,
  "pricingRuleVersion" TEXT NOT NULL,
  "inputSnapshot" JSONB NOT NULL,
  "priceBreakdown" JSONB NOT NULL,
  "deliveryEstimate" JSONB NOT NULL,
  "amountCent" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "taxMode" TEXT NOT NULL,
  "roundingMode" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "supersedesQuoteId" TEXT,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quote_mode_valid" CHECK ("quoteMode" IN ('sandbox_test', 'formal_candidate')),
  CONSTRAINT "quote_status_valid" CHECK ("status" IN ('active', 'accepted', 'expired', 'superseded', 'canceled')),
  CONSTRAINT "quote_amount_valid" CHECK ("amountCent" > 0),
  CONSTRAINT "quote_currency_valid" CHECK ("currency" = 'CNY'),
  CONSTRAINT "quote_validity_window" CHECK ("expiresAt" = "validFrom" + INTERVAL '7 days'),
  CONSTRAINT "quote_json_objects" CHECK (
    jsonb_typeof("inputSnapshot") = 'object'
    AND jsonb_typeof("priceBreakdown") = 'object'
    AND jsonb_typeof("deliveryEstimate") = 'object'
  ),
  CONSTRAINT "quote_state_consistent" CHECK (
    ("status" = 'active' AND "acceptedAt" IS NULL AND "expiredAt" IS NULL AND "supersededAt" IS NULL AND "canceledAt" IS NULL)
    OR ("status" = 'accepted' AND "acceptedAt" IS NOT NULL AND "expiredAt" IS NULL AND "supersededAt" IS NULL AND "canceledAt" IS NULL)
    OR ("status" = 'expired' AND "acceptedAt" IS NULL AND "expiredAt" IS NOT NULL AND "supersededAt" IS NULL AND "canceledAt" IS NULL)
    OR ("status" = 'superseded' AND "acceptedAt" IS NULL AND "expiredAt" IS NULL AND "supersededAt" IS NOT NULL AND "canceledAt" IS NULL)
    OR ("status" = 'canceled' AND "acceptedAt" IS NULL AND "expiredAt" IS NULL AND "supersededAt" IS NULL AND "canceledAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "quote_owner_idempotency_key" ON "quote"("ownerUserId", "idempotencyKey");
CREATE UNIQUE INDEX "quote_owner_input_fingerprint_key" ON "quote"("ownerUserId", "inputFingerprint");
CREATE UNIQUE INDEX "quote_supersedesQuoteId_key" ON "quote"("supersedesQuoteId");
CREATE UNIQUE INDEX "quote_one_active_per_request" ON "quote"("requestId") WHERE "status" = 'active';
CREATE INDEX "quote_ownerUserId_createdAt_idx" ON "quote"("ownerUserId", "createdAt");
CREATE INDEX "quote_requestId_status_idx" ON "quote"("requestId", "status");
CREATE INDEX "quote_status_expiresAt_idx" ON "quote"("status", "expiresAt");

ALTER TABLE "quote" ADD CONSTRAINT "quote_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote" ADD CONSTRAINT "quote_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "customization_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote" ADD CONSTRAINT "quote_checkRunId_fkey"
  FOREIGN KEY ("checkRunId") REFERENCES "check_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote" ADD CONSTRAINT "quote_estimateJobId_fkey"
  FOREIGN KEY ("estimateJobId") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote" ADD CONSTRAINT "quote_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote" ADD CONSTRAINT "quote_pricingRuleId_fkey"
  FOREIGN KEY ("pricingRuleId") REFERENCES "pricing_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote" ADD CONSTRAINT "quote_supersedesQuoteId_fkey"
  FOREIGN KEY ("supersedesQuoteId") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_quote_eligibility() RETURNS trigger AS $$
DECLARE
  request_row "customization_request"%ROWTYPE;
  check_row "check_run"%ROWTYPE;
  job_row "job"%ROWTYPE;
  material_row "material"%ROWTYPE;
  rule_row "pricing_rule"%ROWTYPE;
  superseded_quote_row "quote"%ROWTYPE;
  expected_weight NUMERIC;
  expected_material_cost NUMERIC;
  expected_before_rounding NUMERIC;
  expected_amount NUMERIC;
BEGIN
  IF NEW."status" <> 'active' THEN
    RAISE EXCEPTION 'quote must be created active and transition through the lifecycle' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO request_row FROM "customization_request" WHERE "id" = NEW."requestId" FOR KEY SHARE;
  SELECT * INTO check_row FROM "check_run" WHERE "id" = NEW."checkRunId" FOR KEY SHARE;
  SELECT * INTO job_row FROM "job" WHERE "id" = NEW."estimateJobId" FOR KEY SHARE;
  SELECT * INTO material_row FROM "material" WHERE "id" = NEW."materialId" FOR KEY SHARE;
  SELECT * INTO rule_row FROM "pricing_rule" WHERE "id" = NEW."pricingRuleId" FOR KEY SHARE;

  IF request_row."id" IS NULL OR request_row."ownerUserId" <> NEW."ownerUserId"
     OR request_row."status" <> 'submitted' THEN
    RAISE EXCEPTION 'quote requires a current submitted request owned by the quote owner' USING ERRCODE = '23514';
  END IF;
  IF check_row."id" IS NULL OR check_row."requestId" <> request_row."id"
     OR check_row."status" <> 'completed' OR check_row."result" <> 'approved'
     OR check_row."completedAt" IS NULL THEN
    RAISE EXCEPTION 'quote requires the approved completed review for its request' USING ERRCODE = '23514';
  END IF;
  IF job_row."id" IS NULL OR job_row."ownerUserId" <> NEW."ownerUserId"
     OR job_row."type" <> 'mesh_analysis' OR job_row."status" <> 'succeeded'
     OR job_row."resultRef" IS NULL THEN
    RAISE EXCEPTION 'quote requires a succeeded owner-scoped mesh analysis' USING ERRCODE = '23514';
  END IF;
  IF material_row."id" IS NULL OR rule_row."id" IS NULL OR rule_row."materialId" <> material_row."id" THEN
    RAISE EXCEPTION 'quote material and pricing rule must be a matching persisted version' USING ERRCODE = '23514';
  END IF;

  IF NEW."productCode" <> request_row."productCode"
     OR NEW."materialName" <> request_row."materialName"
     OR NEW."materialName" <> material_row."displayName"
     OR NEW."materialVersion" <> request_row."materialVersion"
     OR NEW."materialVersion" <> material_row."versionCode"
     OR NEW."pricingRuleVersion" <> rule_row."versionCode"
     OR NEW."currency" <> material_row."currency"
     OR NEW."currency" <> rule_row."currency"
     OR NEW."taxMode" <> rule_row."taxMode"
     OR NEW."roundingMode" <> rule_row."roundingMode" THEN
    RAISE EXCEPTION 'quote columns must match immutable request, material and pricing versions' USING ERRCODE = '23514';
  END IF;

  IF NEW."inputSnapshot"->>'schemaVersion' IS DISTINCT FROM 'quote-input.v0'
     OR NEW."inputSnapshot"->'request'->>'id' IS DISTINCT FROM request_row."id"
     OR NEW."inputSnapshot"->'request'->'sceneConfirmation' IS DISTINCT FROM request_row."sceneConfirmation"
     OR NEW."inputSnapshot"->'request'->>'productCode' IS DISTINCT FROM request_row."productCode"
     OR NEW."inputSnapshot"->'request'->>'materialName' IS DISTINCT FROM request_row."materialName"
     OR NEW."inputSnapshot"->'request'->>'materialVersion' IS DISTINCT FROM request_row."materialVersion"
     OR ((NEW."inputSnapshot"->'request'->>'submittedAt')::timestamptz AT TIME ZONE 'UTC')
        IS DISTINCT FROM request_row."submittedAt"
     OR NEW."inputSnapshot"->'review'->>'id' IS DISTINCT FROM check_row."id"
     OR NEW."inputSnapshot"->'review'->>'result' IS DISTINCT FROM 'approved'
     OR NEW."inputSnapshot"->'review'->'requestSnapshot' IS DISTINCT FROM check_row."requestSnapshot"
     OR NEW."inputSnapshot"->'review'->>'checklistVersion' IS DISTINCT FROM check_row."checklistVersion"
     OR NEW."inputSnapshot"->'review'->>'ruleVersion' IS DISTINCT FROM check_row."ruleVersion"
     OR ((NEW."inputSnapshot"->'review'->>'completedAt')::timestamptz AT TIME ZONE 'UTC')
        IS DISTINCT FROM check_row."completedAt"
     OR NEW."inputSnapshot"->'b7'->>'estimateJobId' IS DISTINCT FROM job_row."id"
     OR NEW."inputSnapshot"->'b7'->'jobInput' IS DISTINCT FROM job_row."input"
     OR NEW."inputSnapshot"->'b7'->'analysis' IS DISTINCT FROM job_row."resultRef" THEN
    RAISE EXCEPTION 'quote input snapshot must match persisted request, review and analysis facts' USING ERRCODE = '23514';
  END IF;

  expected_weight := round(
    (job_row."resultRef"->>'volumeMm3')::numeric * material_row."densityMilligramPerCm3"::numeric / 1000000,
    3
  );
  expected_material_cost := ceil(expected_weight * material_row."unitPriceCentPerGram"::numeric);
  expected_before_rounding := greatest(
    (expected_material_cost + rule_row."baseFeeCent"::numeric) * rule_row."multiplier",
    rule_row."floorPriceCent"::numeric
  );
  expected_amount := ceil(expected_before_rounding / 100) * 100;

  IF NEW."priceBreakdown"->>'schemaVersion' IS DISTINCT FROM 'quote-price.v0'
     OR (NEW."priceBreakdown"->>'weightGrams')::numeric IS DISTINCT FROM expected_weight
     OR (NEW."priceBreakdown"->>'materialCostCent')::numeric IS DISTINCT FROM expected_material_cost
     OR (NEW."priceBreakdown"->>'baseFeeCent')::numeric IS DISTINCT FROM rule_row."baseFeeCent"::numeric
     OR (NEW."priceBreakdown"->>'floorPriceCent')::numeric IS DISTINCT FROM rule_row."floorPriceCent"::numeric
     OR (NEW."priceBreakdown"->>'multiplier')::numeric IS DISTINCT FROM rule_row."multiplier"
     OR (NEW."priceBreakdown"->>'amountBeforeRoundingCent')::numeric IS DISTINCT FROM expected_before_rounding
     OR (NEW."priceBreakdown"->>'amountCent')::numeric IS DISTINCT FROM expected_amount
     OR NEW."amountCent"::numeric IS DISTINCT FROM expected_amount
     OR NEW."priceBreakdown"->>'formulaVersion' IS DISTINCT FROM rule_row."formulaVersion"
     OR NEW."deliveryEstimate"->>'status' IS DISTINCT FROM 'unverified_sandbox'
     OR NEW."deliveryEstimate"->>'label' IS DISTINCT FROM '沙箱交期未验证，不构成履约承诺' THEN
    RAISE EXCEPTION 'quote price and delivery snapshots must match persisted pricing facts' USING ERRCODE = '23514';
  END IF;

  IF job_row."input"->'sceneConfirmation' IS DISTINCT FROM request_row."sceneConfirmation"
     OR job_row."resultRef"->>'assetChecksum' IS DISTINCT FROM request_row."sceneConfirmation"->'assetRef'->>'sha256'
     OR job_row."resultRef"->'dimensionsMm'->>'x' IS NULL
     OR job_row."resultRef"->'dimensionsMm'->>'y' IS NULL
     OR job_row."resultRef"->'dimensionsMm'->>'z' IS NULL
     OR abs((job_row."resultRef"->'dimensionsMm'->>'x')::numeric -
            (request_row."sceneConfirmation"->'dimensionsMm'->>'x')::numeric) > 0.001
     OR abs((job_row."resultRef"->'dimensionsMm'->>'y')::numeric -
            (request_row."sceneConfirmation"->'dimensionsMm'->>'y')::numeric) > 0.001
     OR abs((job_row."resultRef"->'dimensionsMm'->>'z')::numeric -
            (request_row."sceneConfirmation"->'dimensionsMm'->>'z')::numeric) > 0.001 THEN
    RAISE EXCEPTION 'quote analysis must match the request scene confirmation' USING ERRCODE = '23514';
  END IF;

  IF NEW."quoteMode" = 'formal_candidate' THEN
    IF NEW."sandboxOnly" OR material_row."sandboxOnly" OR rule_row."sandboxOnly"
       OR NOT material_row."isSellable" OR NOT rule_row."isSellable" THEN
      RAISE EXCEPTION 'formal quote rejects sandbox or non-sellable pricing' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."quoteMode" = 'sandbox_test' THEN
    IF NOT NEW."sandboxOnly" OR NOT material_row."sandboxOnly" OR NOT rule_row."sandboxOnly"
       OR material_row."isSellable" OR rule_row."isSellable" THEN
      RAISE EXCEPTION 'sandbox test quote requires non-sellable sandbox pricing' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."supersedesQuoteId" IS NOT NULL THEN
    SELECT * INTO superseded_quote_row FROM "quote" WHERE "id" = NEW."supersedesQuoteId" FOR KEY SHARE;
    IF superseded_quote_row."id" IS NULL
       OR superseded_quote_row."ownerUserId" <> NEW."ownerUserId"
       OR superseded_quote_row."requestId" IS DISTINCT FROM request_row."supersedesRequestId"
       OR superseded_quote_row."status" <> 'superseded'
       OR superseded_quote_row."supersededAt" IS NULL THEN
      RAISE EXCEPTION 'quote supersession must reference the owner previous request quote' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_eligibility_guard
  BEFORE INSERT ON "quote"
  FOR EACH ROW EXECUTE FUNCTION guard_quote_eligibility();

CREATE FUNCTION guard_quote_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quote history is append-only' USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW."id", NEW."ownerUserId", NEW."requestId", NEW."checkRunId", NEW."estimateJobId",
    NEW."materialId", NEW."pricingRuleId", NEW."quoteMode", NEW."sandboxOnly",
    NEW."productCode", NEW."materialName", NEW."materialVersion", NEW."pricingRuleVersion",
    NEW."inputSnapshot", NEW."priceBreakdown", NEW."deliveryEstimate", NEW."amountCent",
    NEW."currency", NEW."taxMode", NEW."roundingMode", NEW."idempotencyKey",
    NEW."inputFingerprint", NEW."supersedesQuoteId", NEW."validFrom", NEW."expiresAt", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."ownerUserId", OLD."requestId", OLD."checkRunId", OLD."estimateJobId",
    OLD."materialId", OLD."pricingRuleId", OLD."quoteMode", OLD."sandboxOnly",
    OLD."productCode", OLD."materialName", OLD."materialVersion", OLD."pricingRuleVersion",
    OLD."inputSnapshot", OLD."priceBreakdown", OLD."deliveryEstimate", OLD."amountCent",
    OLD."currency", OLD."taxMode", OLD."roundingMode", OLD."idempotencyKey",
    OLD."inputFingerprint", OLD."supersedesQuoteId", OLD."validFrom", OLD."expiresAt", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'quote snapshot is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" <> 'active' THEN
    RAISE EXCEPTION 'quote terminal state is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'accepted' AND NEW."acceptedAt" IS NOT NULL
     AND NEW."acceptedAt" >= OLD."validFrom" AND NEW."acceptedAt" < OLD."expiresAt"
     AND (clock_timestamp() AT TIME ZONE 'UTC') < OLD."expiresAt"
     AND NEW."expiredAt" IS NULL AND NEW."supersededAt" IS NULL AND NEW."canceledAt" IS NULL THEN RETURN NEW; END IF;
  IF NEW."status" = 'expired' AND NEW."acceptedAt" IS NULL
     AND NEW."expiredAt" IS NOT NULL AND NEW."supersededAt" IS NULL AND NEW."canceledAt" IS NULL THEN RETURN NEW; END IF;
  IF NEW."status" = 'superseded' AND NEW."acceptedAt" IS NULL
     AND NEW."expiredAt" IS NULL AND NEW."supersededAt" IS NOT NULL AND NEW."canceledAt" IS NULL THEN RETURN NEW; END IF;
  IF NEW."status" = 'canceled' AND NEW."acceptedAt" IS NULL
     AND NEW."expiredAt" IS NULL AND NEW."supersededAt" IS NULL AND NEW."canceledAt" IS NOT NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid quote lifecycle transition' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_history_guard
  BEFORE UPDATE OR DELETE ON "quote"
  FOR EACH ROW EXECUTE FUNCTION guard_quote_history();
