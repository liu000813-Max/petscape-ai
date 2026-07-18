// application/projects.ts —— 项目用例（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2。
//
// 本层不直接 import @prisma/client（lint 边界规则）；PrismaClient 类型经
// infra/db 转发。不读 process.env——调用方（web Route Handler）从 loadWebConfig()
// 取值后显式传入。
import type { PrismaClient } from '../infra/db/index.ts';
import { assertOwner, NotFoundError } from '../domain/index.ts';

export { NotFoundError };

export interface ProjectSummary {
  id: string;
  ownerUserId: string;
  title: string | null;
  status: 'editable' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  prisma: PrismaClient;
  ownerUserId: string;
  title?: string;
}

/** 创建项目，归属当前登录用户。 */
export async function createProject({ prisma, ownerUserId, title }: CreateProjectInput): Promise<ProjectSummary> {
  const project = await prisma.project.create({
    data: { ownerUserId, title: title ?? null },
  });
  return toSummary(project);
}

export interface ListProjectsInput {
  prisma: PrismaClient;
  ownerUserId: string;
}

/** 列出当前登录用户拥有的全部项目（不返回他人项目——查询已按 ownerUserId 过滤）。 */
export async function listProjects({ prisma, ownerUserId }: ListProjectsInput): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({
    where: { ownerUserId },
    orderBy: { createdAt: 'desc' },
  });
  return projects.map(toSummary);
}

export interface GetProjectInput {
  prisma: PrismaClient;
  projectId: string;
  currentUserId: string;
}

/**
 * 读取单个项目，非 owner 访问抛 NotFoundError（对应 Route Handler 的 404 语义——
 * WP-3.2 验收 1："用户 B 访问 A 的项目/资产 404 或 403"）。
 */
export async function getProject({ prisma, projectId, currentUserId }: GetProjectInput): Promise<ProjectSummary> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  assertOwner(project, currentUserId, 'Project');
  return toSummary(project);
}

function toSummary(project: {
  id: string;
  ownerUserId: string;
  title: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): ProjectSummary {
  return {
    id: project.id,
    ownerUserId: project.ownerUserId,
    title: project.title,
    status: project.status as 'editable' | 'archived',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
