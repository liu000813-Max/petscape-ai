import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const analyzer = path.join(repoRoot, 'worker/scripts/analyze_mesh.py');
const uv = process.env.UV_BIN || 'uv';

function analyze(relativePath, dimensionsMm, geometryUnit = 'millimeter') {
  return spawnSync(
    uv,
    [
      'run',
      '--with',
      'trimesh==4.12.2',
      'python',
      analyzer,
      '--input',
      path.join(repoRoot, relativePath),
      '--geometry-unit',
      geometryUnit,
      '--dimensions-mm',
      dimensionsMm.join(','),
      '--algorithm-version',
      'trimesh-volume.v0',
    ],
    { encoding: 'utf8' },
  );
}

test('real analyzer accepts a closed mesh and returns server-computed volume', () => {
  const run = analyze('web/public/mockup-assets/mock-model.stl', [120, 119.022, 53.865]);
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.watertight, true);
  assert.equal(result.triangleCount, 103716);
  assert.ok(result.volumeMm3 > 240000 && result.volumeMm3 < 241000);
});

test('real analyzer fails closed for the non-watertight cheese GLB', () => {
  const run = analyze('web/public/scene-assets/cheese-lounge-bed.norm.glb', [274.148, 100, 194.543]);
  assert.notEqual(run.status, 0);
  const error = JSON.parse(run.stderr);
  assert.equal(error.code, 'mesh_not_watertight');
});

test('real analyzer rejects missing/unsupported units and abnormal scale', () => {
  const badUnit = analyze('web/public/mockup-assets/mock-model.stl', [120, 119.022, 53.865], 'model_unit');
  assert.notEqual(badUnit.status, 0);
  assert.equal(JSON.parse(badUnit.stderr).code, 'unit_missing_or_unsupported');

  const abnormalScale = analyze('web/public/mockup-assets/mock-model.stl', [1, 0.991851, 0.448875]);
  assert.notEqual(abnormalScale.status, 0);
  assert.equal(JSON.parse(abnormalScale.stderr).code, 'mesh_abnormal_scale');
});
