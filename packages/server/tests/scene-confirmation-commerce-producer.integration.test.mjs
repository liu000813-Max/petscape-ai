import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NotFoundError,
  confirmScene,
  createDesignItem,
  createModelConfirmation,
  produceSceneConfirmationCommerceInput,
  saveScene,
} from '../src/application/index.ts';
import { SceneConfirmationCommerceInputSchema } from '../src/contracts/scene-confirmation-commerce.ts';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.CI) throw new Error('CI 缺少 DATABASE_URL：WP-B45-3 producer 集成测试不得静默 skip');
  test('scene-confirmation-commerce-producer.integration.test.mjs skipped: DATABASE_URL not set', (t) => {
    t.skip('需要执行最新 migration 的真实 PostgreSQL');
  });
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 8 });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerUserId = `b45-producer-owner-${suffix}`;
  const otherUserId = `b45-producer-other-${suffix}`;

  async function createConfirmedScene({
    label,
    modelRef,
    sourceBoundsMm,
    uniformScale,
    rotationYRad,
  }) {
    const project = await prisma.project.create({
      data: { ownerUserId, title: `B45 producer ${label}` },
    });
    const designItem = await createDesignItem({
      prisma,
      ownerUserId,
      projectId: project.id,
      input: { name: `Producer target ${label}` },
    });
    const finalBoundsMm = Object.fromEntries(
      Object.entries(sourceBoundsMm).map(([axis, value]) => [axis, value * uniformScale]),
    );
    const modelConfirmation = await createModelConfirmation({
      prisma,
      ownerUserId,
      designItemId: designItem.id,
      input: { modelRef, sourceBoundsMm, uniformScale, finalBoundsMm },
    });
    const targetInstanceId = `target-${label}`;
    const scene = await saveScene({
      prisma,
      ownerUserId,
      projectId: project.id,
      input: {
        expectedRevision: 0,
        draft: {
          schemaVersion: 'scene-draft.v1',
          stage: 'scene_editing',
          projectId: project.id,
          targetDesignItemId: designItem.id,
          targetModelConfirmationId: modelConfirmation.id,
          targetInstanceId,
          cageMm: { width: 900, height: 600, depth: 700 },
          items: [{
            instanceId: targetInstanceId,
            role: 'target',
            modelConfirmationId: modelConfirmation.id,
            modelRef,
            positionMm: { x: 0, y: 0, z: 0 },
            rotationYRad,
            uniformScale,
            sourceBoundsMm,
            finalBoundsMm,
          }],
        },
      },
    });
    const confirmation = await confirmScene({
      prisma,
      ownerUserId,
      input: { sceneId: scene.id, sceneRevision: scene.revision },
    });
    return { project, confirmation, targetInstanceId, finalBoundsMm };
  }

  test.before(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerUserId, name: 'B45 Producer Owner' },
        { id: otherUserId, name: 'B45 Producer Other' },
      ],
    });
  });

  test.after(async () => {
    // Viewer confirmations are append-only, so disposable CI databases retain
    // these namespaced rows until the database itself is removed.
    await prisma.$disconnect();
  });

  test('temporary_catalog confirmation maps to the shared contract as sandbox_only', async () => {
    const modelRef = {
      kind: 'temporary_catalog',
      assetKey: 'cheese-lounge-bed',
      checksum: 'bbc2517c6503485c086d3b9e2987de1c75906426b5318d00e59ef232149d0112',
      quoteEligible: false,
    };
    const fixture = await createConfirmedScene({
      label: 'temporary',
      modelRef,
      sourceBoundsMm: { x: 274.148, y: 100, z: 194.543 },
      uniformScale: 1.25,
      rotationYRad: 0.375,
    });

    const produced = await produceSceneConfirmationCommerceInput({
      prisma,
      ownerUserId,
      sceneConfirmationId: fixture.confirmation.id,
    });

    assert.deepEqual(SceneConfirmationCommerceInputSchema.parse(produced), produced);
    assert.equal(produced.schemaVersion, 'scene-confirmation-commerce.v0');
    assert.equal(produced.sceneConfirmationId, fixture.confirmation.id);
    assert.equal(produced.projectId, fixture.project.id);
    assert.equal(produced.targetInstanceId, fixture.targetInstanceId);
    assert.deepEqual(produced.assetRef, {
      kind: 'temporary_catalog',
      assetKey: modelRef.assetKey,
      sha256: modelRef.checksum,
    });
    assert.deepEqual(produced.dimensionsMm, fixture.finalBoundsMm);
    assert.equal(produced.rotationYRad, 0.375);
    assert.equal(produced.uniformScale, 1.25);
    assert.equal(produced.confirmedAt, fixture.confirmation.confirmedAt);
    assert.equal(produced.source, 'viewer_scene_confirmation');
    assert.equal(produced.eligibility, 'sandbox_only');
  });

  test('owned_asset confirmation maps immutable asset id/checksum as formal_candidate', async () => {
    const project = await prisma.project.create({
      data: { ownerUserId, title: 'B45 producer owned asset staging' },
    });
    const asset = await prisma.asset.create({
      data: {
        ownerUserId,
        projectId: project.id,
        kind: 'model_glb',
        mime: 'model/gltf-binary',
        size: 1024,
        checksum: 'd'.repeat(64),
        ossKey: `viewer/${suffix}/owned-target.glb`,
        status: 'available',
      },
    });
    const designItem = await createDesignItem({
      prisma,
      ownerUserId,
      projectId: project.id,
      input: { name: 'Owned target' },
    });
    const modelRef = {
      kind: 'owned_asset',
      assetId: asset.id,
      checksum: asset.checksum,
      quoteEligible: true,
    };
    const sourceBoundsMm = { x: 160, y: 80, z: 120 };
    const modelConfirmation = await createModelConfirmation({
      prisma,
      ownerUserId,
      designItemId: designItem.id,
      input: { modelRef, sourceBoundsMm, uniformScale: 1.5, finalBoundsMm: { x: 240, y: 120, z: 180 } },
    });
    const targetInstanceId = 'target-owned';
    const scene = await saveScene({
      prisma,
      ownerUserId,
      projectId: project.id,
      input: {
        expectedRevision: 0,
        draft: {
          schemaVersion: 'scene-draft.v1',
          stage: 'scene_editing',
          projectId: project.id,
          targetDesignItemId: designItem.id,
          targetModelConfirmationId: modelConfirmation.id,
          targetInstanceId,
          cageMm: { width: 900, height: 600, depth: 700 },
          items: [{
            instanceId: targetInstanceId,
            role: 'target',
            modelConfirmationId: modelConfirmation.id,
            modelRef,
            positionMm: { x: 0, y: 0, z: 0 },
            rotationYRad: -0.5,
            uniformScale: 1.5,
            sourceBoundsMm,
            finalBoundsMm: { x: 240, y: 120, z: 180 },
          }],
        },
      },
    });
    const confirmation = await confirmScene({
      prisma,
      ownerUserId,
      input: { sceneId: scene.id, sceneRevision: scene.revision },
    });

    const produced = await produceSceneConfirmationCommerceInput({
      prisma,
      ownerUserId,
      sceneConfirmationId: confirmation.id,
    });

    assert.deepEqual(SceneConfirmationCommerceInputSchema.parse(produced), produced);
    assert.deepEqual(produced.assetRef, {
      kind: 'owned_asset',
      assetId: asset.id,
      sha256: asset.checksum,
    });
    assert.deepEqual(produced.dimensionsMm, { x: 240, y: 120, z: 180 });
    assert.equal(produced.rotationYRad, -0.5);
    assert.equal(produced.uniformScale, 1.5);
    assert.equal(produced.eligibility, 'formal_candidate');
  });

  test('producer fails closed for unknown ids and another owner\'s immutable confirmation', async () => {
    const fixture = await createConfirmedScene({
      label: 'owner-boundary',
      modelRef: {
        kind: 'temporary_catalog',
        assetKey: 'cheese-lounge-bed',
        checksum: 'bbc2517c6503485c086d3b9e2987de1c75906426b5318d00e59ef232149d0112',
        quoteEligible: false,
      },
      sourceBoundsMm: { x: 274.148, y: 100, z: 194.543 },
      uniformScale: 1,
      rotationYRad: 0,
    });

    await assert.rejects(
      () => produceSceneConfirmationCommerceInput({
        prisma,
        ownerUserId: otherUserId,
        sceneConfirmationId: fixture.confirmation.id,
      }),
      (error) => error instanceof NotFoundError,
    );
    await assert.rejects(
      () => produceSceneConfirmationCommerceInput({
        prisma,
        ownerUserId,
        sceneConfirmationId: `unknown-${suffix}`,
      }),
      (error) => error instanceof NotFoundError,
    );
  });
}
