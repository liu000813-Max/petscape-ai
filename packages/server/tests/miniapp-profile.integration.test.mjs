import test from 'node:test';
import assert from 'node:assert/strict';
import { getMiniappProfile, updateMiniappProfile, uploadProfileAvatar } from '../src/application/miniapp-profile.ts';

if (!process.env.DATABASE_URL) {
  if (process.env.CI) throw new Error('Profile integration requires PostgreSQL');
  test('profile integration requires PostgreSQL', (t) => t.skip('DATABASE_URL missing'));
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL, poolMax: 4 });
  const run = `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const owner = run + '-a'; const other = run + '-b';
  const avatar = run + '-avatar';
  test.before(async () => {
    await prisma.user.createMany({ data: [owner, other].map(id => ({ id, name: '原社区署名', image: 'https://example.test/old.png' })) });
    await prisma.asset.createMany({ data: [
      { id: avatar, ownerUserId: owner, kind: 'user_avatar', status: 'available' },
      { id: run + '-foreign', ownerUserId: other, kind: 'user_avatar', status: 'available' },
      { id: run + '-pending', ownerUserId: owner, kind: 'user_avatar', status: 'pending' },
      { id: run + '-pet', ownerUserId: owner, kind: 'pet_cover', status: 'available' },
    ].map(a => ({ ...a, mime: 'image/png', size: 16, ossKey: 'tests/' + a.id })) });
  });
  test.after(async () => { await prisma.miniappProfile.deleteMany({ where: { userId: { in: [owner, other] } } }); await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } }); await prisma.$disconnect(); });

  test('default profile is private and first concurrent saves create only one row', async () => {
    assert.deepEqual(await getMiniappProfile({ prisma, userId: owner }), { nickname: '', avatarAssetId: null });
    await Promise.all([1, 2].map(i => updateMiniappProfile({ prisma, userId: owner, input: { nickname: '养宠人' + i } })));
    assert.equal(await prisma.miniappProfile.count({ where: { userId: owner } }), 1);
    assert.deepEqual(await getMiniappProfile({ prisma, userId: other }), { nickname: '', avatarAssetId: null });
  });
  test('only confirmed own user avatar can be attached, and nickname + avatar save together', async () => {
    await updateMiniappProfile({ prisma, userId: owner, input: { nickname: '麦麦', avatarAssetId: avatar } });
    for (const id of [run + '-foreign', run + '-pending', run + '-pet', 'missing']) {
      await assert.rejects(updateMiniappProfile({ prisma, userId: owner, input: { nickname: '不应写入', avatarAssetId: id } }));
      assert.deepEqual(await getMiniappProfile({ prisma, userId: owner }), { nickname: '麦麦', avatarAssetId: avatar });
    }
    const user = await prisma.user.findUnique({ where: { id: owner } });
    assert.equal(user.name, '原社区署名'); assert.equal(user.image, 'https://example.test/old.png');
    await updateMiniappProfile({ prisma, userId: owner, input: { nickname: '新昵称' } });
    assert.equal((await getMiniappProfile({ prisma, userId: owner })).avatarAssetId, avatar);
  });
  test('blank nickname and identity or privilege injection are rejected', async () => {
    for (const input of [{ nickname: '  ' }, { nickname: 'a', userId: other }, { nickname: 'a', role: 'admin' }, { image: 'https://foreign.example' }]) {
      await assert.rejects(updateMiniappProfile({ prisma, userId: owner, input }));
    }
  });
  test('owner image bytes become a confirmed private asset before atomic profile binding', async () => {
    const objects = new Map();
    const oss = { signPutUrl: async () => 'https://private.example/upload', put: async (key, bytes) => objects.set(key, bytes), head: async key => ({ exists: objects.has(key), size: objects.get(key)?.length, etag: 'verified' }), readHeadBytes: async key => objects.get(key).subarray(0, 16) };
    const asset = await uploadProfileAvatar({ prisma, oss, userId: owner, mime: 'image/png', bytes: Buffer.from('89504e470d0a1a0a0000000000000000', 'hex') });
    assert.equal(asset.status, 'available'); assert.equal(asset.kind, 'user_avatar');
    await updateMiniappProfile({ prisma, userId: owner, input: { nickname: '照片主人', avatarAssetId: asset.id } });
    assert.equal((await getMiniappProfile({ prisma, userId: owner })).avatarAssetId, asset.id);
    await assert.rejects(updateMiniappProfile({ prisma, userId: other, input: { nickname: '冒用', avatarAssetId: asset.id } }));
  });
}
