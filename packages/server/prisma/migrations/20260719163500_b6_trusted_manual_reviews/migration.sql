-- WP-B6-0: user/admin authorization, append-only role grants and trusted manual review runs.

ALTER TABLE "user" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "user" ADD CONSTRAINT "user_role_valid" CHECK ("role" IN ('user', 'admin'));

CREATE TABLE "role_change_audit" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "previousRole" TEXT NOT NULL,
    "newRole" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_change_audit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "role_change_audit_roles_valid"
      CHECK (
        "previousRole" IN ('user', 'admin')
        AND "newRole" IN ('user', 'admin')
        AND "previousRole" <> "newRole"
      ),
    CONSTRAINT "role_change_audit_reason_nonempty"
      CHECK (char_length(btrim("reason")) BETWEEN 1 AND 500),
    CONSTRAINT "role_change_audit_source_valid"
      CHECK (
        ("source" = 'admin_api' AND "actorUserId" IS NOT NULL)
        OR ("source" = 'bootstrap_operator' AND "actorUserId" IS NULL)
      )
);

CREATE INDEX "role_change_audit_targetUserId_createdAt_idx"
  ON "role_change_audit"("targetUserId", "createdAt");
CREATE INDEX "role_change_audit_actorUserId_createdAt_idx"
  ON "role_change_audit"("actorUserId", "createdAt");

ALTER TABLE "role_change_audit"
  ADD CONSTRAINT "role_change_audit_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_change_audit"
  ADD CONSTRAINT "role_change_audit_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION deny_role_change_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'role_change_audit is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER role_change_audit_append_only
  BEFORE UPDATE OR DELETE ON "role_change_audit"
  FOR EACH ROW EXECUTE FUNCTION deny_role_change_audit_mutation();

CREATE TABLE "check_run" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "issues" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "adjustmentSuggestions" JSONB NOT NULL,
    "note" TEXT,
    "reviewerUserId" TEXT,
    "checklistVersion" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_run_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "check_run_status_valid"
      CHECK ("status" IN ('queued', 'in_review', 'completed')),
    CONSTRAINT "check_run_result_valid"
      CHECK ("result" IS NULL OR "result" IN ('approved', 'rejected', 'uncertain')),
    CONSTRAINT "check_run_state_consistent"
      CHECK (
        (
          "status" = 'queued' AND "result" IS NULL AND "reviewerUserId" IS NULL
          AND "startedAt" IS NULL AND "completedAt" IS NULL
        ) OR (
          "status" = 'in_review' AND "result" IS NULL AND "reviewerUserId" IS NOT NULL
          AND "startedAt" IS NOT NULL AND "completedAt" IS NULL
        ) OR (
          "status" = 'completed' AND "result" IS NOT NULL AND "reviewerUserId" IS NOT NULL
          AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL
        )
      ),
    CONSTRAINT "check_run_snapshot_object"
      CHECK (jsonb_typeof("requestSnapshot") = 'object'),
    CONSTRAINT "check_run_issues_array" CHECK (jsonb_typeof("issues") = 'array'),
    CONSTRAINT "check_run_evidence_array" CHECK (jsonb_typeof("evidence") = 'array'),
    CONSTRAINT "check_run_approved_has_evidence"
      CHECK ("result" <> 'approved' OR jsonb_array_length("evidence") > 0),
    CONSTRAINT "check_run_adjustments_array" CHECK (jsonb_typeof("adjustmentSuggestions") = 'array'),
    CONSTRAINT "check_run_versions_nonempty"
      CHECK (char_length(btrim("checklistVersion")) > 0 AND char_length(btrim("ruleVersion")) > 0),
    CONSTRAINT "check_run_note_length" CHECK ("note" IS NULL OR char_length("note") <= 4000),
    CONSTRAINT "check_run_time_order" CHECK ("completedAt" IS NULL OR "completedAt" >= "startedAt")
);

CREATE UNIQUE INDEX "check_run_requestId_key" ON "check_run"("requestId");
CREATE INDEX "check_run_status_createdAt_idx" ON "check_run"("status", "createdAt");
CREATE INDEX "check_run_reviewerUserId_status_idx" ON "check_run"("reviewerUserId", "status");

ALTER TABLE "check_run"
  ADD CONSTRAINT "check_run_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "customization_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "check_run"
  ADD CONSTRAINT "check_run_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Core review input is immutable. The only legal mutations are atomic state transitions.
