import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：C4 资金/竞态/恢复测试不得静默 skip');
  test('orders.integration.test.mjs skipped: DATABASE_URL not set', (t) => t.skip('需要 C4 Draft migration 的 PostgreSQL 16'));
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
    B7_SANDBOX_SCENE_CONFIRMATION_ID,
    NotFoundError,
    acceptQuote,
    bootstrapFirstAdmin,
    completeCheckRun,
    cancelOrder,
    confirmDeliveryAddress,
    createCheckRun,
    createCustomizationRequest,
    createPaymentIntent,
    createPrismaSandboxPaymentStateStore,
    createQuote,
    createSandboxEstimateJob,
    createSandboxPaymentProvider,
    getOrder,
    ingestPaymentEvent,
    listOrders,
    processOrderRecoveryJob,
    OrderConflictError,
    saveDeliveryAddress,
    startCheckRun,
  } = await import('../src/application/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 24 });
  if (!process.env.SANDBOX_PAYMENT_SECRET) throw new Error('C4 integration 需要动态测试 SANDBOX_PAYMENT_SECRET');
  const provider = createSandboxPaymentProvider({
    secret: process.env.SANDBOX_PAYMENT_SECRET,
    environment: 'test',
    stateStore: createPrismaSandboxPaymentStateStore(prisma),
  });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const admin = `c4-admin-${suffix}`;
  const owner = `c4-owner-${suffix}`;
  const other = `c4-other-${suffix}`;
  let adminId = admin;

  async function makePayment(key, ownerUserId = owner) {
    const request = (await createCustomizationRequest({
      prisma, ownerUserId,
      input: {
        sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
        idempotencyKey: `c4-request-${key}`,
        contactName: 'C4 用户', contactPhone: '13800138000', usageDescription: `C4 ${key}`, additionalRequirements: null,
      },
    })).request;
    const check = (await createCheckRun({ prisma, actorUserId: adminId, input: { requestId: request.id } })).checkRun;
    await startCheckRun({ prisma, actorUserId: adminId, checkRunId: check.id });
    await completeCheckRun({ prisma, actorUserId: adminId, checkRunId: check.id, input: {
      result: 'approved', issues: [], adjustmentSuggestions: [], note: 'C4 sandbox',
      evidence: [{ kind: 'note', ref: 'manual://c4', summary: 'C4 sandbox review' }],
    } });
    const estimate = await createSandboxEstimateJob({
      prisma, ownerUserId, sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
    });
    await prisma.job.update({ where: { id: estimate.estimateJobId }, data: { status: 'succeeded', resultRef: {
      schemaVersion: 'mesh-analysis-result.v0', algorithmVersion: 'trimesh-volume.v0', geometryUnit: 'millimeter',
      assetChecksum: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
      dimensionsMm: { x: 120, y: 119.022, z: 53.865 }, volumeMm3: 240342.387, triangleCount: 103716, watertight: true,
    } } });
    let quote = (await createQuote({ prisma, ownerUserId, input: {
      requestId: request.id, estimateJobId: estimate.estimateJobId,
      idempotencyKey: `c4-quote-${key}`, quoteMode: 'sandbox_test',
    } })).quote;
    quote = await acceptQuote({ prisma, ownerUserId, quoteId: quote.id, input: { expectedStatus: 'active' } });
    const saved = await saveDeliveryAddress({ prisma, ownerUserId, input: {
      quoteId: quote.id, recipientName: 'C4 收件人', mobile: '13800138000', province: '浙江省', city: '杭州市',
      district: '余杭区', detail: `C4 ${key} 地址`, postalCode: '311100',
    } });
    await confirmDeliveryAddress({ prisma, ownerUserId, addressId: saved.deliveryAddress.id, input: { expectedVersion: 1 } });
    const payment = await createPaymentIntent({
      prisma, provider, ownerUserId,
      input: { quoteId: quote.id, idempotencyKey: `c4-payment-${key}` },
    });
    return { request, check, quote, payment: payment.paymentIntent };
  }

  async function successEvent(payment) {
    return provider.simulate(payment.attempts[0].providerPaymentId, 'succeeded');
  }

  test.before(async () => {
    await prisma.user.createMany({ data: [
      { id: admin, name: 'C4 Admin' }, { id: owner, name: 'C4 Owner' }, { id: other, name: 'C4 Other' },
    ] });
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
    if (existingAdmin) adminId = existingAdmin.id;
    else await bootstrapFirstAdmin({ prisma, targetUserId: admin, reason: 'C4 integration bootstrap' });
  });
  test.after(async () => prisma.$disconnect());

  test('ten concurrent trusted success deliveries create one paid sandbox order and one initial history row', async () => {
    const fixture = await makePayment('concurrent');
    const signed = await successEvent(fixture.payment);
    await Promise.all(Array.from({ length: 10 }, () => ingestPaymentEvent({
      prisma, provider, rawBody: signed.rawBody, signature: signed.signature,
    })));
    const rows = await prisma.order.findMany({ where: { paymentIntentId: fixture.payment.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amountCent, fixture.quote.amountCent);
    assert.equal(rows[0].sandboxOnly, true);
    assert.equal(rows[0].status, 'paid');
    assert.deepEqual(rows[0].deliveryAddressSnapshot, (await prisma.paymentIntent.findUniqueOrThrow({ where: { id: fixture.payment.id } })).deliveryAddressSnapshot);
    assert.equal(await prisma.orderStatusHistory.count({ where: { orderId: rows[0].id } }), 1);
    assert.equal(await prisma.job.count({ where: {
      ownerUserId: owner, type: 'order_recovery', idempotencyKey: fixture.payment.id,
    } }), 1);
  });

  test('a crash after payment success but before order insert is repaired by redelivering the same event', async () => {
    const fixture = await makePayment('recovery');
    const signed = await successEvent(fixture.payment);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION c4_test_fail_order_once() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected order interruption'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER a_c4_test_fail_order_once BEFORE INSERT ON "order" FOR EACH ROW EXECUTE FUNCTION c4_test_fail_order_once()`);
    try {
      await assert.rejects(() => ingestPaymentEvent({ prisma, provider, rawBody: signed.rawBody, signature: signed.signature }), /injected order interruption/i);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS a_c4_test_fail_order_once ON "order"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS c4_test_fail_order_once()`);
    }
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: fixture.payment.id } })).status, 'succeeded');
    assert.equal(await prisma.order.count({ where: { paymentIntentId: fixture.payment.id } }), 0);
    const recoveryJob = await prisma.job.findUniqueOrThrow({ where: { job_owner_type_idempotency_key: {
      ownerUserId: owner, type: 'order_recovery', idempotencyKey: fixture.payment.id,
    } } });
    assert.equal(recoveryJob.status, 'pending');
    await processOrderRecoveryJob({ prisma, ownerUserId: owner, input: recoveryJob.input });
    assert.equal(await prisma.order.count({ where: { paymentIntentId: fixture.payment.id } }), 1);
    const replayed = await ingestPaymentEvent({ prisma, provider, rawBody: signed.rawBody, signature: signed.signature });
    assert.equal(replayed.duplicate, true);
    assert.equal(await prisma.order.count({ where: { paymentIntentId: fixture.payment.id } }), 1);
  });

  test('order reads are owner-scoped and server snapshots are immutable', async () => {
    const fixture = await makePayment('ownership');
    const signed = await successEvent(fixture.payment);
    await ingestPaymentEvent({ prisma, provider, rawBody: signed.rawBody, signature: signed.signature });
    const listed = await listOrders({ prisma, ownerUserId: owner });
    const order = listed.find((item) => item.paymentIntentId === fixture.payment.id);
    assert.ok(order);
    assert.equal(order.purchaseSnapshot.review.result, 'approved');
    assert.equal(order.deliveryAddressSnapshot.fields.detail, 'C4 ownership 地址');
    assert.equal((await getOrder({ prisma, ownerUserId: owner, orderId: order.id })).id, order.id);
    await assert.rejects(() => getOrder({ prisma, ownerUserId: other, orderId: order.id }), (error) => error instanceof NotFoundError);
    await assert.rejects(() => prisma.order.update({ where: { id: order.id }, data: { amountCent: 1 } }), /immutable/i);
    await assert.rejects(() => prisma.order.update({ where: { id: order.id }, data: { deliveryAddressSnapshot: {} } }), /immutable/i);
    await assert.rejects(() => prisma.order.delete({ where: { id: order.id } }), /immutable/i);
    await assert.rejects(() => prisma.orderStatusHistory.update({ where: { sequence: BigInt(order.history[0].sequence) }, data: { reason: 'tampered' } }), /append-only/i);
    await assert.rejects(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('petscape.order_history_proof', ${order.id}, true)`;
      await tx.orderStatusHistory.create({ data: {
        orderId: order.id, fromStatus: null, toStatus: 'paid', reason: 'trusted_payment_succeeded', source: 'system',
      } });
    }), /order creation trigger/i);
  });

  test('needs_attention payments never create an order', async () => {
    const fixture = await makePayment('attention');
    const mismatch = await provider.simulate(fixture.payment.attempts[0].providerPaymentId, 'succeeded', {
      amountCent: fixture.quote.amountCent - 100,
    });
    await ingestPaymentEvent({ prisma, provider, rawBody: mismatch.rawBody, signature: mismatch.signature });
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: fixture.payment.id } })).status, 'needs_attention');
    assert.equal(await prisma.order.count({ where: { paymentIntentId: fixture.payment.id } }), 0);
    assert.equal(await prisma.job.count({ where: { type: 'order_recovery', idempotencyKey: fixture.payment.id } }), 0);
  });

  test('only the owner can cancel paid to canceled and the database appends actor history without snapshot drift', async () => {
    const fixture = await makePayment('cancel');
    const signed = await successEvent(fixture.payment);
    await ingestPaymentEvent({ prisma, provider, rawBody: signed.rawBody, signature: signed.signature });
    const before = (await listOrders({ prisma, ownerUserId: owner })).find((item) => item.paymentIntentId === fixture.payment.id);
    assert.ok(before);
    await assert.rejects(() => cancelOrder({
      prisma, provider, ownerUserId: other, orderId: before.id, input: { expectedStatus: 'paid' },
    }), (error) => error instanceof NotFoundError);
    await assert.rejects(() => prisma.order.update({
      where: { id: before.id }, data: { status: 'canceled' },
    }), /trusted owner proof/i);
    const canceled = await cancelOrder({
      prisma, provider, ownerUserId: owner, orderId: before.id, input: { expectedStatus: 'paid' },
    });
    assert.equal(canceled.status, 'canceled');
    assert.equal(canceled.history.length, 2);
    assert.deepEqual(canceled.purchaseSnapshot, before.purchaseSnapshot);
    assert.deepEqual(canceled.deliveryAddressSnapshot, before.deliveryAddressSnapshot);
    assert.deepEqual(canceled.history.at(-1), {
      sequence: canceled.history.at(-1).sequence,
      fromStatus: 'paid', toStatus: 'canceled', reason: 'owner_canceled_sandbox',
      source: 'owner', actorUserId: owner, createdAt: canceled.history.at(-1).createdAt,
    });
    await assert.rejects(() => cancelOrder({
      prisma, provider, ownerUserId: owner, orderId: before.id, input: { expectedStatus: 'paid' },
    }), (error) => error instanceof OrderConflictError);
  });
}
