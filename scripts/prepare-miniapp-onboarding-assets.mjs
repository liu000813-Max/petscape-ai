import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const sharp = require('sharp');
const directory = new URL('../miniapp/assets/onboarding/', import.meta.url);
await mkdir(directory, { recursive: true });

for (const name of ['rat', 'gecko', 'snake', 'parrot', 'spider']) {
  const { data, info } = await sharp(fileURLToPath(new URL(`../miniapp/assets/species-${name}.png`, import.meta.url)))
    .flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const visited = new Uint8Array(width * height);
  const queue = [];
  // Remove only near-white background connected to the outside; preserve light fur and eyes enclosed by the animal.
  function visit(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (visited[pixel]) return;
    visited[pixel] = 1;
    const offset = pixel * channels;
    if (Math.min(data[offset], data[offset + 1], data[offset + 2]) < 232) return;
    queue.push(pixel);
  }
  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  for (let head = 0; head < queue.length; head++) {
    const pixel = queue[head]; const offset = pixel * channels;
    data[offset] = data[offset + 1] = data[offset + 2] = 255;
    const x = pixel % width; const y = Math.floor(pixel / width);
    visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }
  const components = new Uint8Array(width * height);
  let animal = [];
  for (let start = 0; start < components.length; start++) {
    if (components[start] || Math.min(...data.subarray(start * channels, start * channels + 3)) >= 232) continue;
    const pixels = [start]; components[start] = 1;
    for (let head = 0; head < pixels.length; head++) {
      const pixel = pixels[head]; const x = pixel % width; const y = Math.floor(pixel / width);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = x + dx; const yy = y + dy; const next = yy * width + xx;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height || components[next]) continue;
        components[next] = 1;
        if (Math.min(...data.subarray(next * channels, next * channels + 3)) < 232) pixels.push(next);
      }
    }
    if (pixels.length > animal.length) animal = pixels;
  }
  if (!animal.length) throw new Error(`Animal outline missing: ${name}`);
  const xs = animal.map(pixel => pixel % width); const ys = animal.map(pixel => Math.floor(pixel / width));
  const left = Math.max(0, Math.min(...xs) - 4); const top = Math.max(0, Math.min(...ys) - 4);
  const right = Math.min(width - 1, Math.max(...xs) + 4); const bottom = Math.min(height - 1, Math.max(...ys) + 4);
  // A tight animal crop excludes the original rounded-rectangle fringe outside its outline.
  await sharp(data, { raw: info }).extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize(232, 232, { fit: 'contain', background: '#ffffff' })
    .extend({ top: 12, bottom: 12, left: 12, right: 12, background: '#ffffff' })
    .png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL(`${name}.png`, directory)));
  console.log(`${name}: pure white exterior (${queue.length} pixels)`);
}
