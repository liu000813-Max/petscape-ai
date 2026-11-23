import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadPetCover } from '../src/application/pet-cover.ts';

const png = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex');
function fixture() {
  const assets = new Map(); const objects = new Map(); const pendingKeys = new Set();
  const prisma = {
    pet: { findFirst: async ({ where }) => where.ownerUserId === 'owner-a' ? ({ id: 'pet-a', ownerUserId: 'owner-a', deletedAt: null }) : null },
    asset: {
      create: async ({ data }) => {
        assert.ok(!pendingKeys.has(data.ossKey)); pendingKeys.add(data.ossKey);
        const asset = { ...data, id: `asset-${assets.size}`, createdAt: new Date(), updatedAt: new Date() };
        assets.set(asset.id, asset); return asset;
      },
      update: async ({ where, data }) => { const asset = { ...assets.get(where.id), ...data }; assets.set(where.id, asset); return asset; },
      findUnique: async ({ where }) => assets.get(where.id),
    },
  };
  const oss = {
    signPutUrl: async () => 'https://private.example.invalid/upload',
    put: async (key, bytes) => { objects.set(key, bytes); },
    head: async (key) => ({ exists: objects.has(key), size: objects.get(key)?.length, etag: 'verified' }),
    readHeadBytes: async (key) => objects.get(key).subarray(0, 16),
  };
  const upload = (overrides = {}) => uploadPetCover({ prisma, oss, ownerUserId: 'owner-a', petId: 'pet-a', mime: 'image/png', bytes: png, ...overrides });
  return { upload, assets, objects, oss };
}

test('pet cover refuses another owner before creating or uploading an asset', async () => {
  const f = fixture();
  await assert.rejects(f.upload({ ownerUserId: 'owner-b' }));
  assert.equal(f.assets.size, 0); assert.equal(f.objects.size, 0);
});

test('pet cover rejects forged image type and excessive bytes before storage', async () => {
  const f = fixture();
  await assert.rejects(f.upload({ mime: 'image/jpeg' }));
  await assert.rejects(f.upload({ bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }));
  assert.equal(f.assets.size, 0);
});

test('pet cover verifies stored bytes, keeps failed uploads pending and supports simultaneous photos', async () => {
  const f = fixture();
  const uploaded = await Promise.all([f.upload(), f.upload()]);
  assert.equal(new Set(uploaded.map((asset) => asset.id)).size, 2);
  assert.ok(uploaded.every((asset) => asset.status === 'available' && asset.checksum === 'verified'));
  f.oss.put = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(f.upload());
  assert.equal([...f.assets.values()].at(-1).status, 'pending');
});
