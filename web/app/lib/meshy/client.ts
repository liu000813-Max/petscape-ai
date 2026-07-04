import { readFileSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const BASE_URL = 'https://api.meshy.ai/openapi/v1';

type Json = Record<string, unknown>;

export interface MeshyPollResult extends Json {
  id?: string;
  status?: string;
  progress?: number;
  task_error?: unknown;
  model_urls?: { glb?: string };
  model_url?: string;
  printability?: MeshyPrintability;
}

export interface MeshyPrintability {
  status?: string;
  issue_count?: number;
  error_count?: number;
  warning_count?: number;
  metrics?: Record<string, unknown>;
}

function readApiKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  // next dev 从 web/ 启动时默认不会读取项目根 .env；服务端兜底读取 ../.env，绝不暴露到前端。
  for (const envPath of [path.join(process.cwd(), '.env.local'), path.join(process.cwd(), '..', '.env')]) {
    try {
      const match = readFileSync(envPath, 'utf8').match(/^MESHY_API_KEY=(.+)$/m);
      if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {}
  }
  throw new Error('服务端未配置 MESHY_API_KEY（请在项目根 .env 或 web/.env.local 中配置）');
}

async function api<T extends Json>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${readApiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  const text = await res.text();
  let json: unknown = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname} failed: ${res.status} ${text}`);
  return json as T;
}

function taskIdFrom(response: Json) {
  const id = response.result || response.id;
  if (typeof id !== 'string' || !id) throw new Error(`Meshy 响应缺少 task id: ${JSON.stringify(response)}`);
  return id;
}

function mimeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

export async function imageFileToDataUri(absPath: string) {
  const data = await readFile(absPath);
  return `data:${mimeFromPath(absPath)};base64,${data.toString('base64')}`;
}

export async function submitImageTo3d(imageAbsPath: string) {
  const image_url = await imageFileToDataUri(imageAbsPath);
  const response = await api('/image-to-3d', {
    method: 'POST',
    body: JSON.stringify({
      image_url,
      should_remesh: true,
      should_texture: true,
      topology: 'triangle',
      target_polycount: 100000,
    }),
  });
  return { taskId: taskIdFrom(response), response };
}

export async function getImageTo3d(taskId: string) {
  return api<MeshyPollResult>(`/image-to-3d/${taskId}`);
}

export async function submitPrintabilityAnalyze(inputTaskId: string) {
  const response = await api('/print/analyze', { method: 'POST', body: JSON.stringify({ input_task_id: inputTaskId }) });
  return { taskId: taskIdFrom(response), response };
}

export async function getPrintabilityAnalyze(taskId: string) {
  return api<MeshyPollResult>(`/print/analyze/${taskId}`);
}

export async function submitRepair(inputTaskId: string) {
  const response = await api('/print/repair', { method: 'POST', body: JSON.stringify({ input_task_id: inputTaskId }) });
  return { taskId: taskIdFrom(response), response };
}

export async function getRepair(taskId: string) {
  return api<MeshyPollResult>(`/print/repair/${taskId}`);
}

export async function pollTask(kind: 'image-to-3d' | 'print/analyze' | 'print/repair', taskId: string, opts?: { intervalMs?: number; timeoutMs?: number; onPoll?: (r: MeshyPollResult, count: number) => void | Promise<void> }) {
  const started = Date.now();
  const intervalMs = opts?.intervalMs ?? (kind === 'image-to-3d' ? 15000 : 2000);
  const timeoutMs = opts?.timeoutMs ?? (kind === 'image-to-3d' ? 8 * 60_000 : 2 * 60_000);
  let count = 0;
  while (true) {
    count += 1;
    const result = kind === 'image-to-3d' ? await getImageTo3d(taskId) : kind === 'print/analyze' ? await getPrintabilityAnalyze(taskId) : await getRepair(taskId);
    await opts?.onPoll?.(result, count);
    if (result.status === 'SUCCEEDED') return result;
    if (result.status === 'FAILED' || result.status === 'CANCELED' || result.task_error) throw new Error(`${kind} ${taskId} failed: ${JSON.stringify(result.task_error || result)}`);
    if (Date.now() - started > timeoutMs) throw new Error(`${kind} ${taskId} polling timeout`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function downloadFile(url: string, absPath: string) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`下载 Meshy 文件失败 ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buf);
  return buf.length;
}

export function glbUrlFrom(result: MeshyPollResult) {
  const url = result.model_urls?.glb || result.model_url;
  if (!url) throw new Error(`Meshy 结果缺少 GLB URL: ${JSON.stringify(result)}`);
  return url;
}

export function printabilityNeedsRepair(printability?: MeshyPrintability) {
  if (!printability) return true;
  const metrics = printability.metrics || {};
  return printability.status === 'error' || (printability.error_count ?? 0) > 0 || metrics.is_watertight === false || Number(metrics.non_manifold_edges || 0) > 0 || Number(metrics.holes || 0) > 0;
}

export function summarizePrintability(printability?: MeshyPrintability) {
  if (!printability) return ['未返回 printability 结果'];
  const metrics = printability.metrics || {};
  const issues: string[] = [];
  if (printability.status) issues.push(`status=${printability.status}`);
  if (typeof printability.error_count === 'number') issues.push(`errors=${printability.error_count}`);
  if (typeof printability.warning_count === 'number') issues.push(`warnings=${printability.warning_count}`);
  for (const key of ['is_watertight', 'non_manifold_edges', 'degenerate_faces', 'holes', 'volume']) {
    if (metrics[key] !== undefined) issues.push(`${key}=${String(metrics[key])}`);
  }
  return issues;
}
