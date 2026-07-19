import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：C3 资金/竞态测试不得静默 skip');
  test('payments.integration.test.mjs skipped: DATABASE_URL not set', (t) => t.skip('需要 C3 Draft migration 的 PostgreSQL 16'));
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
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
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } })).status, 'needs_attention');
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

  test('failed payments retry with a new attempt and active query recovers a lost success event', async () => {
    const quote = await makeQuote(owner, 'retry-query', { accepted: true, confirmedAddress: true });
    const created = await createPaymentIntent({ prisma, provider, ownerUserId: owner,
      input: { quoteId: quote.id, idempotencyKey: 'c3-retry-query-payment' } });
    const failed = await provider.simulate(created.paymentIntent.attempts[0].providerPaymentId, 'failed');
    await ingestPaymentEvent({ prisma, provider, rawBody: failed.rawBody, signature: failed.signature });
    const invalidRegression = await provider.simulate(created.paymentIntent.attempts[0].providerPaymentId, 'processing', {
      occurredAt: new Date(Date.now() + 1_000),
    });
    await ingestPaymentEvent({ prisma, provider, rawBody: invalidRegression.rawBody, signature: invalidRegression.signature });
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: created.paymentIntent.id } })).status, 'failed');
    const retried = await retryPaymentIntent({ prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id,
      input: { expectedStatus: 'failed' } });
    assert.equal(retried.attempts.length, 2);
    const lost = await provider.simulate(retried.attempts[1].providerPaymentId, 'succeeded');
    assert.ok(lost.signature);
    const restartedProvider = createSandboxPaymentProvider(providerOptions);
    const reconciled = await reconcilePaymentIntent({ prisma, provider: restartedProvider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id });
    assert.equal(reconciled.status, 'succeeded');
    assert.equal(await prisma.paymentEvent.count({ where: { source: 'query', paymentIntentId: created.paymentIntent.id } }), 1);
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
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => retryPaymentIntent({
      prisma, provider, ownerUserId: owner, paymentIntentId: created.paymentIntent.id, input: { expectedStatus: 'failed' },
    })));
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter((item) => item.status === 'rejected' && item.reason instanceof PaymentConflictError).length, 9);
    assert.equal(await prisma.paymentAttempt.count({ where: { paymentIntentId: created.paymentIntent.id } }), 2);
  });
}