CREATE FUNCTION guard_check_run_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'check_run history is append-only' USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW."id", NEW."requestId", NEW."requestSnapshot", NEW."checklistVersion",
    NEW."ruleVersion", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."requestId", OLD."requestSnapshot", OLD."checklistVersion",
    OLD."ruleVersion", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'check_run input snapshot is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;

  IF OLD."status" = 'queued' AND NEW."status" = 'in_review'
     AND NEW."result" IS NULL AND NEW."reviewerUserId" IS NOT NULL
     AND NEW."startedAt" IS NOT NULL AND NEW."completedAt" IS NULL
     AND NEW."issues" = OLD."issues" AND NEW."evidence" = OLD."evidence"
     AND NEW."adjustmentSuggestions" = OLD."adjustmentSuggestions"
     AND NEW."note" IS NOT DISTINCT FROM OLD."note" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'in_review' AND NEW."status" = 'completed'
     AND NEW."reviewerUserId" IS NOT DISTINCT FROM OLD."reviewerUserId"
     AND NEW."startedAt" IS NOT DISTINCT FROM OLD."startedAt"
     AND NEW."completedAt" IS NOT NULL AND NEW."result" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid check_run mutation or lifecycle transition' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_run_history_guard
  BEFORE UPDATE OR DELETE ON "check_run"
  FOR EACH ROW EXECUTE FUNCTION guard_check_run_history();

-- User.role is writable only through an application transaction that declares
-- narrow, transaction-local audit context. The trigger repeats the critical
-- authorization/lifecycle checks and appends the audit in the same statement.
CREATE FUNCTION guard_user_role_change() RETURNS trigger AS $$
DECLARE
  change_source TEXT := current_setting('petscape.role_change_source', true);
  actor_id TEXT := NULLIF(current_setting('petscape.role_change_actor', true), '');
  change_reason TEXT := current_setting('petscape.role_change_reason', true);
BEGIN
  IF NEW."role" IS NOT DISTINCT FROM OLD."role" THEN RETURN NEW; END IF;

  IF change_reason IS NULL OR char_length(btrim(change_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'role change requires an audited reason' USING ERRCODE = '55000';
  END IF;

  IF change_source = 'bootstrap_operator' THEN
    IF actor_id IS NOT NULL OR OLD."role" <> 'user' OR NEW."role" <> 'admin'
       OR EXISTS (SELECT 1 FROM "user" WHERE "role" = 'admin' AND "id" <> OLD."id") THEN
      RAISE EXCEPTION 'first admin bootstrap is closed' USING ERRCODE = '55000';
    END IF;
  ELSIF change_source = 'admin_api' THEN
    IF actor_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM "user" WHERE "id" = actor_id AND "role" = 'admin'
    ) THEN
      RAISE EXCEPTION 'role change actor must be an admin' USING ERRCODE = '55000';
    END IF;
    IF OLD."role" = 'admin' AND NEW."role" = 'user' THEN
      IF EXISTS (
        SELECT 1 FROM "check_run" WHERE "reviewerUserId" = OLD."id" AND "status" = 'in_review'
      ) THEN
        RAISE EXCEPTION 'active reviewer cannot be demoted' USING ERRCODE = '55000';
      END IF;
      IF (SELECT count(*) FROM "user" WHERE "role" = 'admin') <= 1 THEN
        RAISE EXCEPTION 'last admin cannot be demoted' USING ERRCODE = '55000';
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'direct user.role mutation is forbidden' USING ERRCODE = '55000';
  END IF;

  INSERT INTO "role_change_audit" (
    "id", "targetUserId", "actorUserId", "previousRole", "newRole", "source", "reason"
  ) VALUES (
    gen_random_uuid()::text, OLD."id", actor_id, OLD."role", NEW."role", change_source, btrim(change_reason)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_role_change_guard
  BEFORE UPDATE OF "role" ON "user"
  FOR EACH ROW EXECUTE FUNCTION guard_user_role_change();

CREATE FUNCTION guard_user_role_insert() RETURNS trigger AS $$
BEGIN
  IF NEW."role" <> 'user' THEN
    RAISE EXCEPTION 'new users must start with the user role' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_role_insert_guard
  BEFORE INSERT ON "user"
  FOR EACH ROW EXECUTE FUNCTION guard_user_role_insert();
