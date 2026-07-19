import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：Viewer 持久化集成测试不得静默 skip');
  test('scenes-persistence.integration.test.mjs skipped: DATABASE_URL not set', (t) => {
    t.skip('需要执行最新 migration 的真实 PostgreSQL');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const {
    RevisionConflictError,
    createDesignItem,
    createModelConfirmation,
    getSceneConfirmation,
    getSceneForProject,
    saveScene,
    confirmScene,
    NotFoundError,
  } = await import('../src/application/index.ts');

  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 12 });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerUserId = `viewer-owner-${suffix}`;
  const otherUserId = `viewer-other-${suffix}`;
  const checksum = 'ad7ff9f2b6e2f53ab0908dee9caa58e23f22b7319962bd57931b991bd56d61b5';
  const sourceBoundsMm = { x: 274.148, y: 100, z: 194.543 };
  const temporaryModel = {
    kind: 'temporary_catalog',
    assetKey: 'cheese-lounge-bed',
    checksum,
    quoteEligible: false,
  };
  let project;
  let otherProject;
  let designItem;
  let modelConfirmation;

  function sceneDraft(overrides = {}) {
    return {
      schemaVersion: 'scene-draft.v1',
      stage: 'scene_editing',
      projectId: project.id,
      targetDesignItemId: designItem.id,
      targetModelConfirmationId: modelConfirmation.id,
      targetInstanceId: 'target-primary',
      cageMm: { width: 800, height: 500, depth: 500 },
      items: [{
        instanceId: 'target-primary',
        role: 'target',
        modelConfirmationId: modelConfirmation.id,
        modelRef: temporaryModel,
        positionMm: { x: 0, y: 0, z: 0 },
        rotationYRad: 0,
        uniformScale: 1,
        sourceBoundsMm,
        finalBoundsMm: sourceBoundsMm,
      }],
      ...overrides,
    };
  }

  async function createSceneFixture(label, fixtureOwnerUserId = ownerUserId) {
    const fixtureProject = await prisma.project.create({
      data: { ownerUserId: fixtureOwnerUserId, title: `Viewer guard ${label}` },
    });
    const fixtureDesignItem = await createDesignItem({
      prisma,
      ownerUserId: fixtureOwnerUserId,
      projectId: fixtureProject.id,
      input: { name: `Guard item ${label}` },
    });
    const fixtureModelConfirmation = await createModelConfirmation({
      prisma,
      ownerUserId: fixtureOwnerUserId,
      designItemId: fixtureDesignItem.id,
      input: { modelRef: temporaryModel, sourceBoundsMm, uniformScale: 1, finalBoundsMm: sourceBoundsMm },
    });
    const targetInstanceId = `target-${label}`;
    const fixtureScene = await saveScene({
      prisma,
      ownerUserId: fixtureOwnerUserId,
      projectId: fixtureProject.id,
      input: {
        expectedRevision: 0,
        draft: {
          schemaVersion: 'scene-draft.v1',
          stage: 'scene_editing',
          projectId: fixtureProject.id,
          targetDesignItemId: fixtureDesignItem.id,
          targetModelConfirmationId: fixtureModelConfirmation.id,
          targetInstanceId,
          cageMm: { width: 800, height: 500, depth: 500 },
          items: [{
            instanceId: targetInstanceId,
            role: 'target',
            modelConfirmationId: fixtureModelConfirmation.id,
            modelRef: temporaryModel,
            positionMm: { x: 0, y: 0, z: 0 },
            rotationYRad: 0,
            uniformScale: 1,
            sourceBoundsMm,
            finalBoundsMm: sourceBoundsMm,
          }],
        },
      },
    });
    return {
      project: fixtureProject,
      designItem: fixtureDesignItem,
      modelConfirmation: fixtureModelConfirmation,
      scene: fixtureScene,
    };
  }

  function directConfirmationData(fixture, overrides = {}) {
    const confirmedAt = new Date();
    const columns = {
      sceneId: fixture.scene.id,
      sceneRevision: fixture.scene.revision,
      targetDesignItemId: fixture.designItem.id,
      targetModelConfirmationId: fixture.modelConfirmation.id,
      targetInstanceId: fixture.scene.draft.targetInstanceId,
      confirmedByUserId: fixture.project.ownerUserId,
      ...overrides,
    };
    return {
      ...columns,
      snapshotSchemaVersion: 'scene-confirmation.v1',
      confirmedAt,
      snapshot: {
        ...fixture.scene.draft,
        schemaVersion: 'scene-confirmation.v1',
        sceneId: columns.sceneId,
        sceneRevision: columns.sceneRevision,
        targetDesignItemId: columns.targetDesignItemId,
        targetModelConfirmationId: columns.targetModelConfirmationId,
        targetInstanceId: columns.targetInstanceId,
        confirmedAt: confirmedAt.toISOString(),
      },
    };
  }

  test.before(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerUserId, name: 'Viewer Owner' },
      { id: otherUserId, name: 'Viewer Other' },
    ] });
    project = await prisma.project.create({ data: { ownerUserId, title: 'Viewer Project' } });
    otherProject = await prisma.project.create({ data: { ownerUserId: otherUserId, title: 'Other Project' } });
    designItem = await createDesignItem({ prisma, ownerUserId, projectId: project.id, input: { name: '奶酪躺椅' } });
    modelConfirmation = await createModelConfirmation({
      prisma,
      ownerUserId,
      designItemId: designItem.id,
      input: { modelRef: temporaryModel, sourceBoundsMm, uniformScale: 1, finalBoundsMm: sourceBoundsMm },
    });
  });

  test.after(async () => {
    // Confirmation rows are deliberately undeletable at the database layer.
    // CI uses a disposable database; real-RDS runs retain namespaced evidence rows.
    await prisma.$disconnect();
  });

  test('temporary catalog creates an immutable sandbox model confirmation and advances current work pointer', async () => {
    assert.equal(modelConfirmation.modelRef.kind, 'temporary_catalog');
    assert.equal(modelConfirmation.modelRef.quoteEligible, false);
    assert.equal(modelConfirmation.modelRef.checksum, checksum);
    const row = await prisma.designItem.findUniqueOrThrow({ where: { id: designItem.id } });
    assert.equal(row.currentModelConfirmationId, modelConfirmation.id);
    await assert.rejects(() => prisma.modelConfirmation.update({
      where: { id: modelConfirmation.id },
      data: { uniformScale: 1.1 },
    }));
    await assert.rejects(() => prisma.modelConfirmation.delete({ where: { id: modelConfirmation.id } }));
    await assert.rejects(
      () => createModelConfirmation({ prisma, ownerUserId, designItemId: designItem.id, input: {
        modelRef: { ...temporaryModel, assetKey: 'forged-catalog-item' },
        sourceBoundsMm,
        uniformScale: 1,
        finalBoundsMm: sourceBoundsMm,
      } }),
      (error) => error instanceof NotFoundError,
    );
  });

  test('database rejects a current ModelConfirmation pointer owned by another DesignItem', async () => {
    const left = await createSceneFixture('pointer-left');
    const right = await createSceneFixture('pointer-right');
    await prisma.designItem.update({
      where: { id: right.designItem.id },
      data: { currentModelConfirmationId: null },
    });
    await assert.rejects(() => prisma.designItem.update({
      where: { id: left.designItem.id },
      data: { currentModelConfirmationId: right.modelConfirmation.id },
    }));
  });

  test('database rejects immutable SceneConfirmation rows that drift from the locked parent aggregate', async () => {
    const wrongRevision = await createSceneFixture('wrong-revision');
    const wrongTarget = await createSceneFixture('wrong-target');
    const foreignTarget = await createSceneFixture('foreign-target', otherUserId);
    const wrongInstance = await createSceneFixture('wrong-instance');
    const wrongConfirmer = await createSceneFixture('wrong-confirmer');
    const wrongSnapshotProject = await createSceneFixture('wrong-snapshot-project');
    const cases = [
      directConfirmationData(wrongRevision, { sceneRevision: wrongRevision.scene.revision + 1 }),
      directConfirmationData(wrongTarget, {
        targetDesignItemId: foreignTarget.designItem.id,
        targetModelConfirmationId: foreignTarget.modelConfirmation.id,
      }),
      directConfirmationData(wrongInstance, { targetInstanceId: 'wrong-target-instance' }),
      directConfirmationData(wrongConfirmer, { confirmedByUserId: otherUserId }),
      {
        ...directConfirmationData(wrongSnapshotProject),
        snapshot: {
          ...directConfirmationData(wrongSnapshotProject).snapshot,
          projectId: otherProject.id,
        },
      },
    ];
    const attempts = await Promise.allSettled(cases.map((data) => prisma.sceneConfirmation.create({ data })));
    assert.equal(
      attempts.filter((attempt) => attempt.status === 'rejected').length,
      cases.length,
      attempts.map((attempt) => attempt.status === 'fulfilled' ? `unexpected insert:${attempt.value.id}` : 'rejected').join('\n'),
    );
  });

  test('owned asset requires SHA-256 and same owner/project; cross-project injection is hidden as 404', async () => {
    const validAsset = await prisma.asset.create({ data: {
      ownerUserId,
      projectId: project.id,
      kind: 'model_glb',
      mime: 'model/gltf-binary',
      size: 123,
      checksum: 'b'.repeat(64),
      ossKey: `viewer/${suffix}/valid.glb`,
      status: 'available',
    } });
    const blankChecksumAsset = await prisma.asset.create({ data: {
      ownerUserId,
      projectId: project.id,
      kind: 'model_glb',
      mime: 'model/gltf-binary',
      size: 123,
      checksum: null,
      ossKey: `viewer/${suffix}/blank.glb`,
      status: 'available',
    } });
    const foreignAsset = await prisma.asset.create({ data: {
      ownerUserId: otherUserId,
      projectId: otherProject.id,
      kind: 'model_glb',
      mime: 'model/gltf-binary',
      size: 123,
      checksum: 'c'.repeat(64),
      ossKey: `viewer/${suffix}/foreign.glb`,
      status: 'available',
    } });
    const validInput = {
      modelRef: { kind: 'owned_asset', assetId: validAsset.id, checksum: validAsset.checksum, quoteEligible: true },
      sourceBoundsMm,
      uniformScale: 1,
      finalBoundsMm: sourceBoundsMm,
    };
    assert.equal((await createModelConfirmation({ prisma, ownerUserId, designItemId: designItem.id, input: validInput })).modelRef.assetId, validAsset.id);
    await assert.rejects(
      () => createModelConfirmation({ prisma, ownerUserId, designItemId: designItem.id, input: {
        ...validInput,
        modelRef: { ...validInput.modelRef, assetId: blankChecksumAsset.id, checksum: 'd'.repeat(64) },
      } }),
      (error) => error instanceof NotFoundError,
    );
    await assert.rejects(
      () => createModelConfirmation({ prisma, ownerUserId, designItemId: designItem.id, input: {
        ...validInput,
        modelRef: { ...validInput.modelRef, assetId: foreignAsset.id, checksum: foreignAsset.checksum },
      } }),
      (error) => error instanceof NotFoundError,
    );
  });

  test('one Scene per Project, CAS revision increments and stale saves return structured conflict', async () => {
    const first = await saveScene({ prisma, ownerUserId, projectId: project.id, input: { expectedRevision: 0, draft: sceneDraft() } });
    assert.equal(first.revision, 1);
    assert.equal((await getSceneForProject({ prisma, ownerUserId, projectId: project.id })).id, first.id);
    const second = await saveScene({
      prisma,
      ownerUserId,
      projectId: project.id,
      input: { expectedRevision: 1, draft: sceneDraft({ cageMm: { width: 900, height: 500, depth: 500 } }) },
    });
    assert.equal(second.id, first.id);
    assert.equal(second.revision, 2);
    const noOp = await saveScene({
      prisma,
      ownerUserId,
      projectId: project.id,
      input: {
        expectedRevision: second.revision,
        draft: sceneDraft({ cageMm: { width: 900, height: 500, depth: 500 } }),
      },
    });
    assert.equal(noOp.id, second.id);
    assert.equal(noOp.revision, second.revision);
    await assert.rejects(
      () => saveScene({ prisma, ownerUserId, projectId: project.id, input: { expectedRevision: 1, draft: sceneDraft() } }),
      (error) => error instanceof RevisionConflictError && error.expectedRevision === 1 && error.currentRevision === 2,
    );
    assert.equal(await prisma.scene.count({ where: { projectId: project.id } }), 1);
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => saveScene({
      prisma,
      ownerUserId,
      projectId: project.id,
      input: { expectedRevision: second.revision, draft: sceneDraft({ cageMm: { width: 901 + index, height: 500, depth: 500 } }) },
    })));
    assert.equal(
      attempts.filter((attempt) => attempt.status === 'fulfilled').length,
      1,
      attempts.map((attempt) => attempt.status === 'rejected' ? `${attempt.reason?.name}:${attempt.reason?.message}` : 'fulfilled').join('\n'),
    );
    assert.equal(attempts.filter((attempt) => attempt.status === 'rejected' && attempt.reason instanceof RevisionConflictError).length, 9);
    assert.equal((await getSceneForProject({ prisma, ownerUserId, projectId: project.id })).revision, 3);
    await assert.rejects(() => prisma.scene.update({
      where: { id: second.id },
      data: { cageMm: { width: 910, height: 500, depth: 500 }, revision: { increment: 2 } },
    }));
  });

  test('same revision confirmation is idempotent; later revision creates history and old snapshot is immutable', async () => {
    const scene = await getSceneForProject({ prisma, ownerUserId, projectId: project.id });
    const repeatedResults = await Promise.all(Array.from({ length: 10 }, () =>
      confirmScene({ prisma, ownerUserId, input: { sceneId: scene.id, sceneRevision: scene.revision } })
    ));
    const first = repeatedResults[0];
    assert.equal(new Set(repeatedResults.map((confirmation) => confirmation.id)).size, 1);
    assert.equal(await prisma.sceneConfirmation.count({ where: { sceneId: scene.id, sceneRevision: scene.revision } }), 1);

    const changed = await saveScene({
      prisma,
      ownerUserId,
      projectId: project.id,
      input: { expectedRevision: scene.revision, draft: sceneDraft({ cageMm: { width: 950, height: 500, depth: 500 } }) },
    });
    const second = await confirmScene({ prisma, ownerUserId, input: { sceneId: changed.id, sceneRevision: changed.revision } });
    assert.notEqual(second.id, first.id);
    assert.equal((await getSceneConfirmation({ prisma, ownerUserId, sceneConfirmationId: first.id })).snapshot.cageMm.width, scene.draft.cageMm.width);
    assert.equal((await getSceneConfirmation({ prisma, ownerUserId, sceneConfirmationId: second.id })).snapshot.cageMm.width, 950);
    await assert.rejects(() => prisma.sceneConfirmation.update({ where: { id: first.id }, data: { sceneRevision: 999 } }));
    await assert.rejects(() => prisma.sceneConfirmation.delete({ where: { id: first.id } }));
  });

  test('other owners receive 404 for design item, scene save/confirm and confirmation read', async () => {
    const scene = await getSceneForProject({ prisma, ownerUserId, projectId: project.id });
    await assert.rejects(
      () => createModelConfirmation({ prisma, ownerUserId: otherUserId, designItemId: designItem.id, input: {
        modelRef: temporaryModel, sourceBoundsMm, uniformScale: 1, finalBoundsMm: sourceBoundsMm,
      } }),
      (error) => error instanceof NotFoundError,
    );
    await assert.rejects(
      () => getSceneForProject({ prisma, ownerUserId: otherUserId, projectId: project.id }),
      (error) => error instanceof NotFoundError,
    );
    await assert.rejects(
      () => confirmScene({ prisma, ownerUserId: otherUserId, input: { sceneId: scene.id, sceneRevision: scene.revision } }),
      (error) => error instanceof NotFoundError,
    );
    const confirmation = await prisma.sceneConfirmation.findFirstOrThrow({ where: { sceneId: scene.id } });
    await assert.rejects(
      () => getSceneConfirmation({ prisma, ownerUserId: otherUserId, sceneConfirmationId: confirmation.id }),
      (error) => error instanceof NotFoundError,
    );
  });
}
