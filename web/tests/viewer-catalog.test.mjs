import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { VIEWER_ASSET_CATALOG } from '../app/lib/viewer/catalog.ts';

const expected = {
  target: ['banana-bed', 'cheese-lounge-bed', 'cheese-play-mat'],
  context: ['cloud-moss-platform', 'star-spiral-ramp'],
};

test('临时目录只登记冻结的三个 target 与两个 context', () => {
  for (const role of Object.keys(expected)) {
    const actual = VIEWER_ASSET_CATALOG.filter((asset) => asset.role === role)
      .map((asset) => asset.assetKey)
      .sort();
    assert.deepEqual(actual, expected[role]);
  }
  assert.equal(
    VIEWER_ASSET_CATALOG.every(
      (asset) => asset.modelRef.quoteEligible === false && asset.bytes <= 4 * 1024 * 1024,
    ),
    true,
  );
});

test('目录中的文件、字节数与 SHA-256 checksum 对应真实 GLB', async () => {
  for (const asset of VIEWER_ASSET_CATALOG) {
    const bytes = await readFile(new URL(`../public${asset.publicPath}`, import.meta.url));
    assert.equal(bytes.byteLength, asset.bytes, asset.assetKey);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.modelRef.checksum, asset.assetKey);
  }
});
