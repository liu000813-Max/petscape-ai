#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = '<USER_HOME>/Desktop/PetScape-final';
const WEB_NODE_MODULES = path.join(ROOT, 'web', 'node_modules');
const require = createRequire(import.meta.url);
const sharp = require(path.join(WEB_NODE_MODULES, 'sharp'));

const OUT_DIR = path.join(ROOT, 'assets-3d', 'modules', 'starry-hideout');
const VIEWS_DIR = path.join(OUT_DIR, 'views');
const SOURCE_IMAGE = path.join(ROOT, 'web', 'public', 'assets', 'pet-products', 'starry-hideout.png');
const FAL_BASE = 'https://fal.run';
const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';
const TRIPO_MODEL_VERSION = 'v3.0-20250812';

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

function log(line) {
  const full = `[${new Date().toISOString()}] ${line}`;
  console.log(full);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(path.join(OUT_DIR, 'tripo-triview-run.log'), `${full}\n`);
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

async function prepareWhiteSource() {
  fs.mkdirSync(VIEWS_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'source-white.png');
  await sharp(SOURCE_IMAGE)
    .ensureAlpha()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toFile(out);
  log(`white source prepared ${rel(out)}`);
  return out;
}

function buildTriviewPrompt() {
  return `Reference image: a single white-background product photo of the exact same black star-and-moon themed small-pet hideout module.

Create one horizontal three-view orthographic product sheet for 3D reconstruction.

Hard requirements:
1. Exactly three views in one row, left to right: front view, left side view, back view.
2. Preserve the same object identity: same black rounded hideout body, star and moon decorations, cave opening positions, silhouette, proportions, material color, and key structures. Do not turn it into a mushroom, tree, animal, house, or a different prop.
3. Pure white background (#FFFFFF), no shadows, no ground, no labels, no text, no dividers, no extra props, no pet, no cage.
4. Orthographic / parallel product rendering, same scale and lighting across all three views.
5. Each view must be fully visible, centered in its panel, with clear white margin around all edges and clear horizontal gaps between views. No part may cross into a neighboring panel.

Output a clean 3:1 wide image containing only those three views.`;
}

async function falEdit(prompt, inputImage, outPath) {
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000) {
    log(`reuse existing fal triview grid ${rel(outPath)}`);
    return;
  }
  const res = await fetch(`${FAL_BASE}/fal-ai/nano-banana/edit`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, image_urls: [imageToDataUri(inputImage)], num_images: 1 }),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  writeJsonRedacted(path.join(OUT_DIR, 'fal-triview-result.json'), json);
  if (!res.ok) throw new Error(`fal edit failed ${res.status}: ${text.slice(0, 400)}`);
  const url = json?.images?.[0]?.url;
  if (!url) throw new Error(`fal edit returned no image URL: ${text.slice(0, 400)}`);
  const bytes = await download(url, outPath);
  log(`fal triview grid downloaded ${rel(outPath)} bytes=${bytes}`);
}

