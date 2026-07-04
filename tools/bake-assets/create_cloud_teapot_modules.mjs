import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromWeb = createRequire(path.resolve('web/package.json'));
const THREE = await import(requireFromWeb.resolve('three'));
const { GLTFExporter } = await import(requireFromWeb.resolve('three/examples/jsm/exporters/GLTFExporter.js'));

if (!globalThis.FileReader) {
  globalThis.FileReader = class NodeFileReader {
    result = null;
    onloadend = null;
    onerror = null;

    readAsArrayBuffer(blob) {
      blob.arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          this.onloadend?.({ target: this });
        })
        .catch((error) => this.onerror?.(error));
    }

    readAsDataURL(blob) {
      blob.arrayBuffer()
        .then((buffer) => {
          const base64 = Buffer.from(buffer).toString('base64');
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
          this.onloadend?.({ target: this });
        })
        .catch((error) => this.onerror?.(error));
    }
  };
}

const OUT_DIR = path.resolve('web/public/scene-assets');

const COLORS = {
  cloud: 0xe7e5dc,
  cloudShadow: 0xd2d0c8,
  pink: 0xf2a1b8,
  pinkDeep: 0xd66d85,
  wood: 0xb48b62,
  woodDark: 0x7c5738,
  moss: 0x91a642,
  mossDark: 0x486b32,
  blueStar: 0x79b9ce,
  yellowStar: 0xe6c45e,
  whiteStar: 0xf4f1ea,
};

function mat(color, roughness = 0.72) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness, side: THREE.DoubleSide });
}

const materials = Object.fromEntries(
  Object.entries(COLORS).map(([name, color]) => [name, mat(color)])
);

let seed = 20260705;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

function addMesh(group, geometry, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

function makeStarShape(radius = 16, inner = 7, points = 5) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? radius : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function addStar(group, material, position, scale = 1, rotation = [0, 0, 0]) {
  const geometry = new THREE.ExtrudeGeometry(makeStarShape(), { depth: 6, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 2 });
  geometry.center();
  return addMesh(group, geometry, material, position, [scale, scale, scale], rotation);
}

function cylinderBetween(group, start, end, radius, material) {
  const s = new THREE.Vector3(...start);
  const e = new THREE.Vector3(...end);
  const mid = s.clone().add(e).multiplyScalar(0.5);
  const len = s.distanceTo(e);
  const geometry = new THREE.CylinderGeometry(radius, radius, len, 16);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), e.clone().sub(s).normalize());
  group.add(mesh);
  return mesh;
}

function addCloudLumps(group, centers, material = materials.cloud) {
  const geometry = new THREE.SphereGeometry(1, 32, 18);
  centers.forEach(({ p, s, m }) => addMesh(group, geometry, m || material, p, s));
}

function addMossPatch(group, x, z, width = 72, depth = 28) {
  const mound = new THREE.SphereGeometry(1, 16, 10);
  for (let i = 0; i < 9; i += 1) {
    const px = x + (rand() - 0.5) * width;
    const pz = z + (rand() - 0.5) * depth;
    const sy = 5 + rand() * 5;
    const sx = 9 + rand() * 8;
    const sz = 7 + rand() * 7;
    addMesh(group, mound, i % 3 === 0 ? materials.mossDark : materials.moss, [px, sy, pz], [sx, sy, sz]);
  }
}

function normalizeToGround(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.position.x -= center.x;
  group.position.z -= center.z;
  group.position.y -= box.min.y;
  group.updateMatrixWorld(true);
}

function metaFor(group, id) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  return {
    sourceFile: 'create_cloud_teapot_modules.mjs',
    normalizedFile: `${id}.norm.glb`,
    heightMm: Number(size.y.toFixed(3)),
    footprint: {
      xMm: Number(size.x.toFixed(3)),
      zMm: Number(size.z.toFixed(3)),
    },
    boundsMm: [
      [Number(box.min.x.toFixed(3)), Number(box.min.y.toFixed(3)), Number(box.min.z.toFixed(3))],
      [Number(box.max.x.toFixed(3)), Number(box.max.y.toFixed(3)), Number(box.max.z.toFixed(3))],
    ],
    transform: {
      convention: 'Y-up, 1 unit = 1mm',
      scale: 1,
      droppedToY0: true,
      centeredXZ: true,
      authoredLocally: true,
    },
  };
}

