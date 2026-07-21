import { randomUUID } from 'crypto';
import type { PetScapeProject } from '../types/project';

// 服务端 in-memory 单例（沿用 sessions.ts 全局单例模式，next dev 热重载不丢）。
declare global {
  // eslint-disable-next-line no-var
  var __petscapeProjects: Map<string, PetScapeProject> | undefined;
}

export const projects = globalThis.__petscapeProjects ?? new Map<string, PetScapeProject>();
globalThis.__petscapeProjects = projects;

export function nowIso() {
  return new Date().toISOString();
}

export function createProject(): PetScapeProject {
  const id = randomUUID();
  const now = nowIso();
  const project: PetScapeProject = {
    id,
    userState: 'briefing',
    brief: { species: '', taboos: [], traits: [] },
    canvasItems: [],
    generating: false,
    createdAt: now,
    updatedAt: now,
  };
  projects.set(id, project);
  return project;
}

export function getProject(id: string) {
  return projects.get(id);
}

/**
 * WP-G1：项目身份已切到 v1（`/api/v1/projects`，Postgres 持久化，进程重启不丢）。
 * 本 store 降级为「未迁段状态缓存」（brief 详情字段 + vibe/avatar 任务状态，见
 * docs/plans/g-line-execution-plan.md §一.6）——vibe/avatar/upload 等尚未迁移到
 * worker 的旧链路，仍需要以（v1）projectId 为 key 的可写状态容器。
 *
 * 与 createProject() 的区别：本函数按传入 id 惰性创建（v1 project 已存在，
 * 内存镜像还没有），不再自己生成 id——id 的权威来源已经是 v1 Project.id。
 */
export function getOrCreateProject(id: string): PetScapeProject {
  const existing = projects.get(id);
  if (existing) return existing;
  const now = nowIso();
  const project: PetScapeProject = {
    id,
    userState: 'briefing',
    brief: { species: '', taboos: [], traits: [] },
    canvasItems: [],
    generating: false,
    createdAt: now,
    updatedAt: now,
  };
  projects.set(id, project);
  return project;
}

export function touch(project: PetScapeProject) {
  project.updatedAt = nowIso();
}
