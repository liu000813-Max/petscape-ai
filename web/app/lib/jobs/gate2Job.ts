import { appendFile, copyFile, mkdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getProject, touch } from '../store/projects';
import type { ModelConfig, PetScapeProject } from '../types/project';
import { JOB_TIMEOUT_MS, withTimeout } from './timeouts';

// 门 2 竖切链路（复用 legacy sliceJob 的 normalize_mesh.py + PrusaSlicer，但驱动 project 单例）：
//   确认的修复几何 GLB → normalize 到 modelConfig.scaleMm → PrusaSlicer 切 G-code → STL + G-code 下载。
// mock=1：用 public/mockup-assets 现成 STL/G-code 当产物，不跑真实切片。

const workingDir = process.cwd();
const UV_BIN = process.env.UV_BIN || '/opt/homebrew/bin/uv';
const PRUSA_BIN = process.env.PRUSASLICER_BIN || '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer';
const execFileAsync = promisify(execFile);

function projectDir(id: string) {
  return path.join(workingDir, 'public', 'generated', id);
}
function publicToAbs(publicPath: string) {
  return path.join(workingDir, 'public', publicPath.replace(/^\//, ''));
}
async function log(id: string, line: string) {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true }).catch(() => {});
  await appendFile(path.join(dir, 'gate2.log'), `[${new Date().toISOString()}] ${line}\n`).catch(() => {});
  console.log(`[gate2 ${id}] ${line}`);
}

function parseWarnings(output: string) {
  const warnings: string[] = [];
  const patterns: { re: RegExp; label: string }[] = [
    { re: /collapsing overhang[^\n]*/gi, label: 'Collapsing overhang（悬垂可能塌陷）' },
    { re: /low bed adhesion[^\n]*/gi, label: 'Low bed adhesion（底床附着力不足）' },
    { re: /thin fragile part[^\n]*/gi, label: 'Thin fragile part（局部薄弱易断）' },
  ];
  for (const { re, label } of patterns) if (re.test(output) && !warnings.includes(label)) warnings.push(label);
  for (const line of output.split(/\r?\n/)) {
    if (/(warning|警告|\[error\])/i.test(line) && !warnings.includes(line.trim())) warnings.push(line.trim());
  }
  return warnings.slice(0, 15);
}

function parseGcodeMeta(header: string) {
  const timeMatch = header.match(/(?:estimated printing time[^\n:]*|print time[^\n:]*)\s*[:=]\s*([^\n;]+)/i);
  const filamentG = header.match(/filament used \[g\]\s*=\s*([^\n]+)/i);
  const filamentM = header.match(/filament used \[m\]\s*=\s*([^\n]+)/i);
  const filament = [filamentG && `${filamentG[1].trim()} g`, filamentM && `${filamentM[1].trim()} m`].filter(Boolean).join(' / ');
  return { estimatedTime: timeMatch?.[1]?.trim(), filament: filament || undefined };
}
async function readGcodeMeta(gcodeAbs: string) {
  const buf = await readFile(gcodeAbs, 'utf8');
  return parseGcodeMeta(`${buf.slice(0, 120_000)}\n${buf.slice(-120_000)}`);
}

// 门 2 入口：写入 modelConfig、置 slice=running，后台跑切片，前端轮询。
export function startGate2(project: PetScapeProject, config: ModelConfig, mock: boolean) {
  const inputPublic = project.model3d?.repairedGlbPath || project.model3d?.glbPath;
  if (!inputPublic) throw new Error('缺少 3D 模型 GLB，无法切片');
  project.modelConfig = config;
  project.slice = { status: 'running', progress: 5 };
  touch(project);

  void withTimeout('slice', JOB_TIMEOUT_MS.slice, () => runGate2(project.id, inputPublic, config, mock)).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await log(project.id, `FAILED ${message}`);
    const p = getProject(project.id);
    if (p) { p.slice = { status: 'failed', error: message }; touch(p); }
  });
}

