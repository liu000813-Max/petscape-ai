// Cloud Teapot Playland scene-pack asset generator.
// Input: clean white-background module images from image2 slicing.
// Output: raw textured Meshy GLBs under assets-3d, copied unchanged into public
// so runtime can preserve glTF materials/textures.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '<REPOSITORY_ROOT>';
const ENV_PATHS = [path.join(ROOT, '.env'), '<USER_HOME>/Desktop/3D宠物打印/.env'];
const PACK_DIR = path.join(ROOT, 'assets-3d/scene-packs/cloud-teapot-playland');
const SOURCE_DIR = path.join(PACK_DIR, '2d-modules-image2');
const OUT_DIR = path.join(PACK_DIR, '3d-modules-meshy');
const PUBLIC_SCENE_DIR = path.join(ROOT, 'web/public/scene-assets');
const PUBLIC_THUMB_DIR = path.join(ROOT, 'web/public/assets/pet-products');

const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';
const POLL_INTERVAL = 15_000;
const TIMEOUT_MS = 12 * 60_000;
const GLB_MIN_BYTES = 100_000;
const ESTIMATED_CREDITS_PER_TASK = 30;

const MODULES = [
  { id: 'pink-teapot-large-hideout', title: '大粉茶壶躲屋', target: { x: 170, y: 170, z: 145 } },
  { id: 'pink-teapot-small-hideout', title: '小粉茶壶躲屋', target: { x: 116, y: 118, z: 98 } },
  { id: 'cloud-moss-teapot-platform', title: '云朵苔藓茶壶托盘', target: { x: 178, y: 86, z: 102 } },
  { id: 's-cloud-star-ramp', title: 'S 形云朵星星坡道', target: { x: 178, y: 156, z: 122 } },
  { id: 'cloud-star-bowl-upper', title: '上层云朵星星吊篮', target: { x: 132, y: 84, z: 96 } },
  { id: 'cloud-star-bowl-lower', title: '中层云朵星星吊篮', target: { x: 146, y: 72, z: 96 } },
  { id: 'wood-dna-moss-ladder', title: '木色 DNA 苔藓梯', target: { x: 80, y: 220, z: 86 } },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logPath = path.join(OUT_DIR, 'run.log');
const log = (...parts) => {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(logPath, `${line}\n`);
};

function readEnv(name) {
  for (const envPath of ENV_PATHS) {
    if (!fs.existsSync(envPath)) continue;
    const match = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  throw new Error(`${name} not found in ${ENV_PATHS.join(', ')}`);
}

const MESHY_KEY = readEnv('MESHY_API_KEY');
const meshyAuth = { Authorization: `Bearer ${MESHY_KEY}` };

async function meshyJson(pathname, init = {}) {
  const res = await fetch(`${MESHY_BASE}${pathname}`, {
    ...init,
    headers: { ...meshyAuth, 'Content-Type': 'application/json', ...(init.headers || {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const error = new Error(`${init.method || 'GET'} ${pathname} ${res.status}: ${text.slice(0, 400)}`);
    error.status = res.status;
    error.body = json;
    throw error;
  }
  return json;
}

async function withTransientRetry(label, fn, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.status && error.status < 500 && error.status !== 429) throw error;
      if (i < attempts - 1) await sleep(2500);
    }
  }
  throw new Error(`${label} retry ${attempts}x failed: ${lastError?.message}`);
}

function imageToDataUri(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}

async function meshyBalance() {
  try {
    return (await meshyJson('/balance')).balance;
  } catch {
    return null;
  }
}

async function meshySubmit(imgPath) {
  const body = {
    image_url: imageToDataUri(imgPath),
    should_remesh: true,
    should_texture: true,
    topology: 'triangle',
    target_polycount: 100000,
  };
  const response = await withTransientRetry('meshy submit', () => meshyJson('/image-to-3d', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
  const taskId = response.result || response.id;
  if (typeof taskId !== 'string' || !taskId) throw new Error(`meshy no task id: ${JSON.stringify(response).slice(0, 300)}`);
  return { taskId, response };
}

async function meshyPoll(taskId, slug) {
  const start = Date.now();
  let count = 0;
  let transient = 0;
  while (true) {
    count += 1;
    let result;
    try {
      result = await meshyJson(`/image-to-3d/${taskId}`);
      transient = 0;
    } catch (error) {
      transient += 1;
      if (transient >= 5) throw error;
      log(`[${slug}] poll transient #${transient} ${String(error.message).slice(0, 90)}`);
      await sleep(POLL_INTERVAL);
      continue;
    }
    fs.writeFileSync(path.join(OUT_DIR, slug, 'meshy-result.latest.json'), JSON.stringify(redactMeshy(result), null, 2));
    log(`[${slug}] poll #${count} status=${result.status} progress=${result.progress ?? ''}`);
    if (result.status === 'SUCCEEDED') return result;
    if (result.status === 'FAILED' || result.status === 'CANCELED' || result.task_error) {
      throw new Error(`[${slug}] meshy ${result.status}: ${JSON.stringify(result.task_error || result).slice(0, 300)}`);
    }
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
  let lastError;
  for (let i = 0; i < 3; i += 1) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, buffer);
      return buffer.length;
    } catch (error) {
      lastError = error;
      await sleep(3000);
    }
  }
  throw lastError;
}

function inspectGlb(absPath) {
  const buffer = fs.readFileSync(absPath);
  if (buffer.toString('utf8', 0, 4) !== 'glTF') throw new Error(`not a GLB: ${absPath}`);
  let offset = 12;
  let json = null;
  while (offset + 8 <= buffer.length) {
    const len = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (type === 0x4E4F534A) {
      json = JSON.parse(buffer.toString('utf8', offset, offset + len));
      break;
    }
    offset += len;
  }
  if (!json) throw new Error('GLB JSON chunk missing');
  const materials = json.materials || [];
  return {
    bytes: buffer.length,
    meshes: (json.meshes || []).length,
    materials: materials.length,
    textures: (json.textures || []).length,
    images: (json.images || []).length,
    hasBaseColorTexture: materials.some((material) => material.pbrMetallicRoughness?.baseColorTexture),
  };
}

function redactMeshy(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    id: result.id,
    status: result.status,
    progress: result.progress,
    task_error: result.task_error,
    model_urls: result.model_urls ? Object.fromEntries(Object.keys(result.model_urls).map((key) => [key, '[redacted-url]'])) : undefined,
  };
}

function publicGlbName(id) {
  return `${id}.meshy.glb`;
}

function publicMetaName(id) {
  return `${id}.meta.json`;
}

function copyPublicAssets(module, glbPath, inspection) {
  const publicGlb = path.join(PUBLIC_SCENE_DIR, publicGlbName(module.id));
  const publicMeta = path.join(PUBLIC_SCENE_DIR, publicMetaName(module.id));
  const sourceImage = path.join(SOURCE_DIR, `${module.id}.png`);
  const publicThumb = path.join(PUBLIC_THUMB_DIR, `${module.id}.png`);
  fs.mkdirSync(PUBLIC_SCENE_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_THUMB_DIR, { recursive: true });
  fs.copyFileSync(glbPath, publicGlb);
  fs.copyFileSync(sourceImage, publicThumb);
  fs.writeFileSync(publicMeta, `${JSON.stringify({
    sourceFile: path.relative(ROOT, glbPath),
    normalizedFile: publicGlbName(module.id),
    heightMm: module.target.y,
    footprint: { xMm: module.target.x, zMm: module.target.z },
    fitStrategy: 'runtime-contain-collision-box',
    materialPolicy: 'preserve glTF materials and textures',
    targetCollisionSizeMm: module.target,
    inspection,
  }, null, 2)}\n`);
}

async function processModule(module) {
  const dir = path.join(OUT_DIR, module.id);
  const sourceImage = path.join(SOURCE_DIR, `${module.id}.png`);
  const localSource = path.join(dir, 'source.png');
  const rawGlb = path.join(dir, 'raw.glb');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(sourceImage)) throw new Error(`missing source image ${sourceImage}`);
  if (!fs.existsSync(localSource)) fs.copyFileSync(sourceImage, localSource);

  const entry = {
    id: module.id,
    title: module.title,
    source: path.relative(ROOT, localSource),
    rawGlb: path.relative(ROOT, rawGlb),
    publicGlb: `/scene-assets/${publicGlbName(module.id)}`,
    publicMeta: `/scene-assets/${publicMetaName(module.id)}`,
    targetCollisionSizeMm: module.target,
    status: 'pending',
  };

  if (!fs.existsSync(rawGlb) || fs.statSync(rawGlb).size <= GLB_MIN_BYTES) {
    const started = Date.now();
    log(`[${module.id}] submit`);
    const { taskId, response } = await meshySubmit(localSource);
    fs.writeFileSync(path.join(dir, 'meshy-submit.json'), JSON.stringify(response, null, 2));
    entry.meshyTaskId = taskId;
    const result = await meshyPoll(taskId, module.id);
    fs.writeFileSync(path.join(dir, 'meshy-result.json'), JSON.stringify(redactMeshy(result), null, 2));
    const bytes = await download(glbUrlFrom(result), rawGlb);
    entry.elapsedSec = Math.round((Date.now() - started) / 1000);
    entry.bytes = bytes;
    log(`[${module.id}] downloaded raw.glb bytes=${bytes} elapsed=${entry.elapsedSec}s`);
  } else {
    entry.reused = true;
    entry.bytes = fs.statSync(rawGlb).size;
    log(`[${module.id}] reuse raw.glb bytes=${entry.bytes}`);
  }

  const inspection = inspectGlb(rawGlb);
  fs.writeFileSync(path.join(dir, 'glb-inspection.json'), JSON.stringify(inspection, null, 2));
  copyPublicAssets(module, rawGlb, inspection);
  entry.inspection = inspection;
  entry.status = inspection.bytes > GLB_MIN_BYTES && inspection.hasBaseColorTexture ? 'ok' : 'needs_review';
  return entry;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(logPath, { force: true });
  const only = (process.argv.find((arg) => arg.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
  const picked = MODULES.filter((module) => !only.length || only.includes(module.id));
  const missing = picked.filter((module) => {
    const rawGlb = path.join(OUT_DIR, module.id, 'raw.glb');
    return !fs.existsSync(rawGlb) || fs.statSync(rawGlb).size <= GLB_MIN_BYTES;
  });
  const balanceBefore = await meshyBalance();
  log(`start cloud teapot scene-pack modules=${picked.map((module) => module.id).join(',')} missing=${missing.length} balance=${balanceBefore}`);
  if (balanceBefore !== null && missing.length && balanceBefore < missing.length * ESTIMATED_CREDITS_PER_TASK) {
    log(`BLOCKED balance ${balanceBefore} < estimated ${missing.length * ESTIMATED_CREDITS_PER_TASK}; no submits`);
    process.exit(3);
  }

  const entries = await Promise.all(picked.map(processModule));
  const balanceAfter = await meshyBalance();
  const summary = {
    generatedAt: new Date().toISOString(),
    engine: 'meshy image-to-3d',
    sourceDir: path.relative(ROOT, SOURCE_DIR),
    publicSceneDir: path.relative(ROOT, PUBLIC_SCENE_DIR),
    meshyBalance: { before: balanceBefore, after: balanceAfter },
    modules: entries,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  log(`done ok=${entries.filter((entry) => entry.status === 'ok').length}/${entries.length} balance ${balanceBefore}->${balanceAfter}`);
}

main().catch((error) => {
  log(`FATAL ${error.message}`);
  console.error(error);
  process.exit(1);
});
