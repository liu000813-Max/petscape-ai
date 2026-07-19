import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：C2 报价资金/竞态测试不得静默 skip');
  test('quotes.integration.test.mjs skipped: DATABASE_URL not set', (t) => {
    t.skip('需要执行 C2 Draft migration 的真实 PostgreSQL');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
    B7_SANDBOX_SCENE_CONFIRMATION_ID,
    NotFoundError,
    QuoteConflictError,
    QuoteEligibilityError,
    acceptQuote,
    bootstrapFirstAdmin,
    completeCheckRun,
    createCheckRun,
    createCustomizationRequest,
    createQuote,
    createSandboxEstimateJob,
    getQuote,
    listQuotes,
    startCheckRun,
  } = await import('../src/application/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 16 });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const admin = `c2-admin-${suffix}`;
  const owner = `c2-owner-${suffix}`;
  const other = `c2-other-${suffix}`;
  let adminId = admin;
  let readyEstimateJobId;

  async function submitRequest(key, supersedesRequestId) {
    return (await createCustomizationRequest({
      prisma,
      ownerUserId: owner,
      input: {
        sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
        idempotencyKey: `c2-request-${key}`,
        ...(supersedesRequestId ? { supersedesRequestId } : {}),
        contactName: 'C2 沙箱用户',
        contactPhone: '13800138000',
        usageDescription: `C2 报价测试 ${key}`,
        additionalRequirements: null,
      },
    })).request;
  }

  async function completeReview(requestId, result = 'approved') {
    const queued = (await createCheckRun({ prisma, actorUserId: adminId, input: { requestId } })).checkRun;
    await startCheckRun({ prisma, actorUserId: adminId, checkRunId: queued.id });
    return completeCheckRun({
      prisma,
      actorUserId: adminId,
      checkRunId: queued.id,
      input: {
        result,
        issues: result === 'approved' ? [] : ['未通过'],
        evidence: result === 'approved'
          ? [{ kind: 'note', ref: 'manual://c2-sandbox', summary: 'C2 沙箱审核证据' }]
          : [],
        adjustmentSuggestions: [],
        note: '仅供沙箱测试',
      },
    });
  }

  function quoteInput(requestId, key, quoteMode = 'sandbox_test') {
    return {
      requestId,
      estimateJobId: readyEstimateJobId,
      idempotencyKey: `c2-quote-${key}`,
      quoteMode,
    };
  }

  async function cloneReadyEstimate(key, dimensionsMm) {
    const source = await prisma.job.findUniqueOrThrow({ where: { id: readyEstimateJobId } });
    return prisma.job.create({ data: {
      type: 'mesh_analysis',
      ownerUserId: owner,
      idempotencyKey: `c2-estimate-${key}-${suffix}`,
      status: 'succeeded',
      input: source.input,
      resultRef: { ...source.resultRef, dimensionsMm },
    } });
  }

  test.before(async () => {
    await prisma.user.createMany({ data: [
      { id: admin, name: 'C2 Admin' },
      { id: owner, name: 'C2 Owner' },
      { id: other, name: 'C2 Other' },
    ] });
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
    if (existingAdmin) adminId = existingAdmin.id;
    else await bootstrapFirstAdmin({ prisma, targetUserId: admin, reason: 'C2 integration bootstrap' });
    const estimate = await createSandboxEstimateJob({
      prisma,
      ownerUserId: owner,
      sceneConfirmationId: B7_SANDBOX_SCENE_CONFIRMATION_ID,
    });
    readyEstimateJobId = estimate.estimateJobId;
    await prisma.job.update({
      where: { id: readyEstimateJobId },
      data: {
        status: 'succeeded',
        resultRef: {
          schemaVersion: 'mesh-analysis-result.v0',
          algorithmVersion: 'trimesh-volume.v0',
          geometryUnit: 'millimeter',
          assetChecksum: '8191dcdaaa3d01993df661857e388c1cbe641b5d0443d47b692a856acf6d596d',
          dimensionsMm: { x: 120, y: 119.022, z: 53.865 },
          volumeMm3: 240342.387,
          triangleCount: 103716,
          watertight: true,
        },
      },
    });
  });

  test.after(async () => {
    await prisma.$disconnect();
  });

  test('unapproved review and incomplete B7 input cannot create a quote', async () => {
    const unreviewed = await submitRequest('unreviewed');
    await assert.rejects(
      () => createQuote({ prisma, ownerUserId: owner, input: quoteInput(unreviewed.id, 'unreviewed') }),
      (error) => error instanceof QuoteEligibilityError,
    );

    const rejected = await submitRequest('rejected');
    await completeReview(rejected.id, 'rejected');
    await assert.rejects(
      () => createQuote({ prisma, ownerUserId: owner, input: quoteInput(rejected.id, 'rejected') }),
      (error) => error instanceof QuoteEligibilityError,
    );

    const pending = await submitRequest('pending-estimate');
    await completeReview(pending.id);
    const pendingJob = await prisma.job.create({
      data: {
        type: 'mesh_analysis', ownerUserId: owner, idempotencyKey: `c2-pending-${suffix}`,
        input: (await prisma.job.findUniqueOrThrow({ where: { id: readyEstimateJobId } })).input,
      },
    });
    const pendingInput = { ...quoteInput(pending.id, 'pending'), estimateJobId: pendingJob.id };
    await assert.rejects(
      () => createQuote({ prisma, ownerUserId: owner, input: pendingInput }),
      (error) => error instanceof QuoteEligibilityError,
    );
  });

  test('v0-sandbox is rejected for formal candidates and never creates a row', async () => {
    const request = await submitRequest('formal-gate');
    await completeReview(request.id);
    const before = await prisma.quote.count();
    await assert.rejects(
      () => createQuote({ prisma, ownerUserId: owner, input: quoteInput(request.id, 'formal', 'formal_candidate') }),
      (error) => error instanceof QuoteEligibilityError,
    );
    assert.equal(await prisma.quote.count(), before);
  });

  test('concurrent sandbox creation stores one server-priced immutable snapshot', async () => {
    const request = await submitRequest('concurrent');
    await completeReview(request.id);
    const input = await quoteInput(request.id, 'concurrent');
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      createQuote({ prisma, ownerUserId: owner, input }),
    ));
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(new Set(results.map((result) => result.quote.id)).size, 1);
    const quote = results[0].quote;
    assert.equal(quote.amountCent, 33000);
    assert.equal(quote.quoteMode, 'sandbox_test');
    assert.equal(quote.sandboxOnly, true);
    assert.equal(quote.deliveryEstimate.status, 'unverified_sandbox');
    assert.equal(new Date(quote.expiresAt).getTime() - new Date(quote.validFrom).getTime(), 7 * 86_400_000);
    await assert.rejects(() => prisma.quote.update({ where: { id: quote.id }, data: { amountCent: 1 } }));
    await assert.rejects(() => prisma.quote.delete({ where: { id: quote.id } }));
    assert.equal((await getQuote({ prisma, ownerUserId: owner, quoteId: quote.id })).id, quote.id);
    await assert.rejects(
      () => getQuote({ prisma, ownerUserId: other, quoteId: quote.id }),
      (error) => error instanceof NotFoundError,
    );
  });

  test('database rejects forged immutable quote ancestry and snapshot columns', async () => {
    const request = await submitRequest('db-guard-source');
    await completeReview(request.id);
    const quote = (await createQuote({
      prisma,
      ownerUserId: owner,
      input: quoteInput(request.id, 'db-guard-source'),
    })).quote;
    const stored = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    await acceptQuote({
      prisma,
      ownerUserId: owner,
      quoteId: quote.id,
      input: { expectedStatus: 'active' },
    });
    const clone = (key, overrides) => ({
      ...stored,
      id: `c2-forged-${key}-${suffix}`,
      idempotencyKey: `c2-forged-idem-${key}-${suffix}`,
      inputFingerprint: `c2-forged-fingerprint-${key}-${suffix}`,
      ...overrides,
    });

    await assert.rejects(() => prisma.quote.create({
      data: clone('owner', { ownerUserId: other }),
    }));

    const otherRequest = await submitRequest('db-guard-other-review');
    const otherReview = await completeReview(otherRequest.id);
    await assert.rejects(() => prisma.quote.create({
      data: clone('review', { checkRunId: otherReview.id }),
    }));

    const sourceJob = await prisma.job.findUniqueOrThrow({ where: { id: readyEstimateJobId } });
    const otherJob = await prisma.job.create({ data: {
      type: 'mesh_analysis',
      ownerUserId: other,
      idempotencyKey: `c2-forged-job-${suffix}`,
      status: 'succeeded',
      input: sourceJob.input,
      resultRef: sourceJob.resultRef,
    } });
    await assert.rejects(() => prisma.quote.create({
      data: clone('job-owner', { estimateJobId: otherJob.id }),
    }));

    await assert.rejects(() => prisma.quote.create({
      data: clone('snapshot', { productCode: 'forged-product' }),
    }));

    await submitRequest('db-guard-successor', request.id);
    await assert.rejects(() => prisma.quote.create({
      data: clone('stale-request', {}),
    }));
  });

  test('application and database share the 0.001 mm geometry tolerance', async () => {
    const withinRequest = await submitRequest('dimensions-within');
    await completeReview(withinRequest.id);
    const withinJob = await cloneReadyEstimate(
      'dimensions-within',
      { x: 120.0005, y: 119.022, z: 53.865 },
    );
    const within = await createQuote({
      prisma,
      ownerUserId: owner,
      input: { ...quoteInput(withinRequest.id, 'dimensions-within'), estimateJobId: withinJob.id },
    });
    assert.equal(within.created, true);

    const outsideRequest = await submitRequest('dimensions-outside');
    await completeReview(outsideRequest.id);
    const outsideJob = await cloneReadyEstimate(
      'dimensions-outside',
      { x: 120.0011, y: 119.022, z: 53.865 },
    );
    await assert.rejects(
      () => createQuote({
        prisma,
        ownerUserId: owner,
        input: { ...quoteInput(outsideRequest.id, 'dimensions-outside'), estimateJobId: outsideJob.id },
      }),
      (error) => error instanceof QuoteEligibilityError,
    );
  });

  test('database recomputes price and rejects a self-consistent forged amount snapshot', async () => {
    const request = await submitRequest('db-price-recompute');
    await completeReview(request.id);
    const quote = (await createQuote({
      prisma,
      ownerUserId: owner,
      input: quoteInput(request.id, 'db-price-recompute'),
    })).quote;
    const stored = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    const targetRequest = await submitRequest('db-price-recompute-target');
    await completeReview(targetRequest.id);
    const [targetRequestRow, targetReviewRow] = await Promise.all([
      prisma.customizationRequest.findUniqueOrThrow({ where: { id: targetRequest.id } }),
      prisma.checkRun.findUniqueOrThrow({ where: { requestId: targetRequest.id } }),
    ]);
    const forgedAmount = stored.amountCent + 10_000;
    await assert.rejects(() => prisma.quote.create({ data: {
      ...stored,
      id: `c2-forged-price-${suffix}`,
      requestId: targetRequestRow.id,
      checkRunId: targetReviewRow.id,
      idempotencyKey: `c2-forged-price-idem-${suffix}`,
      inputFingerprint: `c2-forged-price-fingerprint-${suffix}`,
      inputSnapshot: {
        ...stored.inputSnapshot,
        request: {
          id: targetRequestRow.id,
          sceneConfirmation: targetRequestRow.sceneConfirmation,
          productCode: targetRequestRow.productCode,
          materialName: targetRequestRow.materialName,
          materialVersion: targetRequestRow.materialVersion,
          submittedAt: targetRequestRow.submittedAt.toISOString(),
        },
        review: {
          id: targetReviewRow.id,
          result: 'approved',
          requestSnapshot: targetReviewRow.requestSnapshot,
          checklistVersion: targetReviewRow.checklistVersion,
          ruleVersion: targetReviewRow.ruleVersion,
          completedAt: targetReviewRow.completedAt.toISOString(),
        },
      },
      amountCent: forgedAmount,
      priceBreakdown: {
        ...stored.priceBreakdown,
        amountBeforeRoundingCent: forgedAmount,
        amountCent: forgedAmount,
      },
    } }), (error) => String(error).includes('quote price and delivery snapshots must match persisted pricing facts'));
  });

  test('accept is concurrency-safe and expired quotes cannot be accepted', async () => {
    const acceptedRequest = await submitRequest('accept');
    await completeReview(acceptedRequest.id);
    const active = (await createQuote({ prisma, ownerUserId: owner, input: quoteInput(acceptedRequest.id, 'accept') })).quote;
    const accepted = await Promise.all(Array.from({ length: 10 }, () => acceptQuote({
      prisma, ownerUserId: owner, quoteId: active.id, input: { expectedStatus: 'active' },
    })));
    assert.equal(new Set(accepted.map((quote) => quote.status)).size, 1);
    assert.equal(accepted[0].status, 'accepted');

    const expiredRequest = await submitRequest('expired');
    await completeReview(expiredRequest.id);
    const start = new Date('2026-07-19T00:00:00.000Z');
    const expiring = (await createQuote({
      prisma, ownerUserId: owner, input: quoteInput(expiredRequest.id, 'expired'), now: start,
    })).quote;
    await assert.rejects(
      () => acceptQuote({
        prisma, ownerUserId: owner, quoteId: expiring.id,
        input: { expectedStatus: 'active' }, now: new Date(start.getTime() + 8 * 86_400_000),
      }),
      (error) => error instanceof QuoteConflictError,
    );
    assert.equal((await getQuote({ prisma, ownerUserId: owner, quoteId: expiring.id })).status, 'expired');

    const databaseExpiredRequest = await submitRequest('database-expired-accept');
    await completeReview(databaseExpiredRequest.id);
    const oldStart = new Date('2020-01-01T00:00:00.000Z');
    const databaseExpired = (await createQuote({
      prisma,
      ownerUserId: owner,
      input: quoteInput(databaseExpiredRequest.id, 'database-expired-accept'),
      now: oldStart,
    })).quote;
    await assert.rejects(
      () => prisma.quote.update({
        where: { id: databaseExpired.id },
        data: { status: 'accepted', acceptedAt: new Date(oldStart.getTime() + 86_400_000) },
      }),
      (error) => String(error).includes('invalid quote lifecycle transition'),
    );
    await assert.rejects(
      () => acceptQuote({
        prisma,
        ownerUserId: owner,
        quoteId: databaseExpired.id,
        input: { expectedStatus: 'active' },
        now: new Date(oldStart.getTime() + 86_400_000),
      }),
      (error) => error instanceof QuoteConflictError,
    );

    const timezoneRequest = await submitRequest('database-timezone-accept');
    await completeReview(timezoneRequest.id);
    const databaseNow = new Date();
    const fourHoursBeforeExpiry = new Date(databaseNow.getTime() - (7 * 86_400_000 - 4 * 3_600_000));
    const timezoneQuote = (await createQuote({
      prisma,
      ownerUserId: owner,
      input: quoteInput(timezoneRequest.id, 'database-timezone-accept'),
      now: fourHoursBeforeExpiry,
    })).quote;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Shanghai'");
      await tx.quote.update({
        where: { id: timezoneQuote.id },
        data: { status: 'accepted', acceptedAt: databaseNow },
      });
    });
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: timezoneQuote.id } })).status, 'accepted');
  });

  test('idempotency keys cannot cross-wire fingerprints and POST expires stale matches', async () => {
    const secondRequest = await submitRequest('cross-fingerprint-second');
    await completeReview(secondRequest.id);
    const secondInput = quoteInput(secondRequest.id, 'cross-key-second');
    await createQuote({ prisma, ownerUserId: owner, input: secondInput });
    await assert.rejects(
      () => createQuote({
        prisma,
        ownerUserId: owner,
        input: { ...secondInput, idempotencyKey: `c2-quote-cross-key-alias-${suffix}` },
      }),
      (error) => error instanceof QuoteConflictError,
    );

    const firstRequest = await submitRequest('cross-fingerprint-first');
    await completeReview(firstRequest.id);
    const firstInput = quoteInput(firstRequest.id, 'cross-key-first');
    await createQuote({ prisma, ownerUserId: owner, input: firstInput });
    await assert.rejects(
      () => createQuote({
        prisma,
        ownerUserId: owner,
        input: { ...secondInput, idempotencyKey: firstInput.idempotencyKey },
      }),
      (error) => error instanceof QuoteConflictError,
    );

    const expiringRequest = await submitRequest('post-expiration');
    await completeReview(expiringRequest.id);
    const expiringInput = quoteInput(expiringRequest.id, 'post-expiration');
    const start = new Date('2026-07-19T00:00:00.000Z');
    await createQuote({ prisma, ownerUserId: owner, input: expiringInput, now: start });
    const repeated = await createQuote({
      prisma,
      ownerUserId: owner,
      input: expiringInput,
      now: new Date(start.getTime() + 8 * 86_400_000),
    });
    assert.equal(repeated.created, false);
    assert.equal(repeated.quote.status, 'expired');
  });

  test('idempotency replay returns the original quote after its request is superseded', async () => {
    const request = await submitRequest('replay-superseded-original');
    await completeReview(request.id);
    const input = quoteInput(request.id, 'replay-superseded-original');
    const start = new Date('2026-07-19T00:00:00.000Z');
    const original = await createQuote({ prisma, ownerUserId: owner, input, now: start });
    await submitRequest('replay-superseded-successor', request.id);

    const replayed = await createQuote({
      prisma,
      ownerUserId: owner,
      input,
      now: new Date(start.getTime() + 8 * 86_400_000),
    });
    assert.equal(replayed.created, false);
    assert.equal(replayed.quote.id, original.quote.id);
    assert.equal(replayed.quote.status, 'superseded');
  });

  test('a second estimate for one request returns a domain conflict instead of raw P2002', async () => {
    const request = await submitRequest('one-request-one-quote');
    await completeReview(request.id);
    await createQuote({ prisma, ownerUserId: owner, input: quoteInput(request.id, 'one-request-one-quote') });
    const alternateJob = await cloneReadyEstimate(
      'one-request-one-quote-alternate',
      { x: 120, y: 119.022, z: 53.865 },
    );
    await assert.rejects(
      () => createQuote({
        prisma,
        ownerUserId: owner,
        input: {
          ...quoteInput(request.id, 'one-request-one-quote-alternate'),
          estimateJobId: alternateJob.id,
        },
      }),
      (error) => error instanceof QuoteConflictError,
    );
    assert.equal(await prisma.quote.count({ where: { requestId: request.id } }), 1);
  });

  test('quote creation waits for request cancellation and leaves no quote after commit', async () => {
    const request = await submitRequest('cancel-race');
    await completeReview(request.id);
    const competingPrisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 2 });
    let releaseCancellation;
    const cancellationGate = new Promise((resolve) => { releaseCancellation = resolve; });
    let reportLocked;
    const locked = new Promise((resolve) => { reportLocked = resolve; });
    const cancellation = competingPrisma.$transaction(async (tx) => {
      await tx.customizationRequest.update({
        where: { id: request.id },
        data: { status: 'canceled', canceledAt: new Date() },
      });
      reportLocked();
      await cancellationGate;
    });

    try {
      await locked;
      let createSettled = false;
      const creation = createQuote({
        prisma,
        ownerUserId: owner,
        input: quoteInput(request.id, 'cancel-race'),
      }).finally(() => { createSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(createSettled, false, 'createQuote must wait on the request row lock');
      releaseCancellation();
      await cancellation;
      await assert.rejects(creation, (error) => error instanceof QuoteEligibilityError);
      assert.equal(await prisma.quote.count({ where: { requestId: request.id } }), 0);
    } finally {
      releaseCancellation?.();
      await cancellation.catch(() => {});
      await competingPrisma.$disconnect();
    }
  });

  test('a successor request supersedes the old active quote without history drift', async () => {
    const firstRequest = await submitRequest('version-1');
    await completeReview(firstRequest.id);
    const first = (await createQuote({ prisma, ownerUserId: owner, input: quoteInput(firstRequest.id, 'version-1') })).quote;
    const secondRequest = await submitRequest('version-2', firstRequest.id);
    const immediatelySuperseded = await getQuote({ prisma, ownerUserId: owner, quoteId: first.id });
    assert.equal(immediatelySuperseded.status, 'superseded');
    await assert.rejects(
      () => acceptQuote({ prisma, ownerUserId: owner, quoteId: first.id, input: { expectedStatus: 'active' } }),
      (error) => error instanceof QuoteConflictError,
    );
    await completeReview(secondRequest.id);
    const second = (await createQuote({ prisma, ownerUserId: owner, input: quoteInput(secondRequest.id, 'version-2') })).quote;
    const old = await getQuote({ prisma, ownerUserId: owner, quoteId: first.id });
    assert.equal(old.status, 'superseded');
    assert.equal(old.amountCent, first.amountCent);
    assert.equal(second.supersedesQuoteId, first.id);
    await assert.rejects(
      () => acceptQuote({ prisma, ownerUserId: owner, quoteId: first.id, input: { expectedStatus: 'active' } }),
      (error) => error instanceof QuoteConflictError,
    );
    assert.equal((await listQuotes({ prisma, ownerUserId: owner })).some((quote) => quote.id === second.id), true);
  });
}
