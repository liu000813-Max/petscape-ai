// Batch A offline asset generator — PetScape-final.
// Pipeline (2026-07-04 re-routes): white-bg product image -> SINGLE-image image-to-3d (no multiview grid).
// Engine history:
//   - Tripo image_to_model was the拍板 engine; v3.1 family doesn't exist on this account (code=2017),
//     highest accepted = v3.0-20250812; then account hit credit wall (403 code=2010, balance=10 < ~20/task).
//   - 2026-07-04 user拍板兜底: engine = Meshy image-to-3d (balance probed 740 credits). Ported from old repo
//     web/app/lib/meshy/client.ts (submitImageTo3d/getImageTo3d/pollTask/glbUrlFrom — M-series验收通过).
// Modules: white-bg product images from V3 public/assets/pet-products/. Wearables: fal text-to-image first
//   (nano-banana) — REUSED if source.png already on disk (4 already generated in the Tripo attempt).
// Concurrency: submit+poll concurrently. Poll fault tolerance: <=5 consecutive transient fetch errors don't
//   kill the task (pattern from old tripo client). Per-asset retry: 1 (额度纪律).
// Usage:
//   node generate.mjs --only=cheese-lounge-bed   # canary: single asset
//   node generate.mjs                            # all assets lacking a valid raw.glb (>100KB); merges manifest
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '<REPOSITORY_ROOT>';
const ASSETS = path.join(ROOT, 'assets-3d');
const V3_PRODUCTS = '<USER_HOME>/Desktop/设计师前端页面/public/assets/pet-products';
const OLD_ENV = '<USER_HOME>/Desktop/3D宠物打印/.env';

const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';
const FAL_BASE = 'https://queue.fal.run';
const ENGINE = 'meshy';
const POLL_INTERVAL = 15_000;      // meshy image-to-3d cadence (old client used 15s)
const TIMEOUT_MS = 12 * 60_000;
const GLB_MIN_BYTES = 100_000;

function readEnv(name) {
  const m = fs.readFileSync(OLD_ENV, 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`${name} not found in ${OLD_ENV}`);
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}
const MESHY_KEY = readEnv('MESHY_API_KEY');
const FAL_KEY = readEnv('FAL_KEY');
const meshyAuth = { Authorization: `Bearer ${MESHY_KEY}` };

// ---- asset list (5 modules = V3 modules[] first 5; 4 wearables = V3 wearableItems[]) ----
const MODULES = [
  { id: 'cheese-lounge-bed', title: '奶酪软垫小床' },
  { id: 'banana-bed', title: '香蕉软垫小床' },
  { id: 'banana-layer-pad', title: '夹层香蕉垫' },
  { id: 'hanging-climb-baskets', title: '悬挂藤篮阶梯' },
  { id: 'cheese-play-mat', title: '奶酪洞洞层板' },
];
const WEARABLES = [
  { id: 'knit-hat', title: '迷你针织帽', prompt: 'a tiny knitted beanie hat for a small pet, chunky wool knit texture, warm cream and soft brown colors, product photography, pure white background, single object, centered, soft studio lighting, high detail, no pet, no props' },
  { id: 'chef-scarf', title: '小厨师围巾', prompt: 'a small chef neckerchief scarf for a tiny pet, red and white checkered fabric, folded triangle shape, product photography, pure white background, single object, centered, soft studio lighting, high detail' },
  { id: 'name-charm', title: '名字小吊牌', prompt: 'a small blank pet name tag charm pendant, polished gold metal, rounded bone shape with a ring, product photography, pure white background, single object, centered, soft studio lighting, high detail' },
  { id: 'mini-cape', title: '迷你斗篷', prompt: 'a tiny cape cloak for a small pet, soft red velvet fabric with a gold clasp collar, draped fabric, product photography, pure white background, single object, centered, soft studio lighting, high detail' },
];

