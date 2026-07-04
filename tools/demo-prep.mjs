#!/usr/bin/env node
// demo 预热：生成"双轨编排"的第二轨项目（讲解时展示的已完成项目）。
// 用法：node tools/demo-prep.mjs [--real] [--base http://localhost:3000]
//   默认 mock（秒级）；--real 走真链（fal + Meshy，约 3 分钟，消耗额度）。
// 产出：打印可直接打开的恢复 URL（?project=<id>）。store 是内存态，server 重启后需重跑本脚本。

const args = process.argv.slice(2);
const real = args.includes('--real');
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3000';
const mockQS = real ? '' : '?mock=1';

const j = (r) => r.json();
const project = await fetch(`${base}/api/project`, { method: 'POST' }).then(j);
const id = project.id;
console.log(`[prep] project=${id} mode=${real ? 'REAL' : 'mock'}`);

if (real) {
  // 真链需要一张宠物照：用 hero 海报图代替（demo 前也可先在页面上传真照片再手动生成）。
  const img = await fetch(`${base}/assets/hero-mouse-poster.jpeg`).then((r) => r.arrayBuffer());
  const fd = new FormData();
  fd.append('file', new Blob([img], { type: 'image/jpeg' }), 'pet.jpg');
  fd.append('kind', 'pet');
  await fetch(`${base}/api/project/${id}/upload`, { method: 'POST', body: fd });
  console.log('[prep] pet photo uploaded');
}

await fetch(`${base}/api/project/${id}/avatar${mockQS}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ wearables: ['knit-hat'], species: 'rat', petSize: 3 }),
});

process.stdout.write('[prep] generating');
const deadline = Date.now() + (real ? 8 * 60_000 : 60_000);
let proj;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 3000));
  proj = await fetch(`${base}/api/project/${id}`).then(j);
  process.stdout.write(`.${proj.avatar?.stage || proj.avatar?.status || ''}`);
  if (proj.avatar?.status === 'done' && proj.avatarSlice?.status === 'done') break;
  if (proj.avatar?.status === 'failed') { console.error(`\n[prep] FAILED: ${proj.avatar.error}`); process.exit(1); }
}
if (proj?.avatar?.status !== 'done') { console.error('\n[prep] TIMEOUT'); process.exit(1); }

console.log(`\n[prep] done. weight=${proj.avatarSlice?.weightG}g time=${proj.avatarSlice?.printTimeMin}min`);
console.log(`\n第二轨恢复 URL（讲解时打开）：\n  ${base}/${mockQS ? mockQS + '&' : '?'}project=${id}\n`);
