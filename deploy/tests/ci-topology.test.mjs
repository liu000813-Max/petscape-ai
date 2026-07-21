import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ciPath = path.join(repoRoot, '.github/workflows/ci.yml');

test('CI preserves every existing validation while sharding business E2E', async () => {
  const workflow = await readFile(ciPath, 'utf8');
  const businessTests = [
    'tests/e2e-customization-requests.test.mjs',
    'tests/e2e-pets.test.mjs',
    'tests/e2e-check-runs.test.mjs',
    'tests/e2e-quotes.test.mjs',
    'tests/e2e-delivery-addresses.test.mjs',
    'tests/e2e-payments.test.mjs',
    'tests/e2e-orders.test.mjs',
  ];

  for (const testFile of businessTests) {
    assert.equal(workflow.split(testFile).length - 1, 1, `${testFile} must run exactly once`);
  }

  assert.match(workflow, /shard:\s*\n\s*- request-profile-quote\s*\n\s*- payment\s*\n\s*- review-delivery-order/);
  assert.match(workflow, /Test \(web\)/);
  assert.match(workflow, /Test \(packages\/server, real PostgreSQL\)/);
  assert.match(workflow, /Build web \(production Next\)/);
  assert.match(workflow, /Apply migrations from the exact image to empty CI PostgreSQL/);
  assert.match(workflow, /Exercise exact-image production migration no-op/);
  assert.match(workflow, /Run 390x844 touch-pointer browser test/);
  assert.match(workflow, /Run authenticated model confirmation flow/);
});

test('CI has one conservative classifier and one fail-closed aggregate gate', async () => {
  const workflow = await readFile(ciPath, 'utf8');
  assert.match(workflow, /classify-changes:/);
  assert.match(workflow, /docs-check:/);
  assert.match(workflow, /ci-release-metadata-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /ci-gate:\s*\n\s*name: ci-gate\s*\n\s*if: always\(\)/);
  assert.match(workflow, /require_result business-e2e "\$BUSINESS_E2E_RESULT" success/);
  assert.match(workflow, /require_result business-e2e "\$BUSINESS_E2E_RESULT" skipped/);
  assert.match(workflow, /Invalid docs_only output/);
});
