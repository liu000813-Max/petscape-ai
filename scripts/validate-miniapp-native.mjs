import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const compilerDir = process.argv[2];
if (!compilerDir) throw new Error('Usage: node scripts/validate-miniapp-native.mjs <WeChat devtools wcc-exec directory>');
const root = fileURLToPath(new URL('../miniapp/', import.meta.url));
const pages = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')).pages;
const outputDir = mkdtempSync(path.join(tmpdir(), 'petscape-native-'));
for (const [compiler, extension, sources] of [
  ['wcc', 'wxml', pages.map((page) => page + '.wxml')],
  ['wcsc', 'wxss', ['app.wxss', ...pages.map((page) => page + '.wxss')]],
]) {
  const binary = path.join(compilerDir, compiler + (process.platform === 'win32' ? '.exe' : ''));
  const result = spawnSync(binary, ['-o', path.join(outputDir, compiler + '.js'), ...sources], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${extension} compiler failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  console.log(`${compiler}: compiled ${sources.length} ${extension} files`);
  if (result.stderr.trim()) console.log(result.stderr.trim());
}
console.log(`Native compiler artifacts: ${outputDir}`);