const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(line); fs.appendFileSync(path.join(ROOT, 'tools/asset-gen/run.log'), line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { fal: 0, falReused: 0, meshyTasks: 0 };

// ---- Meshy core (ported from old repo web/app/lib/meshy/client.ts) ----
async function meshyJson(pathname, init = {}) {
  const res = await fetch(`${MESHY_BASE}${pathname}`, {
    ...init,
    headers: { ...meshyAuth, 'Content-Type': 'application/json', ...(init.headers || {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) { const e = new Error(`${init.method || 'GET'} ${pathname} ${res.status}: ${text.slice(0, 400)}`); e.status = res.status; e.body = json; throw e; }
  return json;
}
async function withTransientRetry(label, fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      // Do NOT retry hard API rejections (payment/quota/validation) — only transient network/5xx.
      if (err.status && err.status < 500 && err.status !== 429) throw err;
      if (i < attempts - 1) await sleep(2500);
    }
  }
  throw new Error(`${label} retry ${attempts}x failed: ${lastErr?.message}`);
}
function imageToDataUri(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}
async function meshySubmit(imgPath) {
  const body = {
    image_url: imageToDataUri(imgPath),
    should_remesh: true,
    should_texture: true,
    topology: 'triangle',
    target_polycount: 100000,
  };
  const response = await withTransientRetry('meshy submit', () => meshyJson('/image-to-3d', { method: 'POST', body: JSON.stringify(body) }));
  const taskId = response.result || response.id;
  if (typeof taskId !== 'string' || !taskId) throw new Error(`meshy no task id: ${JSON.stringify(response).slice(0, 300)}`);
  return { taskId, response };
}
async function meshyPoll(taskId, slug) {
  const start = Date.now();
  let n = 0, transient = 0;
  while (true) {
    n++;
    let r;
    try { r = await meshyJson(`/image-to-3d/${taskId}`); transient = 0; }
    catch (err) { transient++; if (transient >= 5) throw err; log(`[${slug}] poll transient #${transient} (${String(err.message).slice(0, 80)})`); await sleep(POLL_INTERVAL); continue; }
    log(`[${slug}] #${n} status=${r.status} progress=${r.progress ?? ''}`);
    if (r.status === 'SUCCEEDED') return r;
    if (r.status === 'FAILED' || r.status === 'CANCELED' || r.task_error) throw new Error(`[${slug}] meshy ${r.status}: ${JSON.stringify(r.task_error || r).slice(0, 300)}`);
    if (Date.now() - start > TIMEOUT_MS) throw new Error(`[${slug}] poll timeout`);
    await sleep(POLL_INTERVAL);
  }
}
function glbUrlFrom(result) {
  const url = result.model_urls?.glb || result.model_url;
  if (!url) throw new Error(`meshy result missing GLB URL: ${JSON.stringify(result).slice(0, 300)}`);
  return url;
}
async function download(url, absPath) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, buf);
      return buf.length;
    } catch (err) { lastErr = err; await sleep(3000); }
  }
  throw lastErr;
}
async function meshyBalance() {
  try { return (await meshyJson('/balance')).balance; } catch { return null; }
}

