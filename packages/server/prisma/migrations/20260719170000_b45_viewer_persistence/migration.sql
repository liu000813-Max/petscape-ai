-- WP-B45-2: one editable Scene per Project plus immutable model/scene confirmations.

CREATE TABLE "design_item" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentModelConfirmationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_item_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "design_item_name_nonempty" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120)
);

CREATE TABLE "model_confirmation" (
    "id" TEXT NOT NULL,
    "designItemId" TEXT NOT NULL,
    "modelRef" JSONB NOT NULL,
    "sourceBoundsMm" JSONB NOT NULL,
    "uniformScale" DOUBLE PRECISION NOT NULL,
    "finalBoundsMm" JSONB NOT NULL,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_confirmation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "model_confirmation_scale_valid" CHECK ("uniformScale" > 0 AND "uniformScale" <= 10),
    CONSTRAINT "model_confirmation_ref_valid" CHECK (
      jsonb_typeof("modelRef") = 'object'
      AND ("modelRef"->>'checksum') ~ '^[a-f0-9]{64}$'
      AND (
        (("modelRef"->>'kind') = 'temporary_catalog'
          AND char_length(btrim("modelRef"->>'assetKey')) > 0
          AND ("modelRef"->>'quoteEligible') = 'false'
          AND NOT ("modelRef" ? 'assetId'))
        OR
        (("modelRef"->>'kind') = 'owned_asset'
          AND char_length(btrim("modelRef"->>'assetId')) > 0
          AND ("modelRef"->>'quoteEligible') = 'true'
          AND NOT ("modelRef" ? 'assetKey'))
      )
    ),
    CONSTRAINT "model_confirmation_bounds_objects" CHECK (
      jsonb_typeof("sourceBoundsMm") = 'object'
      AND jsonb_typeof("finalBoundsMm") = 'object'
    )
);

CREATE TABLE "scene" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "targetDesignItemId" TEXT NOT NULL,
    "targetModelConfirmationId" TEXT NOT NULL,
    "targetInstanceId" TEXT NOT NULL,
    "cageMm" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scene_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scene_revision_nonnegative" CHECK ("revision" >= 0),
    CONSTRAINT "scene_target_instance_nonempty" CHECK (char_length(btrim("targetInstanceId")) > 0),
    CONSTRAINT "scene_cage_object" CHECK (jsonb_typeof("cageMm") = 'object'),
    CONSTRAINT "scene_items_array" CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") BETWEEN 1 AND 64)
);

CREATE TABLE "scene_confirmation" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "sceneRevision" INTEGER NOT NULL,
    "targetDesignItemId" TEXT NOT NULL,
    "targetModelConfirmationId" TEXT NOT NULL,
    "targetInstanceId" TEXT NOT NULL,
    "snapshotSchemaVersion" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_confirmation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scene_confirmation_revision_nonnegative" CHECK ("sceneRevision" >= 0),
    CONSTRAINT "scene_confirmation_schema_v1" CHECK ("snapshotSchemaVersion" = 'scene-confirmation.v1'),
    CONSTRAINT "scene_confirmation_snapshot_object" CHECK (jsonb_typeof("snapshot") = 'object'),
    CONSTRAINT "scene_confirmation_snapshot_matches_columns" CHECK (
      ("snapshot"->>'sceneId') IS NOT DISTINCT FROM "sceneId"
      AND (("snapshot"->>'sceneRevision')::INTEGER) IS NOT DISTINCT FROM "sceneRevision"
      AND ("snapshot"->>'targetDesignItemId') IS NOT DISTINCT FROM "targetDesignItemId"
      AND ("snapshot"->>'targetModelConfirmationId') IS NOT DISTINCT FROM "targetModelConfirmationId"
      AND ("snapshot"->>'targetInstanceId') IS NOT DISTINCT FROM "targetInstanceId"
      AND ("snapshot"->>'schemaVersion') IS NOT DISTINCT FROM "snapshotSchemaVersion"
    )
);

