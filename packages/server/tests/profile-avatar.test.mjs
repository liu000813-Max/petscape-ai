import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadProfileAvatar } from '../src/application/miniapp-profile.ts';

function fixture() {
  const assets = new Map(); const objects = new Map();
  const prisma = {
    user: { findUnique: async ({ where }) => where.id === 'owner' ? { id: 'owner' } : null },
    asset: {
      create: async ({ data }) => { const asset = { ...data, id: 'a' + assets.size, createdAt: new Date(), updatedAt: new Date() }; assets.set(asset.id, asset); return asset; },
      update: async ({ where, data }) => { const asset = { ...assets.get(where.id), ...data }; assets.set(where.id, asset); return asset; },
      findUnique: async ({ where }) => assets.get(where.id),
    },
  };
  const oss = { signPutUrl: async () => 'https://private.example/upload', put: async (key, bytes) => objects.set(key, bytes), head: async key => ({ exists: objects.has(key), size: objects.get(key)?.length, etag: 'ok' }), readHeadBytes: async key => objects.get(key).subarray(0, 16) };
  const upload = (input = {}) => uploadProfileAvatar({ prisma, oss, userId: 'owner', mime: 'image/png', bytes: Buffer.from('89504e470d0a1a0a0000000000000000', 'hex'), ...input });
  return { assets, objects, oss, upload };
}
test('owner avatar rejects missing owners, invalid bytes and unsupported formats before uploading', async () => {
  const f = fixture();
  for (const input of [{ userId: 'foreign' }, { mime: 'image/gif' }, { bytes: Buffer.alloc(0) }, { bytes: Buffer.from('not image') }, { bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }]) await assert.rejects(f.upload(input));
  assert.equal(f.objects.size, 0); assert.equal(f.assets.size, 0);
});
test('owner avatar confirms dedicated private assets and a failed put never makes them usable', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.upload(), f.upload()]);
  assert.notEqual(a.id, b.id); assert.equal(a.kind, 'user_avatar'); assert.equal(a.status, 'available');
  f.oss.put = async () => { throw new Error('offline'); };
  await assert.rejects(f.upload()); assert.equal([...f.assets.values()].at(-1).status, 'pending');
});