async function exportGlb(id, group) {
  normalizeToGround(group);
  const exporter = new GLTFExporter();
  const arrayBuffer = await exporter.parseAsync(group, { binary: true, trs: false });
  fs.writeFileSync(path.join(OUT_DIR, `${id}.norm.glb`), Buffer.from(arrayBuffer));
  fs.writeFileSync(path.join(OUT_DIR, `${id}.meta.json`), `${JSON.stringify(metaFor(group, id), null, 2)}\n`);
}

function buildCloudMossPlatform() {
  const group = new THREE.Group();
  addCloudLumps(group, [
    { p: [-66, 23, 0], s: [34, 22, 24] },
    { p: [-32, 26, -9], s: [38, 25, 26] },
    { p: [5, 28, 3], s: [42, 27, 29] },
    { p: [42, 24, -8], s: [36, 23, 24] },
    { p: [70, 22, 8], s: [28, 20, 22] },
  ]);
  addMossPatch(group, -20, -4, 118, 36);
  addStar(group, materials.pink, [58, 48, 10], 0.55, [0.8, 0.1, -0.3]);
  return group;
}

function buildCloudHammock() {
  const group = new THREE.Group();
  addCloudLumps(group, [
    { p: [-55, 24, 4], s: [31, 22, 24] },
    { p: [-22, 31, -8], s: [35, 27, 28] },
    { p: [19, 29, 0], s: [38, 26, 30] },
    { p: [56, 23, 7], s: [29, 21, 24] },
  ]);
  addMesh(group, new THREE.TorusGeometry(48, 4, 12, 72), materials.pink, [0, 48, 0], [1, 0.22, 0.45], [Math.PI / 2, 0, 0]);
  addStar(group, materials.pink, [-28, 48, 17], 0.5, [0.45, 0.15, -0.35]);
  return group;
}

function buildStarSpiralRamp() {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-72, 16, 34),
    new THREE.Vector3(-38, 43, -34),
    new THREE.Vector3(12, 74, 28),
    new THREE.Vector3(54, 105, -26),
    new THREE.Vector3(82, 126, 22),
  ]);
  addMesh(group, new THREE.TubeGeometry(curve, 72, 13, 22, false), materials.cloud);
  addMesh(group, new THREE.CylinderGeometry(42, 54, 18, 42), materials.cloudShadow, [-70, 12, 34], [1, 1, 0.75]);
  addMesh(group, new THREE.SphereGeometry(1, 24, 14), materials.cloud, [-28, 12, -36], [72, 18, 30]);
  addStar(group, materials.pink, [-68, 41, 35], 0.7, [0.5, 0.2, -0.6]);
  addStar(group, materials.pink, [48, 106, -12], 1.0, [0.9, -0.2, 0.5]);
  return group;
}

function buildWoodDnaLadder() {
  const group = new THREE.Group();
  const left = [];
  const right = [];
  const turns = 1.45;
  const steps = 44;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const y = t * 210;
    left.push(new THREE.Vector3(Math.cos(angle) * 27, y, Math.sin(angle) * 18));
    right.push(new THREE.Vector3(Math.cos(angle + Math.PI) * 27, y, Math.sin(angle + Math.PI) * 18));
  }
  addMesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(left), 96, 5, 14, false), materials.wood);
  addMesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(right), 96, 5, 14, false), materials.wood);
  for (let i = 4; i < steps; i += 5) {
    cylinderBetween(group, left[i].toArray(), right[i].toArray(), 4, i % 10 === 4 ? materials.woodDark : materials.wood);
  }
  addMossPatch(group, -18, 10, 60, 32);
  addMossPatch(group, 25, -12, 52, 30);
  return group;
}

const builders = {
  'cloud-moss-platform': buildCloudMossPlatform,
  'cloud-hammock': buildCloudHammock,
  'star-spiral-ramp': buildStarSpiralRamp,
  'wood-dna-ladder': buildWoodDnaLadder,
};

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [id, build] of Object.entries(builders)) {
  await exportGlb(id, build());
  console.log(`wrote ${id}`);
}
