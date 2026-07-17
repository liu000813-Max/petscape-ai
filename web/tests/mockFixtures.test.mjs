import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = fileURLToPath(new URL('../public/mockup-assets/', import.meta.url));

// Exact allowlist: this directory is the small, versioned contract for every ?mock=1 path.
// Minimum sizes reject empty placeholders while avoiding hashes that would make intentional
// fixture refreshes unnecessarily difficult.
const requiredFixtures = new Map([
  ['mock-model.gcode', 1_000_000],
  ['mock-model.glb', 1_000_000],
  ['mock-model.stl', 1_000_000],
  ['model3d-preview.jpg', 10_000],
  ['pet-hamster-ref.jpg', 10_000],
  ['scheme-a-mushroom-v1.jpg', 10_000],
  ['scheme-a-mushroom-v2.jpg', 10_000],
  ['scheme-b-rockcave.jpg', 10_000],
  ['scheme-c-logstump.jpg', 10_000],
]);

test('mock fixture directory contains only the classified fixture set', async () => {
  const actual = (await readdir(fixtureDirectory)).sort();
  const expected = [...requiredFixtures.keys()].sort();
  assert.deepEqual(actual, expected);
});

test('every mock fixture is a non-placeholder file', async () => {
  for (const [filename, minimumBytes] of requiredFixtures) {
    const info = await stat(path.join(fixtureDirectory, filename));
    assert.equal(info.isFile(), true, `${filename} must be a regular file`);
    assert.ok(info.size >= minimumBytes, `${filename} must be at least ${minimumBytes} bytes`);
  }
});
