-- WP-B7-1: append-only Material/PricingRule v0 sandbox catalog.

CREATE TABLE "material" (
    "id" TEXT NOT NULL,
    "versionCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "materialKind" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "densityMilligramPerCm3" INTEGER NOT NULL,
    "unitPriceCentPerGram" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "isSellable" BOOLEAN NOT NULL DEFAULT false,
    "sandboxOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "material_density_positive" CHECK ("densityMilligramPerCm3" > 0),
    CONSTRAINT "material_unit_price_nonnegative" CHECK ("unitPriceCentPerGram" >= 0),
    CONSTRAINT "material_sandbox_not_sellable" CHECK (NOT ("sandboxOnly" AND "isSellable"))
);

CREATE TABLE "pricing_rule" (
    "id" TEXT NOT NULL,
    "versionCode" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "baseFeeCent" INTEGER NOT NULL,
    "multiplier" DECIMAL(8,4) NOT NULL,
    "floorPriceCent" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "taxMode" TEXT NOT NULL,
    "roundingMode" TEXT NOT NULL,
    "isSellable" BOOLEAN NOT NULL DEFAULT false,
    "sandboxOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pricing_rule_base_fee_nonnegative" CHECK ("baseFeeCent" >= 0),
    CONSTRAINT "pricing_rule_multiplier_positive" CHECK ("multiplier" > 0),
    CONSTRAINT "pricing_rule_floor_nonnegative" CHECK ("floorPriceCent" >= 0),
    CONSTRAINT "pricing_rule_sandbox_not_sellable" CHECK (NOT ("sandboxOnly" AND "isSellable"))
);

CREATE UNIQUE INDEX "material_versionCode_key" ON "material"("versionCode");
CREATE UNIQUE INDEX "pricing_rule_versionCode_key" ON "pricing_rule"("versionCode");
CREATE INDEX "pricing_rule_materialId_idx" ON "pricing_rule"("materialId");

ALTER TABLE "pricing_rule"
  ADD CONSTRAINT "pricing_rule_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "material"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Version rows are immutable. New facts create new versionCode rows.
CREATE FUNCTION deny_material_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'material is append-only; create a new versionCode instead' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER material_append_only
  BEFORE UPDATE OR DELETE ON "material"
  FOR EACH ROW EXECUTE FUNCTION deny_material_mutation();

CREATE FUNCTION deny_pricing_rule_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pricing_rule is append-only; create a new versionCode instead' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pricing_rule_append_only
  BEFORE UPDATE OR DELETE ON "pricing_rule"
  FOR EACH ROW EXECUTE FUNCTION deny_pricing_rule_mutation();

-- Unverified sandbox placeholders. Never use for a formal Quote.
INSERT INTO "material" (
  "id", "versionCode", "displayName", "materialKind", "colorName",
  "densityMilligramPerCm3", "unitPriceCentPerGram", "currency",
  "isSellable", "sandboxOnly"
) VALUES (
  'b7_material_petg_cheese_yellow_v0',
  'petg-cheese-yellow-sandbox-v0',
  'PETG 奶酪黄（沙箱）',
  'PETG',
  '奶酪黄',
  1270,
  35,
  'CNY',
  false,
  true
);

INSERT INTO "pricing_rule" (
  "id", "versionCode", "materialId", "formulaVersion", "baseFeeCent",
  "multiplier", "floorPriceCent", "currency", "taxMode", "roundingMode",
  "isSellable", "sandboxOnly"
) VALUES (
  'b7_pricing_rule_v0_sandbox',
  'v0-sandbox',
  'b7_material_petg_cheese_yellow_v0',
  'material-cent-ceil-plus-base-times-multiplier-v0',
  2500,
  2.5,
  12900,
  'CNY',
  'tax_inclusive',
  'ceil_whole_yuan',
  false,
  true
);
