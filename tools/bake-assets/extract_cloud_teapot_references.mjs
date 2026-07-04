import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromWeb = createRequire(path.resolve('web/package.json'));
const sharp = (await import(requireFromWeb.resolve('sharp'))).default;

const source = process.argv[2];
if (!source) {
  throw new Error('Usage: node tools/bake-assets/extract_cloud_teapot_references.mjs <reference.png>');
}

const root = process.cwd();
const outDir = path.join(root, 'assets-3d', 'scene-packs', 'cloud-teapot-playland', '2d-modules');
fs.mkdirSync(outDir, { recursive: true });

const modules = [
  {
    id: 'pink-teapot-large-hideout',
    title: '大粉茶壶躲屋',
    role: 'hero teapot hideout, final scene instance',
    crop: { left: 780, top: 1360, width: 940, height: 560 },
    promptNotes: [
      'large pastel pink teapot hideout',
      'wide low body, long left-facing spout, angular handle, round lid knob',
      'round pet entrance must be carved into the teapot body',
      'small pastel star decorations on the front body',
    ],
  },
  {
    id: 'pink-teapot-small-hideout',
    title: '小粉茶壶躲屋',
    role: 'secondary teapot hideout, final scene instance',
    crop: { left: 1000, top: 1060, width: 590, height: 380 },
    promptNotes: [
      'small pastel pink teapot hideout',
      'round front entrance, curved handle, short spout, lid knob',
      'same visual family as large teapot but smaller and rounder',
    ],
  },
  {
    id: 'cloud-moss-teapot-platform',
    title: '云朵苔藓茶壶托盘',
    role: 'upper cloud platform with moss and teapot instance',
    crop: { left: 900, top: 470, width: 760, height: 620 },
    promptNotes: [
      'puffy off-white cloud platform',
      'green moss ring on top surface',
      'small pastel pink teapot sitting on the moss',
      'cloud lobes visible around the lower edge',
    ],
  },
  {
    id: 's-cloud-star-ramp',
    title: 'S 形云朵星星坡道',
    role: 'central sculptural ramp',
    crop: { left: 1710, top: 980, width: 780, height: 900 },
    promptNotes: [
      'off-white S-shaped cloud ramp or slide',
      'thick soft rounded tube, curled vertical profile',
      'rests on a low puffy cloud base',
      'pastel pink star decorations attached to the ramp',
    ],
  },
  {
    id: 'cloud-star-bowl-upper',
    title: '上层云朵星星吊篮',
    role: 'upper repeated cloud bowl instance',
    crop: { left: 2470, top: 460, width: 660, height: 450 },
    promptNotes: [
      'off-white cloud bowl or hanging nest',
      'puffy cloud lobes, hollow shallow center',
      'thin pastel pink rim around the top',
      'pastel pink star decorations on the side',
    ],
  },
  {
    id: 'cloud-star-bowl-lower',
    title: '中层云朵星星吊篮',
    role: 'lower repeated cloud bowl instance, same family as upper bowl',
    crop: { left: 2260, top: 1130, width: 610, height: 420 },
    promptNotes: [
      'off-white cloud bowl or hanging nest',
      'same module family as upper cloud bowl',
      'slightly different pose for layout reference',
      'pink rim and pink star decorations',
    ],
  },
  {
    id: 'wood-dna-moss-ladder',
    title: '木色 DNA 苔藓梯',
    role: 'right vertical climbing ladder',
    crop: { left: 2650, top: 800, width: 650, height: 1160 },
    promptNotes: [
      'tall wooden DNA helix ladder',
      'two twisting wood rails with horizontal rungs',
      'green moss clusters at the base',
      'natural light brown wood grain material',
    ],
  },
];

const sourceAbs = path.resolve(source);
const metadata = await sharp(sourceAbs).metadata();
const manifest = {
  source: sourceAbs,
  sourceSize: { width: metadata.width, height: metadata.height },
  outputDir: outDir,
  generationPolicy: {
    phase1: 'local crop extraction only; no external image or 3D generation',
    phase2: 'generate clean white-background multiview images per unique module after user confirms external-cost generation',
    phase3: 'generate textured GLB per module, normalize while preserving materials, then compose final scene layout',
  },
  unique3dModules: [
    'pink-teapot-large-hideout',
    'pink-teapot-small-hideout',
    'cloud-moss-teapot-platform',
    's-cloud-star-ramp',
    'cloud-star-bowl',
    'wood-dna-moss-ladder',
  ],
  finalSceneInstances: [
    'pink-teapot-large-hideout',
    'pink-teapot-small-hideout',
    'cloud-moss-teapot-platform',
    's-cloud-star-ramp',
    'cloud-star-bowl-upper',
    'cloud-star-bowl-lower',
    'wood-dna-moss-ladder',
  ],
  modules: [],
};

for (const item of modules) {
  const output = path.join(outDir, `${item.id}.png`);
  await sharp(sourceAbs)
    .extract(item.crop)
    .resize({ width: 1024, height: 1024, fit: 'contain', background: '#ffffff' })
    .png()
    .toFile(output);

  manifest.modules.push({
    ...item,
    output,
    relativeOutput: path.relative(root, output),
  });
}

const manifestPath = path.join(outDir, 'manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ outDir, manifestPath, count: modules.length }, null, 2));
