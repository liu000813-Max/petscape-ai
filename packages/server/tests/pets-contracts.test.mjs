// packages/server/tests/pets-contracts.test.mjs
// A4 第一套内部业务 API contracts：请求与响应都由 Zod 在进程边界做运行时校验。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CreatePetRequestSchema,
  UpdatePetRequestSchema,
  PetResponseSchema,
  PetListResponseSchema,
  PetCoverUploadRequestSchema,
} from '../src/contracts/pets.ts';

const validPet = {
  id: 'cm1234567890pet',
  name: '小椒',
  speciesCode: null,
  customSpeciesName: null,
  breed: null,
  sizeLevel: null,
  lifeStage: null,
  behaviorTraits: [],
  environmentNotes: null,
  specialNeeds: null,
  coverAssetId: null,
  coverUrl: null,
  createdAt: '2026-07-19T08:00:00.000Z',
  updatedAt: '2026-07-19T08:00:00.000Z',
};

test('CreatePetRequestSchema：只提供非空 name 即可创建，字符串会 trim', () => {
  const parsed = CreatePetRequestSchema.parse({ name: '  小椒  ' });
  assert.equal(parsed.name, '小椒');
  assert.deepEqual(parsed.behaviorTraits, []);
});

test('CreatePetRequestSchema：拒绝空名称、未知字段和不完整的 other 物种', () => {
  assert.equal(CreatePetRequestSchema.safeParse({ name: '   ' }).success, false);
  assert.equal(CreatePetRequestSchema.safeParse({ name: '小椒', ownerUserId: 'leak' }).success, false);
  assert.equal(
    CreatePetRequestSchema.safeParse({ name: '小椒', customSpeciesName: '未声明 other' }).success,
    false,
  );
  assert.equal(
    CreatePetRequestSchema.safeParse({ name: '小椒', speciesCode: 'other' }).success,
    false,
  );
});

test('UpdatePetRequestSchema：拒绝空对象和越界 sizeLevel', () => {
  assert.equal(UpdatePetRequestSchema.safeParse({}).success, false);
  assert.equal(UpdatePetRequestSchema.safeParse({ sizeLevel: 0 }).success, false);
  assert.equal(UpdatePetRequestSchema.safeParse({ sizeLevel: 6 }).success, false);
});

test('PetCoverUploadRequestSchema：只允许受支持图片与合理大小', () => {
  assert.equal(
    PetCoverUploadRequestSchema.safeParse({ filename: 'pet.webp', mime: 'image/webp', size: 1024 }).success,
    true,
  );
  assert.equal(
    PetCoverUploadRequestSchema.safeParse({ filename: 'pet.svg', mime: 'image/svg+xml', size: 1024 }).success,
    false,
  );
  assert.equal(
    PetCoverUploadRequestSchema.safeParse({ filename: 'pet.png', mime: 'image/png', size: 11 * 1024 * 1024 }).success,
    false,
  );
});

test('PetResponseSchema：接受公开 DTO，拒绝 Date、ownerUserId、ossKey 等越界字段', () => {
  assert.equal(PetResponseSchema.safeParse(validPet).success, true);
  assert.equal(PetResponseSchema.safeParse({ ...validPet, createdAt: new Date() }).success, false);
  assert.equal(PetResponseSchema.safeParse({ ...validPet, breed: 'x'.repeat(121) }).success, false);
  assert.equal(PetResponseSchema.safeParse({ ...validPet, ownerUserId: 'secret' }).success, false);
  assert.equal(PetResponseSchema.safeParse({ ...validPet, ossKey: 'uploads/raw/secret' }).success, false);
});

test('PetListResponseSchema：列表 envelope 也经过运行时校验', () => {
  const parsed = PetListResponseSchema.parse({ pets: [validPet] });
  assert.equal(parsed.pets[0]?.name, '小椒');
  assert.equal(PetListResponseSchema.safeParse({ pets: [{ ...validPet, coverUrl: 'not-a-url' }] }).success, false);
});
