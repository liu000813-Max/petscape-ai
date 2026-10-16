import test from 'node:test';
import assert from 'node:assert/strict';
import { listContentArticles, listCommunityComments, createCareLog, moderateContent, toggleCommunityPostLike, completeCareReminder } from '../src/application/content-community.ts';
import { ContentArticleListResponseSchema, ModerateContentSchema } from '../src/contracts/community-content.ts';
import { NotFoundError } from '../src/domain/index.ts';
import { AdminRequiredError } from '../src/application/check-runs.ts';

test('public articles contain only contract fields, no moderation or author identifiers', async () => {
  const now = new Date('2026-10-16T08:00:00.000Z');
  const prisma = { contentArticle: { findMany: async () => [{ id: 'article', slug: 'habitat', title: '栖境', summary: '摘要', body: '正文', category: '空间设计', speciesCode: null, coverUrl: null, status: 'published', authorUserId: 'private-user', publishedAt: now, createdAt: now, updatedAt: now }] } };
  const articles = await listContentArticles({ prisma, query: {} });
  assert.equal(ContentArticleListResponseSchema.safeParse({ articles }).success, true);
  assert.equal('authorUserId' in articles[0], false);
});

test('comments on an unpublished parent never become publicly visible', async () => {
  const prisma = { communityPost: { findFirst: async () => null }, communityComment: { findMany: async () => { throw new Error('must not read hidden comments'); } } };
  await assert.rejects(() => listCommunityComments({ prisma, postId: 'hidden' }), NotFoundError);
});

test('care logs cannot be attached to another owner pet', async () => {
  const prisma = { pet: { findFirst: async ({ where }) => { assert.equal(where.ownerUserId, 'user-a'); return null; } } };
  await assert.rejects(() => createCareLog({ prisma, ownerUserId: 'user-a', input: { petId: 'user-b-pet', kind: '观察', recordedAt: new Date().toISOString() } }), NotFoundError);
});

test('ordinary users are rejected before any moderation writes', async () => {
  const prisma = { user: { findUnique: async () => ({ role: 'user' }) } };
  await assert.rejects(() => moderateContent({ prisma, actorUserId: 'user-a', input: { contentType: 'post', id: 'post', status: 'published' } }), AdminRequiredError);
});

test('moderation rejects status combinations forbidden by the database', () => {
  assert.equal(ModerateContentSchema.safeParse({ contentType: 'post', id: 'p', status: 'draft' }).success, false);
  assert.equal(ModerateContentSchema.safeParse({ contentType: 'article', id: 'a', status: 'rejected' }).success, false);
});

test('retrying a like request preserves the same desired state', async () => {
  const likes = new Set();
  const prisma = {
    communityPost: { findFirst: async () => ({ id: 'p' }) },
    communityPostLike: {
      createMany: async ({ data }) => { likes.add(data.ownerUserId); },
      deleteMany: async ({ where }) => { likes.delete(where.ownerUserId); },
      count: async () => likes.size,
    },
  };
  await toggleCommunityPostLike({ prisma, ownerUserId: 'u', postId: 'p', liked: true });
  assert.deepEqual(await toggleCommunityPostLike({ prisma, ownerUserId: 'u', postId: 'p', liked: true }), { postId: 'p', liked: true, likeCount: 1 });
  assert.deepEqual(await toggleCommunityPostLike({ prisma, ownerUserId: 'u', postId: 'p', liked: false }), { postId: 'p', liked: false, likeCount: 0 });
});

test('completing another owner reminder is rejected', async () => {
  const prisma = { careReminder: { findFirst: async ({ where }) => { assert.equal(where.ownerUserId, 'a'); return null; } } };
  await assert.rejects(() => completeCareReminder({ prisma, ownerUserId: 'a', reminderId: 'b-reminder' }), NotFoundError);
});