async function cropTriview(gridPath) {
  const { data, info } = await sharp(gridPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const ch = info.channels;
  if (!width || !height) throw new Error(`invalid triview image size ${width}x${height}`);

  // The generated sheet can contain soft shadows / off-white background. Use a stricter
  // "dark enough" threshold to find the three actual object bands, then recenter each
  // object in a white square. This avoids clipping decorative stars at hard 1/3 splits.
  const column = new Array(width).fill(0);
  const DIFF_FROM_WHITE = 40;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * ch;
      const a = ch === 4 ? data[idx + 3] : 255;
      const diff = Math.max(255 - data[idx], 255 - data[idx + 1], 255 - data[idx + 2]);
      if (a > 20 && diff > DIFF_FROM_WHITE) column[x] += 1;
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
  const intervals = [];
  let start = null;
  for (let i = 0; i < width; i += 1) {
    if (smooth[i] > 5 && start === null) start = i;
    if ((smooth[i] <= 5 || i === width - 1) && start !== null) {
      if (i - start > 20) intervals.push([start, i]);
      start = null;
    }
  }
  if (intervals.length !== 3) {
    throw new Error(`expected 3 object intervals in triview grid, found ${intervals.length}: ${JSON.stringify(intervals)}`);
  }

  const regions = intervals.map(([x0, x1], index) => {
    let minY = height;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const idx = (y * width + x) * ch;
        const a = ch === 4 ? data[idx + 3] : 255;
        const diff = Math.max(255 - data[idx], 255 - data[idx + 1], 255 - data[idx + 2]);
        if (a > 20 && diff > DIFF_FROM_WHITE) {
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
    const name = ['front', 'left', 'back'][index];
    return [name, { left, top, width: right - left, height: bottom - top }];
  });

  const views = [];
  for (const [name, region] of regions) {
    const out = path.join(VIEWS_DIR, `${name}.png`);
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
  log(`cropped views ${views.map(rel).join(', ')} intervals=${JSON.stringify(intervals)}`);
  return views;
}

async function validateViews(viewPaths) {
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
    const WHITE = 245;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const idx = (y * W + x) * ch;
        const a = ch === 4 ? data[idx + 3] : 255;
        const isContent = a > 20 && (data[idx] < WHITE || data[idx + 1] < WHITE || data[idx + 2] < WHITE);
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
  fs.writeFileSync(path.join(OUT_DIR, 'triview-validation.json'), JSON.stringify(result, null, 2));
  log(`triview validation ok=${result.ok} reasons=${reasons.join('; ')}`);
  if (!result.ok) throw new Error(`triview validation failed: ${reasons.join('; ')}`);
  return result;
}

async function padViews(viewPaths, padPct = 6) {
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
  log(`views padded ${padPct}%`);
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

async function submitTripo(viewPaths, apiKey) {
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
  fs.writeFileSync(path.join(OUT_DIR, 'tripo-request.json'), JSON.stringify(body, null, 2));
  const json = await tripoJson('/task', apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  fs.writeFileSync(path.join(OUT_DIR, 'tripo-submit.json'), JSON.stringify(json, null, 2));
  const taskId = json?.data?.task_id;
  if (!taskId) throw new Error(`tripo task returned no task_id: ${JSON.stringify(json).slice(0, 400)}`);
  log(`tripo taskId=${taskId}`);
  return taskId;
}

async function pollTripo(taskId, apiKey) {
  const started = Date.now();
  let count = 0;
  while (true) {
    count += 1;
    const json = await tripoJson(`/task/${taskId}`, apiKey);
    writeJsonRedacted(path.join(OUT_DIR, 'tripo-result.latest.json'), json);
    const data = json?.data || {};
    const status = String(data.status || '').toLowerCase();
    log(`poll tripo #${count} status=${data.status} progress=${data.progress ?? ''}`);
    if (status === 'success' || status === 'succeeded') {
      writeJsonRedacted(path.join(OUT_DIR, 'tripo-result.json'), json);
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
  const summary = {
    bytes: b.length,
    meshes: (json.meshes || []).length,
    materials: materials.length,
    textures: (json.textures || []).length,
    images: (json.images || []).length,
    hasBaseColorTexture: materials.some((m) => m.pbrMetallicRoughness?.baseColorTexture),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'glb-inspection.json'), JSON.stringify(summary, null, 2));
  return summary;
}

function writePreviewHtml() {
  const htmlPath = path.join(OUT_DIR, 'preview.html');
  const glbUrl = '/assets-3d/modules/starry-hideout/raw.glb';
  fs.writeFileSync(htmlPath, `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>starry-hideout Tripo preview</title>
  <script type="module" src="/web/node_modules/@google/model-viewer/dist/model-viewer.min.js"></script>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #f4f1ea; font-family: Arial, sans-serif; }
    model-viewer { width: 100vw; height: 100vh; background: #f4f1ea; }
    .label { position: fixed; left: 16px; top: 14px; padding: 8px 10px; background: rgba(255,255,255,.86); border: 1px solid rgba(0,0,0,.08); border-radius: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="label">starry-hideout · Tripo multiview · raw textured GLB</div>
  <model-viewer id="mv" src="${glbUrl}" camera-controls auto-rotate shadow-intensity="1" exposure="1" environment-image="neutral" camera-orbit="45deg 68deg auto"></model-viewer>
</body>
</html>`);
  return htmlPath;
}

async function capturePreview(htmlPath) {
  let chromium;
  try {
    ({ chromium } = require(path.join(ROOT, 'tools', 'verify-batch0', 'node_modules', 'playwright')));
  } catch (err) {
    log(`preview screenshot skipped: playwright unavailable (${err.message})`);
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
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/${rel(htmlPath)}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((resolve) => {
      const mv = document.querySelector('model-viewer');
      if (!mv) return resolve();
      if (mv.loaded) return resolve();
      mv.addEventListener('load', resolve, { once: true });
      setTimeout(resolve, 30000);
    }));
    await page.waitForTimeout(2000);
    const shot = path.join(OUT_DIR, 'preview-browser.png');
    await page.screenshot({ path: shot, fullPage: true });
    log(`preview screenshot saved ${rel(shot)}`);
    return shot;
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

async function main() {
  fs.rmSync(path.join(OUT_DIR, 'tripo-triview-run.log'), { force: true });
  log('starry-hideout Tripo multiview run start');
  const whiteSource = await prepareWhiteSource();

  const gridPath = path.join(OUT_DIR, 'triview-grid.png');
  await falEdit(buildTriviewPrompt(), whiteSource, gridPath);
  const views = await cropTriview(gridPath);
  await validateViews(views);
  await padViews(views, 6);

  const apiKey = TRIPO_KEYS[0];
  const taskId = await submitTripo(views, apiKey);
  const result = await pollTripo(taskId, apiKey);
  const glbUrl = glbUrlFrom(result);
  if (!glbUrl) throw new Error('tripo result missing GLB URL');
  const glbPath = path.join(OUT_DIR, 'raw.glb');
  const bytes = await download(glbUrl, glbPath);
  log(`tripo GLB downloaded ${rel(glbPath)} bytes=${bytes}`);

  const inspection = inspectGlb(glbPath);
  log(`GLB inspection ${JSON.stringify(inspection)}`);
  const htmlPath = writePreviewHtml();
  await capturePreview(htmlPath);
  log('starry-hideout Tripo multiview run done');
}

main().catch((err) => {
  log(`FAILED ${err.stack || err.message}`);
  process.exit(1);
});
