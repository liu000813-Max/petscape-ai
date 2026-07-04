import { copyFile, mkdir, stat, writeFile, appendFile } from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { getProject, touch } from '../store/projects';
import type { PetScapeProject } from '../types/project';
import { falEditImage, downloadImage, fileToDataUri, publicImageToAbs } from '../images/falClient';
import { buildAvatarStylePrompt, STYLE_ENABLED } from '../prompts/avatarStyle';
import { buildTriviewGridPrompt, cropTriviewToViews, validateViews, padViews } from '../images/triview';
import {
  uploadImage as tripoUploadImage,
  pollTask as tripoPollTask,
  glbUrlFrom as tripoGlbUrlFrom,
  downloadFile as tripoDownloadFile,
  TRIPO_MODEL_VERSION,
  readTripoKeys,
  withTripoKey,
} from '../tripo/client';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { JOB_TIMEOUT_MS, withTimeout } from './timeouts';
import { readGcodeMeta } from './gcodeMeta';

const execFileAsync = promisify(execFile);

// 批次1 宠物角色链（照片 → 风格化立绘 → 3D 模型 → 自动切片）。
// 引擎开关 MESH_ENGINE（2026-07-04 二次拍板：新 Tripo 双 key 到位，级联降级）：
//   'auto'（默认）：tripo#key1 → tripo#key2 → meshy 逐级降级。
//                   每级瞬时错误最多重试一次；额度/认证/版本类硬错误不重试、直接降级下一级。
//   'tripo'：只级联 Tripo 双 key，不落 Meshy。
//   'meshy'：直连 Meshy 单图（旧兜底路径）。
//   tripo 路径 = 立绘 → fal 三视图网格 → 裁切+独立性验证 → multiview_to_model（stage 含 triview）；
//   meshy 路径 = 立绘正面单图 → image-to-3d（stage 直跳 modeling）。
// mock=1：全链走预置资产（走 tripo mock 分支以覆盖裁切+验证代码路径），零成本、不进级联。
export const MESH_ENGINE: 'auto' | 'meshy' | 'tripo' = 'auto';

// 额度耗尽(2010)/版本不可用(2017)/认证失败(401/403) —— 换 key 或换引擎才有意义，重试同级纯烧时间。
function isHardEngineError(message: string): boolean {
  return /"code"\s*:\s*(2010|2017)|\b401\b|\b403\b|Unauthorized|credit/i.test(message);
}

const workingDir = process.cwd();

function projectDir(id: string) {
  return path.join(workingDir, 'public', 'generated', id, 'avatar');
}

async function log(id: string, line: string) {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true }).catch(() => {});
  await appendFile(path.join(dir, 'avatar.log'), `[${new Date().toISOString()}] ${line}\n`).catch(() => {});
  console.log(`[avatar ${id}] ${line}`);
}

// fal 瞬时错误重试一次（与 gate1 同待遇）。
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[avatar retry] ${label} 首次失败，2s 后重试一次：${err instanceof Error ? err.message : String(err)}`);
    await new Promise((r) => setTimeout(r, 2000));
    return fn();
  }
}

// ---- 内联 Meshy image-to-3d 客户端（batch0 禁止重建 app/lib/meshy/ 目录 + 本文件 ownership 内自包含）----
// 逻辑来自老仓库 web/app/lib/meshy/client.ts（M 系验收通过的实现），仅取 avatar 链所需子集。
const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

function readMeshyKey(): string {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  for (const envPath of [path.join(workingDir, '.env.local'), path.join(workingDir, '..', '.env')]) {
    try {
      const match = readFileSync(envPath, 'utf8').match(/^MESHY_API_KEY=(.+)$/m);
      if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {}
  }
  throw new Error('服务端未配置 MESHY_API_KEY（请在项目根 .env 或 web/.env.local 中配置）');
}

async function meshyApi(pathname: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${MESHY_BASE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${readMeshyKey()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`meshy ${init.method || 'GET'} ${pathname} ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function meshySubmitImageTo3d(imageAbsPath: string): Promise<string> {
  const image_url = await fileToDataUri(imageAbsPath);
  const response = await meshyApi('/image-to-3d', {
    method: 'POST',
    body: JSON.stringify({ image_url, should_remesh: true, should_texture: true, topology: 'triangle', target_polycount: 100000 }),
  });
  const id = (response.result || response.id) as string | undefined;
  if (!id) throw new Error(`Meshy 响应缺少 task id: ${JSON.stringify(response).slice(0, 200)}`);
  return id;
}

