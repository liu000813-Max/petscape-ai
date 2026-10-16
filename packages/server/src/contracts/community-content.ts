import { z } from 'zod';
import { PetSpeciesCodeSchema } from './pets.ts';

const idSchema = z.string().trim().min(1).max(191);
const dateSchema = z.iso.datetime();
const optionalSpecies = PetSpeciesCodeSchema.nullable().optional();

export const ContentArticleQuerySchema = z.strictObject({
  category: z.string().trim().min(1).max(80).optional(),
  speciesCode: PetSpeciesCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const ContentArticleResponseSchema = z.strictObject({
  id: idSchema,
  slug: z.string().trim().min(1).max(191),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(1000),
  body: z.string().trim().max(100000),
  category: z.string().trim().min(1).max(80),
  speciesCode: PetSpeciesCodeSchema.nullable(),
  coverUrl: z.url().nullable(),
  publishedAt: dateSchema.nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});
export const ContentArticleListResponseSchema = z.strictObject({ articles: z.array(ContentArticleResponseSchema) });

export const CommunityPostQuerySchema = z.strictObject({
  topic: z.string().trim().min(1).max(80).optional(),
  speciesCode: PetSpeciesCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const CreateCommunityPostSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(10000),
  topic: z.string().trim().min(1).max(80),
  speciesCode: optionalSpecies,
});

export const CommunityPostResponseSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(10000),
  topic: z.string().trim().min(1).max(80),
  speciesCode: PetSpeciesCodeSchema.nullable(),
  authorName: z.string().nullable(),
  commentCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  liked: z.boolean(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});
export const CommunityPostListResponseSchema = z.strictObject({ posts: z.array(CommunityPostResponseSchema) });
export const CommunityPostDetailResponseSchema = CommunityPostResponseSchema.pick({ id: true, title: true, body: true, topic: true, authorName: true, createdAt: true });

export const CreateCommunityCommentSchema = z.strictObject({
  body: z.string().trim().min(1).max(5000),
});
export const CommunityCommentResponseSchema = z.strictObject({
  id: idSchema,
  postId: idSchema,
  body: z.string().trim().max(5000),
  authorName: z.string().nullable(),
  createdAt: dateSchema,
});
export const CommunityCommentListResponseSchema = z.strictObject({ comments: z.array(CommunityCommentResponseSchema) });

export const CommunityPostLikeResponseSchema = z.strictObject({
  postId: idSchema,
  liked: z.boolean(),
  likeCount: z.number().int().nonnegative(),
});
export const SetCommunityPostLikeSchema = z.strictObject({ liked: z.boolean() });
export const ContentSubmissionResponseSchema = z.strictObject({ id: idSchema, status: z.literal('pending'), createdAt: dateSchema });
export const CommentSubmissionResponseSchema = ContentSubmissionResponseSchema.extend({ postId: idSchema });

export const CareLogQuerySchema = z.strictObject({
  petId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const CreateCareLogSchema = z.strictObject({
  petId: idSchema,
  kind: z.string().trim().min(1).max(80),
  note: z.string().trim().max(2000).nullable().optional(),
  value: z.string().trim().max(200).nullable().optional(),
  recordedAt: dateSchema,
});
export const CareLogResponseSchema = z.strictObject({
  id: idSchema,
  petId: idSchema,
  kind: z.string().trim().min(1).max(80),
  note: z.string().nullable(),
  value: z.string().nullable(),
  recordedAt: dateSchema,
  createdAt: dateSchema,
});
export const CareLogListResponseSchema = z.strictObject({ logs: z.array(CareLogResponseSchema) });

export const ServiceProviderQuerySchema = z.strictObject({
  city: z.string().trim().min(1).max(80).optional(),
  serviceType: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const ServiceProviderResponseSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1).max(160),
  serviceType: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(80),
  description: z.string().trim().max(3000),
  contactUrl: z.url().nullable(),
});
export const ServiceProviderListResponseSchema = z.strictObject({ providers: z.array(ServiceProviderResponseSchema) });

export const AnalyticsEventSchema = z.strictObject({
  eventName: z.enum(['app.launch', 'home.view', 'knowledge.filter', 'knowledge.open', 'community.filter', 'community.open', 'community.like', 'community.submit', 'care.save', 'reminder.create', 'service.open', 'client.error', 'client.request_error']),
  path: z.string().trim().regex(/^\/[a-zA-Z0-9/_-]*$/).max(200).nullable().optional(),
  sessionId: z.string().trim().max(191).nullable().optional(),
  properties: z.strictObject({
    category: z.string().max(80).optional(), topic: z.string().max(80).optional(),
    articleId: idSchema.optional(), postId: idSchema.optional(), providerId: idSchema.optional(),
    liked: z.boolean().optional(), statusCode: z.number().int().optional(),
    code: z.enum(['runtime', 'unhandled_rejection', 'http', 'network']).optional(),
    requestId: z.string().max(191).optional(),
  }).optional(),
});
export const AnalyticsEventResponseSchema = z.strictObject({ accepted: z.literal(true) });

export const ModerateContentSchema = z.strictObject({
  contentType: z.enum(['article', 'post', 'comment', 'provider']),
  id: idSchema,
  status: z.enum(['draft', 'pending', 'published', 'rejected', 'archived']),
}).superRefine((input, ctx) => {
  const allowed = input.contentType === 'article' ? ['draft', 'published', 'archived'] : ['pending', 'published', 'rejected', 'archived'];
  if (!allowed.includes(input.status)) ctx.addIssue({ code: 'custom', path: ['status'], message: '该内容类型不支持此状态' });
});
export const ModerateContentResponseSchema = z.strictObject({
  contentType: ModerateContentSchema.shape.contentType,
  id: idSchema,
  status: ModerateContentSchema.shape.status,
});

export type CreateCommunityPost = z.infer<typeof CreateCommunityPostSchema>;
export type CreateCommunityComment = z.infer<typeof CreateCommunityCommentSchema>;
export type CreateCareLog = z.infer<typeof CreateCareLogSchema>;
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;
export type ModerateContent = z.infer<typeof ModerateContentSchema>;

export const CareReminderResponseSchema = z.strictObject({ id: idSchema, petId: idSchema, title: z.string().min(1).max(160), dueAt: dateSchema, completedAt: dateSchema.nullable() });
export const CareReminderListResponseSchema = z.strictObject({ reminders: z.array(CareReminderResponseSchema) });
export const CreateCareReminderSchema = z.strictObject({ petId: idSchema, title: z.string().trim().min(1).max(160), dueAt: dateSchema });
export const CompleteCareReminderSchema = z.strictObject({ completed: z.literal(true) });
export const CareReminderQuerySchema = z.strictObject({ petId: idSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export const AdminContentQuerySchema = z.strictObject({ contentType: ModerateContentSchema.shape.contentType, status: ModerateContentSchema.shape.status.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const AdminContentItemSchema = z.strictObject({ id: idSchema, title: z.string(), body: z.string(), status: ModerateContentSchema.shape.status, updatedAt: dateSchema });
export const AdminContentListResponseSchema = z.strictObject({ items: z.array(AdminContentItemSchema) });
export const SaveArticleSchema = z.strictObject({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(191),
  title: ContentArticleResponseSchema.shape.title, summary: ContentArticleResponseSchema.shape.summary,
  body: ContentArticleResponseSchema.shape.body, category: ContentArticleResponseSchema.shape.category,
  speciesCode: optionalSpecies, coverUrl: z.url().nullable().optional(),
});
export const SaveProviderSchema = z.strictObject({ name: z.string().trim().min(1).max(160), serviceType: z.string().trim().min(1).max(80), city: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(3000), contactUrl: z.url().nullable().optional() });
export const AdminSaveContentSchema = z.discriminatedUnion('contentType', [
  z.strictObject({ contentType: z.literal('article'), input: SaveArticleSchema }),
  z.strictObject({ contentType: z.literal('provider'), input: SaveProviderSchema }),
]);
export const SavedContentResponseSchema = z.strictObject({ id: idSchema, status: ModerateContentSchema.shape.status });
export const AnalyticsSummaryResponseSchema = z.strictObject({ since: dateSchema, events: z.array(z.strictObject({ eventName: AnalyticsEventSchema.shape.eventName, count: z.number().int().nonnegative() })), recentErrors: z.array(z.strictObject({ eventName: AnalyticsEventSchema.shape.eventName, path: z.string().nullable(), createdAt: dateSchema })) });
export { ZodError as ContentValidationError } from 'zod';
