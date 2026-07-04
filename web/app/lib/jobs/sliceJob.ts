import { appendFile, mkdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSession, makeMessage } from '../store/sessions';
import type { Session } from '../types/session';
import { JOB_TIMEOUT_MS, JobTimeoutError, userTimeoutMessage, withTimeout } from './timeouts';

const execFileAsync = promisify(execFile);
const UV_BIN = process.env.UV_BIN || '/opt/homebrew/bin/uv';
const PRUSA_BIN = process.env.PRUSASLICER_BIN || '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer';

function publicToAbs(publicPath: string) {
  return path.join(process.cwd(), 'public', publicPath.replace(/^\//, ''));
}

function sessionDir(sessionId: string) {
  return path.join(process.cwd(), 'public', 'generated', sessionId);
}

async function log(sessionId: string, line: string) {
  const dir = sessionDir(sessionId);
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, 'slice.log'), `[${new Date().toISOString()}] ${line}\n`);
  console.log(`[slice ${sessionId}] ${line}`);
}

export function parsePetSizeMm(petSize?: string) {
  const raw = (petSize || '').trim().toLowerCase();
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|公分|m|米)?/i);
  if (!match) return { mm: 100, note: `尺寸“${petSize || '未填写'}”无法解析，默认按 100mm 缩放。` };
  const value = Number(match[1]);
  const unit = match[2] || 'cm';
  let mm = value;
  if (/^(cm|厘米|公分)$/.test(unit)) mm = value * 10;
  else if (/^(m|米)$/.test(unit)) mm = value * 1000;
  if (!Number.isFinite(mm) || mm <= 0) return { mm: 100, note: `尺寸“${petSize || '未填写'}”无效，默认按 100mm 缩放。` };
  return { mm, note: undefined };
}

function nextSliceIndex(session: Session) {
  const existing = session.messages.filter((m) => m.sliceResult).length;
  return existing + 1;
}

function parseWarnings(output: string) {
  const warnings: string[] = [];
  const patterns: { re: RegExp; label: string }[] = [
    { re: /floating object part[^\n]*/gi, label: 'Floating object part（存在悬浮碎体）' },
    { re: /floating bridge anchors[^\n]*/gi, label: 'Floating bridge anchors（桥接锚点悬空）' },
    { re: /collapsing overhang[^\n]*/gi, label: 'Collapsing overhang（悬垂可能塌陷）' },
    { re: /low bed adhesion[^\n]*/gi, label: 'Low bed adhesion（底床附着力不足）' },
    { re: /thin fragile part[^\n]*/gi, label: 'Thin fragile part（局部薄弱易断）' },
    { re: /overhang[^\n]*/gi, label: 'Overhang（存在悬垂区域）' },
    { re: /bed adhesion[^\n]*/gi, label: 'Bed adhesion（底床附着相关提示）' },
  ];
  for (const { re, label } of patterns) {
    if (re.test(output) && !warnings.includes(label)) warnings.push(label);
  }
  for (const line of output.split(/\r?\n/)) {
    if (/(warning|警告|\[error\])/i.test(line) && !warnings.includes(line.trim())) warnings.push(line.trim());
  }
  return warnings.slice(0, 20);
}

function parseGcodeMeta(header: string) {
  const timeMatch = header.match(/(?:estimated printing time[^\n:]*|print time[^\n:]*|;\s*estimated printing time)\s*[:=]\s*([^\n;]+)/i);
  const filamentMm = header.match(/filament used \[mm\]\s*=\s*([^\n]+)/i);
  const filamentCm3 = header.match(/filament used \[cm3\]\s*=\s*([^\n]+)/i);
  const filamentG = header.match(/filament used \[g\]\s*=\s*([^\n]+)/i);
  const filamentM = header.match(/filament used \[m\]\s*=\s*([^\n]+)/i);
  const filament = [
    filamentCm3 && `${filamentCm3[1].trim()} cm³`,
    filamentG && `${filamentG[1].trim()} g`,
    filamentM && `${filamentM[1].trim()} m`,
    filamentMm && `${filamentMm[1].trim()} mm`,
  ].filter(Boolean).join(' / ');
  return { estimatedTime: timeMatch?.[1]?.trim(), filament: filament || undefined };
}

async function readGcodeMeta(gcodeAbs: string) {
  const buf = await readFile(gcodeAbs, 'utf8');
  const sample = `${buf.slice(0, 120_000)}\n${buf.slice(-120_000)}`;
  return parseGcodeMeta(sample);
}