interface MeshyPoll {
  status?: string;
  progress?: number;
  task_error?: unknown;
  model_urls?: { glb?: string };
  model_url?: string;
}

async function meshyPoll(
  taskId: string,
  onPoll?: (r: MeshyPoll, count: number) => void | Promise<void>,
): Promise<MeshyPoll> {
  const started = Date.now();
  const intervalMs = 15000;
  const timeoutMs = 8 * 60_000;
  let count = 0;
  while (true) {
    count += 1;
    const result = (await meshyApi(`/image-to-3d/${taskId}`)) as MeshyPoll;
    await onPoll?.(result, count);
    if (result.status === 'SUCCEEDED') return result;
    if (result.status === 'FAILED' || result.status === 'CANCELED' || result.task_error) {
      throw new Error(`meshy image-to-3d ${taskId} failed: ${JSON.stringify(result.task_error || result).slice(0, 300)}`);
    }
    if (Date.now() - started > timeoutMs) throw new Error(`meshy image-to-3d ${taskId} 轮询超时`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function meshyGlbUrl(r: MeshyPoll): string {
  const url = r.model_urls?.glb || r.model_url;
  if (!url) throw new Error(`Meshy 结果缺少 GLB URL: ${JSON.stringify(r).slice(0, 200)}`);
  return url;
}

async function meshyDownload(url: string, absPath: string): Promise<number> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`下载 Meshy GLB 失败 ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buf);
  return buf.length;
}

// ---- Tripo 三视图提交（本链 right 槽留空，只传 front/left/back）----
async function tripoSubmitTriview(viewPaths: string[]): Promise<{ taskId: string; response: unknown }> {
  const files: Array<{ type: string; file_token: string }> = [];
  for (const p of viewPaths) {
    const { token, ext } = await tripoUploadImage(p);
    files.push({ type: ext, file_token: token });
  }
  // multiview 四槽位 [front, left, back, right] 必须齐——right 缺席用空对象 {} 占位。
  // 真链实测：只传 3 元素数组会被 /task 拒 400 code=1004（2026-07-04），老仓库参考脚本是四视图全齐所以没暴露。
  const body = {
    type: 'multiview_to_model',
    files: [...files, {}],
    model_version: TRIPO_MODEL_VERSION,
    orientation: 'align_image',
  };
  const res = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
    method: 'POST',
    headers: { Authorization: `Bearer ${readTripoKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`tripo /task ${res.status}: ${text.slice(0, 300)}`);
  const taskId = (json as { data?: { task_id?: string } }).data?.task_id;
  if (!taskId) throw new Error(`tripo /task 未返回 task_id: ${text.slice(0, 200)}`);
  return { taskId, response: json };
}

function readTripoKey(): string {
  if (process.env.TRIPO_API_KEY) return process.env.TRIPO_API_KEY;
  for (const envPath of [path.join(workingDir, '.env.local'), path.join(workingDir, '..', '.env')]) {
    try {
      const match = readFileSync(envPath, 'utf8').match(/^TRIPO_API_KEY=(.+)$/m);
      if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {}
  }
  throw new Error('服务端未配置 TRIPO_API_KEY');
}

export interface StartAvatarInput {
  species?: string;
  wearableIds?: string[];
  petSize?: number; // 1-5 体型档
}

// avatar 入口：同步置 avatar=running/stage=styling，重活后台跑，前端轮询。
export function startAvatar(project: PetScapeProject, input: StartAvatarInput, mock: boolean) {
  const petImage = project.brief.petPhotoUrl;
  if (!mock && !petImage) throw new Error('未上传宠物照片，无法生成');

  project.avatar = { status: 'running', stage: 'styling' };
  touch(project);

  const scaleMm = sizeToScaleMm(input.petSize);
  // 级联梯子最坏路径 = tripo#1 ×2 + tripo#2 ×2 + meshy ×2，单档 15min 不够 —— 给 3 倍预算。
  void withTimeout('meshy', JOB_TIMEOUT_MS.meshy * 3, () => runAvatar(project.id, input, mock, scaleMm)).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await log(project.id, `FAILED ${message}`);
    const p = getProject(project.id);
    if (p) { p.avatar = { ...(p.avatar ?? { status: 'running' }), status: 'failed', error: message }; touch(p); }
  });
}

// 体型档 1-5 → scaleMm 80/100/120/140/160（供自动切片）。
export function sizeToScaleMm(size?: number): number {
  const map: Record<number, number> = { 1: 80, 2: 100, 3: 120, 4: 140, 5: 160 };
  return map[Math.min(5, Math.max(1, Math.round(size ?? 3)))] ?? 120;
}

async function setStage(id: string, stage: 'styling' | 'triview' | 'modeling', styledUrl?: string) {
  const p = getProject(id);
  if (!p?.avatar) return;
  p.avatar.stage = stage;
  if (styledUrl) p.avatar.styledImageUrl = styledUrl;
  touch(p);
}

async function runAvatar(id: string, input: StartAvatarInput, mock: boolean, scaleMm: number) {
  const dir = projectDir(id);
  const viewsDir = path.join(dir, 'views');
  await mkdir(viewsDir, { recursive: true });

  const styledRel = `/generated/${id}/avatar/styled.png`;
  const styledAbs = path.join(dir, 'styled.png');
  const glbRel = `/generated/${id}/avatar/model.glb`;
  const glbAbs = path.join(dir, 'model.glb');

  // ---- 步骤1：风格化立绘（fal edit；STYLE_ENABLED=false 回退直喂原图；mock 用 mockup 图）----
  let styleInputAbs: string; // 喂给下一步（三视图/建模）的图
  if (mock) {
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'pet-hamster-ref.jpg'), styledAbs);
    await log(id, `mock styled copied → ${styledRel}`);
    await new Promise((r) => setTimeout(r, 1200));
    styleInputAbs = styledAbs;
    await setStage(id, 'styling', styledRel);
  } else {
    const petAbs = publicImageToAbs(getProject(id)?.brief.petPhotoUrl ?? '');
    if (STYLE_ENABLED) {
      const prompt = buildAvatarStylePrompt({ species: input.species, wearableIds: input.wearableIds });
      await log(id, `fal style edit start input=${petAbs} STYLE_ENABLED=true`);
      const petUri = await fileToDataUri(petAbs);
      const url = await withRetry('fal style', () => falEditImage(prompt, [petUri]));
      await downloadImage(url, styledAbs);
      const info = await stat(styledAbs).catch(() => null);
      if (!info || info.size === 0) throw new Error('风格化立绘生成失败：输出文件为空');
      styleInputAbs = styledAbs;
      await log(id, `fal style success → ${styledRel}`);
      await setStage(id, 'styling', styledRel);
    } else {
      // 回退路径 a：跳过风格化，直喂原图。不写 styled.png（产物目录无 styled.png 即佐证未经风格化）。
      await log(id, `STYLE_ENABLED=false 回退：跳过风格化，直喂原图 ${petAbs}`);
      styleInputAbs = petAbs;
    }
  }

  // ---- 步骤2/3：3D 引擎（级联梯子：tripo#1 → tripo#2 → meshy，见 MESH_ENGINE 注释）----
  let engineUsed: string;
  if (mock) {
    // mock 不进级联：固定走 tripo mock 分支，覆盖裁切+验证代码路径。
    await runTripoEngine(id, styleInputAbs, input, mock, dir, viewsDir, glbAbs, glbRel);
    engineUsed = 'tripo(mock)';
  } else if (MESH_ENGINE === 'meshy') {
    await runMeshyEngine(id, styleInputAbs, mock, glbAbs, glbRel);
    engineUsed = 'meshy';
  } else {
    const keys = readTripoKeys();
    const ladder: Array<{ name: string; run: () => Promise<void> }> = keys.map((key, i) => ({
      name: `tripo#${i + 1}`,
      run: () => withTripoKey(key, () => runTripoEngine(id, styleInputAbs, input, mock, dir, viewsDir, glbAbs, glbRel)),
    }));
    if (MESH_ENGINE === 'auto') {
      ladder.push({ name: 'meshy', run: () => runMeshyEngine(id, styleInputAbs, mock, glbAbs, glbRel) });
    }
    if (!ladder.length) throw new Error('无可用 3D 引擎：未配置 TRIPO_API_KEY（MESH_ENGINE=tripo）');

    let used: string | null = null;
    let lastErr: unknown = null;
    outer: for (const step of ladder) {
      for (let attempt = 1; attempt <= 2; attempt += 1) { // 每级最多重试一次（共 2 次尝试）
        try {
          await log(id, `engine ${step.name} attempt #${attempt}`);
          await step.run();
          used = step.name;
          break outer;
        } catch (error) {
          lastErr = error;
          const message = error instanceof Error ? error.message : String(error);
          await log(id, `engine ${step.name} attempt #${attempt} failed: ${message.slice(0, 200)}`);
          if (isHardEngineError(message)) {
            await log(id, `engine ${step.name} 硬错误（额度/认证/版本），降级下一级`);
            break;
          }
        }
      }
    }
    if (!used) throw lastErr instanceof Error ? lastErr : new Error('全部 3D 引擎级联失败');
    engineUsed = used;
  }

  const glbInfo = await stat(glbAbs).catch(() => null);
  if (!glbInfo || glbInfo.size === 0) throw new Error('3D 模型生成失败：GLB 文件为空');

  const final = getProject(id);
  if (!final) return;
  final.avatar = {
    status: 'done',
    stage: undefined,
    styledImageUrl: STYLE_ENABLED || mock ? styledRel : undefined,
    modelUrl: glbRel,
  };
  touch(final);
  await log(id, `SUCCEEDED engine=${engineUsed} glb=${glbRel} bytes=${glbInfo.size}`);

  // ---- 步骤6：avatar done 后自动触发切片 ----
  const p = getProject(id);
  if (p) {
    await log(id, `auto-trigger avatar-slice scaleMm=${scaleMm}`);
    startAvatarSlice(p, scaleMm, mock);
  }
}

