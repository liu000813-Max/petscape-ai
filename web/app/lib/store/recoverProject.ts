import { readdirSync, statSync } from 'fs';
import path from 'path';
import type { GcodeMeta } from '../jobs/gcodeMeta';
import { readGcodeMeta } from '../jobs/gcodeMeta';
import type { PetScapeProject } from '../types/project';
import { nowIso, projects } from './projects';

const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]{7,}$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

function publicRoot() {
  return path.join(process.cwd(), 'public');
}

function safePublicAbs(...parts: string[]) {
  const root = publicRoot();
  const target = path.join(root, ...parts);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function publicUrl(...parts: string[]) {
  return `/${parts.join('/')}`;
}

function fileInfo(abs: string | null) {
  if (!abs) return null;
  try {
    const stat = statSync(abs);
    return stat.isFile() && stat.size > 0 ? stat : null;
  } catch {
    return null;
  }
}

function listDir(abs: string | null) {
  if (!abs) return [];
  try {
    return readdirSync(abs);
  } catch {
    return [];
  }
}

function findPetUpload(id: string) {
  const dir = safePublicAbs('uploads', id);
  const filename = listDir(dir).find((entry) => entry.startsWith('pet.') && IMAGE_EXT_RE.test(entry));
  return filename ? publicUrl('uploads', id, filename) : undefined;
}

function findAvatarSlice(id: string, avatarDirAbs: string) {
  const candidates = listDir(avatarDirAbs)
    .map((entry) => {
      const match = /^print-(\d+)mm\.gcode$/i.exec(entry);
      if (!match) return null;
      const scaleMm = Number(match[1]);
      const gcodeAbs = path.join(avatarDirAbs, entry);
      const stlName = `print-${scaleMm}mm.stl`;
      const stlAbs = path.join(avatarDirAbs, stlName);
      const gcodeInfo = fileInfo(gcodeAbs);
      const stlInfo = fileInfo(stlAbs);
      if (!gcodeInfo || !stlInfo) return null;
      return { scaleMm, gcodeAbs, gcodeUrl: publicUrl('generated', id, 'avatar', entry), stlUrl: publicUrl('generated', id, 'avatar', stlName), mtimeMs: gcodeInfo.mtimeMs };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0];
}

export async function recoverProjectFromDisk(id: string): Promise<PetScapeProject | undefined> {
  if (!SAFE_ID_RE.test(id)) return undefined;
  const existing = projects.get(id);
  if (existing) return existing;

  const avatarDirAbs = safePublicAbs('generated', id, 'avatar');
  const modelInfo = fileInfo(safePublicAbs('generated', id, 'avatar', 'model.glb'));
  if (!avatarDirAbs || !modelInfo) return undefined;

  const now = nowIso();
  const petPhotoUrl = findPetUpload(id);
  const styledImageUrl = fileInfo(safePublicAbs('generated', id, 'avatar', 'styled.png'))
    ? publicUrl('generated', id, 'avatar', 'styled.png')
    : undefined;
  const slice = findAvatarSlice(id, avatarDirAbs);
  const project: PetScapeProject = {
    id,
    userState: 'briefing',
    brief: {
      species: 'rat',
      petSize: '3',
      style: 'restored-avatar',
      taboos: [],
      traits: [],
      petName: 'Nomi',
      petPhotoUrl,
    },
    canvasItems: [],
    generating: false,
    avatar: {
      status: 'done',
      styledImageUrl,
      modelUrl: publicUrl('generated', id, 'avatar', 'model.glb'),
    },
    createdAt: new Date(modelInfo.mtimeMs).toISOString(),
    updatedAt: now,
  };

  if (slice) {
    const meta: GcodeMeta = await readGcodeMeta(slice.gcodeAbs).catch(() => ({}));
    project.avatarSlice = {
      status: 'done',
      scaleMm: slice.scaleMm,
      stlUrl: slice.stlUrl,
      gcodeUrl: slice.gcodeUrl,
      weightG: meta.weightG,
      printTimeMin: meta.printTimeMin,
    };
  }

  projects.set(id, project);
  return project;
}
