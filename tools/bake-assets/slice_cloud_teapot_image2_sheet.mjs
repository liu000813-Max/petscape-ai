import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromWeb = createRequire(path.resolve('web/package.json'));
const sharpFromWeb = (await import(requireFromWeb.resolve('sharp'))).default;

const sheet = process.argv[2];
if (!sheet) {
  throw new Error('Usage: node tools/bake-assets/slice_cloud_teapot_image2_sheet.mjs <image2-sheet.png>');
}

const root = process.cwd();
const sheetAbs = path.resolve(sheet);
const outRoot = path.join(root, 'assets-3d', 'scene-packs', 'cloud-teapot-playland');
const outDir = path.join(outRoot, '2d-modules-image2');
fs.mkdirSync(outDir, { recursive: true });

const sourceSheet = path.join(outRoot, 'image2-module-sheet.png');
fs.copyFileSync(sheetAbs, sourceSheet);

const baseModules = [
  {
    id: 'pink-teapot-large-hideout',
    title: '大粉茶壶躲屋',
    crop: { left: 12, top: 18, width: 435, height: 438 },
    generationRole: 'unique 3D module and final hero instance',
  },
  {
    id: 'pink-teapot-small-hideout',
    title: '小粉茶壶躲屋',
    crop: { left: 462, top: 18, width: 380, height: 438 },
    generationRole: 'unique 3D module and secondary teapot instance',
  },
  {
    id: 'cloud-moss-teapot-platform',
    title: '云朵苔藓茶壶托盘',
    crop: { left: 854, top: 18, width: 405, height: 438 },
    generationRole: 'unique 3D module and upper platform instance',
  },
  {
    id: 's-cloud-star-ramp',
    title: 'S 形云朵星星坡道',
    crop: { left: 1272, top: 18, width: 398, height: 438 },
    generationRole: 'unique 3D module and central ramp instance',
  },
  {
    id: 'cloud-star-bowl-upper',
    title: '上层云朵星星吊篮',
    crop: { left: 12, top: 474, width: 435, height: 455 },
    generationRole: 'cloud bowl unique module candidate; upper final pose',
  },
  {
    id: 'cloud-star-bowl-lower',
    title: '中层云朵星星吊篮',
    crop: { left: 462, top: 474, width: 463, height: 455 },
    generationRole: 'cloud bowl unique module candidate; lower flatter final pose',
  },
  {
    id: 'wood-dna-moss-ladder',
    title: '木色 DNA 苔藓梯',
    crop: { left: 942, top: 474, width: 345, height: 455 },
    generationRole: 'unique 3D module and right climbing instance',
  },
];

const metadata = await sharpFromWeb(sheetAbs).metadata();
const manifest = {
  sourceSheet,
  originalGeneratedSheet: sheetAbs,
  sourceSize: { width: metadata.width, height: metadata.height },
  outputDir: outDir,
  modulePolicy: {
    unique3dModuleCount: 7,
    reason: 'The reference contains two distinct teapot hideouts and two cloud bowl poses; generate each as a separate module first, then compose final scene instances.',
    nextStep: 'Use these clean white-background module images to generate multiview references, then textured GLB modules.',
  },
  modules: [],
};

for (const item of baseModules) {
  const output = path.join(outDir, `${item.id}.png`);
  await sharpFromWeb(sheetAbs)
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
console.log(JSON.stringify({ sourceSheet, outDir, manifestPath, count: baseModules.length }, null, 2));