// Meshy 路径：风格化立绘正面单图 → image-to-3d。
async function runMeshyEngine(id: string, imageAbs: string, mock: boolean, glbAbs: string, glbRel: string) {
  await setStage(id, 'modeling');
  if (mock) {
    for (const _ of [0, 1]) await new Promise((r) => setTimeout(r, 700));
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'mock-model.glb'), glbAbs);
    await log(id, `mock meshy model copied → ${glbRel}`);
    return;
  }
  await log(id, `meshy submit image-to-3d input=${imageAbs}`);
  const taskId = await meshySubmitImageTo3d(imageAbs);
  await log(id, `meshy taskId=${taskId}`);
  const result = await meshyPoll(taskId, async (r, c) => {
    await log(id, `poll meshy #${c} status=${r.status} progress=${r.progress ?? ''}`);
  });
  const url = meshyGlbUrl(result);
  const bytes = await meshyDownload(url, glbAbs);
  await log(id, `meshy glb downloaded bytes=${bytes} → ${glbRel}`);
}

// Tripo 路径：立绘 → fal 三视图网格 → 裁切+独立性验证（不合格重生成≤2）→ multiview_to_model。
async function runTripoEngine(
  id: string,
  imageAbs: string,
  input: StartAvatarInput,
  mock: boolean,
  dir: string,
  viewsDir: string,
  glbAbs: string,
  glbRel: string,
) {
  const gridRel = `/generated/${id}/avatar/triview-grid.png`;
  const gridAbs = path.join(dir, 'triview-grid.png');
  await setStage(id, 'triview');

  if (mock) {
    // mock 下也真跑裁切+验证分支（证明代码路径），用 mockup 三视图源。
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'scheme-a-mushroom-v1.jpg'), gridAbs);
    const cropped = await cropTriviewToViews(gridAbs, viewsDir);
    const validation = await validateViews(cropped.orderedForTripo);
    await writeFile(path.join(dir, 'triview-validation.json'), JSON.stringify(validation, null, 2));
    await log(id, `mock triview crop+validate ok=${validation.ok} reasons=${validation.reasons.join('; ')}`);
    await setStage(id, 'modeling');
    await new Promise((r) => setTimeout(r, 1000));
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'mock-model.glb'), glbAbs);
    await log(id, `mock tripo model copied → ${glbRel}`);
    return;
  }

  // 三视图生成 + 验证，不合格重生成最多 2 次。
  const prompt = buildTriviewGridPrompt({ species: input.species });
  const styledUri = await fileToDataUri(imageAbs);
  let cropped: Awaited<ReturnType<typeof cropTriviewToViews>> | null = null;
  let lastValidation: Awaited<ReturnType<typeof validateViews>> | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await log(id, `fal triview-grid attempt #${attempt}`);
    const url = await withRetry('fal triview', () => falEditImage(prompt, [styledUri]));
    await downloadImage(url, gridAbs);
    cropped = await cropTriviewToViews(gridAbs, viewsDir);
    lastValidation = await validateViews(cropped.orderedForTripo);
    await writeFile(path.join(dir, 'triview-validation.json'), JSON.stringify(lastValidation, null, 2));
    await log(id, `triview validate #${attempt} ok=${lastValidation.ok} reasons=${lastValidation.reasons.join('; ')}`);
    if (lastValidation.ok) break;
    if (attempt === 3) throw new Error(`三视图独立性验证连续失败：${lastValidation.reasons.join('; ')}`);
  }
  if (!cropped) throw new Error('三视图裁切失败');

  // 验证通过后补白边再提交（必须在验证之后——补白会掩盖跨格信号）。上下贴边由此治愈。
  await padViews(cropped.orderedForTripo, 6);
  await log(id, `views padded +6% white margin`);

  await setStage(id, 'modeling');
  await log(id, `tripo submit multiview (front/left/back)`);
  const submit = await tripoSubmitTriview(cropped.orderedForTripo);
  await writeFile(path.join(dir, 'tripo-submit.json'), JSON.stringify(submit.response, null, 2));
  await log(id, `tripo taskId=${submit.taskId}`);
  const gen = await tripoPollTask(submit.taskId, {
    intervalMs: 5000,
    timeoutMs: 10 * 60_000,
    onPoll: async (r, c) => log(id, `poll tripo #${c} status=${r.data?.status} progress=${r.data?.progress ?? ''}`),
  });
  await writeFile(path.join(dir, 'tripo-result.json'), JSON.stringify(gen, null, 2));
  const bytes = await tripoDownloadFile(tripoGlbUrlFrom(gen), glbAbs);
  await log(id, `tripo glb downloaded bytes=${bytes} → ${glbRel}`);
}

