import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../src/infra/db/index.ts';
import { createPet, deletePet } from '../src/application/pets.ts';
import { createPetGrowthEntry, deletePetGrowthEntry, GrowthEntrySaveConflictError, InvalidPetGrowthEntryError, listPetGrowthEntries, updatePetGrowthEntry } from '../src/application/pet-growth.ts';
import { uploadPetGrowthPhoto } from '../src/application/pet-growth-assets.ts';
import { NotFoundError } from '../src/domain/index.ts';
import { ListPetGrowthEntriesResponseSchema } from '../src/contracts/pet-growth.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI requires DATABASE_URL for growth diary integration tests');
  test('pet-growth.integration requires migrated PostgreSQL', (t) => t.skip('DATABASE_URL is not configured'));
} else {
  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 3 });
  const runId = randomUUID();
  const users = { owner: `growth-a-${runId}`, other: `growth-b-${runId}` };
  let pet;
  let foreignPet;

  test.before(async () => {
    await prisma.user.createMany({ data: Object.values(users).map((id) => ({ id, name: id })) });
    pet = await createPet({ prisma, ownerUserId: users.owner, input: { name: '成长日记宠物' } });
    foreignPet = await createPet({ prisma, ownerUserId: users.other, input: { name: '他人宠物' } });
  });

  test.after(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    await prisma.$disconnect();
  });

  test('growth entries paginate by selected pet and enforce owner scope on every mutation', async () => {
    const older = await createPetGrowthEntry({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id,
      input: { note: '第一次到家', recordedAt: '2026-01-01T00:00:00.000Z' } });
    const newer = await createPetGrowthEntry({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id,
      input: { note: '开始探索', recordedAt: '2026-02-01T00:00:00.000Z' } });
    const page = await listPetGrowthEntries({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id, query: { limit: 1 } });
    ListPetGrowthEntriesResponseSchema.parse(page);
    assert.deepEqual(page.entries.map((item) => item.id), [newer.id]);
    assert.equal(page.hasMore, true);
    assert.deepEqual((await listPetGrowthEntries({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id,
      query: { limit: 5, offset: 1 } })).entries.map((item) => item.id), [older.id]);
    await assert.rejects(() => listPetGrowthEntries({ prisma, oss: {}, ownerUserId: users.other, petId: pet.id, query: {} }), NotFoundError);
    await assert.rejects(() => updatePetGrowthEntry({ prisma, oss: {}, ownerUserId: users.other, petId: pet.id,
      entryId: newer.id, input: { note: '跨用户修改' } }), NotFoundError);
    await assert.rejects(() => deletePetGrowthEntry({ prisma, ownerUserId: users.other, petId: pet.id, entryId: newer.id }), NotFoundError);
    assert.equal((await listPetGrowthEntries({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id, query: {} })).entries.length, 2);
  });

  test('photo assets require same owner, active pet, supported kind and available upload state', async () => {
    const createAsset = (ownerUserId, overrides = {}) => prisma.asset.create({ data: {
      ownerUserId, projectId: null, kind: 'growth_photo', mime: 'image/png', size: 16,
      ossKey: `uploads/raw/${runId}/growth/${randomUUID()}`, status: 'available', ...overrides,
    } });
    const good = await createAsset(users.owner);
    const pending = await createAsset(users.owner, { status: 'pending' });
    const wrongKind = await createAsset(users.owner, { kind: 'pet_cover' });
    const foreign = await createAsset(users.other);
    for (const asset of [pending, wrongKind, foreign]) {
      await assert.rejects(() => createPetGrowthEntry({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id,
        input: { note: null, photoAssetIds: [asset.id] } }), NotFoundError);
    }
    await assert.rejects(() => createPetGrowthEntry({ prisma, oss: {}, ownerUserId: users.owner, petId: foreignPet.id,
      input: { note: null, photoAssetIds: [good.id] } }), NotFoundError);

    const signCalls = [];
    const oss = { signGetUrl: async (key, ttl) => { signCalls.push({ key, ttl }); return 'https://private.invalid/photo?short=1'; } };
    const entry = await createPetGrowthEntry({ prisma, oss, ownerUserId: users.owner, petId: pet.id,
      input: { note: '初次合照', photoAssetIds: [good.id] } });
    assert.equal(entry.photos.length, 1);
    assert.equal(entry.photos[0].assetId, good.id);
    assert.equal(entry.photos[0].downloadUrl, 'https://private.invalid/photo?short=1');
    assert.equal(signCalls.length, 1);
    const retainedAsset = await prisma.petGrowthEntryPhoto.findUniqueOrThrow({ where: { assetId: good.id } });
    await deletePetGrowthEntry({ prisma, ownerUserId: users.owner, petId: pet.id, entryId: entry.id });
    assert.ok(await prisma.petGrowthEntryPhoto.findUnique({ where: { id: retainedAsset.id } }), 'soft delete keeps photo link and original Asset');
    assert.equal((await prisma.asset.findUnique({ where: { id: good.id } })).status, 'available');
  });

  test('photo upload checks pet ownership and image bytes before marking an asset available', async () => {
    const bytes = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex');
    const objects = new Map();
    const oss = {
      signPutUrl: async () => 'https://private.invalid/put',
      put: async (key, value) => { objects.set(key, value); },
      head: async (key) => ({ exists: objects.has(key), size: objects.get(key)?.length, etag: 'growth-etag' }),
      readHeadBytes: async (key) => objects.get(key).subarray(0, 16),
    };
    await assert.rejects(() => uploadPetGrowthPhoto({ prisma, oss, ownerUserId: users.other, petId: pet.id,
      mime: 'image/png', bytes }), NotFoundError);
    assert.equal(objects.size, 0);
    await assert.rejects(() => uploadPetGrowthPhoto({ prisma, oss, ownerUserId: users.owner, petId: pet.id,
      mime: 'image/png', bytes: Buffer.from('not an image') }), /invalid_growth_photo/);
    assert.equal(objects.size, 0);
    const uploaded = await uploadPetGrowthPhoto({ prisma, oss, ownerUserId: users.owner, petId: pet.id,
      mime: 'image/png', bytes });
    assert.equal(uploaded.kind, 'growth_photo');
    assert.equal(uploaded.status, 'available');
  });

  test('text-only entries can be edited and empty entries cannot be persisted', async () => {
    await assert.rejects(() => createPetGrowthEntry({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id,
      input: { note: '   ', photoAssetIds: [] } }));
    const entry = await createPetGrowthEntry({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id,
      input: { note: '开始适应新环境' } });
    await assert.rejects(() => updatePetGrowthEntry({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id,
      entryId: entry.id, input: { note: null } }), InvalidPetGrowthEntryError);
    const edited = await updatePetGrowthEntry({ prisma, oss: {}, ownerUserId: users.owner, petId: pet.id,
      entryId: entry.id, input: { note: '已经开始进食' } });
    assert.equal(edited.note, '已经开始进食');
  });

  test('an entry cannot be edited or removed through another or deleted pet', async () => {
    const archived = await createPet({ prisma, ownerUserId: users.owner, input: { name: '已归档宠物' } });
    const entry = await createPetGrowthEntry({ prisma, oss: {}, ownerUserId: users.owner, petId: archived.id,
      input: { note: '保留的旧记录' } });
    const lookup = { prisma, ownerUserId: users.owner, entryId: entry.id };
    await assert.rejects(() => updatePetGrowthEntry({ ...lookup, oss: {}, petId: pet.id, input: { note: '错误档案' } }), NotFoundError);
    await deletePet({ prisma, ownerUserId: users.owner, petId: archived.id });
    await assert.rejects(() => updatePetGrowthEntry({ ...lookup, oss: {}, petId: archived.id, input: { note: '归档后修改' } }), NotFoundError);
    await assert.rejects(() => deletePetGrowthEntry({ ...lookup, petId: archived.id }), NotFoundError);
    const stored = await prisma.petGrowthEntry.findUniqueOrThrow({ where: { id: entry.id } });
    assert.equal(stored.note, '保留的旧记录');
    assert.equal(stored.deletedAt, null);
  });

  test('retries of the same draft can only create one row and cannot replace its contents', async () => {
    const context = { prisma, oss: {}, ownerUserId: users.owner, petId: pet.id };
    const input = { saveKey: 'same-draft-01', recordedAt: '2026-01-02T12:00:00.000Z', note: '一次保存' };
    const entries = await Promise.all(Array.from({ length: 3 }, () => createPetGrowthEntry({ ...context, input })));
    assert.equal(new Set(entries.map(entry => entry.id)).size, 1);
    const [{ id: entryId }] = entries;
    await assert.rejects(() => createPetGrowthEntry({ ...context, input: { ...input, note: '不同草稿' } }), GrowthEntrySaveConflictError);
    await deletePetGrowthEntry({ ...context, entryId });
    await assert.rejects(() => createPetGrowthEntry({ ...context, input }), NotFoundError);
  });
}
