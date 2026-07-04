import { mkdir, readFile, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';

// Tripo openapi client（gate1 主链 3D 引擎）。
// 用法参考 experiments/fidelity-test/run-tripo.mjs：
//   1) 每张视图先 POST /upload（multipart）拿 file_token（Tripo 不吃 base64，必须先传文件拿 token）
//   2) POST /task type=multiview_to_model，files 按 [front, left, back, right]（FLBR）顺序
//   3) 轮询 GET /task/{id} 直到 success，output.pbr_model|model 为 GLB URL
// key 名：项目根 .env 的 TRIPO_API_KEY。

const BASE = 'https://api.tripo3d.ai/v2/openapi';
export const TRIPO_MODEL_VERSION = 'v3.0-20250812';

function readApiKey(): string {
  if (process.env.TRIPO_API_KEY) return process.env.TRIPO_API_KEY;
  // next dev 从 web/ 启动时默认不读项目根 .env；服务端兜底读 ../.env，绝不暴露到前端。
  for (const envPath of [path.join(process.cwd(), '.env.local'), path.join(process.cwd(), '..', '.env')]) {
    try {
      const match = readFileSync(envPath, 'utf8').match(/^TRIPO_API_KEY=(.+)$/m);
      if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {}
  }
  throw new Error('服务端未配置 TRIPO_API_KEY（请在项目根 .env 或 web/.env.local 中配置）');
}

function authHeader() {
  return { Authorization: `Bearer ${readApiKey()}` };
}

type Json = Record<string, unknown>;

async function apiJson(pathname: string, init: RequestInit = {}): Promise<Json> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { ...authHeader(), ...(init.headers || {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  let json: Json = {};
  try { json = text ? (JSON.parse(text) as Json) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname} ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

// 网络层瞬时抖动重试：上传/提交与轮询同等待遇，单次 fetch failed 不判死任务
async function withTransientRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw lastErr instanceof Error ? new Error(`${label} 重试 ${attempts} 次仍失败: ${lastErr.message}`) : lastErr;
}

// 单张视图上传 → file_token。Tripo /upload 走 multipart，字段名 file。
export async function uploadImage(absPath: string): Promise<{ token: string; ext: string }> {
  const buf = await readFile(absPath);
  const ext = path.extname(absPath).slice(1).toLowerCase() || 'png';
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)], { type: `image/${ext}` }), path.basename(absPath));
  const res = await fetch(`${BASE}/upload`, { method: 'POST', headers: authHeader(), body: fd });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { json = { raw: text }; }
  const code = (json as { code?: number }).code;
  if (!res.ok || (code !== undefined && code !== 0)) throw new Error(`tripo upload ${res.status}: ${text.slice(0, 300)}`);
  const data = (json as { data?: { image_token?: string; file_token?: string; token?: string } }).data || {};
  const token = data.image_token || data.file_token || data.token;
  if (!token) throw new Error(`tripo upload 未返回 token: ${text.slice(0, 200)}`);
  return { token, ext };
}

// 提交 multiview_to_model。viewPaths 必须按 [front, left, back, right]（FLBR）顺序传入。
export async function submitMultiviewToModel(viewPaths: string[]): Promise<{ taskId: string; response: Json }> {
  if (viewPaths.length !== 4) throw new Error(`multiview 需要 4 张视图，收到 ${viewPaths.length}`);
  const files: Array<{ type: string; file_token: string }> = [];
  for (const p of viewPaths) {
    const { token, ext } = await withTransientRetry(`tripo upload ${path.basename(p)}`, () => uploadImage(p));
    files.push({ type: ext, file_token: token });
  }
  const body = {
    type: 'multiview_to_model',
    files,
    model_version: TRIPO_MODEL_VERSION,
    orientation: 'align_image',
  };
  const response = await withTransientRetry('tripo submit', () => apiJson('/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const taskId = (response as { data?: { task_id?: string } }).data?.task_id;
  if (!taskId) throw new Error(`tripo /task 未返回 task_id: ${JSON.stringify(response).slice(0, 300)}`);
  return { taskId, response };
}

export interface TripoPollResult extends Json {
  data?: {
    status?: string;
    progress?: number;
    output?: { pbr_model?: string; model?: string; model_url?: string };
  };
}

// 轮询 GET /task/{id}。默认 5s 间隔，超时 10 分钟。
export async function pollTask(
  taskId: string,
  opts?: { intervalMs?: number; timeoutMs?: number; onPoll?: (r: TripoPollResult, count: number) => void | Promise<void> },
): Promise<TripoPollResult> {
  const intervalMs = opts?.intervalMs ?? 5000;
  const timeoutMs = opts?.timeoutMs ?? 10 * 60_000;
  const started = Date.now();
  let count = 0;
  let transientFailures = 0;
  while (true) {
    count += 1;
    let result: TripoPollResult;
    try {
      result = (await apiJson(`/task/${taskId}`)) as TripoPollResult;
      transientFailures = 0;
    } catch (err) {
      // 单次网络抖动不判死任务：Tripo 服务端仍在跑，连续多次失败才放弃
      transientFailures += 1;
      if (transientFailures >= 5) throw err;
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    await opts?.onPoll?.(result, count);
    const status = String(result.data?.status || '').toLowerCase();
    if (status === 'success' || status === 'succeeded') return result;
    if (['failed', 'cancelled', 'canceled', 'banned', 'expired', 'unknown'].includes(status)) {
      throw new Error(`tripo task ${taskId} status=${status}: ${JSON.stringify(result.data).slice(0, 400)}`);
    }
    if (Date.now() - started > timeoutMs) throw new Error(`tripo task ${taskId} 轮询超时`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function glbUrlFrom(result: TripoPollResult): string {
  const out = result.data?.output || {};
  const url = out.pbr_model || out.model || out.model_url;
  if (!url) throw new Error(`tripo 结果缺少 GLB URL: ${JSON.stringify(out).slice(0, 300)}`);
  return url;
}

export async function downloadFile(url: string, absPath: string): Promise<number> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`下载 Tripo GLB 失败 ${res.status}: ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(path.dirname(absPath), { recursive: true });
      await writeFile(absPath, buf);
      return buf.length;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}
