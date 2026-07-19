-- WP-C1-1: immutable customization request versions and sandbox submission lifecycle.

CREATE TABLE "customization_request" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "sceneConfirmationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "targetInstanceId" TEXT NOT NULL,
    "sceneConfirmation" JSONB NOT NULL,
    "productCode" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "materialVersion" TEXT NOT NULL,
    "sandboxOnly" BOOLEAN NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "usageDescription" TEXT NOT NULL,
    "additionalRequirements" TEXT,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "supersedesRequestId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customization_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customization_request_status_valid"
      CHECK ("status" IN ('draft', 'submitted', 'superseded', 'canceled')),
    CONSTRAINT "customization_request_not_self_superseding"
      CHECK ("supersedesRequestId" IS NULL OR "supersedesRequestId" <> "id"),
    CONSTRAINT "customization_request_cancel_timestamp_consistent"
      CHECK (("status" = 'canceled') = ("canceledAt" IS NOT NULL)),
    CONSTRAINT "customization_request_contact_name_nonempty"
      CHECK (char_length(btrim("contactName")) BETWEEN 1 AND 80),
    CONSTRAINT "customization_request_contact_phone_nonempty"
      CHECK (char_length(btrim("contactPhone")) BETWEEN 6 AND 32),
    CONSTRAINT "customization_request_usage_nonempty"
      CHECK (char_length(btrim("usageDescription")) BETWEEN 1 AND 2000),
    CONSTRAINT "customization_request_additional_length"
      CHECK ("additionalRequirements" IS NULL OR char_length("additionalRequirements") <= 2000),
    CONSTRAINT "customization_request_scene_snapshot_object"
      CHECK (jsonb_typeof("sceneConfirmation") = 'object'),
    CONSTRAINT "customization_request_scene_snapshot_matches_columns"
      CHECK (
        ("sceneConfirmation"->>'sceneConfirmationId') IS NOT DISTINCT FROM "sceneConfirmationId"
        AND ("sceneConfirmation"->>'projectId') IS NOT DISTINCT FROM "projectId"
        AND ("sceneConfirmation"->>'targetInstanceId') IS NOT DISTINCT FROM "targetInstanceId"
      ),
    CONSTRAINT "customization_request_sandbox_snapshot_valid"
      CHECK (
        "sandboxOnly" IS TRUE
        AND ("sceneConfirmation"->>'eligibility') IS NOT DISTINCT FROM 'sandbox_only'
        AND "productCode" = 'cheese-lounge-bed'
        AND "materialName" = 'PETG 奶酪黄（沙箱）'
        AND "materialVersion" = 'petg-cheese-yellow-sandbox-v0'
      )
);

CREATE UNIQUE INDEX "customization_request_supersedesRequestId_key"
  ON "customization_request"("supersedesRequestId");
CREATE UNIQUE INDEX "customization_request_owner_idempotency_key"
  ON "customization_request"("ownerUserId", "idempotencyKey");
CREATE INDEX "customization_request_ownerUserId_createdAt_idx"
  ON "customization_request"("ownerUserId", "createdAt");
CREATE INDEX "customization_request_sceneConfirmationId_idx"
  ON "customization_request"("sceneConfirmationId");

ALTER TABLE "customization_request"
  ADD CONSTRAINT "customization_request_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customization_request"
  ADD CONSTRAINT "customization_request_supersedesRequestId_fkey"
  FOREIGN KEY ("supersedesRequestId") REFERENCES "customization_request"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A request version freezes every submitted fact. Only the lifecycle transition
-- needed by resubmission/cancelation may update an existing row.
CREATE FUNCTION guard_customization_request_history() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."ownerUserId", NEW."sceneConfirmationId", NEW."projectId",
    NEW."targetInstanceId", NEW."sceneConfirmation", NEW."productCode",
    NEW."materialName", NEW."materialVersion", NEW."sandboxOnly",
    NEW."contactName", NEW."contactPhone", NEW."usageDescription",
    NEW."additionalRequirements", NEW."idempotencyKey", NEW."requestFingerprint",
    NEW."supersedesRequestId", NEW."submittedAt", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."ownerUserId", OLD."sceneConfirmationId", OLD."projectId",
    OLD."targetInstanceId", OLD."sceneConfirmation", OLD."productCode",
    OLD."materialName", OLD."materialVersion", OLD."sandboxOnly",
    OLD."contactName", OLD."contactPhone", OLD."usageDescription",
    OLD."additionalRequirements", OLD."idempotencyKey", OLD."requestFingerprint",
    OLD."supersedesRequestId", OLD."submittedAt", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'customization request history is immutable; create a successor version'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND NEW."canceledAt" IS NOT DISTINCT FROM OLD."canceledAt" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'submitted'
     AND NEW."status" = 'superseded'
     AND NEW."canceledAt" IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'submitted'
     AND NEW."status" = 'canceled'
     AND NEW."canceledAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid customization request lifecycle transition: % -> %',
    OLD."status", NEW."status" USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customization_request_history_guard
  BEFORE UPDATE ON "customization_request"
  FOR EACH ROW EXECUTE FUNCTION guard_customization_request_history();