// ===================== 自动切片（复制 gate2Job normalize→PrusaSlicer→parseGcodeMeta，跳过挖腔）=====================
// 直接吃 avatar 的 model.glb，按体型档 scaleMm 归一化后切片；同 mm 已有产物直接返回（幂等）。
// batch0 ownership：本 job 内联在 avatarJob.ts 内（app/lib/jobs 只此一文件属本批次），不新建 sliceJob 文件。

const UV_BIN = process.env.UV_BIN || '/opt/homebrew/bin/uv';
const PRUSA_BIN = process.env.PRUSASLICER_BIN || '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer';

// 材料单价（元/g），用于报价。与 landing data.js materialRows 的 PETG ¥0.42/g 对齐。
export const FILAMENT_PRICE_PER_G = 0.42;

function publicToAbs(publicPath: string) {
  return path.join(workingDir, 'public', publicPath.replace(/^\//, ''));
}

async function sliceLog(id: string, line: string) {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true }).catch(() => {});
  await appendFile(path.join(dir, 'avatar-slice.log'), `[${new Date().toISOString()}] ${line}\n`).catch(() => {});
  console.log(`[avatar-slice ${id}] ${line}`);
}

// avatar-slice 入口：置 avatarSlice=running，后台跑，前端轮询。幂等由 runAvatarSlice 内部处理。
export function startAvatarSlice(project: PetScapeProject, scaleMm: number, mock: boolean) {
  const inputPublic = project.avatar?.modelUrl;
  if (!inputPublic) throw new Error('缺少 avatar model.glb，无法切片');

  // 幂等：同 mm 已 done 直接返回（换档重切时前端会带新 mm）。
  if (project.avatarSlice?.status === 'done' && project.avatarSlice.scaleMm === scaleMm) {
    return;
  }
  project.avatarSlice = { status: 'running', scaleMm };
  touch(project);

  void withTimeout('slice', JOB_TIMEOUT_MS.slice, () => runAvatarSlice(project.id, inputPublic, scaleMm, mock)).catch(
    async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await sliceLog(project.id, `FAILED ${message}`);
      const p = getProject(project.id);
      if (p) { p.avatarSlice = { status: 'failed', scaleMm, error: message }; touch(p); }
    },
  );
}