async function runGate2(id: string, inputPublic: string, config: ModelConfig, mock: boolean) {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true });
  const targetMm = Math.round(config.scaleMm);
  const stlPublic = `/generated/${id}/print-${targetMm}mm.stl`;
  const gcodePublic = `/generated/${id}/print-${targetMm}mm.gcode`;
  const stlAbs = publicToAbs(stlPublic);
  const gcodeAbs = publicToAbs(gcodePublic);

  await log(id, `START mock=${mock} input=${inputPublic} targetMm=${targetMm} color=${config.color} material=${config.material}`);

  if (mock) {
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'mock-model.stl'), stlAbs);
    await copyFile(path.join(workingDir, 'public', 'mockup-assets', 'mock-model.gcode'), gcodeAbs);
    await log(id, `mock STL/G-code copied → ${stlPublic} ${gcodePublic}`);
  } else {
    const p1 = getProject(id);
    if (p1?.slice) { p1.slice.progress = 20; touch(p1); }
    const script = path.join(workingDir, 'scripts', 'normalize_mesh.py');
    const inputAbs = publicToAbs(inputPublic);
    await log(id, `normalize input=${inputPublic} targetMm=${targetMm}`);
    const norm = await execFileAsync(
      UV_BIN,
      ['run', '--with', 'trimesh', 'python3', script, '--input', inputAbs, '--output', stlAbs, '--target-mm', String(targetMm)],
      { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
    );
    const normalizeResult = JSON.parse(norm.stdout.trim().split(/\r?\n/).at(-1) || '{}');
    await log(id, `normalize ok extents=${JSON.stringify(normalizeResult.actualExtentsMm)}`);
    const p2 = getProject(id);
    if (p2?.slice) { p2.slice.progress = 55; p2.slice.actualExtentsMm = normalizeResult.actualExtentsMm; touch(p2); }

    await log(id, `prusaslicer export gcode=${gcodePublic}`);
    let prusaOut = '';
    try {
      const prusa = await execFileAsync(
        PRUSA_BIN,
        ['--export-gcode', '--layer-height', '0.2', '--fill-density', '15%', '--support-material', '--output', gcodeAbs, stlAbs],
        { timeout: 10 * 60_000, maxBuffer: 20 * 1024 * 1024 },
      );
      prusaOut = `${prusa.stdout}\n${prusa.stderr}`;
    } catch (error: any) {
      prusaOut = `${error?.stdout || ''}\n${error?.stderr || ''}`;
      await log(id, `prusaslicer failed output=${prusaOut.slice(0, 2000)}`);
      throw new Error(`PrusaSlicer 切片失败：${error?.message || String(error)}`);
    }
    await log(id, `prusaslicer done output=${prusaOut.slice(0, 1500).replace(/\n/g, ' | ')}`);
    const p3 = getProject(id);
    if (p3?.slice) { p3.slice.warnings = parseWarnings(prusaOut); touch(p3); }
  }

  const stlInfo = await stat(stlAbs).catch(() => null);
  const gcodeInfo = await stat(gcodeAbs).catch(() => null);
  if (!stlInfo || stlInfo.size === 0) throw new Error('STL 文件为空');
  if (!gcodeInfo || gcodeInfo.size === 0) throw new Error('G-code 文件为空');
  const meta = await readGcodeMeta(gcodeAbs);

  const final = getProject(id);
  if (!final) return;
  final.slice = {
    status: 'ready',
    stlPath: stlPublic,
    gcodePath: gcodePublic,
    estimatedTime: meta.estimatedTime,
    filament: meta.filament,
    actualExtentsMm: final.slice?.actualExtentsMm,
    warnings: final.slice?.warnings,
    progress: 100,
  };
  touch(final);
  await log(id, `SUCCEEDED stl=${stlPublic} gcode=${gcodePublic} bytes=${gcodeInfo.size} time=${meta.estimatedTime || ''}`);
}
