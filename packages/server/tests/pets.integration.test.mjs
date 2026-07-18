// packages/server/tests/pets.integration.test.mjs
// A4 宠物档案应用层：真实 PostgreSQL 上验证 owner 隔离、软删除与封面 Asset 约束。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPet,
  listPets,
  getPet,
  updatePet,
  deletePet,
  InvalidPetCoverError,
  InvalidPetProfileError,
} from '../src/application/pets.ts';
import { NotFoundError } from '../src/domain/index.ts';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) {
    throw new Error('CI 缺少 DATABASE_URL：Pet 集成测试门禁不可静默跳过。');
  }
  test('pets.integration.test.mjs skipped: DATABASE_URL not set', (t) => {
    t.skip('需要已执行最新 migration 的真实 PostgreSQL。');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 4 });
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const userIds = [`pet-itest-a-${runId}`, `pet-itest-b-${runId}`];

  test.before(async () => {
    await prisma.user.createMany({
      data: userIds.map((id) => ({ id, name: id, email: `${id}@example.test` })),
    });
  });

  test.after(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  test('只填 name 可创建；列表只返回当前 owner 且不暴露 ownerUserId', async () => {
    const petA = await createPet({ prisma, ownerUserId: userIds[0], input: { name: '  小椒  ' } });
    await createPet({ prisma, ownerUserId: userIds[1], input: { name: '隔壁宠物' } });

    assert.equal(petA.name, '小椒');
    assert.deepEqual(petA.behaviorTraits, []);
    assert.equal('ownerUserId' in petA, false);

    const ownPets = await listPets({ prisma, ownerUserId: userIds[0] });
    assert.deepEqual(ownPets.map((pet) => pet.id), [petA.id]);
  });

  test('A 用户持 B 的 petId 读取、修改、删除均为 NotFound', async () => {
    const petB = await createPet({ prisma, ownerUserId: userIds[1], input: { name: 'B 的宠物' } });

    await assert.rejects(
      () => getPet({ prisma, ownerUserId: userIds[0], petId: petB.id }),
      NotFoundError,
    );
    await assert.rejects(
      () => updatePet({ prisma, ownerUserId: userIds[0], petId: petB.id, input: { name: '越权' } }),
      NotFoundError,
    );
    await assert.rejects(
      () => deletePet({ prisma, ownerUserId: userIds[0], petId: petB.id }),
      NotFoundError,
    );
  });

  test('封面只能引用同 owner、available、pet_cover 且为受支持图片的 Asset', async () => {
    const pet = await createPet({ prisma, ownerUserId: userIds[0], input: { name: '封面测试' } });

    const createAsset = (overrides = {}) =>
      prisma.asset.create({
        data: {
          ownerUserId: userIds[0],
          projectId: null,
          kind: 'pet_cover',
          mime: 'image/png',
          size: 128,
          ossKey: `uploads/raw/${runId}/${crypto.randomUUID()}`,
          status: 'available',
          ...overrides,
        },
      });

    const valid = await createAsset();
    const updated = await updatePet({
      prisma,
      ownerUserId: userIds[0],
      petId: pet.id,
      input: { coverAssetId: valid.id },
    });
    assert.equal(updated.coverAssetId, valid.id);

    const pending = await createAsset({ status: 'pending' });
    const wrongKind = await createAsset({ kind: 'upload_raw' });
    const wrongMime = await createAsset({ mime: 'application/pdf' });
    const foreign = await createAsset({ ownerUserId: userIds[1] });

    for (const asset of [pending, wrongKind, wrongMime]) {
      await assert.rejects(
        () =>
          updatePet({
            prisma,
            ownerUserId: userIds[0],
            petId: pet.id,
            input: { coverAssetId: asset.id },
          }),
        InvalidPetCoverError,
      );
    }
    await assert.rejects(
      () =>
        updatePet({
          prisma,
          ownerUserId: userIds[0],
          petId: pet.id,
          input: { coverAssetId: foreign.id },
        }),
      NotFoundError,
    );
  });

  test('other 物种必须有自定义名称；切回稳定代码时自动清空自定义名称', async () => {
    const pet = await createPet({
      prisma,
      ownerUserId: userIds[0],
      input: { name: '异宠', speciesCode: 'other', customSpeciesName: '守宫新品系' },
    });

    await assert.rejects(
      () =>
        updatePet({
          prisma,
          ownerUserId: userIds[0],
          petId: pet.id,
          input: { customSpeciesName: null },
        }),
      InvalidPetProfileError,
    );

    const updated = await updatePet({
      prisma,
      ownerUserId: userIds[0],
      petId: pet.id,
      input: { speciesCode: 'gecko' },
    });
    assert.equal(updated.speciesCode, 'gecko');
    assert.equal(updated.customSpeciesName, null);
  });

  test('删除 Pet 为软删除：列表/读取不可见，Asset 仍保留', async () => {
    const asset = await prisma.asset.create({
      data: {
        ownerUserId: userIds[0],
        projectId: null,
        kind: 'pet_cover',
        mime: 'image/jpeg',
        size: 128,
        ossKey: `uploads/raw/${runId}/${crypto.randomUUID()}`,
        status: 'available',
      },
    });
    const pet = await createPet({
      prisma,
      ownerUserId: userIds[0],
      input: { name: '待删除', coverAssetId: asset.id },
    });

    const deleted = await deletePet({ prisma, ownerUserId: userIds[0], petId: pet.id });
    assert.deepEqual(deleted, { deleted: true, id: pet.id });
    await assert.rejects(
      () => getPet({ prisma, ownerUserId: userIds[0], petId: pet.id }),
      NotFoundError,
    );
    const listed = await listPets({ prisma, ownerUserId: userIds[0] });
    assert.equal(listed.some((item) => item.id === pet.id), false);
    assert.ok(await prisma.asset.findUnique({ where: { id: asset.id } }), '软删除 Pet 不应删除 Asset');
  });
}