export async function runSlicePipeline(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const inputPublic = session.meshy?.repairedGlbPath || session.meshy?.glbPath;
  if (!inputPublic) throw new Error('缺少 GLB，无法切片');
  const dir = sessionDir(sessionId);
  await mkdir(dir, { recursive: true });
  const index = nextSliceIndex(session);
  const target = parsePetSizeMm(session.brief.petSize);
  const inputAbs = publicToAbs(inputPublic);
  const stlPublic = `/generated/${sessionId}/model-${index}-normalized-${Math.round(target.mm)}mm.stl`;
  const gcodePublic = `/generated/${sessionId}/model-${index}-${Math.round(target.mm)}mm.gcode`;
  const stlAbs = publicToAbs(stlPublic);
  const gcodeAbs = publicToAbs(gcodePublic);

  await log(sessionId, `START timeoutMs=${JOB_TIMEOUT_MS.slice}`);
  await log(sessionId, `normalize input=${inputPublic} targetMm=${target.mm}`);
  session.pendingJob = { type: 'slice', status: 'running', progress: 15 };
  const script = path.join(process.cwd(), 'scripts', 'normalize_mesh.py');
  const norm = await execFileAsync(UV_BIN, ['run', '--with', 'trimesh', 'python3', script, '--input', inputAbs, '--output', stlAbs, '--target-mm', String(target.mm)], { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 });
  const normalizeResult = JSON.parse(norm.stdout.trim().split(/\r?\n/).at(-1) || '{}');
  await log(sessionId, `normalize ok extents=${JSON.stringify(normalizeResult.actualExtentsMm)} stderr=${norm.stderr.trim()}`);

  session.pendingJob = { type: 'slice', status: 'running', progress: 55 };
  await log(sessionId, `prusaslicer export gcode=${gcodePublic}`);
  let prusaOut = '';
  try {
    const prusa = await execFileAsync(PRUSA_BIN, ['--export-gcode', '--layer-height', '0.2', '--fill-density', '15%', '--support-material', '--output', gcodeAbs, stlAbs], { timeout: 10 * 60_000, maxBuffer: 20 * 1024 * 1024 });
    prusaOut = `${prusa.stdout}\n${prusa.stderr}`;
  } catch (error: any) {
    prusaOut = `${error?.stdout || ''}\n${error?.stderr || ''}`;
    await log(sessionId, `prusaslicer failed output=${prusaOut.slice(0, 4000)}`);
    throw new Error(`PrusaSlicer 切片失败：${error?.message || String(error)}`);
  }
  await log(sessionId, `prusaslicer output=${prusaOut.slice(0, 4000).replace(/\n/g, ' | ')}`);

  const size = (await stat(gcodeAbs)).size;
  if (size <= 0) throw new Error('G-code 文件为空');
  const warnings = parseWarnings(prusaOut);
  if (target.note) warnings.unshift(target.note);
  const meta = await readGcodeMeta(gcodeAbs);

  const current = getSession(sessionId);
  if (!current) return { stlPath: stlPublic, gcodePath: gcodePublic, warnings, normalizeResult, ...meta, gcodeBytes: size };
  current.slice = { stlPath: stlPublic, gcodePath: gcodePublic, warnings, estimatedTime: meta.estimatedTime, filament: meta.filament, normalize: normalizeResult };
  current.stage = 'done';
  delete current.pendingJob;
  current.messages.push(makeMessage('assistant', '切片完成。下面是 G-code 与 STL 下载、预估打印信息和切片警告。', undefined, undefined, true));
  await log(sessionId, `SUCCEEDED gcodeBytes=${size} warnings=${warnings.join('; ')} time=${meta.estimatedTime || ''} filament=${meta.filament || ''}`);
  return { stlPath: stlPublic, gcodePath: gcodePublic, warnings, normalizeResult, ...meta, gcodeBytes: size };
}

export function startSliceJob(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return;
  session.stage = 'slicing';
  session.pendingJob = { type: 'slice', status: 'running', progress: 0 };
  session.messages.push(makeMessage('assistant', '已确认 3D 模型。我开始标准化尺寸/方向并调用 PrusaSlicer 切片。'));
  void withTimeout('slice', JOB_TIMEOUT_MS.slice, () => runSlicePipeline(sessionId)).catch(async (error) => {
    const current = getSession(sessionId);
    const message = error instanceof JobTimeoutError ? userTimeoutMessage('slice') : error instanceof Error ? error.message : String(error);
    await log(sessionId, `${error instanceof JobTimeoutError ? 'TIMEOUT' : 'FAILED'} ${message}`).catch(() => undefined);
    if (!current) return;
    current.stage = 'slicing';
    current.pendingJob = { type: 'slice', status: 'failed', error: message };
    current.messages.push(makeMessage('assistant', `切片失败：${message}\n你可以直接再回复“重试切片”，我会从当前 GLB 继续。`));
  });
}
