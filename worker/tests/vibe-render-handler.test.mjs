// worker/tests/vibe-render-handler.test.mjs —— WP-G3 vibe_render handler 行为测试。
// spec: docs/plans/g-line-execution-plan.md WP-G3（handler 中断可恢复、幂等——同
//   idempotencyKey 不重复扣费调用；失败 errorClass 语义）+ ADR-0006（断连仍扣费 →
//   幂等重试为 ADR 级约束）。
//
// 真实 DB（PG16，一次性容器或隧道）+ 内存 fake OSS + spy provider（零外部调用、
// 可注入失败）。无 DATABASE_URL 显式失败，不静默 skip（同 packages/server 集成测试口径）。
import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL 未设置：vibe-render-handler 测试需要一个已 migrate deploy 的 Postgres（本地容器或 SSH 隧道），不静默 skip。',
  );
}

const { createPrismaClient, createFixtureVibeRenderProvider } = await import('@petscape/server/worker-api');
const { createVibeRenderJob, getLatestVibeRender, NotFoundError } = await import('@petscape/server/application');
const { claimNextJob, completeJob, shutdownJobs } = await import('@petscape/server/worker-api');
const { vibeRenderHandler } = await import('../src/handlers/vibeRender.ts');
const { RetryableError } = await import('../src/handlers/types.ts');
const { YunwuPermanentError } = await import('@petscape/server/worker-api');

