#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = '<REPOSITORY_ROOT>';
const WEB_NODE_MODULES = path.join(ROOT, 'web', 'node_modules');
const require = createRequire(import.meta.url);
const sharp = require(path.join(WEB_NODE_MODULES, 'sharp'));

const FAL_BASE = 'https://fal.run';
const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';
const TRIPO_MODEL_VERSION = 'v3.0-20250812';
const ASSETS_DIR = path.join(ROOT, 'assets-3d', 'modules');

const MODULES = [
  { id: 'cheese-lounge-bed', title: '奶酪软垫小床', hints: 'low cheese-shaped lounge bed with padded nest, rounded cheese rail, holes and soft cushion' },
  { id: 'banana-bed', title: '香蕉软垫小床', hints: 'banana-shaped open pet bed with curved banana backrest and soft cushion' },
  { id: 'banana-layer-pad', title: '夹层香蕉垫', hints: 'three-layer banana sandwich cushion, rounded stacked banana pad, soft nested form' },
  { id: 'hanging-climb-baskets', title: '悬挂藤篮阶梯', hints: 'three hanging woven baskets with ladder and vertical climbing structure' },
];

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  for (const envPath of [path.join(ROOT, '.env'), path.join(ROOT, 'web', '.env.local')]) {
    try {
      const match = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
      if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, '');
    } catch {}
  }
  return null;
}

const FAL_KEY = readEnv('FAL_KEY');
const TRIPO_KEYS = ['TRIPO_API_KEY', 'TRIPO_API_KEY_2'].map(readEnv).filter(Boolean);
if (!FAL_KEY) throw new Error('FAL_KEY missing in project .env');
if (!TRIPO_KEYS.length) throw new Error('TRIPO_API_KEY missing in project .env');

function rel(p) {
  return path.relative(ROOT, p);
}

function outDirFor(moduleId) {
  return path.join(ASSETS_DIR, moduleId, 'tripo-triview');
}

function log(moduleId, line) {
  const dir = outDirFor(moduleId);
  const full = `[${new Date().toISOString()}] [${moduleId}] ${line}`;
  console.log(full);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'run.log'), `${full}\n`);
}

function redactRemoteUrls(value) {
  if (Array.isArray(value)) return value.map(redactRemoteUrls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactRemoteUrls(child)]));
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return '[redacted-remote-url]';
  return value;
}

function writeJsonRedacted(absPath, value) {
  fs.writeFileSync(absPath, JSON.stringify(redactRemoteUrls(value), null, 2));
}

function imageToDataUri(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}

async function download(url, absPath) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`download ${url} failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, buf);
  return buf.length;
}

async function prepareWhiteSource(moduleId) {
  const src = path.join(ASSETS_DIR, moduleId, 'source.png');
  const out = path.join(outDirFor(moduleId), 'source-white.png');
  await sharp(src)
    .ensureAlpha()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toFile(out);
  log(moduleId, `white source prepared ${rel(out)}`);
  return out;
}

function buildTriviewPrompt(module) {
  return `Reference image: a single white-background product photo of the exact same small-pet habitat module: ${module.title}. Object hints: ${module.hints}.

Create one horizontal three-view orthographic product sheet for 3D reconstruction.

