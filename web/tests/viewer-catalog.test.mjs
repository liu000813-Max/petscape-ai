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
      (asset) => asset.modelRef.quoteEligible === false && asset.bytes <= 8 * 1024 * 1024,
    ),
    true,
  );
});

test('目录中的文件、字节数与 SHA-256 checksum 对应真实 GLB', async () => {
  for (const asset of VIEWER_ASSET_CATALOG) {
    const bytes = await readFile(new URL(`../public${asset.publicPath}`, import.meta.url));
    const meta = JSON.parse(await readFile(new URL(`../public${asset.metaPath}`, import.meta.url), 'utf8'));
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const jsonChunkLength = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonChunkLength).toString('utf8').trim());
    assert.equal(bytes.byteLength, asset.bytes, asset.assetKey);
    assert.equal(checksum, asset.modelRef.checksum, asset.assetKey);
    assert.equal(meta.bytes, asset.bytes, asset.assetKey);
    assert.equal(meta.checksumSha256, checksum, asset.assetKey);
    assert.ok(gltf.materials?.length > 0, `${asset.assetKey} 缺少材质`);
    assert.ok(gltf.textures?.length > 0, `${asset.assetKey} 缺少贴图`);
    assert.ok(gltf.images?.length > 0, `${asset.assetKey} 缺少嵌入图片`);
  }
});
