import test from 'node:test';
import assert from 'node:assert/strict';
import { listContentArticles, listCommunityPosts, createCommunityPost, createCommunityComment, listCommunityComments, toggleCommunityPostLike, createCareLog, createCareReminder, completeCareReminder, moderateContent, listAdminContent, saveAdminContent } from '../src/application/content-community.ts';
import { ContentArticleListResponseSchema, CommunityPostListResponseSchema } from '../src/contracts/community-content.ts';
import { AdminRequiredError } from '../src/application/check-runs.ts';
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
    await prisma.user.createMany({ data: [{ id: admin, name: 'Admin', role: 'admin' }, { id: owner, name: 'Owner' }, { id: other, name: 'Other' }] });
    pet = await prisma.pet.create({ data: { ownerUserId: owner, name: '测试宠物', speciesCode: 'rat', behaviorTraits: [] } });
  });
  test.after(async () => {
    await prisma.contentArticle.deleteMany({ where: { slug: run } });
    await prisma.user.deleteMany({ where: { id: { in: [admin, owner, other] } } });
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
}
