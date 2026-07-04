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

export function touch(project: PetScapeProject) {
  project.updatedAt = nowIso();
}