CREATE UNIQUE INDEX "design_item_currentModelConfirmationId_key" ON "design_item"("currentModelConfirmationId");
CREATE INDEX "design_item_projectId_idx" ON "design_item"("projectId");
CREATE INDEX "model_confirmation_designItemId_confirmedAt_idx" ON "model_confirmation"("designItemId", "confirmedAt");
CREATE INDEX "model_confirmation_confirmedByUserId_idx" ON "model_confirmation"("confirmedByUserId");
CREATE UNIQUE INDEX "scene_projectId_key" ON "scene"("projectId");
CREATE INDEX "scene_targetDesignItemId_idx" ON "scene"("targetDesignItemId");
CREATE INDEX "scene_targetModelConfirmationId_idx" ON "scene"("targetModelConfirmationId");
CREATE UNIQUE INDEX "scene_confirmation_sceneId_sceneRevision_key" ON "scene_confirmation"("sceneId", "sceneRevision");
CREATE INDEX "scene_confirmation_confirmedByUserId_idx" ON "scene_confirmation"("confirmedByUserId");
CREATE INDEX "scene_confirmation_targetDesignItemId_idx" ON "scene_confirmation"("targetDesignItemId");
CREATE INDEX "scene_confirmation_targetModelConfirmationId_idx" ON "scene_confirmation"("targetModelConfirmationId");