async function runAvatarSlice(id: string, inputPublic: string, scaleMm: number, mock: boolean) {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true });
  const targetMm = Math.round(scaleMm);
  const stlPublic = `/generated/${id}/avatar/print-${targetMm}mm.stl`;
  const gcodePublic = `/generated/${id}/avatar/print-${targetMm}mm.gcode`;
  const stlAbs = publicToAbs(stlPublic);
  const gcodeAbs = publicToAbs(gcodePublic);

  await sliceLog(id, `START mock=${mock} input=${inputPublic} targetMm=${targetMm}`);

  // 幂等：同 mm 产物已存在（且非空）→ 直接回填，不重切。
  const existStl = await stat(stlAbs).catch(() => null);
  const existGcode = await stat(gcodeAbs).catch(() => null);
  if (existStl?.size && existGcode?.size) {
    const raw = await readGcodeMeta(gcodeAbs);
    // mock 的 gcode 是同一份拷贝，header 恒为基准值——回填时同样按 mm 立方缩放，与首切一致。
    const cubic = Math.pow(targetMm / 120, 3);
    const meta = mock
      ? {
          estimatedTime: raw.estimatedTime,
          weightG: raw.weightG ? Math.round(raw.weightG * cubic * 10) / 10 : undefined,
          printTimeMin: raw.printTimeMin ? Math.round(raw.printTimeMin * cubic) : undefined,
        }
      : raw;
    finishSlice(id, stlPublic, gcodePublic, targetMm, meta);
    await sliceLog(id, `idempotent hit → reuse ${stlPublic}`);
    return;
  }

  if (mock) {
    // demo 双轨会在 mock 下演示换档重切——重量/时长必须随 mm 变化，且"计算中"要肉眼可见，
    // 否则数字纹丝不动会露馅（批次1 verifier Story 2）。按体积立方缩放伪造 meta，1.5s 延时。
    await new Promise((r) => setTimeout(r, 1500));
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'mock-model.stl'), stlAbs);
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'mock-model.gcode'), gcodeAbs);
    const base = await readGcodeMeta(gcodeAbs);
    const cubic = Math.pow(targetMm / 120, 3);
    const meta = {
      estimatedTime: base.estimatedTime,
      weightG: base.weightG ? Math.round(base.weightG * cubic * 10) / 10 : undefined,
      printTimeMin: base.printTimeMin ? Math.round(base.printTimeMin * cubic) : undefined,
    };
    finishSlice(id, stlPublic, gcodePublic, targetMm, meta);
    await sliceLog(id, `mock STL/G-code copied → ${stlPublic} ${gcodePublic} (scaled meta ${meta.weightG}g)`);
    return;
  } else {
    const script = path.join(workingDir, 'scripts', 'normalize_mesh.py');
    const inputAbs = publicToAbs(inputPublic);
    await sliceLog(id, `normalize input=${inputPublic} targetMm=${targetMm}`);
    await execFileAsync(
      UV_BIN,
      ['run', '--with', 'trimesh', 'python3', script, '--input', inputAbs, '--output', stlAbs, '--target-mm', String(targetMm)],
      { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
    );
    await sliceLog(id, `prusaslicer export gcode=${gcodePublic}`);
    try {
      await execFileAsync(
        PRUSA_BIN,
        ['--export-gcode', '--layer-height', '0.2', '--fill-density', '15%', '--support-material', '--output', gcodeAbs, stlAbs],
        { timeout: 10 * 60_000, maxBuffer: 20 * 1024 * 1024 },
      );
    } catch (error: any) {
      const out = `${error?.stdout || ''}\n${error?.stderr || ''}`;
      await sliceLog(id, `prusaslicer failed output=${out.slice(0, 1500)}`);
      throw new Error(`PrusaSlicer 切片失败：${error?.message || String(error)}`);
    }
    await sliceLog(id, `prusaslicer done`);
  }

  const stlInfo = await stat(stlAbs).catch(() => null);
  const gcodeInfo = await stat(gcodeAbs).catch(() => null);
  if (!stlInfo || stlInfo.size === 0) throw new Error('STL 文件为空');
  if (!gcodeInfo || gcodeInfo.size === 0) throw new Error('G-code 文件为空');
  const meta = await readGcodeMeta(gcodeAbs);
  finishSlice(id, stlPublic, gcodePublic, targetMm, meta);
  await sliceLog(id, `SUCCEEDED stl=${stlPublic} gcode=${gcodePublic} weightG=${meta.weightG} time=${meta.estimatedTime || ''}`);
}

function finishSlice(
  id: string,
  stlPublic: string,
  gcodePublic: string,
  scaleMm: number,
  meta: { estimatedTime?: string; weightG?: number; printTimeMin?: number },
) {
  const final = getProject(id);
  if (!final) return;
  final.avatarSlice = {
    status: 'done',
    scaleMm,
    stlUrl: stlPublic,
    gcodeUrl: gcodePublic,
    weightG: meta.weightG,
    printTimeMin: meta.printTimeMin,
  };
  touch(final);
}