Hard requirements:
1. Exactly three views in one row, left to right: front view, left side view, back view.
2. Preserve the same object identity, silhouette, color, material, proportions, openings, holes, cushion/platform/basket details, and all key structures from the reference. Do not transform it into a different prop.
3. Pure white background (#FFFFFF), no shadows, no ground, no labels, no text, no dividers, no extra props, no pet, no cage.
4. Orthographic / parallel product rendering, same scale and lighting across all three views.
5. Each view must be fully visible and centered, with clear white margin around all edges and clear horizontal gaps between views. No part may cross into a neighboring panel.

Output a clean 3:1 wide image containing only those three views.`;
}

async function falEdit(module, inputImage, outPath) {
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000) {
    log(module.id, `reuse existing fal triview grid ${rel(outPath)}`);
    return;
  }
  const res = await fetch(`${FAL_BASE}/fal-ai/nano-banana/edit`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: buildTriviewPrompt(module), image_urls: [imageToDataUri(inputImage)], num_images: 1 }),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  writeJsonRedacted(path.join(outDirFor(module.id), 'fal-triview-result.json'), json);
  if (!res.ok) throw new Error(`fal edit failed ${res.status}: ${text.slice(0, 400)}`);
  const url = json?.images?.[0]?.url;
  if (!url) throw new Error(`fal edit returned no image URL: ${text.slice(0, 400)}`);
  const bytes = await download(url, outPath);
  log(module.id, `fal triview grid downloaded ${rel(outPath)} bytes=${bytes}`);
}

async function cropTriview(moduleId, gridPath) {
  const { data, info } = await sharp(gridPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const ch = info.channels;
  if (!width || !height) throw new Error(`invalid triview image size ${width}x${height}`);

  const thresholds = [40, 50, 60, 70, 30, 20];
  let intervals = null;
  let usedThreshold = null;
  for (const threshold of thresholds) {
    const column = new Array(width).fill(0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * ch;
        const a = ch === 4 ? data[idx + 3] : 255;
        const diff = Math.max(255 - data[idx], 255 - data[idx + 1], 255 - data[idx + 2]);
        if (a > 20 && diff > threshold) column[x] += 1;
      }
    }
    const smooth = column.map((_, i) => {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - 5); j <= Math.min(width - 1, i + 5); j += 1) {
        sum += column[j];
        count += 1;
      }
      return sum / count;
    });
    const found = [];
    let start = null;
    for (let i = 0; i < width; i += 1) {
      if (smooth[i] > 5 && start === null) start = i;
      if ((smooth[i] <= 5 || i === width - 1) && start !== null) {
        if (i - start > 20) found.push([start, i]);
        start = null;
      }
    }
    if (found.length === 3) {
      intervals = found;
      usedThreshold = threshold;
      break;
    }
  }
  if (!intervals) throw new Error(`expected 3 object intervals in triview grid`);

  const viewsDir = path.join(outDirFor(moduleId), 'views');
  fs.mkdirSync(viewsDir, { recursive: true });
  const views = [];
  for (let index = 0; index < intervals.length; index += 1) {
    const [x0, x1] = intervals[index];
    let minY = height;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const idx = (y * width + x) * ch;
        const a = ch === 4 ? data[idx + 3] : 255;
        const diff = Math.max(255 - data[idx], 255 - data[idx + 1], 255 - data[idx + 2]);
        if (a > 20 && diff > usedThreshold) {
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    const padX = Math.round((x1 - x0) * 0.12);
    const padY = Math.round((maxY - minY) * 0.12);
    const left = Math.max(0, x0 - padX);
    const top = Math.max(0, minY - padY);
    const right = Math.min(width, x1 + padX);
    const bottom = Math.min(height, maxY + padY);
    const region = { left, top, width: right - left, height: bottom - top };
    const name = ['front', 'left', 'back'][index];
    const out = path.join(viewsDir, `${name}.png`);
    const side = Math.max(region.width, region.height);
    const extracted = await sharp(gridPath).extract(region).png().toBuffer();
    await sharp({
      create: {
        width: side,
        height: side,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([{ input: extracted, left: Math.round((side - region.width) / 2), top: Math.round((side - region.height) / 2) }])
      .png()
      .toFile(out);
    views.push(out);
  }
  log(moduleId, `cropped views ${views.map(rel).join(', ')} threshold=${usedThreshold} intervals=${JSON.stringify(intervals)}`);
  return views;
}

async function validateViews(moduleId, viewPaths) {
  const checks = [];
  const reasons = [];
  for (const p of viewPaths) {
    const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const ch = info.channels;
    let contentPixels = 0;
    let minX = W;
    let maxX = -1;
    const DIFF_FROM_WHITE = 40;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const idx = (y * W + x) * ch;
        const a = ch === 4 ? data[idx + 3] : 255;
        const diff = Math.max(255 - data[idx], 255 - data[idx + 1], 255 - data[idx + 2]);
        const isContent = a > 20 && diff > DIFF_FROM_WHITE;
        if (isContent) {
          contentPixels += 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    const contentPct = (contentPixels / (W * H)) * 100;
    const marginPct = maxX < 0 ? 0 : Math.min(minX / W, (W - 1 - maxX) / W) * 100;
    const contentOk = contentPct >= 5 && contentPct <= 90;
    const marginOk = marginPct >= 0.25;
    const pass = contentOk && marginOk;
    const check = {
      view: path.basename(p, '.png'),
      widthPx: W,
      heightPx: H,
      contentPct: Number(contentPct.toFixed(2)),
      marginPct: Number(marginPct.toFixed(2)),
      contentOk,
      marginOk,
      pass,
    };
    checks.push(check);
    if (!pass) reasons.push(`${check.view}: content=${check.contentPct}% margin=${check.marginPct}%`);
  }
  const result = { ok: checks.every((c) => c.pass), checks, reasons };
  fs.writeFileSync(path.join(outDirFor(moduleId), 'triview-validation.json'), JSON.stringify(result, null, 2));
  log(moduleId, `triview validation ok=${result.ok} reasons=${reasons.join('; ')}`);
  if (!result.ok) throw new Error(`triview validation failed: ${reasons.join('; ')}`);
  return result;
}

async function padViews(moduleId, viewPaths, padPct = 6) {
  for (const p of viewPaths) {
    const meta = await sharp(p).metadata();
    const padX = Math.round(((meta.width ?? 0) * padPct) / 100);
    const padY = Math.round(((meta.height ?? 0) * padPct) / 100);
    const buf = await sharp(p)
      .extend({ top: padY, bottom: padY, left: padX, right: padX, background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();
    await sharp(buf).toFile(p);
  }
  log(moduleId, `views padded ${padPct}%`);
}

async function tripoUpload(absPath, apiKey) {
  const buf = fs.readFileSync(absPath);
  const ext = path.extname(absPath).slice(1).toLowerCase() || 'png';
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)], { type: `image/${ext}` }), path.basename(absPath));
  const res = await fetch(`${TRIPO_BASE}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) throw new Error(`tripo upload ${res.status}: ${text.slice(0, 400)}`);
  const token = json?.data?.image_token || json?.data?.file_token || json?.data?.token;
  if (!token) throw new Error(`tripo upload returned no token: ${text.slice(0, 400)}`);
  return { type: ext, file_token: token };
}

