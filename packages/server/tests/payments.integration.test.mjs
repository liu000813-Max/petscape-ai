import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：C3 资金/竞态测试不得静默 skip');
  test('payments.integration.test.mjs skipped: DATABASE_URL not set', (t) => t.skip('需要 C3 Draft migration 的 PostgreSQL 16'));
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
    AdminRequiredError,
    B7_SANDBOX_SCENE_CONFIRMATION_ID,
    NotFoundError,
    PaymentConflictError,
    PaymentEligibilityError,
    PaymentProviderDisabledError,
    PaymentProviderSignatureError,
    acceptQuote,
    bootstrapFirstAdmin,
    completeCheckRun,
    confirmDeliveryAddress,
    createCheckRun,
    createCustomizationRequest,
    createPaymentIntent,
    createQuote,
    createSandboxEstimateJob,
    createSandboxPaymentProvider,
    createPrismaSandboxPaymentStateStore,
    listAdminPaymentAttention,
    ingestPaymentEvent,
    reconcilePaymentIntent,
    retryPaymentIntent,
    saveDeliveryAddress,
    startCheckRun,
  } = await import('../src/application/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 24 });
  if (!process.env.SANDBOX_PAYMENT_SECRET) throw new Error('C3 integration 需要测试环境动态注入 SANDBOX_PAYMENT_SECRET');
  const providerOptions = {
    secret: process.env.SANDBOX_PAYMENT_SECRET, environment: 'test',
    stateStore: createPrismaSandboxPaymentStateStore(prisma),
  };
  const provider = createSandboxPaymentProvider(providerOptions);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const admin = `c3-admin-${suffix}`;
  const owner = `c3-owner-${suffix}`;
  const other = `c3-other-${suffix}`;
  let adminId = admin;

  async function makeQuote(ownerUserId, key, options = {}) {
    const request = (await createCustomizationRequest({
      prisma, ownerUserId,
      input: { sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID, idempotencyKey: `c3-request-${key}`,
        contactName: 'C3 用户', contactPhone: '13800138000', usageDescription: `C3 ${key}`, additionalRequirements: null },
    })).request;
    const check = (await createCheckRun({ prisma, actorUserId: adminId, input: { requestId: request.id } })).checkRun;
    await startCheckRun({ prisma, actorUserId: adminId, checkRunId: check.id });
    await completeCheckRun({ prisma, actorUserId: adminId, checkRunId: check.id, input: {
      result: 'approved', issues: [], adjustmentSuggestions: [], note: 'C3 sandbox',
      evidence: [{ kind: 'note', ref: 'manual://c3', summary: 'C3 sandbox review' }],
    } });
    const estimate = await createSandboxEstimateJob({ prisma, ownerUserId, sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID });
    await prisma.job.update({ where: { id: estimate.estimateJobId }, data: { status: 'succeeded', resultRef: {
      schemaVersion: 'mesh-analysis-result.v0', algorithmVersion: 'trimesh-volume.v0', geometryUnit: 'millimeter',
      assetChecksum: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
      dimensionsMm: { x: 120, y: 119.022, z: 53.865 }, volumeMm3: 240342.387, triangleCount: 103716, watertight: true,
    } } });
    let quote = (await createQuote({ prisma, ownerUserId, input: {
      requestId: request.id, estimateJobId: estimate.estimateJobId, idempotencyKey: `c3-quote-${key}`, quoteMode: 'sandbox_test',
    } })).quote;
    if (!options.accepted) return quote;
    quote = await acceptQuote({ prisma, ownerUserId, quoteId: quote.id, input: { expectedStatus: 'active' } });
    if (!options.confirmedAddress) return quote;
    const saved = await saveDeliveryAddress({ prisma, ownerUserId, input: {
      quoteId: quote.id, recipientName: 'C3 收件人', mobile: '13800138000', province: '浙江省', city: '杭州市',
      district: '余杭区', detail: `C3 ${key} 地址`, postalCode: '311100',
    } });
    await confirmDeliveryAddress({ prisma, ownerUserId, addressId: saved.deliveryAddress.id, input: { expectedVersion: 1 } });
    return quote;
  }

  test.before(async () => {
    await prisma.user.createMany({ data: [{ id: admin, name: 'C3 Admin' }, { id: owner, name: 'C3 Owner' }, { id: other, name: 'C3 Other' }] });
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
    if (existingAdmin) adminId = existingAdmin.id;
    else await bootstrapFirstAdmin({ prisma, targetUserId: admin, reason: 'C3 integration bootstrap' });
  });
  test.after(async () => prisma.$disconnect());

  test('only an accepted owner Quote with a confirmed address creates server-priced payment input', async () => {
    const active = await makeQuote(owner, 'active');
    await assert.rejects(() => createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: active.id, idempotencyKey: 'c3-active-payment' } }), (e) => e instanceof PaymentEligibilityError);
    const unconfirmed = await makeQuote(owner, 'unconfirmed', { accepted: true });
    await assert.rejects(() => createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: unconfirmed.id, idempotencyKey: 'c3-unconfirmed-payment' } }), (e) => e instanceof PaymentEligibilityError);
    const quote = await makeQuote(owner, 'eligible', { accepted: true, confirmedAddress: true });
    const mismatchedProvider = createSandboxPaymentProvider({
      secret: 'mismatched-test-secret-that-is-never-registered', environment: 'test',
      stateStore: createPrismaSandboxPaymentStateStore(prisma),
    });
    await assert.rejects(() => createPaymentIntent({ prisma, provider: mismatchedProvider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-mismatched-provider' } }),
    (error) => error instanceof PaymentProviderDisabledError);
    const result = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-eligible-payment' } });
    assert.equal(result.created, true);
    assert.equal(result.paymentIntent.amountCent, quote.amountCent);
    assert.equal(result.paymentIntent.currency, 'CNY');
    assert.equal(result.paymentIntent.status, 'requires_action');
    assert.equal(result.paymentIntent.attentionCode, null);
    assert.equal(result.paymentIntent.attempts.length, 1);
  });

  test('another owner cannot create or read a payment for a foreign Quote', async () => {
    const quote = await makeQuote(other, 'foreign', { accepted: true, confirmedAddress: true });
    await assert.rejects(() => createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-foreign-payment' } }), (e) => e instanceof NotFoundError);
  });

  test('ten concurrent creates produce one intent and one provider attempt', async () => {
    const quote = await makeQuote(owner, 'concurrent', { accepted: true, confirmedAddress: true });
    const results = await Promise.all(Array.from({ length: 10 }, () => createPaymentIntent({
      prisma, provider, ownerUserId: owner, input: { quoteId: quote.id, idempotencyKey: 'c3-concurrent-payment' },
    })));
    assert.equal(results.filter((item) => item.created).length, 1);
    assert.equal(new Set(results.map((item) => item.paymentIntent.id)).size, 1);
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: results[0].paymentIntent.id } }), 1);
  });

  test('a provider creation failure recovers with the same idempotent input and no duplicate attempt', async () => {
    const quote = await makeQuote(owner, 'provider-create-recovery', { accepted: true, confirmedAddress: true });
    let shouldFail = true;
    const flakyProvider = {
      ...provider,
      async createPayment(input) {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('injected provider create failure');
        }
        return provider.createPayment(input);
      },
    };
    const input = { quoteId: quote.id, idempotencyKey: 'c3-provider-create-recovery-payment' };
    await assert.rejects(
      () => createPaymentIntent({ prisma, provider: flakyProvider, ownerUserId: owner, input }),
      (error) => error instanceof PaymentConflictError,
    );
    const persisted = await prisma.paymentIntent.findUniqueOrThrow({ where: { quoteId: quote.id } });
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: persisted.id } }), 0);

    const recovered = await createPaymentIntent({ prisma, provider: flakyProvider, ownerUserId: owner, input });
    assert.equal(recovered.created, false);
    assert.equal(recovered.paymentIntent.id, persisted.id);
    assert.equal(recovered.paymentIntent.attempts.length, 1);
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: persisted.id } }), 1);
  });

  test('provider payment ID collisions are rejected instead of being mistaken for idempotent creation', async () => {
    const firstQuote = await makeQuote(owner, 'provider-id-collision-first', { accepted: true, confirmedAddress: true });
    const first = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: firstQuote.id, idempotencyKey: 'c3-provider-id-collision-first' } });
    const secondQuote = await makeQuote(owner, 'provider-id-collision-second', { accepted: true, confirmedAddress: true });
    const collidingProvider = {
      ...provider,
      async createPayment(input) {
        const created = await provider.createPayment(input);
        return { ...created, payment: { ...created.payment, providerPaymentId: first.paymentIntent.attempts[0].providerPaymentId } };
      },
    };
    await assert.rejects(
      () => createPaymentIntent({ prisma, provider: collidingProvider, ownerUserId: owner,
        input: { quoteId: secondQuote.id, idempotencyKey: 'c3-provider-id-collision-second' } }),
      (error) => error instanceof PaymentConflictError,
    );
    const secondIntent = await prisma.paymentIntent.findUniqueOrThrow({ where: { quoteId: secondQuote.id } });
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: secondIntent.id } }), 0);
    assert.equal((await prisma.paymentAttempt.findUniqueOrThrow({ where: {
      providerPaymentId: first.paymentIntent.attempts[0].providerPaymentId,
    } })).paymentIntentId, first.paymentIntent.id);
  });

  test('sandbox attempt creation rejects synchronous provider terminal or processing states', async () => {
    const quote = await makeQuote(owner, 'provider-create-processing', { accepted: true, confirmedAddress: true });
    const processingProvider = {
      ...provider,
      async createPayment(input) {
        const created = await provider.createPayment(input);
        return { ...created, payment: { ...created.payment, status: 'processing' } };
      },
    };
    await assert.rejects(
      () => createPaymentIntent({ prisma, provider: processingProvider, ownerUserId: owner,
        input: { quoteId: quote.id, idempotencyKey: 'c3-provider-create-processing' } }),
      (error) => error instanceof PaymentConflictError,
    );
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { quoteId: quote.id } });
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: intent.id } }), 0);
  });

  test('signed success is credited once; duplicate and out-of-order events never regress it', async () => {
    const quote = await makeQuote(owner, 'events', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-events-payment' } });
    const attempt = created.paymentIntent.attempts[0];
    const signed = await provider.simulate(attempt.providerPaymentId, 'succeeded');
    const delivered = await Promise.all(Array.from({ length: 10 }, () => ingestPaymentEvent({
      prisma, provider, rawBody: signed.rawBody, signature: signed.signature,
    })));
    assert.equal(delivered.filter((item) => item.duplicate === false).length, 1);
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } })).status, 'succeeded');
    assert.equal(await prisma.paymentEvent.count({ where: { providerEventId: signed.event.providerEventId } }), 1);
    const sameTimeProcessing = await provider.simulate(attempt.providerPaymentId, 'processing', {
      occurredAt: new Date(signed.event.occurredAt),
    });
    await ingestPaymentEvent({ prisma, provider, rawBody: sameTimeProcessing.rawBody, signature: sameTimeProcessing.signature });
    assert.equal((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).providerObservedStatus, 'succeeded');
    const lateProcessing = await provider.simulate(attempt.providerPaymentId, 'processing', { occurredAt: new Date(Date.now() - 10_000) });
    await ingestPaymentEvent({ prisma, provider, rawBody: lateProcessing.rawBody, signature: lateProcessing.signature });
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } })).status, 'succeeded');
  });

  test('a reused provider event ID with different payload is rejected instead of silently deduplicated', async () => {
    const quote = await makeQuote(owner, 'event-id-conflict', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-event-id-conflict-payment' } });
    const attempt = created.paymentIntent.attempts[0];
    const original = await provider.simulate(attempt.providerPaymentId, 'processing');
    await ingestPaymentEvent({ prisma, provider, rawBody: original.rawBody, signature: original.signature });
    const conflictingProvider = {
      ...provider,
      async verifyEvent() {
        const verified = await provider.verifyEvent(original.rawBody, original.signature);
        return { ...verified, event: { ...verified.event, status: 'failed', failureCode: 'reused-id', failureMessage: 'different payload' } };
      },
    };
    await assert.rejects(
      () => ingestPaymentEvent({ prisma, provider: conflictingProvider, rawBody: original.rawBody, signature: original.signature }),
      (error) => error instanceof PaymentConflictError,
    );
    assert.equal(await prisma.paymentEvent.count({ where: { providerEventId: original.event.providerEventId } }), 1);
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } })).status, 'processing');
  });

  test('invalid signatures do not mutate state; signed amount mismatch needs attention', async () => {
    const quote = await makeQuote(owner, 'tamper', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-tamper-payment' } });
    const attempt = created.paymentIntent.attempts[0];
    const event = await provider.simulate(attempt.providerPaymentId, 'succeeded');
    await assert.rejects(() => ingestPaymentEvent({ prisma, provider, rawBody: event.rawBody, signature: 'forged' }),
      (e) => e instanceof PaymentProviderSignatureError);
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } })).status, 'requires_action');
    const amountMismatch = await provider.simulate(attempt.providerPaymentId, 'succeeded', { amountCent: quote.amountCent - 100 });
    await ingestPaymentEvent({ prisma, provider, rawBody: amountMismatch.rawBody, signature: amountMismatch.signature });
    const attention = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    assert.equal(attention.status, 'needs_attention');
    assert.equal(attention.attentionCode, 'amount_mismatch');
    assert.equal(await prisma.order.count({ where: { paymentIntentId: created.paymentIntent.id } }), 0);
    const adminQueue = await listAdminPaymentAttention({ prisma, actorUserId: adminId });
    assert.equal(adminQueue.some((item) => item.paymentIntent.id === created.paymentIntent.id &&
      item.paymentIntent.attentionCode === 'amount_mismatch'), true);
    await assert.rejects(
      () => listAdminPaymentAttention({ prisma, actorUserId: owner }),
      (error) => error instanceof AdminRequiredError,
    );
  });

  test('a verified amount mismatch after failure is ledgered and escalates to needs_attention', async () => {
    const quote = await makeQuote(owner, 'terminal-tamper', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-terminal-tamper-payment' } });
    const attempt = created.paymentIntent.attempts[0];
    const failed = await provider.simulate(attempt.providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const mismatch = await provider.simulate(attempt.providerPaymentId, 'succeeded', { amountCent: quote.amountCent - 100 });
    await ingestPaymentEvent({ prisma, provider, rawBody: mismatch.rawBody, signature: mismatch.signature });
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } })).status, 'needs_attention');
    assert.equal((await prisma.paymentEvent.findUniqueOrThrow({ where: { providerEventId: mismatch.event.providerEventId } })).processingResult, 'needs_attention');
  });

  test('a trusted late success from an older attempt needs attention and never creates an order', async () => {
    const quote = await makeQuote(owner, 'late-old-success', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-late-old-success-payment' } });
    const oldAttempt = created.paymentIntent.attempts[0];
    const failed = await provider.simulate(oldAttempt.providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const retried = await retryPaymentIntent({ prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
      input: { expectedStatus: 'failed' } });
    assert.equal(retried.status, 'requires_action');
    assert.equal(retried.attempts.length, 2);

    const lateSuccess = await provider.simulate(oldAttempt.providerPaymentId, 'succeeded', {
      occurredAt: new Date(Date.now() + 1_000),
    });
    await ingestPaymentEvent({ prisma, provider, rawBody: lateSuccess.rawBody, signature: lateSuccess.signature });

    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    const event = await prisma.paymentEvent.findUniqueOrThrow({ where: { providerEventId: lateSuccess.event.providerEventId } });
    assert.equal(intent.status, 'needs_attention');
    assert.equal(intent.attentionCode, 'stale_succeeded_attempt');
    assert.equal(event.processingResult, 'needs_attention');
    assert.equal(await prisma.order.count({ where: { paymentIntentId: created.paymentIntent.id } }), 0);
    assert.equal(await prisma.job.count({ where: { type: 'order_recovery', idempotencyKey: created.paymentIntent.id } }), 0);
  });

  test('an older success blocks a pending order recovery after the newer attempt already succeeded', async () => {
    const quote = await makeQuote(owner, 'late-old-success-after-new', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-late-old-success-after-new-payment' } });
    const oldAttempt = created.paymentIntent.attempts[0];
    const failed = await provider.simulate(oldAttempt.providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const retried = await retryPaymentIntent({ prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
      input: { expectedStatus: 'failed' } });
    const latestSuccess = await provider.simulate(retried.attempts[1].providerPaymentId, 'succeeded');

    await prisma.$executeRawUnsafe(`CREATE FUNCTION payment_recovery_fail_order_once() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected payment recovery order interruption'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER a_payment_recovery_fail_order_once BEFORE INSERT ON "order" FOR EACH ROW EXECUTE FUNCTION payment_recovery_fail_order_once()`);
    try {
      await assert.rejects(
        () => ingestPaymentEvent({ prisma, provider, rawBody: latestSuccess.rawBody, signature: latestSuccess.signature }),
        /injected payment recovery order interruption/i,
      );
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS a_payment_recovery_fail_order_once ON "order"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS payment_recovery_fail_order_once()`);
    }
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } })).status, 'succeeded');
    assert.equal(await prisma.order.count({ where: { paymentIntentId: created.paymentIntent.id } }), 0);

    const lateSuccess = await provider.simulate(oldAttempt.providerPaymentId, 'succeeded', {
      occurredAt: new Date(Date.now() + 1_000),
    });
    await ingestPaymentEvent({ prisma, provider, rawBody: lateSuccess.rawBody, signature: lateSuccess.signature });

    const attention = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    assert.equal(attention.status, 'needs_attention');
    assert.equal(attention.attentionCode, 'stale_succeeded_attempt');
    assert.equal(await prisma.order.count({ where: { paymentIntentId: created.paymentIntent.id } }), 0);
  });

  test('late failed and canceled events from an older attempt stay in the ledger without replacing the latest attempt', async () => {
    const quote = await makeQuote(owner, 'late-old-terminal', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-late-old-terminal-payment' } });
    const oldAttempt = created.paymentIntent.attempts[0];
    const firstFailure = await provider.simulate(oldAttempt.providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: firstFailure.rawBody, signature: firstFailure.signature });
    const retried = await retryPaymentIntent({ prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
      input: { expectedStatus: 'failed' } });
    const latestAttempt = retried.attempts[1];

    const lateCanceled = await provider.simulate(oldAttempt.providerPaymentId, 'canceled', {
      occurredAt: new Date(Date.now() + 1_000),
    });
    await ingestPaymentEvent({ prisma, provider, rawBody: lateCanceled.rawBody, signature: lateCanceled.signature });
    const lateFailed = await provider.simulate(oldAttempt.providerPaymentId, 'failed', {
      occurredAt: new Date(Date.now() + 2_000),
    });
    await ingestPaymentEvent({ prisma, provider, rawBody: lateFailed.rawBody, signature: lateFailed.signature });

    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    const attempts = await prisma.paymentAttempt.findMany({
      where: { paymentIntentId: created.paymentIntent.id }, orderBy: { attemptNo: 'asc' },
    });
    const staleEvents = await prisma.paymentEvent.findMany({
      where: { providerEventId: { in: [lateCanceled.event.providerEventId, lateFailed.event.providerEventId] } },
    });
    assert.equal(intent.status, 'requires_action');
    assert.equal(intent.attentionCode, null);
    assert.equal(attempts[0].status, 'failed');
    assert.equal(attempts[1].id, latestAttempt.id);
    assert.equal(attempts[1].status, 'requires_action');
    assert.deepEqual(staleEvents.map((event) => event.processingResult).sort(), ['ignored_stale', 'ignored_stale']);
  });

  test('a latest attempt success that conflicts with its terminal state needs attention', async () => {
    const quote = await makeQuote(owner, 'provider-conflict', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-provider-conflict-payment' } });
    const attempt = created.paymentIntent.attempts[0];
    const failed = await provider.simulate(attempt.providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const conflictingSuccess = await provider.simulate(attempt.providerPaymentId, 'succeeded', {
      occurredAt: new Date(Date.now() + 1_000),
    });
    await ingestPaymentEvent({ prisma, provider, rawBody: conflictingSuccess.rawBody, signature: conflictingSuccess.signature });

    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    assert.equal(intent.status, 'needs_attention');
    assert.equal(intent.attentionCode, 'provider_state_conflict');
    assert.equal(await prisma.order.count({ where: { paymentIntentId: created.paymentIntent.id } }), 0);
  });

  test('failed payments retry with a new attempt and active query recovers a lost success event', async () => {
    const quote = await makeQuote(owner, 'retry-query', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-retry-query-payment' } });
    const failed = await provider.simulate(created.paymentIntent.attempts[0].providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const retried = await retryPaymentIntent({ prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
      input: { expectedStatus: 'failed' } });
    assert.equal(retried.attempts.length, 2);
    const lost = await provider.simulate(retried.attempts[1].providerPaymentId, 'succeeded');
    assert.ok(lost.signature);
    const restartedProvider = createSandboxPaymentProvider(providerOptions);
    const reconciled = await reconcilePaymentIntent({ prisma, provider: restartedProvider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id });
    assert.equal(reconciled.status, 'succeeded');
    assert.equal(await prisma.paymentEvent.count({ where: { source: 'query', paymentIntentId: created.paymentIntent.id } }), 2);
  });

  test('retry refuses a provider payment that returned to processing after local failure', async () => {
    const quote = await makeQuote(owner, 'retry-processing-conflict', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-retry-processing-conflict-payment' } });
    const attempt = created.paymentIntent.attempts[0];
    const failed = await provider.simulate(attempt.providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const processing = await provider.simulate(attempt.providerPaymentId, 'processing', {
      occurredAt: new Date(Date.now() + 1_000),
    });
    assert.ok(processing.signature);

    await assert.rejects(
      () => retryPaymentIntent({ prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
        input: { expectedStatus: 'failed' } }),
      (error) => error instanceof PaymentConflictError,
    );
    const attention = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    assert.equal(attention.status, 'needs_attention');
    assert.equal(attention.attentionCode, 'provider_state_conflict');
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: created.paymentIntent.id } }), 1);
  });

  test('canceled payments query every attempt before creating a new attempt', async () => {
    const quote = await makeQuote(owner, 'canceled-retry', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-canceled-retry-payment' } });
    const canceled = await provider.simulate(created.paymentIntent.attempts[0].providerPaymentId, 'canceled');
    await ingestPaymentEvent({ prisma, provider, rawBody: canceled.rawBody, signature: canceled.signature });
    await assert.rejects(
      () => prisma.paymentIntent.update({ where: { id: created.paymentIntent.id }, data: {
        status: 'requires_action', canceledAt: null,
      } }),
      /trusted provider creation proof|new provider attempt/i,
    );

    const retried = await retryPaymentIntent({
      prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
      input: { expectedStatus: 'canceled' },
    });
    assert.equal(retried.status, 'requires_action');
    assert.equal(retried.attempts.length, 2);
    assert.equal(await prisma.paymentEvent.count({
      where: { source: 'query', paymentIntentId: created.paymentIntent.id, paymentAttemptId: created.paymentIntent.attempts[0].id },
    }), 1);
  });

  test('retry queries all attempts and refuses a new attempt when an older provider payment succeeded', async () => {
    const quote = await makeQuote(owner, 'retry-all-attempts', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-retry-all-attempts-payment' } });
    const oldAttempt = created.paymentIntent.attempts[0];
    const oldFailed = await provider.simulate(oldAttempt.providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: oldFailed.rawBody, signature: oldFailed.signature });
    const retried = await retryPaymentIntent({ prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
      input: { expectedStatus: 'failed' } });
    const latestFailed = await provider.simulate(retried.attempts[1].providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: latestFailed.rawBody, signature: latestFailed.signature });

    const lostOldSuccess = await provider.simulate(oldAttempt.providerPaymentId, 'succeeded', {
      occurredAt: new Date(Date.now() + 1_000),
    });
    assert.ok(lostOldSuccess.signature);
    await assert.rejects(
      () => retryPaymentIntent({ prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
        input: { expectedStatus: 'failed' } }),
      (error) => error instanceof PaymentConflictError,
    );

    const attention = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    assert.equal(attention.status, 'needs_attention');
    assert.equal(attention.attentionCode, 'stale_succeeded_attempt');
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: created.paymentIntent.id } }), 2);
    assert.equal(await prisma.order.count({ where: { paymentIntentId: created.paymentIntent.id } }), 0);
  });

  test('retry refuses a queried provider amount mismatch and creates no new attempt', async () => {
    const quote = await makeQuote(owner, 'retry-query-amount-mismatch', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-retry-query-amount-mismatch-payment' } });
    const attempt = created.paymentIntent.attempts[0];
    const failed = await provider.simulate(attempt.providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const mismatchedQueryProvider = {
      ...provider,
      async queryPayment(providerPaymentId) {
        const verified = await provider.queryPayment(providerPaymentId);
        return { ...verified, payment: { ...verified.payment, amountCent: verified.payment.amountCent - 100 } };
      },
    };
    await assert.rejects(
      () => retryPaymentIntent({ prisma, provider: mismatchedQueryProvider, ownerUserId: owner,
        paymentIntentId: created.paymentIntent.id, input: { expectedStatus: 'failed' } }),
      (error) => error instanceof PaymentConflictError,
    );
    const attention = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    assert.equal(attention.status, 'needs_attention');
    assert.equal(attention.attentionCode, 'amount_mismatch');
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: created.paymentIntent.id } }), 1);
    const reconciled = await reconcilePaymentIntent({
      prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
    });
    assert.equal(reconciled.status, 'needs_attention');
    assert.equal(reconciled.attentionCode, 'amount_mismatch');
  });

  test('reconcile rejects a provider query response bound to another payment ID', async () => {
    const firstQuote = await makeQuote(owner, 'query-identity-first', { accepted: true, confirmedAddress: true });
    const first = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: firstQuote.id, idempotencyKey: 'c3-query-identity-first' } });
    const firstFailed = await provider.simulate(first.paymentIntent.attempts[0].providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: firstFailed.rawBody, signature: firstFailed.signature });
    const secondQuote = await makeQuote(owner, 'query-identity-second', { accepted: true, confirmedAddress: true });
    const second = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: secondQuote.id, idempotencyKey: 'c3-query-identity-second' } });
    const mismatchedQueryProvider = {
      ...provider,
      async queryPayment() {
        return provider.queryPayment(second.paymentIntent.attempts[0].providerPaymentId);
      },
    };
    const firstEventCount = await prisma.paymentEvent.count({ where: { paymentIntentId: first.paymentIntent.id } });
    const secondEventCount = await prisma.paymentEvent.count({ where: { paymentIntentId: second.paymentIntent.id } });
    await assert.rejects(
      () => reconcilePaymentIntent({ prisma, provider: mismatchedQueryProvider, ownerUserId: owner,
        paymentIntentId: first.paymentIntent.id }),
      (error) => error instanceof PaymentConflictError,
    );
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: first.paymentIntent.id } })).status, 'failed');
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: second.paymentIntent.id } })).status, 'requires_action');
    assert.equal(await prisma.paymentEvent.count({ where: { paymentIntentId: first.paymentIntent.id } }), firstEventCount);
    assert.equal(await prisma.paymentEvent.count({ where: { paymentIntentId: second.paymentIntent.id } }), secondEventCount);
  });

  test('database rejects money drift, eventless state changes, ledger rewrites and forged event ancestry', async () => {
    await assert.rejects(
      () => prisma.paymentProviderTrust.update({ where: { provider: 'sandbox' }, data: { verificationKeyHash: 'b'.repeat(64) } }),
      /trust registry is immutable/i,
    );
    await assert.rejects(
      () => prisma.paymentProviderTrust.create({ data: { provider: 'forged', verificationKeyHash: 'b'.repeat(64), sandboxOnly: true } }),
      /trust registry is immutable/i,
    );
    const snapshotQuote = await makeQuote(owner, 'db-guard-snapshot', { accepted: true, confirmedAddress: true });
    const snapshotAddress = await prisma.deliveryAddress.findUniqueOrThrow({ where: { quoteId: snapshotQuote.id } });
    await assert.rejects(() => prisma.paymentIntent.create({ data: {
      ownerUserId: owner,
      quoteId: snapshotQuote.id,
      deliveryAddressId: snapshotAddress.id,
      deliveryAddressVersion: snapshotAddress.version,
      deliveryAddressSnapshot: {
        schemaVersion: 'delivery-address.v0', addressId: snapshotAddress.id, quoteId: snapshotQuote.id,
        version: snapshotAddress.version, sandboxOnly: true,
        fields: {
          recipientName: snapshotAddress.recipientName, mobile: snapshotAddress.mobile,
          province: snapshotAddress.province, city: snapshotAddress.city, district: snapshotAddress.district,
          detail: '伪造地址', postalCode: snapshotAddress.postalCode,
        },
        confirmedAt: snapshotAddress.confirmedAt.toISOString(),
      },
      amountCent: snapshotQuote.amountCent,
      currency: 'CNY', mode: 'sandbox_test', provider: provider.name, sandboxOnly: true,
      status: 'requires_action', idempotencyKey: `c3-forged-snapshot-${suffix}`,
      requestFingerprint: `c3-forged-snapshot-fingerprint-${suffix}`,
      verificationKeyHash: provider.verificationKeyHash,
    } }), /address snapshot/i);
    await assert.rejects(() => prisma.paymentIntent.create({ data: {
      ownerUserId: owner,
      quoteId: snapshotQuote.id,
      deliveryAddressId: snapshotAddress.id,
      deliveryAddressVersion: snapshotAddress.version,
      deliveryAddressSnapshot: {
        schemaVersion: 'delivery-address.v0', addressId: snapshotAddress.id, quoteId: snapshotQuote.id,
        version: snapshotAddress.version, sandboxOnly: true,
        fields: {
          recipientName: snapshotAddress.recipientName, mobile: snapshotAddress.mobile,
          province: snapshotAddress.province, city: snapshotAddress.city, district: snapshotAddress.district,
          detail: snapshotAddress.detail, postalCode: snapshotAddress.postalCode,
        },
        confirmedAt: snapshotAddress.confirmedAt.toISOString(),
      },
      amountCent: snapshotQuote.amountCent,
      currency: 'CNY', mode: 'sandbox_test', provider: provider.name, sandboxOnly: true,
      status: 'requires_action', idempotencyKey: `c3-self-signed-intent-${suffix}`,
      requestFingerprint: `c3-self-signed-fingerprint-${suffix}`,
      verificationKeyHash: 'a'.repeat(64),
    } }), /trusted provider/i);

    const firstQuote = await makeQuote(owner, 'db-guard-first', { accepted: true, confirmedAddress: true });
    const first = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: firstQuote.id, idempotencyKey: 'c3-db-guard-first-payment' } });
    const firstAttempt = first.paymentIntent.attempts[0];

    await assert.rejects(() => prisma.paymentAttempt.create({ data: {
      paymentIntentId: first.paymentIntent.id,
      attemptNo: 2,
      provider: firstAttempt.provider,
      providerPaymentId: `c3-forged-attempt-${suffix}`,
      status: 'requires_action',
      providerObservedStatus: 'requires_action',
      providerObservedAt: new Date(),
    } }), /provider creation proof|attempt sequence/i);

    await assert.rejects(
      () => prisma.paymentAttempt.update({ where: { id: firstAttempt.id }, data: {
        providerObservedStatus: 'succeeded', providerObservedAt: new Date(),
      } }),
      /provider state proof/i,
    );
    const reconciledBeforeEvent = await reconcilePaymentIntent({
      prisma, provider: createSandboxPaymentProvider(providerOptions), ownerUserId: owner, paymentIntentId: first.paymentIntent.id,
    });
    assert.equal(reconciledBeforeEvent.status, 'requires_action');

    await assert.rejects(
      () => prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: { amountCent: firstQuote.amountCent - 100 } }),
      /immutable/i,
    );
    await assert.rejects(
      () => prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: { status: 'succeeded', succeededAt: new Date() } }),
      /trusted provider event/i,
    );
    await assert.rejects(
      () => prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: {
        status: 'needs_attention', attentionCode: 'provider_state_conflict', needsAttentionAt: new Date(),
      } }),
      /fresh trusted provider event/i,
    );
    await assert.rejects(
      () => prisma.paymentAttempt.update({ where: { id: firstAttempt.id }, data: { status: 'processing' } }),
      /trusted provider event/i,
    );

    const secondQuote = await makeQuote(owner, 'db-guard-second', { accepted: true, confirmedAddress: true });
    const second = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: secondQuote.id, idempotencyKey: 'c3-db-guard-second-payment' } });
    const secondAttempt = second.paymentIntent.attempts[0];
    await assert.rejects(() => prisma.paymentEvent.create({ data: {
      paymentIntentId: first.paymentIntent.id,
      paymentAttemptId: secondAttempt.id,
      provider: 'sandbox',
      providerEventId: `c3-forged-ancestry-${suffix}`,
      providerPaymentId: secondAttempt.providerPaymentId,
      source: 'webhook',
      providerStatus: 'processing',
      verified: true,
      amountCent: firstQuote.amountCent,
      currency: 'CNY',
      occurredAt: new Date(),
      sanitizedPayload: {},
      processingResult: 'ignored_stale',
      processedAt: new Date(),
    } }), /ancestry/i);
    await assert.rejects(() => prisma.paymentEvent.create({ data: {
      paymentIntentId: first.paymentIntent.id,
      paymentAttemptId: firstAttempt.id,
      provider: 'sandbox',
      providerEventId: `c3-forged-success-${suffix}`,
      providerPaymentId: firstAttempt.providerPaymentId,
      source: 'webhook',
      providerStatus: 'succeeded',
      verified: true,
      amountCent: firstQuote.amountCent,
      currency: 'CNY',
      occurredAt: new Date(),
      sanitizedPayload: {},
      processingResult: 'applied',
      processedAt: new Date(),
    } }), /persistence proof/i);

    const signed = await provider.simulate(firstAttempt.providerPaymentId, 'processing');
    await ingestPaymentEvent({ prisma, provider, rawBody: signed.rawBody, signature: signed.signature });
    const storedEvent = await prisma.paymentEvent.findUniqueOrThrow({ where: { providerEventId: signed.event.providerEventId } });
    await assert.rejects(
      () => prisma.paymentEvent.update({ where: { id: storedEvent.id }, data: { processingResult: 'ignored_stale' } }),
      /append-only/i,
    );
    await assert.rejects(() => prisma.paymentEvent.delete({ where: { id: storedEvent.id } }), /append-only/i);

    const failed = await provider.simulate(firstAttempt.providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const orderedLedger = await prisma.paymentEvent.findMany({
      where: { paymentIntentId: first.paymentIntent.id }, orderBy: { sequence: 'asc' }, select: { sequence: true },
    });
    assert.ok(orderedLedger.every((event, index) => index === 0 || event.sequence > orderedLedger[index - 1].sequence));
    await assert.rejects(() => prisma.paymentAttempt.create({ data: {
      paymentIntentId: first.paymentIntent.id,
      attemptNo: 2,
      provider: firstAttempt.provider,
      providerPaymentId: `c3-unproved-retry-${suffix}`,
      status: 'requires_action',
      providerObservedStatus: 'requires_action',
      providerObservedAt: new Date(),
    } }), /provider creation proof/i);
    await assert.rejects(
      () => prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: {
        failedAt: new Date(Date.now() + 60_000),
      } }),
      /fresh trusted provider event/i,
    );
    await assert.rejects(
      () => prisma.paymentAttempt.update({ where: { id: firstAttempt.id }, data: {
        failureMessage: 'tampered failure message',
      } }),
      /fresh trusted provider event/i,
    );
    await assert.rejects(
      () => prisma.paymentAttempt.update({ where: { id: firstAttempt.id }, data: {
        status: 'processing', failureCode: null, failureMessage: null,
        lastEventAt: storedEvent.occurredAt, lastAppliedEventId: storedEvent.id, resolvedAt: null,
      } }),
      /illegal payment attempt status transition|fresh trusted provider event/i,
    );
    await assert.rejects(
      () => prisma.paymentIntent.update({ where: { id: first.paymentIntent.id }, data: {
        status: 'processing', failedAt: null, lastAppliedEventId: storedEvent.id,
      } }),
      /illegal payment intent status transition|fresh trusted provider event/i,
    );
  });

  test('ten concurrent retries create one new provider attempt and return only domain conflicts', async () => {
    const quote = await makeQuote(owner, 'concurrent-retry', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-concurrent-retry-payment' } });
    const failed = await provider.simulate(created.paymentIntent.attempts[0].providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const before = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => retryPaymentIntent({
      prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id, input: { expectedStatus: 'failed' },
    })));
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter((item) => item.status === 'rejected' && item.reason instanceof PaymentConflictError).length, 9);
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: created.paymentIntent.id } }), 2);
    const after = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } });
    assert.equal(after.amountCent, before.amountCent);
    assert.equal(after.quoteId, before.quoteId);
    assert.equal(after.deliveryAddressId, before.deliveryAddressId);
    assert.equal(after.deliveryAddressVersion, before.deliveryAddressVersion);
    assert.deepEqual(after.deliveryAddressSnapshot, before.deliveryAddressSnapshot);
  });
}