ALTER TABLE "design_item" ADD CONSTRAINT "design_item_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_confirmation" ADD CONSTRAINT "model_confirmation_designItemId_fkey"
  FOREIGN KEY ("designItemId") REFERENCES "design_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_confirmation" ADD CONSTRAINT "model_confirmation_confirmedByUserId_fkey"
  FOREIGN KEY ("confirmedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "design_item" ADD CONSTRAINT "design_item_currentModelConfirmationId_fkey"
  FOREIGN KEY ("currentModelConfirmationId") REFERENCES "model_confirmation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scene" ADD CONSTRAINT "scene_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scene" ADD CONSTRAINT "scene_targetDesignItemId_fkey"
  FOREIGN KEY ("targetDesignItemId") REFERENCES "design_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scene" ADD CONSTRAINT "scene_targetModelConfirmationId_fkey"
  FOREIGN KEY ("targetModelConfirmationId") REFERENCES "model_confirmation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scene_confirmation" ADD CONSTRAINT "scene_confirmation_sceneId_fkey"
  FOREIGN KEY ("sceneId") REFERENCES "scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scene_confirmation" ADD CONSTRAINT "scene_confirmation_targetDesignItemId_fkey"
  FOREIGN KEY ("targetDesignItemId") REFERENCES "design_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scene_confirmation" ADD CONSTRAINT "scene_confirmation_targetModelConfirmationId_fkey"
  FOREIGN KEY ("targetModelConfirmationId") REFERENCES "model_confirmation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scene_confirmation" ADD CONSTRAINT "scene_confirmation_confirmedByUserId_fkey"
  FOREIGN KEY ("confirmedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A DesignItem may only point at one of its own immutable confirmations.
CREATE FUNCTION guard_design_item_current_confirmation() RETURNS trigger AS $$
BEGIN
  IF NEW."currentModelConfirmationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "model_confirmation"
    WHERE "id" = NEW."currentModelConfirmationId"
      AND "designItemId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'current ModelConfirmation must belong to the same DesignItem' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER design_item_current_confirmation_guard
  BEFORE INSERT OR UPDATE OF "currentModelConfirmationId" ON "design_item"
  FOR EACH ROW EXECUTE FUNCTION guard_design_item_current_confirmation();

-- Keep the editable aggregate internally consistent even for direct SQL/Prisma writes.
CREATE FUNCTION guard_scene_revision_and_references() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "design_item"
    WHERE "id" = NEW."targetDesignItemId" AND "projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'scene target DesignItem must belong to the same Project' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "model_confirmation"
    WHERE "id" = NEW."targetModelConfirmationId" AND "designItemId" = NEW."targetDesignItemId"
  ) THEN
    RAISE EXCEPTION 'scene target ModelConfirmation must belong to target DesignItem' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'scene identity and Project are immutable' USING ERRCODE = '55000';
    END IF;

    IF ROW(
      NEW."targetDesignItemId", NEW."targetModelConfirmationId", NEW."targetInstanceId",
      NEW."cageMm", NEW."items"
    ) IS DISTINCT FROM ROW(
      OLD."targetDesignItemId", OLD."targetModelConfirmationId", OLD."targetInstanceId",
      OLD."cageMm", OLD."items"
    ) THEN
      IF NEW."revision" <> OLD."revision" + 1 THEN
        RAISE EXCEPTION 'scene draft mutation must increment revision by exactly one' USING ERRCODE = '55000';
      END IF;
    ELSIF NEW."revision" <> OLD."revision" THEN
      RAISE EXCEPTION 'scene revision cannot change without a draft mutation' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scene_revision_and_reference_guard
  BEFORE INSERT OR UPDATE ON "scene"
  FOR EACH ROW EXECUTE FUNCTION guard_scene_revision_and_references();

-- Freeze a confirmation only when every duplicated reference still matches the
-- locked Scene aggregate and its Project owner at insert time.
CREATE FUNCTION guard_scene_confirmation_consistency() RETURNS trigger AS $$
DECLARE
  parent_project_id TEXT;
  parent_revision INTEGER;
  parent_target_design_item_id TEXT;
  parent_target_model_confirmation_id TEXT;
  parent_target_instance_id TEXT;
  project_owner_user_id TEXT;
BEGIN
  SELECT
    s."projectId",
    s."revision",
    s."targetDesignItemId",
    s."targetModelConfirmationId",
    s."targetInstanceId",
    p."ownerUserId"
  INTO
    parent_project_id,
    parent_revision,
    parent_target_design_item_id,
    parent_target_model_confirmation_id,
    parent_target_instance_id,
    project_owner_user_id
  FROM "scene" s
  JOIN "project" p ON p."id" = s."projectId"
  WHERE s."id" = NEW."sceneId"
  FOR SHARE OF s, p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SceneConfirmation parent Scene or Project does not exist' USING ERRCODE = '23503';
  END IF;

  IF ROW(
    NEW."sceneRevision",
    NEW."targetDesignItemId",
    NEW."targetModelConfirmationId",
    NEW."targetInstanceId"
  ) IS DISTINCT FROM ROW(
    parent_revision,
    parent_target_design_item_id,
    parent_target_model_confirmation_id,
    parent_target_instance_id
  ) THEN
    RAISE EXCEPTION 'SceneConfirmation must match the current locked Scene target and revision' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "design_item"
    WHERE "id" = NEW."targetDesignItemId"
      AND "projectId" = parent_project_id
  ) THEN
    RAISE EXCEPTION 'SceneConfirmation target DesignItem must belong to the Scene Project' USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "model_confirmation"
    WHERE "id" = NEW."targetModelConfirmationId"
      AND "designItemId" = NEW."targetDesignItemId"
  ) THEN
    RAISE EXCEPTION 'SceneConfirmation target ModelConfirmation must belong to the target DesignItem' USING ERRCODE = '23503';
  END IF;

  IF NEW."confirmedByUserId" IS DISTINCT FROM project_owner_user_id THEN
    RAISE EXCEPTION 'SceneConfirmation confirmer must own the Scene Project' USING ERRCODE = '23514';
  END IF;

  IF (NEW."snapshot"->>'projectId') IS DISTINCT FROM parent_project_id THEN
    RAISE EXCEPTION 'SceneConfirmation snapshot Project must match the Scene Project' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scene_confirmation_consistency_guard
  BEFORE INSERT ON "scene_confirmation"
  FOR EACH ROW EXECUTE FUNCTION guard_scene_confirmation_consistency();

CREATE FUNCTION deny_model_confirmation_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'model_confirmation is append-only; create a new confirmation instead' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_confirmation_append_only
  BEFORE UPDATE OR DELETE ON "model_confirmation"
  FOR EACH ROW EXECUTE FUNCTION deny_model_confirmation_mutation();

CREATE FUNCTION deny_scene_confirmation_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'scene_confirmation is append-only; create a new revision confirmation instead' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scene_confirmation_append_only
  BEFORE UPDATE OR DELETE ON "scene_confirmation"
  FOR EACH ROW EXECUTE FUNCTION deny_scene_confirmation_mutation();