// ---- fal text-to-image (nano-banana) for wearables ----
async function falTextToImage(prompt, outPath) {
  const submitRes = await fetch(`${FAL_BASE}/fal-ai/nano-banana`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, num_images: 1, output_format: 'png' }),
  });
  const submitText = await submitRes.text();
  let submitJson; try { submitJson = JSON.parse(submitText); } catch { submitJson = { raw: submitText }; }
  if (!submitRes.ok) throw new Error(`fal submit ${submitRes.status}: ${submitText.slice(0, 300)}`);
  const reqId = submitJson.request_id;
  if (!reqId) throw new Error(`fal no request_id: ${submitText.slice(0, 200)}`);
  const start = Date.now();
  let imageUrl;
  while (true) {
    await sleep(2500);
    const st = await fetch(`${FAL_BASE}/fal-ai/nano-banana/requests/${reqId}/status`, { headers: { Authorization: `Key ${FAL_KEY}` } });
    const stJson = await st.json();
    if (stJson.status === 'COMPLETED') {
      const r = await fetch(`${FAL_BASE}/fal-ai/nano-banana/requests/${reqId}`, { headers: { Authorization: `Key ${FAL_KEY}` } });
      const rJson = await r.json();
      imageUrl = rJson?.images?.[0]?.url;
      if (!imageUrl) throw new Error(`fal completed but no image: ${JSON.stringify(rJson).slice(0, 200)}`);
      break;
    }
    if (['FAILED', 'ERROR'].includes(stJson.status)) throw new Error(`fal status ${stJson.status}`);
    if (Date.now() - start > 90_000) throw new Error('fal timeout');
  }
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`fal image download ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

// ---- per-asset processing ----
async function runMeshyForImage(entry, dir, localSrc, slug) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    entry.attempts = attempt;
    const t0 = Date.now();
    try {
      log(`[${slug}] meshy attempt ${attempt}: submit`);
      const { taskId, response } = await meshySubmit(localSrc);
      stats.meshyTasks++;
      entry.meshy = { taskId, submit: response };
      const result = await meshyPoll(taskId, slug);
      const glbUrl = glbUrlFrom(result);
      const glbPath = path.join(dir, 'raw.glb');
      const size = await download(glbUrl, glbPath);
      entry.glb = glbPath;
      entry.glbBytes = size;
      entry.meshy.result = { id: result.id, status: result.status, progress: result.progress, model_urls: result.model_urls };
      entry.elapsedSec = Math.round((Date.now() - t0) / 1000);
      entry.status = size > GLB_MIN_BYTES ? 'ok' : 'glb_too_small';
      log(`[${slug}] DONE ${size} bytes ${entry.elapsedSec}s`);
      return;
    } catch (e) {
      entry.error = e.message;
      log(`[${slug}] meshy attempt ${attempt} FAILED: ${String(e.message).slice(0, 250)}`);
      // Hard stop on payment/quota errors — do not burn the retry (coordinator指令 #3).
      if (e.status === 402 || /credit|balance|payment|quota/i.test(String(e.message))) { entry.status = 'blocked_credit'; return; }
      if (attempt === 2) entry.status = 'failed';
    }
  }
}

async function processModule(m) {
  const dir = path.join(ASSETS, 'modules', m.id);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(V3_PRODUCTS, `${m.id}.png`);
  const localSrc = path.join(dir, 'source.png');
  if (!fs.existsSync(localSrc)) fs.copyFileSync(src, localSrc);
  const entry = { id: m.id, type: 'module', name: m.title, engine: ENGINE, source: localSrc, glb: null, preview: null, status: 'pending', attempts: 0, meshy: {} };
  await runMeshyForImage(entry, dir, localSrc, m.id);
  return entry;
}

async function processWearable(w) {
  const dir = path.join(ASSETS, 'wearables', w.id);
  fs.mkdirSync(dir, { recursive: true });
  const localSrc = path.join(dir, 'source.png');
  const entry = { id: w.id, type: 'wearable', name: w.title, engine: ENGINE, source: localSrc, glb: null, preview: null, status: 'pending', attempts: 0, meshy: {} };
  // step 1: fal text-to-image — reuse existing source.png (already generated in Tripo attempt)
  if (fs.existsSync(localSrc) && fs.statSync(localSrc).size > 10_000) {
    stats.falReused++;
    entry.falReused = true;
    log(`[wearable ${w.id}] reuse existing fal image (${fs.statSync(localSrc).size} bytes)`);
  } else {
    let haveImg = false;
    for (let a = 1; a <= 2 && !haveImg; a++) {
      try { log(`[wearable ${w.id}] fal t2i attempt ${a}`); const sz = await falTextToImage(w.prompt, localSrc); stats.fal++; entry.falBytes = sz; haveImg = true; }
      catch (e) { entry.error = `fal: ${e.message}`; log(`[wearable ${w.id}] fal FAILED ${a}: ${String(e.message).slice(0, 160)}`); if (a === 2) { entry.status = 'failed'; return entry; } }
    }
  }
  // step 2: Meshy image-to-3d
  await runMeshyForImage(entry, dir, localSrc, w.id);
  return entry;
}

function mergeManifest(newEntries, balances) {
  const manifestPath = path.join(ASSETS, 'manifest.json');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
  const prevAssets = Array.isArray(prev.assets) ? prev.assets : [];
  const byId = new Map(prevAssets.map((a) => [a.id, a]));
  for (const e of newEntries) byId.set(e.id, e);
  // canonical order: modules then wearables
  const order = [...MODULES.map((m) => m.id), ...WEARABLES.map((w) => w.id)];
  const assets = order.map((id) => byId.get(id)).filter(Boolean);
  const ok = assets.filter((a) => a.status === 'ok').length;
  const manifest = {
    generatedAt: new Date().toISOString(),
    pipeline: 'image-to-3d (single white-bg image, no multiview grid) — 2026-07-04 re-route',
    engine: ENGINE,
    engineNote: 'Tripo abandoned: v3.1 not in account enum (code=2017; highest accepted v3.0-20250812), then credit wall (403 code=2010, balance=10). Meshy兜底 per 2026-07-04 user拍板.',
    meshyBalance: balances,
    stats: { meshyTasks: (prev.stats?.meshyTasks || 0) + stats.meshyTasks, fal: (prev.stats?.fal || 0) + stats.fal, falReused: stats.falReused, tripoTasks: prev.stats?.tripoTasks ?? 0 },
    assets,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, ok, total: assets.length };
}

(async () => {
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
  fs.mkdirSync(ASSETS, { recursive: true });
  const balBefore = await meshyBalance();
  log(`=== Batch A (engine=${ENGINE}) start. balance=${balBefore} only=[${only.join(',')}] ===`);
  if (balBefore !== null && balBefore < 20) { log(`BLOCKED: meshy balance ${balBefore} < 20 (one task). Aborting without submits.`); process.exit(3); }

  const hasGlb = (type, id) => {
    const p = path.join(ASSETS, type === 'module' ? 'modules' : 'wearables', id, 'raw.glb');
    return fs.existsSync(p) && fs.statSync(p).size > GLB_MIN_BYTES;
  };
  const pick = (list, type) => list.filter((x) => (only.length ? only.includes(x.id) : !hasGlb(type, x.id)));
  const mods = pick(MODULES, 'module');
  const wears = pick(WEARABLES, 'wearable');
  log(`plan: modules=[${mods.map((m) => m.id).join(',')}] wearables=[${wears.map((w) => w.id).join(',')}]`);

  const moduleEntries = mods.length ? await Promise.all(mods.map(processModule)) : [];
  const wearableEntries = wears.length ? await Promise.all(wears.map(processWearable)) : [];

  const balAfter = await meshyBalance();
  const { ok, total } = mergeManifest([...moduleEntries, ...wearableEntries], { before: balBefore, after: balAfter });
  log(`=== run done. ok=${ok}/${total} meshyTasks=${stats.meshyTasks} fal=${stats.fal} reused=${stats.falReused} balance ${balBefore}->${balAfter} ===`);
  console.log(`RESULT ok=${ok}/${total}`);
})().catch((e) => { log(`FATAL: ${e.message}`); console.error(e); process.exit(1); });
