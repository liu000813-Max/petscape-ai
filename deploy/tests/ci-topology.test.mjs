import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ciPath = path.join(repoRoot, '.github/workflows/ci.yml');
const fullRegressionPath = path.join(repoRoot, '.github/workflows/full-regression.yml');

test('Fast Gate keeps deterministic validation and excludes browser E2E', async () => {
  const workflow = await readFile(ciPath, 'utf8');
  assert.match(workflow, /Test \(web\)/);
  assert.match(workflow, /Test \(packages\/server, real PostgreSQL\)/);
  assert.match(workflow, /Build web \(production Next\)/);
  assert.match(workflow, /Apply migrations from the exact image to empty CI PostgreSQL/);
  assert.match(workflow, /Exercise exact-image production migration no-op/);
  assert.doesNotMatch(workflow, /business-e2e|viewer-touch-e2e|viewer-model-e2e/);
  assert.doesNotMatch(workflow, /tests\/e2e-/);
});

test('CI has one conservative classifier and one fail-closed aggregate gate', async () => {
  const workflow = await readFile(ciPath, 'utf8');
  assert.match(workflow, /classify-changes:/);
  assert.match(workflow, /docs-check:/);
  assert.match(workflow, /ci-release-metadata-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /ci-gate:\s*\n\s*name: ci-gate\s*\n\s*if: always\(\)/);
  assert.match(workflow, /require_result worker-image "\$WORKER_IMAGE_RESULT" success/);
  assert.match(workflow, /require_result worker-image "\$WORKER_IMAGE_RESULT" skipped/);
  assert.match(workflow, /Invalid docs_only output/);
});

test('Full Regression is reusable and preserves every browser validation', async () => {
  const workflow = await readFile(fullRegressionPath, 'utf8');
  const businessTests = [
    'tests/e2e-customization-requests.test.mjs',
    'tests/e2e-pets.test.mjs',
    'tests/e2e-check-runs.test.mjs',
    'tests/e2e-quotes.test.mjs',
    'tests/e2e-delivery-addresses.test.mjs',
    'tests/e2e-payments.test.mjs',
    'tests/e2e-orders.test.mjs',
  ];

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /workflow_call:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /workflow_call:[\s\S]*target_sha:[\s\S]*required:\s*true/);
  assert.match(workflow, /ref:\s*\$\{\{ inputs\.target_sha \|\| github\.sha \}\}/);
  assert.match(workflow, /shard:\s*\n\s*- request-profile-quote\s*\n\s*- payment\s*\n\s*- review-delivery-order/);
  for (const testFile of businessTests) {
    assert.equal(workflow.split(testFile).length - 1, 1, `${testFile} must run exactly once`);
  }
  assert.match(workflow, /Run 390x844 touch-pointer browser test/);
  assert.match(workflow, /tests\/e2e-r3f-spike-touch\.test\.mjs/);
  assert.match(workflow, /Run authenticated model confirmation flow/);
  assert.match(workflow, /tests\/e2e-viewer-model\.test\.mjs/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  for (const artifactName of [
    'ui-polish-pack-b-browser-evidence',
    'wp-c3-1-browser-evidence',
    'wp-b6-0-browser-evidence',
    'wp-c5-1-browser-evidence',
    'wp-c4-1-browser-evidence',
    'wp-b45-0-touch-evidence',
    'ui-polish-pack-a-browser-evidence',
  ]) {
    assert.match(workflow, new RegExp(`name: ${artifactName}`));
  }
});