const runId = `g3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const prisma = createPrismaClient({ connectionString: databaseUrl, poolMax: 5 });

// 内存 fake OSS：只需 put / head / getVerifiedBuffer 三个 handler 触及的方法。
function makeFakeOss() {
  const store = new Map(); // key → Buffer
  return {
    store,
    async put(key, content) {
      store.set(key, Buffer.isBuffer(content) ? content : Buffer.from(content));
    },
    async head(key) {
      const buf = store.get(key);
      if (!buf) return { exists: false };
      return { exists: true, size: buf.length, etag: `"etag-${buf.length}"` };
    },
    async getVerifiedBuffer({ key }) {
      const buf = store.get(key);
      if (!buf) throw new Error(`fake oss: no object ${key}`);
      return buf;
    },
  };
}

// spy provider：记调用次数；可注入返回或抛错。
function makeSpyProvider(behavior = {}) {
  const calls = [];
  return {
    calls,
    async generate(input) {
      calls.push(input);
      if (behavior.throw) throw behavior.throw;
      return behavior.result ?? {
        imageBytes: Buffer.from('PNGBYTES-REAL'),
        mime: 'image/png',
        engine: 'spy-engine',
      };
    },
  };
}

// 认领指定 jobId：claimNextJob 按 type+createdAt 认领任意最早 pending 任务，本测试
// 文件里多个 test 会留下 pending vibe_render 任务（t2i/最新行等不认领的 test），
// 直接 claimNextJob 可能认领到别的 test 的任务。此 helper 循环认领直到拿到目标
// jobId，途中认领到的他人任务立即释放租约（改回 pending）供其原 test 或后续认领。
async function claimJobById(targetJobId, workerId) {
  const others = [];
  try {
    for (let i = 0; i < 50; i += 1) {
      const claimed = await claimNextJob({ workerId, types: ['vibe_render'], leaseSeconds: 30 });
      if (!claimed) return null;
      if (claimed.id === targetJobId) return claimed;
      others.push(claimed.id);
    }
    return null;
  } finally {
    // 释放途中误认领的他人任务：租约清空 + 回 pending，attemptCount 保持（不影响正确性）。
    if (others.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: others } },
        data: { status: 'pending', leaseOwner: null, leaseExpiresAt: null },
      });
    }
  }
}

async function createUser(label) {
  const id = `${runId}-${label}`;
  return prisma.user.create({ data: { id, name: `g3-${label}` } });
}

const createdUserIds = [];
test.after(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
  await shutdownJobs().catch(() => {});
});

test('fixture provider 跑通 3a 链：建项目→上传 Asset→createVibeRenderJob→claim→handler→completeJob', async () => {
  const user = await createUser('chain');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 3a-chain' } });

  // 上传段：available 环境照 Asset（模拟 G2 三段式上传完成）。
  const envAsset = await prisma.asset.create({
    data: { ownerUserId: user.id, projectId: project.id, kind: 'upload_raw', mime: 'image/png', size: 64, ossKey: `uploads/raw/${user.id}/${runId}-chain-env/e.png`, status: 'available' },
  });

  // 建 vibe_render 任务（application 用例，含项目/资产归属校验）。
  const { jobId, created } = await createVibeRenderJob({
    prisma,
    ownerUserId: user.id,
    input: { projectId: project.id, vibeText: '森林奶酪屋', environmentAssetId: envAsset.id },
    idempotencyKey: `chain-${runId}`,
  });
  assert.equal(created, true);

  // worker 认领（vibe_render 类型）。
  const claimed = await claimJobById(jobId, 'chain-w');
  assert.equal(claimed?.id, jobId, '应认领到刚建的 vibe_render 任务');

  // fixture provider 执行 handler（零外部调用），产物落 fake OSS。
  const oss = makeFakeOss();
  await oss.put(envAsset.ossKey, Buffer.from('X'.repeat(64)));
  const provider = createFixtureVibeRenderProvider();
  const resultRef = await vibeRenderHandler(
    { id: claimed.id, ownerUserId: claimed.ownerUserId, input: claimed.input },
    { workerId: 'chain-w', reportProgress: () => {}, server: { prisma, oss, meshAnalyzerPythonBin: 'python3', vibeRenderProvider: provider } },
  );
  assert.equal(provider.callCount, 1);
  assert.equal(resultRef.engine, 'fixture');

  // 完成任务，产物 generated_render Asset 可查。
  const outcome = await completeJob({ jobId: claimed.id, workerId: 'chain-w', targetVersion: claimed.targetVersion, resultRef });
  assert.equal(outcome, 'completed');
  const asset = await prisma.asset.findUnique({ where: { id: resultRef.assetId } });
  assert.equal(asset.kind, 'generated_render');
  assert.equal(asset.status, 'available');
});

test('产出 generated_render Asset（owned，kind/mime/size/ossKey 正确）', async () => {
  const user = await createUser('happy');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 happy' } });

  const oss = makeFakeOss();
  const provider = makeSpyProvider();
  const job = { id: `${runId}-job-happy`, ownerUserId: user.id, input: { projectId: project.id, vibeText: '森林奶酪屋' } };

  const resultRef = await vibeRenderHandler(job, {
    workerId: 'w1',
    reportProgress: () => {},
    server: { prisma, oss, meshAnalyzerPythonBin: 'python3', vibeRenderProvider: provider },
  });

  assert.equal(provider.calls.length, 1, '首跑应调用 provider 一次');
  assert.equal(resultRef.engine, 'spy-engine');
  const asset = await prisma.asset.findUnique({ where: { id: resultRef.assetId } });
  assert.equal(asset.kind, 'generated_render');
  assert.equal(asset.ownerUserId, user.id);
  assert.equal(asset.projectId, project.id);
  assert.equal(asset.status, 'available');
  assert.match(asset.ossKey, new RegExp(`uploads/generated/${user.id}/${job.id}/render\\.png`));
  assert.ok(oss.store.get(asset.ossKey).length > 0, 'OSS 应有产物字节');
});

test('幂等/中断恢复：产物已落地后重跑同一 job 不再调用 provider（不重复扣费）', async () => {
  const user = await createUser('idem');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 idem' } });

  const oss = makeFakeOss();
  const provider = makeSpyProvider();
  const job = { id: `${runId}-job-idem`, ownerUserId: user.id, input: { projectId: project.id, vibeText: '森林奶酪屋' } };
  const ctx = { workerId: 'w1', reportProgress: () => {}, server: { prisma, oss, meshAnalyzerPythonBin: 'python3', vibeRenderProvider: provider } };

  const first = await vibeRenderHandler(job, ctx);
  assert.equal(provider.calls.length, 1);

  // 模拟 worker 在 completeJob 之前中断：同一 job 被重新认领后再次执行 handler。
  const second = await vibeRenderHandler(job, ctx);
  assert.equal(provider.calls.length, 1, '重跑不得再次调用 provider（断连仍扣费的对策：任务级幂等复用已落地产物）');
  assert.equal(second.assetId, first.assetId, '重跑应复用同一产物 Asset，不产生第二个');

  const assetsForJob = await prisma.asset.findMany({ where: { ownerUserId: user.id, ossKey: { contains: job.id } } });
  assert.equal(assetsForJob.length, 1, '同一 jobId 只应有一个 generated_render Asset');
});

test('幂等键透传：provider 收到的 idempotencyKey = job.id（断连重试用同一 key）', async () => {
  const user = await createUser('idemkey');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 idemkey' } });
  const oss = makeFakeOss();
  const provider = makeSpyProvider();
  const job = { id: `${runId}-job-idemkey`, ownerUserId: user.id, input: { projectId: project.id, vibeText: '森林奶酪屋' } };
  await vibeRenderHandler(job, { workerId: 'w1', reportProgress: () => {}, server: { prisma, oss, meshAnalyzerPythonBin: 'python3', vibeRenderProvider: provider } });
  assert.equal(provider.calls[0].idempotencyKey, job.id);
});

test('errorClass 语义：provider 永久错误（无图/4xx）→ 非 RetryableError（main.ts 归 permanent）', async () => {
  const user = await createUser('perm');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 perm' } });
  const oss = makeFakeOss();
  const provider = makeSpyProvider({ throw: new YunwuPermanentError('云雾返回内容不含图片') });
  const job = { id: `${runId}-job-perm`, ownerUserId: user.id, input: { projectId: project.id, vibeText: '森林奶酪屋' } };

  await assert.rejects(
    () => vibeRenderHandler(job, { workerId: 'w1', reportProgress: () => {}, server: { prisma, oss, meshAnalyzerPythonBin: 'python3', vibeRenderProvider: provider } }),
    (err) => {
      assert.equal(err instanceof RetryableError, false, '永久错误不应是 RetryableError');
      assert.ok(err instanceof YunwuPermanentError);
      return true;
    },
  );
  // 未产出 Asset。
  const assets = await prisma.asset.findMany({ where: { ownerUserId: user.id, ossKey: { contains: job.id } } });
  assert.equal(assets.length, 0);
});

test('errorClass 语义：参考图 OSS 暂时不可用 → RetryableError（main.ts 归 retryable）', async () => {
  const user = await createUser('retry');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 retry' } });

  // 建一个 available 的环境照 Asset，但 fake OSS 里没有对应对象（head 返回 exists:false）。
  const envAsset = await prisma.asset.create({
    data: { ownerUserId: user.id, projectId: project.id, kind: 'upload_raw', mime: 'image/png', size: 100, ossKey: `uploads/raw/${user.id}/${runId}-env/pic.png`, status: 'available' },
  });
  const oss = makeFakeOss(); // 空 store：head(envAsset.ossKey) → exists:false
  const provider = makeSpyProvider();
  const job = { id: `${runId}-job-retry`, ownerUserId: user.id, input: { projectId: project.id, vibeText: '森林奶酪屋', environmentAssetId: envAsset.id } };

  await assert.rejects(
    () => vibeRenderHandler(job, { workerId: 'w1', reportProgress: () => {}, server: { prisma, oss, meshAnalyzerPythonBin: 'python3', vibeRenderProvider: provider } }),
    RetryableError,
    'OSS 对象暂时不可用应抛 RetryableError',
  );
  assert.equal(provider.calls.length, 0, 'OSS 读参考图失败时不应已调用 provider（不烧钱）');
});

test('越权参考图：引用他人/跨项目 Asset → 非 RetryableError（permanent）', async () => {
  const owner = await createUser('own');
  const attacker = await createUser('atk');
  createdUserIds.push(owner.id, attacker.id);
  const ownerProject = await prisma.project.create({ data: { ownerUserId: owner.id, title: 'g3 owner' } });
  const attackerProject = await prisma.project.create({ data: { ownerUserId: attacker.id, title: 'g3 atk' } });

  // owner 的 Asset。
  const ownerAsset = await prisma.asset.create({
    data: { ownerUserId: owner.id, projectId: ownerProject.id, kind: 'upload_raw', mime: 'image/png', size: 100, ossKey: `uploads/raw/${owner.id}/${runId}-x/pic.png`, status: 'available' },
  });
  const oss = makeFakeOss();
  await oss.put(ownerAsset.ossKey, Buffer.from('X'.repeat(100)));
  const provider = makeSpyProvider();
  // attacker 的 job 引用 owner 的 Asset。
  const job = { id: `${runId}-job-atk`, ownerUserId: attacker.id, input: { projectId: attackerProject.id, vibeText: '偷图', environmentAssetId: ownerAsset.id } };

  await assert.rejects(
    () => vibeRenderHandler(job, { workerId: 'w1', reportProgress: () => {}, server: { prisma, oss, meshAnalyzerPythonBin: 'python3', vibeRenderProvider: provider } }),
    (err) => {
      assert.equal(err instanceof RetryableError, false, '越权引用应是 permanent，不重试');
      return true;
    },
  );
  assert.equal(provider.calls.length, 0);
});

test('照片真实入图：环境照 + 宠物照字节被读出并传给 provider 作参考图', async () => {
  const user = await createUser('refs');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 refs' } });
  const oss = makeFakeOss();

  const envBytes = Buffer.from('ENV-PHOTO-BYTES');
  const petBytes = Buffer.from('PET-PHOTO-BYTES');
  const envAsset = await prisma.asset.create({ data: { ownerUserId: user.id, projectId: project.id, kind: 'upload_raw', mime: 'image/png', size: envBytes.length, ossKey: `uploads/raw/${user.id}/${runId}-refs-env/e.png`, status: 'available' } });
  const petAsset = await prisma.asset.create({ data: { ownerUserId: user.id, projectId: project.id, kind: 'upload_raw', mime: 'image/jpeg', size: petBytes.length, ossKey: `uploads/raw/${user.id}/${runId}-refs-pet/p.jpg`, status: 'available' } });
  await oss.put(envAsset.ossKey, envBytes);
  await oss.put(petAsset.ossKey, petBytes);

  const provider = makeSpyProvider();
  const job = { id: `${runId}-job-refs`, ownerUserId: user.id, input: { projectId: project.id, vibeText: '森林奶酪屋', environmentAssetId: envAsset.id, petAssetId: petAsset.id } };
  await vibeRenderHandler(job, { workerId: 'w1', reportProgress: () => {}, server: { prisma, oss, meshAnalyzerPythonBin: 'python3', vibeRenderProvider: provider } });

  const passed = provider.calls[0].references;
  assert.equal(passed.length, 2, '两张照片都应作为参考图传入 provider（照片真实入图）');
  assert.deepEqual(passed[0].bytes, envBytes);
  assert.deepEqual(passed[1].bytes, petBytes);
  assert.match(provider.calls[0].prompt, /不改变原笼箱结构/, '有环境照 → i2i 保结构 prompt');
});

// ── QA 修复：RenderSection「改造前=用户环境照」——getLatestVibeRender 展示态 ──────

test('getLatestVibeRender：有环境照的 job 成功后返回 environmentAssetId + 产物 renderAssetId（改造前=用户环境照）', async () => {
  const user = await createUser('latest-env');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 latest-env' } });
  const oss = makeFakeOss();
  const envAsset = await prisma.asset.create({ data: { ownerUserId: user.id, projectId: project.id, kind: 'upload_raw', mime: 'image/png', size: 64, ossKey: `uploads/raw/${user.id}/${runId}-lenv/e.png`, status: 'available' } });
  await oss.put(envAsset.ossKey, Buffer.from('X'.repeat(64)));

  const { jobId } = await createVibeRenderJob({
    prisma, ownerUserId: user.id,
    input: { projectId: project.id, vibeText: '森林奶酪屋', environmentAssetId: envAsset.id },
    idempotencyKey: `latest-env-${runId}`,
  });
  const claimed = await claimJobById(jobId, 'lenv-w');
  assert.equal(claimed?.id, jobId);
  const resultRef = await vibeRenderHandler(
    { id: claimed.id, ownerUserId: claimed.ownerUserId, input: claimed.input },
    { workerId: 'lenv-w', reportProgress: () => {}, server: { prisma, oss, meshAnalyzerPythonBin: 'python3', vibeRenderProvider: createFixtureVibeRenderProvider() } },
  );
  await completeJob({ jobId: claimed.id, workerId: 'lenv-w', targetVersion: claimed.targetVersion, resultRef });

  const latest = await getLatestVibeRender({ prisma, ownerUserId: user.id, projectId: project.id });
  assert.equal(latest.status, 'succeeded');
  assert.equal(latest.environmentAssetId, envAsset.id, '改造前卡应能凭此 assetId 换用户环境照签名 URL');
  assert.equal(latest.renderAssetId, resultRef.assetId, '改造后卡应能凭此 assetId 换产物签名 URL');
});

test('getLatestVibeRender：纯 t2i job（无环境照）→ environmentAssetId 为 null（前端保留示例图 + 「示例」标签）', async () => {
  const user = await createUser('latest-t2i');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 latest-t2i' } });
  await createVibeRenderJob({
    prisma, ownerUserId: user.id,
    input: { projectId: project.id, vibeText: '苔藓岩洞' },
    idempotencyKey: `latest-t2i-${runId}`,
  });
  const latest = await getLatestVibeRender({ prisma, ownerUserId: user.id, projectId: project.id });
  assert.equal(latest.environmentAssetId, null, '无环境照 → null，前端退回示例图');
  assert.equal(latest.renderAssetId, null, '未完成 → 无产物');
});

test('getLatestVibeRender：无任务时三字段皆 null；跨 owner 访问 → NotFoundError', async () => {
  const owner = await createUser('latest-own');
  const other = await createUser('latest-other');
  createdUserIds.push(owner.id, other.id);
  const project = await prisma.project.create({ data: { ownerUserId: owner.id, title: 'g3 latest-iso' } });

  const empty = await getLatestVibeRender({ prisma, ownerUserId: owner.id, projectId: project.id });
  assert.deepEqual(empty, { status: null, environmentAssetId: null, renderAssetId: null });

  await assert.rejects(
    () => getLatestVibeRender({ prisma, ownerUserId: other.id, projectId: project.id }),
    NotFoundError,
    '他人查询本项目最新 render 应 404',
  );
});

test('getLatestVibeRender：取最新一行（多次生成后返回 createdAt 最近的 job）', async () => {
  const user = await createUser('latest-newest');
  createdUserIds.push(user.id);
  const project = await prisma.project.create({ data: { ownerUserId: user.id, title: 'g3 latest-newest' } });
  const envA = await prisma.asset.create({ data: { ownerUserId: user.id, projectId: project.id, kind: 'upload_raw', mime: 'image/png', size: 32, ossKey: `uploads/raw/${user.id}/${runId}-na/a.png`, status: 'available' } });
  const envB = await prisma.asset.create({ data: { ownerUserId: user.id, projectId: project.id, kind: 'upload_raw', mime: 'image/png', size: 32, ossKey: `uploads/raw/${user.id}/${runId}-nb/b.png`, status: 'available' } });

  await createVibeRenderJob({ prisma, ownerUserId: user.id, input: { projectId: project.id, vibeText: '第一次', environmentAssetId: envA.id }, idempotencyKey: `newest-1-${runId}` });
  await new Promise((r) => setTimeout(r, 10));
  await createVibeRenderJob({ prisma, ownerUserId: user.id, input: { projectId: project.id, vibeText: '第二次', environmentAssetId: envB.id }, idempotencyKey: `newest-2-${runId}` });

  const latest = await getLatestVibeRender({ prisma, ownerUserId: user.id, projectId: project.id });
  assert.equal(latest.environmentAssetId, envB.id, '应返回最近一次生成引用的环境照');
});
