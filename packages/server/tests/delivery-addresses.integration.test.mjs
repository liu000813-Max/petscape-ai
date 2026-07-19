import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：C5 地址权限/竞态测试不得静默 skip');
  test('delivery-addresses.integration.test.mjs skipped: DATABASE_URL not set', (t) => {
    t.skip('需要执行 C5 Draft migration 的真实 PostgreSQL');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
    B7_SANDBOX_SCENE_CONFIRMATION_ID,
    DeliveryAddressConflictError,
    DeliveryAddressEligibilityError,
    NotFoundError,
    acceptQuote,
    bootstrapFirstAdmin,
    completeCheckRun,
    confirmDeliveryAddress,
    createCheckRun,
    createCustomizationRequest,
    createQuote,
    createSandboxEstimateJob,
    getConfirmedDeliveryAddressInput,
    listDeliveryAddresses,
    saveDeliveryAddress,
    startCheckRun,
  } = await import('../src/application/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 20 });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const admin = `c5-admin-${suffix}`;
  const owner = `c5-owner-${suffix}`;
  const other = `c5-other-${suffix}`;
  let adminId = admin;

  function fields(tag = 'base') {
    return {
      recipientName: `C5 用户 ${tag}`,
      mobile: '13800138000',
      province: '浙江省',
      city: '杭州市',
      district: '余杭区',
      detail: `文一西路 ${tag} 号`,
      postalCode: '311100',
    };
  }

  async function makeQuote(ownerUserId, key, accepted = true) {
    const request = (await createCustomizationRequest({
      prisma,
      ownerUserId,
      input: {
        sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
        idempotencyKey: `c5-request-${key}`,
        contactName: 'C5 沙箱用户',
        contactPhone: '13800138000',
        usageDescription: `C5 地址测试 ${key}`,
        additionalRequirements: null,
      },
    })).request;
    const queued = (await createCheckRun({ prisma, actorUserId: adminId, input: { requestId: request.id } })).checkRun;
    await startCheckRun({ prisma, actorUserId: adminId, checkRunId: queued.id });
    await completeCheckRun({
      prisma,
      actorUserId: adminId,
      checkRunId: queued.id,
      input: {
        result: 'approved', issues: [], adjustmentSuggestions: [], note: '仅供 C5 沙箱测试',
        evidence: [{ kind: 'note', ref: 'manual://c5-sandbox', summary: 'C5 沙箱审核证据' }],
      },
    });
    const estimate = await createSandboxEstimateJob({
      prisma, ownerUserId, sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
    });
    await prisma.job.update({
      where: { id: estimate.estimateJobId },
      data: { status: 'succeeded', resultRef: {
        schemaVersion: 'mesh-analysis-result.v0', algorithmVersion: 'trimesh-volume.v0', geometryUnit: 'millimeter',
        assetChecksum: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
        dimensionsMm: { x: 120, y: 119.022, z: 53.865 }, volumeMm3: 240342.387,
        triangleCount: 103716, watertight: true,
      } },
    });
    const quote = (await createQuote({
      prisma,
      ownerUserId,
      input: {
        requestId: request.id,
        estimateJobId: estimate.estimateJobId,
        idempotencyKey: `c5-quote-${key}`,
        quoteMode: 'sandbox_test',
      },
    })).quote;
    if (!accepted) return quote;
    return acceptQuote({
      prisma, ownerUserId, quoteId: quote.id, input: { expectedStatus: 'active' },
    });
  }

  test.before(async () => {
    await prisma.user.createMany({ data: [
      { id: admin, name: 'C5 Admin' },
      { id: owner, name: 'C5 Owner' },
      { id: other, name: 'C5 Other' },
    ] });
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
    if (existingAdmin) adminId = existingAdmin.id;
    else await bootstrapFirstAdmin({ prisma, targetUserId: admin, reason: 'C5 integration bootstrap' });
  });

  test.after(async () => { await prisma.$disconnect(); });

  test('only an accepted owner Quote can hold the current checkout address', async () => {
    const active = await makeQuote(owner, 'active', false);
    await assert.rejects(
      () => saveDeliveryAddress({ prisma, ownerUserId: owner, input: { quoteId: active.id, ...fields('active') } }),
      (error) => error instanceof DeliveryAddressEligibilityError,
    );

    const accepted = await makeQuote(owner, 'accepted');
    const result = await saveDeliveryAddress({
      prisma, ownerUserId: owner, input: { quoteId: accepted.id, ...fields('accepted') },
    });
    assert.equal(result.created, true);
    assert.equal(result.deliveryAddress.version, 1);
    assert.equal(result.deliveryAddress.confirmed, false);
    assert.equal((await listDeliveryAddresses({ prisma, ownerUserId: owner })).length, 1);
    await assert.rejects(
      () => getConfirmedDeliveryAddressInput({ prisma, ownerUserId: owner, quoteId: accepted.id }),
      (error) => error instanceof DeliveryAddressEligibilityError,
    );
  });

  test('another owner cannot read, write or confirm the address', async () => {
    const quote = await makeQuote(other, 'other-owner');
    const saved = await saveDeliveryAddress({
      prisma, ownerUserId: other, input: { quoteId: quote.id, ...fields('other') },
    });
    assert.equal((await listDeliveryAddresses({ prisma, ownerUserId: owner }))
      .some((address) => address.id === saved.deliveryAddress.id), false);
    await assert.rejects(
      () => saveDeliveryAddress({ prisma, ownerUserId: owner, input: { quoteId: quote.id, ...fields('forged') } }),
      (error) => error instanceof NotFoundError,
    );
    await assert.rejects(
      () => confirmDeliveryAddress({
        prisma, ownerUserId: owner, addressId: saved.deliveryAddress.id, input: { expectedVersion: 1 },
      }),
      (error) => error instanceof NotFoundError,
    );
  });

  test('editing a confirmed address clears confirmation and never mutates the old C3 snapshot', async () => {
    const quote = await makeQuote(owner, 'edit-confirmed');
    const saved = await saveDeliveryAddress({
      prisma, ownerUserId: owner, input: { quoteId: quote.id, ...fields('v1') },
    });
    const confirmed = await confirmDeliveryAddress({
      prisma, ownerUserId: owner, addressId: saved.deliveryAddress.id,
      input: { expectedVersion: saved.deliveryAddress.version },
    });
    const retried = await confirmDeliveryAddress({
      prisma, ownerUserId: owner, addressId: saved.deliveryAddress.id,
      input: { expectedVersion: saved.deliveryAddress.version },
    });
    assert.equal(retried.version, confirmed.version);
    assert.equal(retried.confirmedAt, confirmed.confirmedAt);
    const snapshot = await getConfirmedDeliveryAddressInput({ prisma, ownerUserId: owner, quoteId: quote.id });
    assert.equal(confirmed.confirmed, true);
    assert.equal(snapshot.fields.detail, fields('v1').detail);

    const edited = await saveDeliveryAddress({
      prisma,
      ownerUserId: owner,
      input: { quoteId: quote.id, expectedVersion: confirmed.version, ...fields('v2') },
    });
    assert.equal(edited.deliveryAddress.confirmed, false);
    assert.equal(edited.deliveryAddress.version, confirmed.version + 1);
    assert.equal(snapshot.fields.detail, fields('v1').detail);
    await assert.rejects(
      () => getConfirmedDeliveryAddressInput({ prisma, ownerUserId: owner, quoteId: quote.id }),
      (error) => error instanceof DeliveryAddressEligibilityError,
    );
  });

  test('concurrent create is idempotent and same-version edits allow one winner', async () => {
    const quote = await makeQuote(owner, 'concurrent');
    const creates = await Promise.all(Array.from({ length: 10 }, () => saveDeliveryAddress({
      prisma, ownerUserId: owner, input: { quoteId: quote.id, ...fields('same') },
    })));
    assert.equal(creates.filter((result) => result.created).length, 1);
    assert.equal(new Set(creates.map((result) => result.deliveryAddress.id)).size, 1);

    const initial = creates[0].deliveryAddress;
    const edits = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => saveDeliveryAddress({
      prisma,
      ownerUserId: owner,
      input: { quoteId: quote.id, expectedVersion: initial.version, ...fields(`edit-${index}`) },
    })));
    assert.equal(edits.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(edits.filter((result) => result.status === 'rejected' &&
      result.reason instanceof DeliveryAddressConflictError).length, 9);
  });

  test('database rejects forged owner, quote ancestry and confirmation-preserving edits', async () => {
    const quote = await makeQuote(owner, 'db-guard');
    const saved = await saveDeliveryAddress({
      prisma, ownerUserId: owner, input: { quoteId: quote.id, ...fields('db') },
    });
    const confirmed = await confirmDeliveryAddress({
      prisma, ownerUserId: owner, addressId: saved.deliveryAddress.id, input: { expectedVersion: 1 },
    });
    await assert.rejects(() => prisma.deliveryAddress.update({
      where: { id: confirmed.id },
      data: { detail: '伪造但保留确认', version: confirmed.version + 1 },
    }));
    await assert.rejects(() => prisma.deliveryAddress.update({
      where: { id: confirmed.id },
      data: { ownerUserId: other, version: confirmed.version + 1, confirmedAt: null },
    }));
    const active = await makeQuote(owner, 'db-active', false);
    await assert.rejects(() => prisma.deliveryAddress.create({ data: {
      ownerUserId: owner, quoteId: active.id, sandboxOnly: true, version: 1,
      confirmedAt: null, ...fields('db-active'),
    } }));

    const clockQuote = await makeQuote(owner, 'db-clock');
    const clockAddress = await saveDeliveryAddress({
      prisma, ownerUserId: owner, input: { quoteId: clockQuote.id, ...fields('db-clock') },
    });
    const forgedTime = new Date('2000-01-01T00:00:00.000Z');
    const databaseConfirmed = await prisma.deliveryAddress.update({
      where: { id: clockAddress.deliveryAddress.id },
      data: { confirmedAt: forgedTime, version: { increment: 1 } },
    });
    assert.notEqual(databaseConfirmed.confirmedAt?.toISOString(), forgedTime.toISOString());
    assert.ok(databaseConfirmed.confirmedAt && Math.abs(Date.now() - databaseConfirmed.confirmedAt.getTime()) < 10_000);
  });
}
