import test from 'node:test';
import assert from 'node:assert/strict';
import { listContentArticles, getContentArticle, getCommunityPost, listCommunityPosts, createCommunityPost, createCommunityComment, listCommunityComments, toggleCommunityPostLike, createCareLog, listCareLogs, createCareReminder, listCareReminders, completeCareReminder, moderateContent, listAdminContent, saveAdminContent, listServiceProviders, recordAnalyticsEvent, getContentAnalytics } from '../src/application/content-community.ts';
import { ContentArticleListResponseSchema, CommunityPostListResponseSchema, ServiceProviderListResponseSchema, CareLogListResponseSchema, CareReminderListResponseSchema, AnalyticsSummaryResponseSchema } from '../src/contracts/community-content.ts';
import { AdminRequiredError, bootstrapFirstAdmin, changeUserRole } from '../src/application/check-runs.ts';
import { NotFoundError } from '../src/domain/index.ts';

if (!process.env.DATABASE_URL) {
  if (process.env.CI) throw new Error('CI requires DATABASE_URL for content integration tests');
  test('content integration requires migrated PostgreSQL', (t) => t.skip('DATABASE_URL is not configured'));
} else {
  const { createPrismaClient } = await import('../src/infra/db/index.ts');
  const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL, poolMax: 4 });
  const run = `content-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [admin, owner, other] = [run + '-admin', run + '-a', run + '-b'];
  let pet;
  test.before(async () => {
    await prisma.user.createMany({ data: [{ id: admin, name: 'Admin' }, { id: owner, name: 'Owner' }, { id: other, name: 'Other' }] });
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
    if (existingAdmin) await changeUserRole({ prisma, actorUserId: existingAdmin.id, targetUserId: admin, input: { role: 'admin', expectedRole: 'user', reason: 'Content integration admin fixture' } });
    else await bootstrapFirstAdmin({ prisma, targetUserId: admin, reason: 'Content integration bootstrap' });
    pet = await prisma.pet.create({ data: { ownerUserId: owner, name: '测试宠物', speciesCode: 'rat', behaviorTraits: [] } });
  });
  test.after(async () => {
    await prisma.serviceProvider.deleteMany({ where: { city: run } });
    await prisma.analyticsEvent.deleteMany({ where: { sessionId: run } });
    await prisma.contentArticle.deleteMany({ where: { slug: run } });
    // The bootstrap admin and its immutable role audit remain as test evidence.
    // Never delete audit rows or relax their Restrict foreign keys for fixture cleanup.
    await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await prisma.$disconnect();
  });

  test('draft article is absent publicly until admin publication; output satisfies strict contract', async () => {
    const article = await saveAdminContent({ prisma, actorUserId: admin, input: { contentType: 'article', input: { slug: run, title: '栖境', summary: '摘要', body: '正文', category: '花枝鼠' } } });
    assert.equal((await listContentArticles({ prisma, query: {} })).some((item) => item.id === article.id), false);
    await assert.rejects(() => moderateContent({ prisma, actorUserId: owner, input: { contentType: 'article', id: article.id, status: 'published' } }), AdminRequiredError);
    await moderateContent({ prisma, actorUserId: admin, input: { contentType: 'article', id: article.id, status: 'published' } });
    const articles = await listContentArticles({ prisma, query: {} });
    assert.ok(articles.some((item) => item.id === article.id));
    ContentArticleListResponseSchema.parse({ articles });
    await assert.rejects(() => listAdminContent({ prisma, actorUserId: other, query: { contentType: 'article' } }), AdminRequiredError);
  });

  test('moderation gates posts and comments; hiding the parent blocks comment reads', async () => {
    const post = await createCommunityPost({ prisma, ownerUserId: owner, input: { title: '栖境分享', body: '内容', topic: run } });
    assert.equal((await listCommunityPosts({ prisma, query: { topic: run } })).length, 0);
    await moderateContent({ prisma, actorUserId: admin, input: { contentType: 'post', id: post.id, status: 'published' } });
    const comment = await createCommunityComment({ prisma, ownerUserId: other, postId: post.id, input: { body: '评论' } });
    assert.equal((await listCommunityComments({ prisma, postId: post.id })).length, 0);
    await moderateContent({ prisma, actorUserId: admin, input: { contentType: 'comment', id: comment.id, status: 'published' } });
    assert.equal((await listCommunityComments({ prisma, postId: post.id })).length, 1);
    const posts = await listCommunityPosts({ prisma, query: { topic: run } });
    CommunityPostListResponseSchema.parse({ posts });
    assert.equal(posts[0].commentCount, 1);
    await moderateContent({ prisma, actorUserId: admin, input: { contentType: 'post', id: post.id, status: 'archived' } });
    await assert.rejects(() => listCommunityComments({ prisma, postId: post.id }), NotFoundError);
  });

  test('concurrent repeated likes create one row; desired unlike remains idempotent', async () => {
    const post = await prisma.communityPost.create({ data: { ownerUserId: owner, title: '并发', body: '测试', topic: run, status: 'published' } });
    await Promise.all(Array.from({ length: 10 }, () => toggleCommunityPostLike({ prisma, ownerUserId: owner, postId: post.id, liked: true })));
    assert.equal(await prisma.communityPostLike.count({ where: { postId: post.id } }), 1);
    await Promise.all(Array.from({ length: 5 }, () => toggleCommunityPostLike({ prisma, ownerUserId: owner, postId: post.id, liked: false })));
    assert.equal(await prisma.communityPostLike.count({ where: { postId: post.id } }), 0);
  });

  test('care logs and reminders enforce ownership; completion preserves the first timestamp', async () => {
    await assert.rejects(() => createCareLog({ prisma, ownerUserId: other, input: { petId: pet.id, kind: '观察', recordedAt: new Date().toISOString() } }), NotFoundError);
    await assert.rejects(() => createCareReminder({ prisma, ownerUserId: other, input: { petId: pet.id, title: '饮水', dueAt: new Date().toISOString() } }), NotFoundError);
    const reminder = await createCareReminder({ prisma, ownerUserId: owner, input: { petId: pet.id, title: '饮水', dueAt: new Date().toISOString() } });
    await assert.rejects(() => completeCareReminder({ prisma, ownerUserId: other, reminderId: reminder.id }), NotFoundError);
    const first = await completeCareReminder({ prisma, ownerUserId: owner, reminderId: reminder.id });
    assert.equal((await completeCareReminder({ prisma, ownerUserId: owner, reminderId: reminder.id })).completedAt, first.completedAt);
  });

  test('direct detail and write operations do not expose unpublished or archived content', async () => {
    const article = await prisma.contentArticle.findUniqueOrThrow({ where: { slug: run } });
    await moderateContent({ prisma, actorUserId: admin, input: { contentType: 'article', id: article.id, status: 'archived' } });
    await assert.rejects(() => getContentArticle({ prisma, articleId: article.id }), NotFoundError);
    const post = await createCommunityPost({ prisma, ownerUserId: owner, input: { title: '待审', body: '内容', topic: run } });
    await assert.rejects(() => getCommunityPost({ prisma, postId: post.id }), NotFoundError);
    await assert.rejects(() => createCommunityComment({ prisma, ownerUserId: other, postId: post.id, input: { body: '不可提交' } }), NotFoundError);
    await assert.rejects(() => toggleCommunityPostLike({ prisma, ownerUserId: owner, postId: post.id, liked: true }), NotFoundError);
  });

  test('provider publication, city and service filters do not leak pending or archived entries', async () => {
    await assert.rejects(() => saveAdminContent({ prisma, actorUserId: owner, input: { contentType: 'provider', input: { name: '越权', serviceType: '寄养', city: run, description: '测试' } } }), AdminRequiredError);
    const provider = await saveAdminContent({ prisma, actorUserId: admin, input: { contentType: 'provider', input: { name: '测试服务', serviceType: '寄养', city: run, description: '测试', contactUrl: 'https://example.test/contact' } } });
    assert.deepEqual(await listServiceProviders({ prisma, query: { city: run } }), []);
    await moderateContent({ prisma, actorUserId: admin, input: { contentType: 'provider', id: provider.id, status: 'published' } });
    const providers = await listServiceProviders({ prisma, query: { city: run, serviceType: '寄养' } });
    assert.deepEqual(providers.map((item) => item.id), [provider.id]);
    ServiceProviderListResponseSchema.parse({ providers });
    assert.deepEqual(await listServiceProviders({ prisma, query: { city: run, serviceType: '医疗' } }), []);
    assert.equal((await listServiceProviders({ prisma, query: { city: run + '-other' } })).some((item) => item.id === provider.id), false);
    await moderateContent({ prisma, actorUserId: admin, input: { contentType: 'provider', id: provider.id, status: 'archived' } });
    assert.deepEqual(await listServiceProviders({ prisma, query: { city: run } }), []);
  });

  test('care lists isolate owners and hide soft-deleted pets even with explicit pet filters', async () => {
    const foreignPet = await prisma.pet.create({ data: { ownerUserId: other, name: '他人宠物', speciesCode: 'gecko', behaviorTraits: [] } });
    const deletedPet = await prisma.pet.create({ data: { ownerUserId: owner, name: '将删除', behaviorTraits: [] } });
    const recordedAt = new Date().toISOString();
    const ownLog = await createCareLog({ prisma, ownerUserId: owner, input: { petId: pet.id, kind: '喂食', recordedAt } });
    const foreignLog = await createCareLog({ prisma, ownerUserId: other, input: { petId: foreignPet.id, kind: '观察', recordedAt } });
    await createCareLog({ prisma, ownerUserId: owner, input: { petId: deletedPet.id, kind: '观察', recordedAt } });
    const foreignReminder = await createCareReminder({ prisma, ownerUserId: other, input: { petId: foreignPet.id, title: '他人提醒', dueAt: recordedAt } });
    const hiddenReminder = await createCareReminder({ prisma, ownerUserId: owner, input: { petId: deletedPet.id, title: '隐藏提醒', dueAt: recordedAt } });
    await prisma.pet.update({ where: { id: deletedPet.id }, data: { deletedAt: new Date() } });
    const logs = await listCareLogs({ prisma, ownerUserId: owner, query: {} });
    assert.ok(logs.some((item) => item.id === ownLog.id));
    assert.equal(logs.some((item) => item.id === foreignLog.id || item.petId === deletedPet.id), false);
    CareLogListResponseSchema.parse({ logs });
    for (const petId of [foreignPet.id, deletedPet.id]) {
      assert.deepEqual(await listCareLogs({ prisma, ownerUserId: owner, query: { petId } }), []);
      assert.deepEqual(await listCareReminders({ prisma, ownerUserId: owner, query: { petId } }), []);
    }
    const reminders = await listCareReminders({ prisma, ownerUserId: owner, query: {} });
    assert.equal(reminders.some((item) => [foreignReminder.id, hiddenReminder.id].includes(item.id)), false);
    CareReminderListResponseSchema.parse({ reminders });
    await assert.rejects(() => completeCareReminder({ prisma, ownerUserId: owner, reminderId: hiddenReminder.id }), NotFoundError);
    await assert.rejects(() => createCareLog({ prisma, ownerUserId: owner, input: { petId: deletedPet.id, kind: '观察', recordedAt } }), NotFoundError);
  });

  test('parallel reminder completion returns one persisted first timestamp', async () => {
    const reminder = await createCareReminder({ prisma, ownerUserId: owner, input: { petId: pet.id, title: '并发提醒', dueAt: new Date().toISOString() } });
    const completed = await Promise.all(Array.from({ length: 10 }, () => completeCareReminder({ prisma, ownerUserId: owner, reminderId: reminder.id })));
    assert.ok(completed[0].completedAt);
    assert.equal(new Set(completed.map((item) => item.completedAt)).size, 1);
    assert.equal((await prisma.careReminder.findUniqueOrThrow({ where: { id: reminder.id } })).completedAt.toISOString(), completed[0].completedAt);
  });

  test('analytics are admin-only and the seven-day summary excludes old errors and private properties', async () => {
    await recordAnalyticsEvent({ prisma, userId: owner, input: { eventName: 'care.save', sessionId: run, path: '/pages/care-log/index' } });
    const errorPath = '/test/' + run;
    await recordAnalyticsEvent({ prisma, input: { eventName: 'client.error', sessionId: run, path: errorPath, properties: { code: 'runtime' } } });
    await prisma.analyticsEvent.create({ data: { eventName: 'client.error', sessionId: run, path: errorPath + '-old', createdAt: new Date(Date.now() - 8 * 86400000) } });
    for (const actorUserId of [owner, other, run + '-missing']) {
      await assert.rejects(() => getContentAnalytics({ prisma, actorUserId }), AdminRequiredError);
    }
    const summary = await getContentAnalytics({ prisma, actorUserId: admin });
    AnalyticsSummaryResponseSchema.parse(summary);
    assert.ok(summary.events.find((item) => item.eventName === 'care.save')?.count >= 1);
    assert.ok(summary.recentErrors.some((item) => item.path === errorPath));
    assert.equal(summary.recentErrors.some((item) => item.path === errorPath + '-old'), false);
    assert.equal(JSON.stringify(summary).includes('sessionId'), false);
    assert.equal(JSON.stringify(summary).includes('properties'), false);
  });
}