async function tripoJson(pathname, apiKey, init = {}) {
  const res = await fetch(`${TRIPO_BASE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname} ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

async function submitTripo(moduleId, viewPaths, apiKey) {
  const files = [];
  for (const p of viewPaths) {
    files.push(await tripoUpload(p, apiKey));
  }
  const body = {
    type: 'multiview_to_model',
    files: [...files, {}],
    model_version: TRIPO_MODEL_VERSION,
    orientation: 'align_image',
  };
  fs.writeFileSync(path.join(outDirFor(moduleId), 'tripo-request.json'), JSON.stringify(body, null, 2));
  const json = await tripoJson('/task', apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  fs.writeFileSync(path.join(outDirFor(moduleId), 'tripo-submit.json'), JSON.stringify(json, null, 2));
  const taskId = json?.data?.task_id;
  if (!taskId) throw new Error(`tripo task returned no task_id: ${JSON.stringify(json).slice(0, 400)}`);
  log(moduleId, `tripo taskId=${taskId}`);
  return taskId;
}

async function pollTripo(moduleId, taskId, apiKey) {
  const started = Date.now();
  let count = 0;
  while (true) {
    count += 1;
    const json = await tripoJson(`/task/${taskId}`, apiKey);
    writeJsonRedacted(path.join(outDirFor(moduleId), 'tripo-result.latest.json'), json);
    const data = json?.data || {};
    const status = String(data.status || '').toLowerCase();
    log(moduleId, `poll tripo #${count} status=${data.status} progress=${data.progress ?? ''}`);
    if (status === 'success' || status === 'succeeded') {
      writeJsonRedacted(path.join(outDirFor(moduleId), 'tripo-result.json'), json);
      return json;
    }
    if (['failed', 'cancelled', 'canceled', 'banned', 'expired', 'unknown'].includes(status)) {
      throw new Error(`tripo task ${taskId} failed status=${status}: ${JSON.stringify(data).slice(0, 500)}`);
    }
    if (Date.now() - started > 10 * 60_000) throw new Error(`tripo task ${taskId} timeout`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

function glbUrlFrom(result) {
  const out = result?.data?.output || {};
  return out.pbr_model || out.model || out.model_url;
}

function inspectGlb(absPath) {
  const b = fs.readFileSync(absPath);
  if (b.toString('utf8', 0, 4) !== 'glTF') throw new Error(`not a GLB: ${absPath}`);
  let off = 12;
  let json = null;
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    off += 8;
    if (type === 0x4E4F534A) {
      json = JSON.parse(b.toString('utf8', off, off + len));
      break;
    }
    off += len;
  }
  if (!json) throw new Error('GLB JSON chunk missing');
  const materials = json.materials || [];
  return {
    bytes: b.length,
    meshes: (json.meshes || []).length,
    materials: materials.length,
    textures: (json.textures || []).length,
    images: (json.images || []).length,
    hasBaseColorTexture: materials.some((m) => m.pbrMetallicRoughness?.baseColorTexture),
  };
}

function writePreviewHtml(moduleId) {
  const htmlPath = path.join(outDirFor(moduleId), 'preview.html');
  const glbUrl = `/assets-3d/modules/${moduleId}/tripo-triview/raw.glb`;
  fs.writeFileSync(htmlPath, `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${moduleId} Tripo preview</title>
  <script type="module" src="/web/node_modules/@google/model-viewer/dist/model-viewer.min.js"></script>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #f4f1ea; font-family: Arial, sans-serif; }
    model-viewer { width: 100vw; height: 100vh; background: #f4f1ea; }
    .label { position: fixed; left: 16px; top: 14px; padding: 8px 10px; background: rgba(255,255,255,.86); border: 1px solid rgba(0,0,0,.08); border-radius: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="label">${moduleId} · Tripo multiview · raw textured GLB</div>
  <model-viewer src="${glbUrl}" camera-controls auto-rotate shadow-intensity="1" exposure="1" environment-image="neutral" camera-orbit="45deg 68deg auto"></model-viewer>
</body>
</html>`);
  return htmlPath;
}

async function capturePreview(moduleId, htmlPath) {
  let chromium;
  try {
    ({ chromium } = require(path.join(ROOT, 'tools', 'verify-batch0', 'node_modules', 'playwright')));
  } catch (err) {
    log(moduleId, `preview screenshot skipped: playwright unavailable (${err.message})`);
    return null;
  }
  const server = http.createServer((req, res) => {
    const rawUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    const fsPath = path.normalize(path.join(ROOT, rawUrl === '/' ? rel(htmlPath) : rawUrl.replace(/^\//, '')));
    if (!fsPath.startsWith(ROOT) || !fs.existsSync(fsPath) || fs.statSync(fsPath).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(fsPath).toLowerCase();
    const type = ext === '.js' ? 'text/javascript' : ext === '.glb' ? 'model/gltf-binary' : ext === '.html' ? 'text/html' : ext === '.png' ? 'image/png' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(fsPath).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const port = server.address().port;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/${rel(htmlPath)}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((resolve) => {
      const mv = document.querySelector('model-viewer');
      if (!mv) return resolve();
      if (mv.loaded) return resolve();
      mv.addEventListener('load', resolve, { once: true });
      setTimeout(resolve, 30000);
    }));
    await page.waitForTimeout(1500);
    const shot = path.join(outDirFor(moduleId), 'preview-browser.png');
    await page.screenshot({ path: shot, fullPage: true });
    log(moduleId, `preview screenshot saved ${rel(shot)}`);
    return shot;
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

async function runModule(module) {
  fs.mkdirSync(outDirFor(module.id), { recursive: true });
  fs.rmSync(path.join(outDirFor(module.id), 'run.log'), { force: true });
  log(module.id, `${module.title} Tripo multiview run start`);
  const source = await prepareWhiteSource(module.id);
  const gridPath = path.join(outDirFor(module.id), 'triview-grid.png');
  await falEdit(module, source, gridPath);
  const views = await cropTriview(module.id, gridPath);
  await validateViews(module.id, views);
  await padViews(module.id, views, 6);
  const taskId = await submitTripo(module.id, views, TRIPO_KEYS[0]);
  const result = await pollTripo(module.id, taskId, TRIPO_KEYS[0]);
  const glbUrl = glbUrlFrom(result);
  if (!glbUrl) throw new Error('tripo result missing GLB URL');
  const glbPath = path.join(outDirFor(module.id), 'raw.glb');
  const bytes = await download(glbUrl, glbPath);
  log(module.id, `tripo GLB downloaded ${rel(glbPath)} bytes=${bytes}`);
  const inspection = inspectGlb(glbPath);
  fs.writeFileSync(path.join(outDirFor(module.id), 'glb-inspection.json'), JSON.stringify(inspection, null, 2));
  log(module.id, `GLB inspection ${JSON.stringify(inspection)}`);
  const htmlPath = writePreviewHtml(module.id);
  await capturePreview(module.id, htmlPath);
  log(module.id, `${module.title} Tripo multiview run done`);
  return { module, taskId, glbPath, inspection, result };
}

async function main() {
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.replace('--only=', '').split(',').filter(Boolean)) : null;
  const picked = only ? MODULES.filter((m) => only.has(m.id)) : MODULES;
  if (!picked.length) throw new Error('no modules selected');
  const results = [];
  for (const module of picked) {
    results.push(await runModule(module));
  }
  const summary = results.map(({ module, taskId, glbPath, inspection, result }) => ({
    id: module.id,
    title: module.title,
    taskId,
    glbPath,
    bytes: inspection.bytes,
    textures: inspection.textures,
    images: inspection.images,
    hasBaseColorTexture: inspection.hasBaseColorTexture,
    consumedCredit: result?.data?.consumed_credit,
    status: result?.data?.status,
  }));
  fs.writeFileSync(path.join(ASSETS_DIR, 'tripo-triview-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
