-- WP-C5-1: owner-scoped current checkout address with explicit confirmation.
CREATE TABLE "delivery_address" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "recipientName" TEXT NOT NULL,
  "mobile" TEXT NOT NULL,
  "province" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "postalCode" TEXT,
  "sandboxOnly" BOOLEAN NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "delivery_address_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_address_version_positive" CHECK ("version" > 0),
  CONSTRAINT "delivery_address_recipient_valid" CHECK (char_length(btrim("recipientName")) BETWEEN 1 AND 80),
  CONSTRAINT "delivery_address_mobile_valid" CHECK (
    char_length(btrim("mobile")) BETWEEN 6 AND 32 AND "mobile" ~ '^[0-9+() -]+$'
  ),
  CONSTRAINT "delivery_address_province_valid" CHECK (char_length(btrim("province")) BETWEEN 1 AND 80),
  CONSTRAINT "delivery_address_city_valid" CHECK (char_length(btrim("city")) BETWEEN 1 AND 80),
  CONSTRAINT "delivery_address_district_valid" CHECK (char_length(btrim("district")) BETWEEN 1 AND 80),
  CONSTRAINT "delivery_address_detail_valid" CHECK (char_length(btrim("detail")) BETWEEN 1 AND 500),
  CONSTRAINT "delivery_address_postal_valid" CHECK (
    "postalCode" IS NULL OR (
      char_length(btrim("postalCode")) BETWEEN 3 AND 16
      AND "postalCode" ~ '^[A-Za-z0-9 -]+$'
    )
  )
);

CREATE UNIQUE INDEX "delivery_address_quoteId_key" ON "delivery_address"("quoteId");
CREATE INDEX "delivery_address_ownerUserId_updatedAt_idx" ON "delivery_address"("ownerUserId", "updatedAt");
CREATE INDEX "delivery_address_ownerUserId_confirmedAt_idx" ON "delivery_address"("ownerUserId", "confirmedAt");

ALTER TABLE "delivery_address" ADD CONSTRAINT "delivery_address_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_address" ADD CONSTRAINT "delivery_address_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_delivery_address_insert() RETURNS trigger AS $$
DECLARE
  quote_row "quote"%ROWTYPE;
BEGIN
  SELECT * INTO quote_row FROM "quote" WHERE "id" = NEW."quoteId" FOR KEY SHARE;
  IF quote_row."id" IS NULL
     OR quote_row."ownerUserId" <> NEW."ownerUserId"
     OR quote_row."status" <> 'accepted'
     OR quote_row."acceptedAt" IS NULL
     OR quote_row."sandboxOnly" <> NEW."sandboxOnly" THEN
    RAISE EXCEPTION 'delivery address requires an accepted owner quote with matching sandbox eligibility'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> 1 OR NEW."confirmedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'delivery address must be created unconfirmed at version 1' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delivery_address_insert_guard
  BEFORE INSERT ON "delivery_address"
  FOR EACH ROW EXECUTE FUNCTION guard_delivery_address_insert();

CREATE FUNCTION guard_delivery_address_history() RETURNS trigger AS $$
DECLARE
  fields_changed BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'delivery address history cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW."id", NEW."ownerUserId", NEW."quoteId", NEW."sandboxOnly", NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."ownerUserId", OLD."quoteId", OLD."sandboxOnly", OLD."createdAt") THEN
    RAISE EXCEPTION 'delivery address ownership and ancestry are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'delivery address update requires the next version' USING ERRCODE = '40001';
  END IF;

  fields_changed := ROW(
    NEW."recipientName", NEW."mobile", NEW."province", NEW."city", NEW."district", NEW."detail", NEW."postalCode"
  ) IS DISTINCT FROM ROW(
    OLD."recipientName", OLD."mobile", OLD."province", OLD."city", OLD."district", OLD."detail", OLD."postalCode"
  );

  IF fields_changed THEN
    IF NEW."confirmedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'editing a delivery address must clear confirmation' USING ERRCODE = '55000';
    END IF;
  ELSIF OLD."confirmedAt" IS NULL AND NEW."confirmedAt" IS NOT NULL THEN
    -- The database, not a client or application clock, owns the confirmation fact.
    NEW."confirmedAt" := clock_timestamp() AT TIME ZONE 'UTC';
  ELSE
    RAISE EXCEPTION 'delivery address update must edit fields or confirm once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delivery_address_history_guard
  BEFORE UPDATE OR DELETE ON "delivery_address"
  FOR EACH ROW EXECUTE FUNCTION guard_delivery_address_history();
