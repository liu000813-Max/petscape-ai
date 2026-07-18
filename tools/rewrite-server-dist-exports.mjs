// worker/Dockerfile 构建期专用：把 packages/server/package.json 的
// `exports`/`main` 从开发态的 `./src/**/*.ts` 源码路径改写为编译产物
// `./dist/**/*.js`，使 worker 的生产构建（tsc + pnpm deploy）能以标准
// Node 模块解析消费已编译的 @petscape/server，而不是把 TS 源码一起吞进来。
//
// 只在 Docker 构建阶段的临时文件系统内运行，不改动仓库内 package.json
// （本地开发、CI typecheck 仍使用未改写的 exports 指向 src/*.ts）。
//
// 用法：node tools/rewrite-server-dist-exports.mjs <path-to-packages/server>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const serverDir = process.argv[2];
if (!serverDir) {
  console.error('用法: node rewrite-server-dist-exports.mjs <packages/server 目录>');
  process.exit(1);
}

const pkgPath = join(serverDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

if (!pkg.exports || typeof pkg.exports !== 'object') {
  console.error(`${pkgPath} 缺少预期的 exports 字段，拒绝改写（可能上游结构已变化）`);
  process.exit(1);
}

const distExports = {};
for (const [key, srcPath] of Object.entries(pkg.exports)) {
  if (typeof srcPath !== 'string' || !srcPath.startsWith('./src/') || !srcPath.endsWith('.ts')) {
    console.error(`${pkgPath} exports["${key}"] = "${srcPath}" 不符合预期形态（./src/**/*.ts），拒绝改写`);
    process.exit(1);
  }
  distExports[key] = srcPath.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
}

pkg.exports = distExports;
pkg.main = distExports['.'] ?? './dist/index.js';

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[rewrite-server-dist-exports] ${pkgPath} exports 已改写为 dist 路径：`);
console.log(JSON.stringify(distExports, null, 2));
