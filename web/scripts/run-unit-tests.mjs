// web/scripts/run-unit-tests.mjs —— `pnpm test` 的入口（WP-A2）。
//
// 只跑无外部依赖的单元测试（tests/*.test.mjs），排除 tests/e2e-*.test.mjs——
// 后者需要一个已迁移的 Postgres（DATABASE_URL）+ Playwright Chromium，
// 不满足 CI「Test (web)」步骤当前的前置条件（该步骤先于任何 DB 迁移执行，
// 也未安装浏览器）。e2e 测试单独走 `pnpm test:e2e`，由具备这些前置条件的
// 调用方（本地开发/未来专门的 CI job）显式触发。
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const testsDir = fileURLToPath(new URL('../tests/', import.meta.url));
const entries = await readdir(testsDir);
const files = entries
  .filter((name) => name.endsWith('.test.mjs') && !name.startsWith('e2e-'))
  .sort();

if (files.length === 0) {
  console.error('[run-unit-tests] tests/*.test.mjs 下未找到非 e2e 测试文件');
  process.exit(1);
}

const child = spawn('node', ['--test', ...files.map((f) => `tests/${f}`)], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
