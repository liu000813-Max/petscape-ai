# WP-B45-2 Viewer persistence QA

Date: 2026-07-19

## Scope and commits

- Current rebase base: `origin/main@502b459c4f1566440ccfc313bd3613badd4b961c`
- Rebased persistence red tests: `95f16673fc993f624788f3ee4b4b853343d8d51b`
- Rebased implementation validated before database review: `f4d5b1b1d2a97b76867451bb588d131c349e0ce2`
- Database-integrity review red tests: `a81bdddad6402fce10311e75001493f88cad55ab`
- Database-integrity guards green: `bf7cad25f95fb1407c3dc26a742b391cc2488f6b`
- Draft PR: <https://github.com/AlfredGuquan/petscape-final/pull/46>
- Draft migration: `20260719170000_b45_viewer_persistence`

The browser evidence below is explicitly **pre-rebase evidence** from implementation head
`65adf1ab3fbd34438b57f1f96d6a2fc7f8f08801` on base
`acfd5c5f80e84017141f95ae70d055430ccf1e8e`. `git range-diff` showed that the
Viewer behavior patches were unchanged by the rebase; only the B6/Viewer Prisma relations
and application exports were combined. Final expected-head facts and CI links live on PR #46
instead of being copied here again.

This WP does not enable AI generation/general upload, manufacturability or pet-safety conclusions, real quoting, payment, or transactions.

## TDD and automated evidence

The red run failed because the persistence schemas did not yet exist:

```text
SyntaxError: ../src/contracts/scenes.ts does not provide
CreateDesignItemRequestSchema
```

The pre-rebase disposable PostgreSQL 16 database applied the eight migrations that existed at
that time. After rebasing over B6 and OPS-1, a new disposable PostgreSQL 16 database applied all
nine migrations from empty, with B6 immediately before the same single Viewer migration.
The database-review red run then proved that the old migration accepted a cross-DesignItem
current pointer and all five forged SceneConfirmation cases. With the guard fix, the focused
persistence suite passed 7/7 and rejected every direct Prisma write.

Pre-rebase local gates on the implementation head:

```text
Viewer contract + persistence: 17 pass, 0 fail
Full packages/server suite: 109 pass, 0 fail, 2 skipped
Web unit suite: 29 pass, 0 fail
server/web/worker TypeScript: PASS
server lint + web lint baseline: PASS
production Next build: PASS
git diff --check: PASS
```

The two server skips require real OSS credentials. Viewer `temporary_catalog` behavior and fail-closed owned Asset database checks ran; this WP does not claim a general owned-asset upload/checksum producer.

The persistence suite proves:

- server allowlisted temporary catalog identity and `sandbox`/quote-ineligible semantics;
- owned Asset exact SHA-256, available status, owner and same-Project checks;
- one Scene per Project and ten concurrent CAS saves yielding one success;
- structured stale revision conflict;
- ten concurrent same-revision confirmations returning one ID;
- later revisions creating new history while old snapshots remain readable;
- database triggers rejecting update/delete of either confirmation type;
- owner-scoped 404 behavior for DesignItem, Scene, ModelConfirmation and SceneConfirmation.

## Database structure evidence

The disposable PostgreSQL inspection returned all four tables:

```text
design_item
model_confirmation
scene
scene_confirmation
```

Relevant unique indexes:

```text
scene_projectId_key
scene_confirmation_sceneId_sceneRevision_key
design_item_currentModelConfirmationId_key
```

Database guards:

```text
design_item_current_confirmation_guard
model_confirmation_append_only
scene_confirmation_consistency_guard
scene_confirmation_append_only
scene_revision_and_reference_guard
```

The post-rebase fresh database also reported 27 PK/FK/CHECK constraints across the four tables.
This is isolated-database evidence; production migration/deploy verification remains owned by
the batch migration queue after merge.

## Builder browser evidence

The real Next + PostgreSQL + Chromium E2E passed on the implementation head and covered:

- real OTP login and explicit Project creation;
- server ModelConfirmation IDs/timestamps and initial Scene revision;
- debounced autosave with visible saving/saved states;
- one injected network failure, visible retry, then a real Route/database save;
- context placement, collision/out-of-bounds blocking, and 390×844 touch input;
- exact-revision confirmation, edit-after-confirm warning, new confirmation history;
- two-tab stale revision conflict without overwrite;
- old confirmation readback;
- browser refresh and an actual Next process restart restoring the Scene;
- landing first-fold behavior with unchanged landing source.

Builder screenshots:

- `screenshots/browser-qa/wp-b45-2/viewer-scene-confirmation.png`
- `screenshots/browser-qa/wp-b45-2/viewer-revision-conflict.png`
- `screenshots/browser-qa/wp-b45-2/viewer-server-restart-restored.png`
- `screenshots/browser-qa/wp-b45-2/viewer-scene-collision-blocked.png`
- `screenshots/browser-qa/wp-b45-2/viewer-scene-touch.png`
- `screenshots/browser-qa/wp-b45-2/landing-first-fold.png`

## Independent browser QA

An agent that did not implement WP-B45-2 reran the complete browser flow against exact implementation head `65adf1ab3fbd34438b57f1f96d6a2fc7f8f08801` and the disposable PostgreSQL database:

```text
tests 1 | pass 1 | fail 0 | duration 73.47s
```

The independent run verified real OTP/Better Auth, ModelConfirmation persistence, Scene autosave, failure/retry, context and dimensions, two immutable confirmations, stale-tab conflict, old-history readback, refresh, actual Next restart, landing and CDP touch. Its full-flow recording is 83.52 seconds.

Evidence:

- `screenshots/browser-qa/wp-b45-2/independent-final-complete-flow-v2.webm`
- `screenshots/browser-qa/wp-b45-2/independent-final-viewer-scene-confirmation.png`
- `screenshots/browser-qa/wp-b45-2/independent-final-viewer-revision-conflict.png`
- `screenshots/browser-qa/wp-b45-2/independent-final-viewer-server-restart-restored.png`
- `screenshots/browser-qa/wp-b45-2/independent-final-viewer-scene-collision-blocked.png`
- `screenshots/browser-qa/wp-b45-2/independent-final-viewer-scene-touch.png`
- `screenshots/browser-qa/wp-b45-2/independent-final-landing-first-fold.png`

## Remaining boundaries

- Production RDS migration, table/constraint verification and deployed-image health are not yet performed. They require the batch migration production slot and are not claimed by this report.
- Touch evidence uses Chromium CDP touch emulation, not a physical phone.
- Physical-device rendering and low-end GPU performance remain unverified.
- The general owned Asset binary/checksum producer and owned-asset rendering UI are outside this WP; persistence rejects incomplete or cross-Project owned references.
