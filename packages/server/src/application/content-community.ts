import type { PrismaClient, PrismaInputJsonValue } from '../infra/db/index.ts';
import {
  AnalyticsEventSchema,
  CareLogQuerySchema,
  ContentArticleQuerySchema,
  CommunityPostQuerySchema,
  CreateCareLogSchema,
  CreateCommunityCommentSchema,
  CreateCommunityPostSchema,
  ServiceProviderQuerySchema,
  type AnalyticsEvent,
  type CreateCareLog,
  type CreateCommunityComment,
  type CreateCommunityPost,
} from '../contracts/community-content.ts';
import { NotFoundError } from '../domain/index.ts';
import { AdminRequiredError } from './check-runs.ts';
import { ModerateContentSchema, AdminContentQuerySchema, AdminSaveContentSchema, CareReminderQuerySchema, CreateCareReminderSchema, type ModerateContent } from '../contracts/community-content.ts';

const publicArticleWhere = { status: 'published' } as const;
const publicPostWhere = { status: 'published' } as const;

async function requireContentAdmin(prisma: PrismaClient, actorUserId: string) {
  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
  if (actor?.role !== 'admin') throw new AdminRequiredError();
}

export async function getContentArticle({ prisma, articleId }: { prisma: PrismaClient; articleId: string }) {
  const row = await prisma.contentArticle.findFirst({ where: { id: articleId, status: 'published' } });
  if (!row) throw new NotFoundError('ContentArticle');
  return { id: row.id, slug: row.slug, title: row.title, summary: row.summary, body: row.body, category: row.category, speciesCode: row.speciesCode, coverUrl: row.coverUrl, publishedAt: row.publishedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function getCommunityPost({ prisma, postId }: { prisma: PrismaClient; postId: string }) {
  const row = await prisma.communityPost.findFirst({ where: { id: postId, status: 'published' }, include: { owner: { select: { name: true } } } });
  if (!row) throw new NotFoundError('CommunityPost');
  return { id: row.id, title: row.title, body: row.body, topic: row.topic, authorName: row.owner.name, createdAt: row.createdAt.toISOString() };
}

export async function listContentArticles({ prisma, query }: { prisma: PrismaClient; query: unknown }) {
  const input = ContentArticleQuerySchema.parse(query);
  const rows = await prisma.contentArticle.findMany({
    where: { ...publicArticleWhere, ...(input.category ? { category: input.category } : {}), ...(input.speciesCode ? { speciesCode: input.speciesCode } : {}) },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: input.limit,
  });
  return rows.map((row) => ({ id: row.id, slug: row.slug, title: row.title, summary: row.summary, body: row.body, category: row.category, speciesCode: row.speciesCode, coverUrl: row.coverUrl, publishedAt: row.publishedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
}

export async function listCommunityPosts({ prisma, query, userId }: { prisma: PrismaClient; query: unknown; userId?: string }) {
  const input = CommunityPostQuerySchema.parse(query);
  const rows = await prisma.communityPost.findMany({
    where: { ...publicPostWhere, ...(input.topic ? { topic: input.topic } : {}), ...(input.speciesCode ? { speciesCode: input.speciesCode } : {}) },
    include: { owner: { select: { name: true } }, _count: { select: { comments: { where: { status: 'published' } }, likes: true } }, likes: { where: { ownerUserId: userId ?? '' }, select: { id: true } } },
    orderBy: { createdAt: 'desc' },
    take: input.limit,
  });
  return rows.map((row) => ({ id: row.id, title: row.title, body: row.body, topic: row.topic, speciesCode: row.speciesCode, authorName: row.owner.name, commentCount: row._count.comments, likeCount: row._count.likes, liked: row.likes.length > 0, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
}

export async function createCommunityPost({ prisma, ownerUserId, input }: { prisma: PrismaClient; ownerUserId: string; input: CreateCommunityPost }) {
  const parsed = CreateCommunityPostSchema.parse(input);
  const row = await prisma.communityPost.create({ data: { ownerUserId, title: parsed.title, body: parsed.body, topic: parsed.topic, speciesCode: parsed.speciesCode ?? null, status: 'pending' } });
  return { id: row.id, status: row.status, createdAt: row.createdAt.toISOString() };
}

export async function listCommunityComments({ prisma, postId }: { prisma: PrismaClient; postId: string }) {
  const post = await prisma.communityPost.findFirst({ where: { id: postId, status: 'published' }, select: { id: true } });
  if (!post) throw new NotFoundError('CommunityPost');
  const rows = await prisma.communityComment.findMany({ where: { postId, status: 'published' }, include: { owner: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
  return rows.map((row) => ({ id: row.id, postId: row.postId, body: row.body, authorName: row.owner.name, createdAt: row.createdAt.toISOString() }));
}

export async function createCommunityComment({ prisma, ownerUserId, postId, input }: { prisma: PrismaClient; ownerUserId: string; postId: string; input: CreateCommunityComment }) {
  const parsed = CreateCommunityCommentSchema.parse(input);
  const post = await prisma.communityPost.findFirst({ where: { id: postId, status: 'published' }, select: { id: true } });
  if (!post) throw new NotFoundError('CommunityPost');
  const row = await prisma.communityComment.create({ data: { postId, ownerUserId, body: parsed.body, status: 'pending' } });
  return { id: row.id, postId: row.postId, status: row.status, createdAt: row.createdAt.toISOString() };
}

export async function toggleCommunityPostLike({ prisma, ownerUserId, postId, liked }: { prisma: PrismaClient; ownerUserId: string; postId: string; liked: boolean }) {
  const post = await prisma.communityPost.findFirst({ where: { id: postId, status: 'published' }, select: { id: true } });
  if (!post) throw new NotFoundError('CommunityPost');
  if (liked) await prisma.communityPostLike.createMany({ data: { postId, ownerUserId }, skipDuplicates: true });
  else await prisma.communityPostLike.deleteMany({ where: { postId, ownerUserId } });
  const likeCount = await prisma.communityPostLike.count({ where: { postId } });
  return { postId, liked, likeCount };
}

export async function listCareLogs({ prisma, ownerUserId, query }: { prisma: PrismaClient; ownerUserId: string; query: unknown }) {
  const input = CareLogQuerySchema.parse(query);
  const rows = await prisma.careLog.findMany({ where: { ownerUserId, pet: { deletedAt: null }, ...(input.petId ? { petId: input.petId } : {}) }, orderBy: { recordedAt: 'desc' }, take: input.limit });
  return rows.map((row) => ({ id: row.id, petId: row.petId, kind: row.kind, note: row.note, value: row.value, recordedAt: row.recordedAt.toISOString(), createdAt: row.createdAt.toISOString() }));
}

export async function createCareLog({ prisma, ownerUserId, input }: { prisma: PrismaClient; ownerUserId: string; input: CreateCareLog }) {
  const parsed = CreateCareLogSchema.parse(input);
  const pet = await prisma.pet.findFirst({ where: { id: parsed.petId, ownerUserId, deletedAt: null }, select: { id: true } });
  if (!pet) throw new NotFoundError('Pet');
  const row = await prisma.careLog.create({ data: { ownerUserId, petId: parsed.petId, kind: parsed.kind, note: parsed.note ?? null, value: parsed.value ?? null, recordedAt: new Date(parsed.recordedAt) } });
  return { id: row.id, petId: row.petId, kind: row.kind, note: row.note, value: row.value, recordedAt: row.recordedAt.toISOString(), createdAt: row.createdAt.toISOString() };
}

export async function listServiceProviders({ prisma, query }: { prisma: PrismaClient; query: unknown }) {
  const input = ServiceProviderQuerySchema.parse(query);
  const rows = await prisma.serviceProvider.findMany({ where: { status: 'published', ...(input.city ? { city: input.city } : {}), ...(input.serviceType ? { serviceType: input.serviceType } : {}) }, orderBy: [{ city: 'asc' }, { name: 'asc' }], take: input.limit });
  return rows.map((row) => ({ id: row.id, name: row.name, serviceType: row.serviceType, city: row.city, description: row.description, contactUrl: row.contactUrl }));
}

export async function recordAnalyticsEvent({ prisma, userId, input }: { prisma: PrismaClient; userId?: string; input: AnalyticsEvent }) {
  const parsed = AnalyticsEventSchema.parse(input);
  await prisma.analyticsEvent.create({ data: { userId: userId ?? null, sessionId: parsed.sessionId ?? null, eventName: parsed.eventName, path: parsed.path ?? null, properties: parsed.properties ? (parsed.properties as PrismaInputJsonValue) : undefined } });
  return { accepted: true as const };
}

export async function moderateContent({ prisma, actorUserId, input }: { prisma: PrismaClient; actorUserId: string; input: ModerateContent }) {
  await requireContentAdmin(prisma, actorUserId);
  const parsed = ModerateContentSchema.parse(input);
  const publishedAt = parsed.status === 'published' ? new Date() : null;
  if (parsed.contentType === 'article') {
    const row = await prisma.contentArticle.updateMany({ where: { id: parsed.id }, data: { status: parsed.status, publishedAt } });
    if (!row.count) throw new NotFoundError('ContentArticle');
  } else if (parsed.contentType === 'post') {
    const row = await prisma.communityPost.updateMany({ where: { id: parsed.id }, data: { status: parsed.status } });
    if (!row.count) throw new NotFoundError('CommunityPost');
  } else if (parsed.contentType === 'comment') {
    const row = await prisma.communityComment.updateMany({ where: { id: parsed.id }, data: { status: parsed.status } });
    if (!row.count) throw new NotFoundError('CommunityComment');
  } else {
    const row = await prisma.serviceProvider.updateMany({ where: { id: parsed.id }, data: { status: parsed.status } });
    if (!row.count) throw new NotFoundError('ServiceProvider');
  }
  return { contentType: parsed.contentType, id: parsed.id, status: parsed.status };
}

export async function listAdminContent({ prisma, actorUserId, query }: { prisma: PrismaClient; actorUserId: string; query: unknown }) {
  await requireContentAdmin(prisma, actorUserId);
  const parsed = AdminContentQuerySchema.parse(query);
  const args = { where: parsed.status ? { status: parsed.status } : {}, orderBy: { updatedAt: 'desc' as const }, take: parsed.limit };
  if (parsed.contentType === 'article') return (await prisma.contentArticle.findMany(args)).map((row) => ({ id: row.id, title: row.title, body: row.body, status: row.status, updatedAt: row.updatedAt.toISOString() }));
  if (parsed.contentType === 'post') return (await prisma.communityPost.findMany(args)).map((row) => ({ id: row.id, title: row.title, body: row.body, status: row.status, updatedAt: row.updatedAt.toISOString() }));
  if (parsed.contentType === 'comment') return (await prisma.communityComment.findMany(args)).map((row) => ({ id: row.id, title: '社区评论', body: row.body, status: row.status, updatedAt: row.updatedAt.toISOString() }));
  return (await prisma.serviceProvider.findMany(args)).map((row) => ({ id: row.id, title: row.name, body: `${row.city} · ${row.serviceType}\n${row.description}`, status: row.status, updatedAt: row.updatedAt.toISOString() }));
}

export async function saveAdminContent({ prisma, actorUserId, input }: { prisma: PrismaClient; actorUserId: string; input: unknown }) {
  await requireContentAdmin(prisma, actorUserId);
  const parsed = AdminSaveContentSchema.parse(input);
  if (parsed.contentType === 'article') {
    const row = await prisma.contentArticle.create({ data: { ...parsed.input, speciesCode: parsed.input.speciesCode ?? null, authorUserId: actorUserId, status: 'draft' } });
    return { id: row.id, status: row.status };
  }
  const row = await prisma.serviceProvider.create({ data: { ...parsed.input, status: 'pending' } });
  return { id: row.id, status: row.status };
}

export async function listCareReminders({ prisma, ownerUserId, query }: { prisma: PrismaClient; ownerUserId: string; query: unknown }) {
  const input = CareReminderQuerySchema.parse(query);
  const rows = await prisma.careReminder.findMany({ where: { ownerUserId, pet: { deletedAt: null }, ...(input.petId ? { petId: input.petId } : {}) }, orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { dueAt: 'asc' }], take: input.limit });
  return rows.map((row) => ({ id: row.id, petId: row.petId, title: row.title, dueAt: row.dueAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null }));
}

export async function createCareReminder({ prisma, ownerUserId, input }: { prisma: PrismaClient; ownerUserId: string; input: unknown }) {
  const parsed = CreateCareReminderSchema.parse(input);
  const pet = await prisma.pet.findFirst({ where: { id: parsed.petId, ownerUserId, deletedAt: null }, select: { id: true } });
  if (!pet) throw new NotFoundError('Pet');
  const row = await prisma.careReminder.create({ data: { ownerUserId, petId: parsed.petId, title: parsed.title, dueAt: new Date(parsed.dueAt) } });
  return { id: row.id, petId: row.petId, title: row.title, dueAt: row.dueAt.toISOString(), completedAt: null };
}

export async function completeCareReminder({ prisma, ownerUserId, reminderId }: { prisma: PrismaClient; ownerUserId: string; reminderId: string }) {
  const row = await prisma.careReminder.findFirst({ where: { id: reminderId, ownerUserId, pet: { deletedAt: null } } });
  if (!row) throw new NotFoundError('CareReminder');
  if (!row.completedAt) await prisma.careReminder.updateMany({ where: { id: reminderId, ownerUserId, completedAt: null }, data: { completedAt: new Date() } });
  const result = await prisma.careReminder.findFirstOrThrow({ where: { id: reminderId, ownerUserId } });
  return { id: result.id, petId: result.petId, title: result.title, dueAt: result.dueAt.toISOString(), completedAt: result.completedAt?.toISOString() ?? null };
}

export async function getContentAnalytics({ prisma, actorUserId }: { prisma: PrismaClient; actorUserId: string }) {
  await requireContentAdmin(prisma, actorUserId);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const events = await prisma.analyticsEvent.groupBy({ by: ['eventName'], where: { createdAt: { gte: since } }, _count: { _all: true }, orderBy: { eventName: 'asc' } });
  const errors = await prisma.analyticsEvent.findMany({ where: { eventName: { in: ['client.error', 'client.request_error'] }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 20, select: { eventName: true, path: true, createdAt: true } });
  return { since: since.toISOString(), events: events.map((row) => ({ eventName: row.eventName, count: row._count._all })), recentErrors: errors.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
}
